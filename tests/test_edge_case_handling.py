"""
Unit tests for edge case handling middleware.

Tests cover:
- Database connection failures
- External API failures
- Network timeouts
- Data validation errors
- Graceful degradation
- Retry mechanisms
- Circuit breaker patterns
"""

import time
from unittest.mock import Mock, patch, MagicMock
from django.test import TestCase, RequestFactory, override_settings
from django.http import JsonResponse
from django.core.cache import cache
from django.db import DatabaseError, OperationalError
from django.core.exceptions import ValidationError, PermissionDenied
from django.http import Http404
from django.conf import settings
import requests
from requests.exceptions import RequestException, Timeout, ConnectionError
import redis
from redis.exceptions import RedisError, ConnectionError as RedisConnectionError

from elate_chatbot.edge_case_middleware import (
    EdgeCaseHandlingMiddleware,
    RetryMiddleware,
    GracefulDegradationMiddleware,
    CircuitBreaker,
    retry_on_failure,
    circuit_breaker,
    fallback_response
)


class CircuitBreakerTest(TestCase):
    """Test cases for CircuitBreaker class."""
    
    def setUp(self):
        """Set up test data."""
        self.breaker = CircuitBreaker(
            failure_threshold=3,
            recovery_timeout=60,
            expected_exception=Exception
        )
    
    def test_circuit_breaker_closed_state(self):
        """Test circuit breaker in CLOSED state."""
        self.assertEqual(self.breaker.state, 'CLOSED')
        
        # Successful call should remain closed
        def successful_func():
            return "success"
        
        result = self.breaker.call(successful_func)
        self.assertEqual(result, "success")
        self.assertEqual(self.breaker.state, 'CLOSED')
        self.assertEqual(self.breaker.failure_count, 0)
    
    def test_circuit_breaker_opens_after_failures(self):
        """Test circuit breaker opens after reaching failure threshold."""
        def failing_func():
            raise Exception("Test failure")
        
        # Call failing function multiple times
        for i in range(3):
            with self.assertRaises(Exception):
                self.breaker.call(failing_func)
        
        # Circuit should be open after 3 failures
        self.assertEqual(self.breaker.state, 'OPEN')
        self.assertEqual(self.breaker.failure_count, 3)
        
        # Next call should fail immediately
        with self.assertRaises(Exception) as context:
            self.breaker.call(failing_func)
        self.assertIn("Circuit breaker is OPEN", str(context.exception))
    
    def test_circuit_breaker_half_open_recovery(self):
        """Test circuit breaker transitions to HALF_OPEN after timeout."""
        def failing_func():
            raise Exception("Test failure")
        
        # Open the circuit
        for i in range(3):
            with self.assertRaises(Exception):
                self.breaker.call(failing_func)
        
        self.assertEqual(self.breaker.state, 'OPEN')
        
        # Fast forward time past recovery timeout
        with patch('time.time') as mock_time:
            mock_time.return_value = time.time() + 61  # Past 60 second timeout
            
            # Circuit should be HALF_OPEN
            self.assertEqual(self.breaker.state, 'HALF_OPEN')
            
            # Successful call should close the circuit
            def successful_func():
                return "success"
            
            result = self.breaker.call(successful_func)
            self.assertEqual(result, "success")
            self.assertEqual(self.breaker.state, 'CLOSED')
            self.assertEqual(self.breaker.failure_count, 0)
    
    def test_circuit_breaker_half_open_failure(self):
        """Test circuit breaker reopens after failure in HALF_OPEN state."""
        def failing_func():
            raise Exception("Test failure")
        
        # Open the circuit
        for i in range(3):
            with self.assertRaises(Exception):
                self.breaker.call(failing_func)
        
        # Fast forward time past recovery timeout
        with patch('time.time') as mock_time:
            mock_time.return_value = time.time() + 61
            
            # Circuit should be HALF_OPEN
            self.assertEqual(self.breaker.state, 'HALF_OPEN')
            
            # Another failure should reopen the circuit
            with self.assertRaises(Exception):
                self.breaker.call(failing_func)
            
            self.assertEqual(self.breaker.state, 'OPEN')
            self.assertEqual(self.breaker.failure_count, 4)


class EdgeCaseHandlingMiddlewareTest(TestCase):
    """Test cases for EdgeCaseHandlingMiddleware."""
    
    def setUp(self):
        """Set up test data."""
        self.factory = RequestFactory()
        self.middleware = EdgeCaseHandlingMiddleware()
        
        # Clear cache before each test
        cache.clear()
    
    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
    
    def test_check_system_health_success(self):
        """Test system health check when all systems are healthy."""
        with patch('django.db.connection.cursor') as mock_cursor:
            mock_cursor.return_value.__enter__.return_value.execute.return_value = None
            
            with patch('django.core.cache.cache.get') as mock_cache:
                mock_cache.return_value = None
                
                result = self.middleware._check_system_health()
                self.assertTrue(result)
    
    def test_check_system_health_database_failure(self):
        """Test system health check when database is down."""
        with patch('django.db.connection.cursor') as mock_cursor:
            mock_cursor.side_effect = DatabaseError("Database connection failed")
            
            result = self.middleware._check_system_health()
            self.assertFalse(result)
    
    def test_check_system_health_cache_failure(self):
        """Test system health check when cache is down."""
        with patch('django.db.connection.cursor') as mock_cursor:
            mock_cursor.return_value.__enter__.return_value.execute.return_value = None
            
            with patch('django.core.cache.cache.get') as mock_cache:
                mock_cache.side_effect = RedisError("Cache connection failed")
                
                result = self.middleware._check_system_health()
                self.assertFalse(result)
    
    def test_create_health_check_response(self):
        """Test creation of health check response."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.request_id = 'test-request-id'
        
        response = self.middleware._create_health_check_response(request)
        
        self.assertIsInstance(response, JsonResponse)
        self.assertEqual(response.status_code, 503)
        
        data = response.json()
        self.assertEqual(data['error'], 'Service temporarily unavailable')
        self.assertEqual(data['error_id'], 'test-request-id')
        self.assertEqual(data['code'], 'SERVICE_UNAVAILABLE')
    
    def test_validate_request_data_success(self):
        """Test request data validation for valid requests."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        
        result = self.middleware._validate_request_data(request)
        self.assertIsNone(result)
    
    def test_validate_request_data_too_large(self):
        """Test request data validation for oversized requests."""
        request = self.factory.post('/api/v1/chatbot/conversations/')
        request.META['CONTENT_LENGTH'] = '11000000'  # 11MB
        
        result = self.middleware._validate_request_data(request)
        
        self.assertIsInstance(result, JsonResponse)
        self.assertEqual(result.status_code, 413)
        
        data = result.json()
        self.assertEqual(data['error'], 'Request too large')
        self.assertEqual(data['code'], 'REQUEST_TOO_LARGE')
    
    def test_validate_request_data_invalid_content_type(self):
        """Test request data validation for invalid content type."""
        request = self.factory.post('/api/v1/chatbot/conversations/')
        request.META['CONTENT_TYPE'] = 'text/plain'
        
        result = self.middleware._validate_request_data(request)
        
        self.assertIsInstance(result, JsonResponse)
        self.assertEqual(result.status_code, 400)
        
        data = result.json()
        self.assertEqual(data['error'], 'Invalid content type')
        self.assertEqual(data['code'], 'INVALID_CONTENT_TYPE')
    
    def test_handle_database_error(self):
        """Test handling of database errors."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.request_id = 'test-request-id'
        
        exception = DatabaseError("Database connection failed")
        
        with patch('django.db.connection.close') as mock_close:
            with patch('django.db.connection.ensure_connection') as mock_ensure:
                response = self.middleware._handle_database_error(request, exception, 'test-error-id')
                
                self.assertIsInstance(response, JsonResponse)
                self.assertEqual(response.status_code, 500)
                
                data = response.json()
                self.assertEqual(data['error'], 'Database error')
                self.assertEqual(data['error_id'], 'test-error-id')
                self.assertEqual(data['code'], 'DATABASE_ERROR')
    
    def test_handle_validation_error(self):
        """Test handling of validation errors."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.request_id = 'test-request-id'
        
        exception = ValidationError("Invalid data")
        
        response = self.middleware._handle_validation_error(request, exception, 'test-error-id')
        
        self.assertIsInstance(response, JsonResponse)
        self.assertEqual(response.status_code, 400)
        
        data = response.json()
        self.assertEqual(data['error'], 'Validation error')
        self.assertEqual(data['error_id'], 'test-error-id')
        self.assertEqual(data['code'], 'VALIDATION_ERROR')
        self.assertIn('errors', data)
    
    def test_handle_permission_error(self):
        """Test handling of permission errors."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.request_id = 'test-request-id'
        
        exception = PermissionDenied("Access denied")
        
        response = self.middleware._handle_permission_error(request, exception, 'test-error-id')
        
        self.assertIsInstance(response, JsonResponse)
        self.assertEqual(response.status_code, 403)
        
        data = response.json()
        self.assertEqual(data['error'], 'Permission denied')
        self.assertEqual(data['error_id'], 'test-error-id')
        self.assertEqual(data['code'], 'PERMISSION_DENIED')
    
    def test_handle_not_found_error(self):
        """Test handling of 404 errors."""
        request = self.factory.get('/api/v1/chatbot/conversations/999/')
        request.request_id = 'test-request-id'
        
        exception = Http404("Resource not found")
        
        response = self.middleware._handle_not_found_error(request, exception, 'test-error-id')
        
        self.assertIsInstance(response, JsonResponse)
        self.assertEqual(response.status_code, 404)
        
        data = response.json()
        self.assertEqual(data['error'], 'Resource not found')
        self.assertEqual(data['error_id'], 'test-error-id')
        self.assertEqual(data['code'], 'NOT_FOUND')
    
    def test_handle_external_api_error_timeout(self):
        """Test handling of external API timeout errors."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.request_id = 'test-request-id'
        
        exception = Timeout("Request timed out")
        
        response = self.middleware._handle_external_api_error(request, exception, 'test-error-id')
        
        self.assertIsInstance(response, JsonResponse)
        self.assertEqual(response.status_code, 502)
        
        data = response.json()
        self.assertEqual(data['error'], 'External service error')
        self.assertEqual(data['error_id'], 'test-error-id')
        self.assertEqual(data['code'], 'EXTERNAL_SERVICE_TIMEOUT')
    
    def test_handle_external_api_error_connection(self):
        """Test handling of external API connection errors."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.request_id = 'test-request-id'
        
        exception = ConnectionError("Connection failed")
        
        response = self.middleware._handle_external_api_error(request, exception, 'test-error-id')
        
        self.assertIsInstance(response, JsonResponse)
        self.assertEqual(response.status_code, 502)
        
        data = response.json()
        self.assertEqual(data['error'], 'External service error')
        self.assertEqual(data['error_id'], 'test-error-id')
        self.assertEqual(data['code'], 'EXTERNAL_SERVICE_CONNECTION_ERROR')
    
    def test_handle_cache_error(self):
        """Test handling of cache errors."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.request_id = 'test-request-id'
        
        exception = RedisError("Cache connection failed")
        
        with patch('django.core.cache.cache.client.connection_pool.disconnect') as mock_disconnect:
            with patch('django.core.cache.cache.client.connection_pool.reset') as mock_reset:
                result = self.middleware._handle_cache_error(request, exception, 'test-error-id')
                
                # Should return None to continue without cache
                self.assertIsNone(result)
                
                # Should attempt to reset cache connection
                mock_disconnect.assert_called_once()
                mock_reset.assert_called_once()
    
    def test_handle_generic_error_debug_mode(self):
        """Test handling of generic errors in debug mode."""
        with override_settings(DEBUG=True):
            request = self.factory.get('/api/v1/chatbot/conversations/')
            request.request_id = 'test-request-id'
            
            exception = Exception("Unexpected error")
            
            response = self.middleware._handle_generic_error(request, exception, 'test-error-id')
            
            self.assertIsInstance(response, JsonResponse)
            self.assertEqual(response.status_code, 500)
            
            data = response.json()
            self.assertEqual(data['error'], 'Internal server error')
            self.assertEqual(data['error_id'], 'test-error-id')
            self.assertEqual(data['message'], 'Unexpected error')
            self.assertEqual(data['type'], 'Exception')
            self.assertIn('traceback', data)
    
    def test_handle_generic_error_production_mode(self):
        """Test handling of generic errors in production mode."""
        with override_settings(DEBUG=False):
            request = self.factory.get('/api/v1/chatbot/conversations/')
            request.request_id = 'test-request-id'
            
            exception = Exception("Unexpected error")
            
            response = self.middleware._handle_generic_error(request, exception, 'test-error-id')
            
            self.assertIsInstance(response, JsonResponse)
            self.assertEqual(response.status_code, 500)
            
            data = response.json()
            self.assertEqual(data['error'], 'Internal server error')
            self.assertEqual(data['error_id'], 'test-error-id')
            self.assertEqual(data['message'], 'An unexpected error occurred. Please try again later.')
            self.assertEqual(data['code'], 'INTERNAL_ERROR')
            self.assertNotIn('traceback', data)
    
    def test_get_service_name_from_request(self):
        """Test extraction of service name from request path."""
        # Test OpenAI service
        request = self.factory.get('/api/v1/chatbot/openai/')
        service_name = self.middleware._get_service_name_from_request(request)
        self.assertEqual(service_name, 'openai')
        
        # Test email service
        request = self.factory.get('/api/v1/email/send/')
        service_name = self.middleware._get_service_name_from_request(request)
        self.assertEqual(service_name, 'email')
        
        # Test SMS service
        request = self.factory.get('/api/v1/sms/send/')
        service_name = self.middleware._get_service_name_from_request(request)
        self.assertEqual(service_name, 'sms')
        
        # Test unknown service
        request = self.factory.get('/api/v1/chatbot/conversations/')
        service_name = self.middleware._get_service_name_from_request(request)
        self.assertIsNone(service_name)
    
    def test_get_circuit_breaker(self):
        """Test getting or creating circuit breaker for service."""
        service_name = 'test_service'
        
        # First call should create new circuit breaker
        breaker1 = self.middleware._get_circuit_breaker(service_name)
        self.assertIsInstance(breaker1, CircuitBreaker)
        
        # Second call should return same instance
        breaker2 = self.middleware._get_circuit_breaker(service_name)
        self.assertIs(breaker1, breaker2)
        
        # Different service should create new circuit breaker
        breaker3 = self.middleware._get_circuit_breaker('different_service')
        self.assertIsNot(breaker1, breaker3)


class RetryMiddlewareTest(TestCase):
    """Test cases for RetryMiddleware."""
    
    def setUp(self):
        """Set up test data."""
        self.factory = RequestFactory()
        self.middleware = RetryMiddleware()
    
    def test_should_retry_get_request(self):
        """Test that GET requests should be retried."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        exception = Exception("Test exception")
        
        result = self.middleware._should_retry(request, exception)
        self.assertTrue(result)
    
    def test_should_not_retry_delete_request(self):
        """Test that DELETE requests should not be retried."""
        request = self.factory.delete('/api/v1/chatbot/conversations/1/')
        exception = Exception("Test exception")
        
        result = self.middleware._should_retry(request, exception)
        self.assertFalse(result)
    
    def test_should_not_retry_validation_error(self):
        """Test that validation errors should not be retried."""
        request = self.factory.post('/api/v1/chatbot/conversations/')
        exception = ValidationError("Invalid data")
        
        result = self.middleware._should_retry(request, exception)
        self.assertFalse(result)
    
    def test_should_not_retry_permission_denied(self):
        """Test that permission denied errors should not be retried."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        exception = PermissionDenied("Access denied")
        
        result = self.middleware._should_retry(request, exception)
        self.assertFalse(result)
    
    def test_should_not_retry_http404(self):
        """Test that 404 errors should not be retried."""
        request = self.factory.get('/api/v1/chatbot/conversations/999/')
        exception = Http404("Resource not found")
        
        result = self.middleware._should_retry(request, exception)
        self.assertFalse(result)


class GracefulDegradationMiddlewareTest(TestCase):
    """Test cases for GracefulDegradationMiddleware."""
    
    def setUp(self):
        """Set up test data."""
        self.factory = RequestFactory()
        self.middleware = GracefulDegradationMiddleware()
    
    def test_check_degradation_mode_none(self):
        """Test degradation mode check when all services are healthy."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        
        with patch.object(self.middleware, '_check_database_availability', return_value=True):
            with patch.object(self.middleware, '_check_cache_availability', return_value=True):
                with patch.object(self.middleware, '_check_openai_availability', return_value=True):
                    result = self.middleware._check_degradation_mode(request)
                    self.assertIsNone(result)
    
    def test_check_degradation_mode_database_unavailable(self):
        """Test degradation mode when database is unavailable."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        
        with patch.object(self.middleware, '_check_database_availability', return_value=False):
            result = self.middleware._check_degradation_mode(request)
            self.assertEqual(result, 'database_unavailable')
    
    def test_check_degradation_mode_cache_unavailable(self):
        """Test degradation mode when cache is unavailable."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        
        with patch.object(self.middleware, '_check_database_availability', return_value=True):
            with patch.object(self.middleware, '_check_cache_availability', return_value=False):
                result = self.middleware._check_degradation_mode(request)
                self.assertEqual(result, 'cache_unavailable')
    
    def test_check_degradation_mode_ai_service_unavailable(self):
        """Test degradation mode when AI service is unavailable."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        
        with patch.object(self.middleware, '_check_database_availability', return_value=True):
            with patch.object(self.middleware, '_check_cache_availability', return_value=True):
                with patch.object(self.middleware, '_check_openai_availability', return_value=False):
                    result = self.middleware._check_degradation_mode(request)
                    self.assertEqual(result, 'ai_service_unavailable')
    
    def test_check_degradation_mode_email_service_unavailable(self):
        """Test degradation mode when email service is unavailable."""
        request = self.factory.get('/api/v1/email/send/')
        
        with patch.object(self.middleware, '_check_database_availability', return_value=True):
            with patch.object(self.middleware, '_check_cache_availability', return_value=True):
                with patch.object(self.middleware, '_check_email_service_availability', return_value=False):
                    result = self.middleware._check_degradation_mode(request)
                    self.assertEqual(result, 'email_service_unavailable')
    
    def test_get_degradation_reason(self):
        """Test getting degradation reason."""
        reasons = {
            'database_unavailable': 'Database service is temporarily unavailable',
            'cache_unavailable': 'Cache service is temporarily unavailable',
            'ai_service_unavailable': 'AI service is temporarily unavailable',
            'email_service_unavailable': 'Email service is temporarily unavailable',
        }
        
        for mode, expected_reason in reasons.items():
            reason = self.middleware._get_degradation_reason(mode)
            self.assertEqual(reason, expected_reason)
        
        # Test unknown degradation mode
        reason = self.middleware._get_degradation_reason('unknown_mode')
        self.assertEqual(reason, 'Service degradation detected')


class UtilityDecoratorsTest(TestCase):
    """Test cases for utility decorators."""
    
    def test_retry_on_failure_success(self):
        """Test retry decorator with successful function."""
        @retry_on_failure(max_retries=3)
        def successful_func():
            return "success"
        
        result = successful_func()
        self.assertEqual(result, "success")
    
    def test_retry_on_failure_eventual_success(self):
        """Test retry decorator with function that eventually succeeds."""
        call_count = 0
        
        @retry_on_failure(max_retries=3, delay=0.1)
        def eventually_successful_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Exception("Temporary failure")
            return "success"
        
        result = eventually_successful_func()
        self.assertEqual(result, "success")
        self.assertEqual(call_count, 3)
    
    def test_retry_on_failure_max_retries_exceeded(self):
        """Test retry decorator when max retries are exceeded."""
        @retry_on_failure(max_retries=2, delay=0.1)
        def always_failing_func():
            raise Exception("Persistent failure")
        
        with self.assertRaises(Exception) as context:
            always_failing_func()
        
        self.assertEqual(str(context.exception), "Persistent failure")
    
    def test_circuit_breaker_decorator(self):
        """Test circuit breaker decorator."""
        @circuit_breaker(failure_threshold=2, recovery_timeout=1)
        def failing_func():
            raise Exception("Test failure")
        
        # First two calls should fail
        for i in range(2):
            with self.assertRaises(Exception):
                failing_func()
        
        # Third call should fail immediately due to open circuit
        with self.assertRaises(Exception) as context:
            failing_func()
        self.assertIn("Circuit breaker is OPEN", str(context.exception))
    
    def test_fallback_response_decorator(self):
        """Test fallback response decorator."""
        def fallback_func(*args, **kwargs):
            return "fallback response"
        
        @fallback_response(fallback_func)
        def failing_func(*args, **kwargs):
            raise Exception("Function failed")
        
        result = failing_func()
        self.assertEqual(result, "fallback response")
    
    def test_fallback_response_decorator_success(self):
        """Test fallback response decorator with successful function."""
        def fallback_func(*args, **kwargs):
            return "fallback response"
        
        @fallback_response(fallback_func)
        def successful_func(*args, **kwargs):
            return "success response"
        
        result = successful_func()
        self.assertEqual(result, "success response")


class EdgeCaseHandlingIntegrationTest(TestCase):
    """Integration tests for edge case handling."""
    
    def setUp(self):
        """Set up test data."""
        self.factory = RequestFactory()
        self.middleware = EdgeCaseHandlingMiddleware()
    
    def test_full_request_lifecycle_success(self):
        """Test full request lifecycle with successful processing."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        
        # Process request
        self.middleware.process_request(request)
        
        # Check that request has required attributes
        self.assertTrue(hasattr(request, 'request_id'))
        self.assertTrue(hasattr(request, 'start_time'))
        self.assertTrue(hasattr(request, 'retry_count'))
        self.assertTrue(hasattr(request, 'max_retries'))
        
        # Process response
        response = JsonResponse({'status': 'success'})
        response = self.middleware.process_response(request, response)
        
        # Check response headers
        self.assertIn('X-Request-ID', response)
        self.assertIn('X-Processing-Time', response)
    
    def test_full_request_lifecycle_with_exception(self):
        """Test full request lifecycle with exception handling."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        
        # Process request
        self.middleware.process_request(request)
        
        # Simulate exception
        exception = DatabaseError("Database connection failed")
        
        response = self.middleware.process_exception(request, exception)
        
        # Check that exception was handled
        self.assertIsInstance(response, JsonResponse)
        self.assertEqual(response.status_code, 500)
        
        data = response.json()
        self.assertEqual(data['error'], 'Database error')
        self.assertEqual(data['code'], 'DATABASE_ERROR')
    
    def test_graceful_degradation_with_cache_failure(self):
        """Test graceful degradation when cache fails."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        
        # Mock cache failure
        with patch('django.core.cache.cache.get') as mock_cache:
            mock_cache.side_effect = RedisError("Cache connection failed")
            
            # Process request
            self.middleware.process_request(request)
            
            # Process response
            response = JsonResponse({'status': 'success'})
            response = self.middleware.process_response(request, response)
            
            # Request should continue without cache
            self.assertIsInstance(response, JsonResponse)
            self.assertEqual(response.status_code, 200)
    
    def test_circuit_breaker_with_external_api(self):
        """Test circuit breaker pattern with external API calls."""
        request = self.factory.get('/api/v1/chatbot/openai/')
        
        # Process request
        self.middleware.process_request(request)
        
        # Simulate external API failure
        exception = Timeout("OpenAI API timeout")
        
        # First few calls should fail normally
        for i in range(5):
            response = self.middleware.process_exception(request, exception)
            self.assertIsInstance(response, JsonResponse)
            self.assertEqual(response.status_code, 502)
        
        # After 5 failures, circuit should be open
        response = self.middleware.process_exception(request, exception)
        self.assertIsInstance(response, JsonResponse)
        self.assertEqual(response.status_code, 503)
        
        data = response.json()
        self.assertEqual(data['code'], 'EXTERNAL_SERVICE_UNAVAILABLE')
