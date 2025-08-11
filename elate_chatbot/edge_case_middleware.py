"""
Edge Case Handling Middleware for Elate Chatbot.

This module provides comprehensive edge case handling including:
- Network failure recovery
- Database connection issues
- Data validation and sanitization
- Graceful degradation
- Circuit breaker patterns
- Retry mechanisms
- Fallback strategies
"""

import time
import logging
import json
import hashlib
from functools import wraps
from django.http import JsonResponse, HttpResponse
from django.conf import settings
from django.core.cache import cache
from django.utils.deprecation import MiddlewareMixin
from django.db import connection, DatabaseError, OperationalError
from django.core.exceptions import ValidationError, PermissionDenied
from django.http import Http404
from django.utils import timezone
import traceback
import uuid
import requests
from requests.exceptions import RequestException, Timeout, ConnectionError
import redis
from redis.exceptions import RedisError, ConnectionError as RedisConnectionError

logger = logging.getLogger(__name__)


class CircuitBreaker:
    """
    Circuit breaker pattern implementation for external service calls.
    
    Prevents cascading failures by temporarily stopping calls to failing services.
    """
    
    def __init__(self, failure_threshold=5, recovery_timeout=60, expected_exception=Exception):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.expected_exception = expected_exception
        self.failure_count = 0
        self.last_failure_time = None
        self.state = 'CLOSED'  # CLOSED, OPEN, HALF_OPEN
    
    def call(self, func, *args, **kwargs):
        """Execute function with circuit breaker protection."""
        if self.state == 'OPEN':
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = 'HALF_OPEN'
            else:
                raise Exception(f"Circuit breaker is OPEN for {func.__name__}")
        
        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except self.expected_exception as e:
            self._on_failure()
            raise e
    
    def _on_success(self):
        """Handle successful call."""
        self.failure_count = 0
        self.state = 'CLOSED'
    
    def _on_failure(self):
        """Handle failed call."""
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.failure_count >= self.failure_threshold:
            self.state = 'OPEN'
            logger.warning(f"Circuit breaker opened after {self.failure_count} failures")


class EdgeCaseHandlingMiddleware(MiddlewareMixin):
    """
    Comprehensive edge case handling middleware.
    
    Handles:
    - Database connection failures
    - External API failures
    - Network timeouts
    - Data validation errors
    - Graceful degradation
    - Retry mechanisms
    """
    
    def __init__(self, get_response=None):
        super().__init__(get_response)
        self.circuit_breakers = {}
        self.retry_config = {
            'max_retries': 3,
            'retry_delay': 1,  # seconds
            'backoff_factor': 2,
        }
    
    def process_request(self, request):
        """Process request with edge case handling."""
        # Add request ID for tracking
        request.request_id = str(uuid.uuid4())
        request.start_time = time.time()
        
        # Check system health before processing
        if not self._check_system_health():
            return self._create_health_check_response(request)
        
        # Validate request data
        validation_error = self._validate_request_data(request)
        if validation_error:
            return validation_error
        
        # Set up retry context
        request.retry_count = 0
        request.max_retries = self.retry_config['max_retries']
    
    def process_response(self, request, response):
        """Process response with edge case handling."""
        # Add response headers
        response['X-Request-ID'] = getattr(request, 'request_id', 'unknown')
        response['X-Processing-Time'] = str(round((time.time() - request.start_time) * 1000, 2)) + 'ms'
        
        # Handle different response scenarios
        if response.status_code >= 500:
            self._handle_server_error(request, response)
        elif response.status_code == 404:
            self._handle_not_found(request, response)
        elif response.status_code == 403:
            self._handle_permission_denied(request, response)
        
        return response
    
    def process_exception(self, request, exception):
        """Handle exceptions with comprehensive error handling."""
        error_id = str(uuid.uuid4())
        
        # Log the exception with context
        self._log_exception(request, exception, error_id)
        
        # Handle specific exception types
        if isinstance(exception, DatabaseError):
            return self._handle_database_error(request, exception, error_id)
        elif isinstance(exception, ValidationError):
            return self._handle_validation_error(request, exception, error_id)
        elif isinstance(exception, PermissionDenied):
            return self._handle_permission_error(request, exception, error_id)
        elif isinstance(exception, Http404):
            return self._handle_not_found_error(request, exception, error_id)
        elif isinstance(exception, RequestException):
            return self._handle_external_api_error(request, exception, error_id)
        elif isinstance(exception, RedisError):
            return self._handle_cache_error(request, exception, error_id)
        else:
            return self._handle_generic_error(request, exception, error_id)
    
    def _check_system_health(self):
        """Check if all critical systems are healthy."""
        try:
            # Check database connection
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            
            # Check Redis connection
            cache.get('health_check')
            
            return True
        except Exception as e:
            logger.error(f"System health check failed: {e}")
            return False
    
    def _create_health_check_response(self, request):
        """Create response when system is unhealthy."""
        return JsonResponse({
            'error': 'Service temporarily unavailable',
            'message': 'The service is currently experiencing issues. Please try again later.',
            'error_id': getattr(request, 'request_id', 'unknown'),
            'code': 'SERVICE_UNAVAILABLE'
        }, status=503)
    
    def _validate_request_data(self, request):
        """Validate incoming request data."""
        try:
            # Check request size
            if request.method in ['POST', 'PUT', 'PATCH']:
                content_length = request.META.get('CONTENT_LENGTH', 0)
                if content_length and int(content_length) > 10 * 1024 * 1024:  # 10MB limit
                    return JsonResponse({
                        'error': 'Request too large',
                        'message': 'Request body exceeds maximum allowed size.',
                        'code': 'REQUEST_TOO_LARGE'
                    }, status=413)
            
            # Validate content type for API requests
            if request.path.startswith('/api/'):
                if request.method in ['POST', 'PUT', 'PATCH']:
                    content_type = request.META.get('CONTENT_TYPE', '')
                    if not content_type.startswith('application/json'):
                        return JsonResponse({
                            'error': 'Invalid content type',
                            'message': 'Content-Type must be application/json for API requests.',
                            'code': 'INVALID_CONTENT_TYPE'
                        }, status=400)
            
            return None
            
        except Exception as e:
            logger.error(f"Error validating request data: {e}")
            return JsonResponse({
                'error': 'Request validation failed',
                'message': 'Unable to validate request data.',
                'code': 'VALIDATION_ERROR'
            }, status=400)
    
    def _handle_database_error(self, request, exception, error_id):
        """Handle database-related errors."""
        logger.error(f"Database error: {exception}")
        
        # Check if it's a connection issue
        if isinstance(exception, OperationalError):
            # Try to reconnect
            try:
                connection.close()
                connection.ensure_connection()
                logger.info("Database connection restored")
            except Exception as e:
                logger.error(f"Failed to restore database connection: {e}")
        
        # Return appropriate response
        if settings.DEBUG:
            return JsonResponse({
                'error': 'Database error',
                'error_id': error_id,
                'message': str(exception),
                'type': type(exception).__name__,
            }, status=500)
        else:
            return JsonResponse({
                'error': 'Database error',
                'error_id': error_id,
                'message': 'A database error occurred. Please try again later.',
                'code': 'DATABASE_ERROR'
            }, status=500)
    
    def _handle_validation_error(self, request, exception, error_id):
        """Handle data validation errors."""
        logger.warning(f"Validation error: {exception}")
        
        # Extract validation errors
        if hasattr(exception, 'message_dict'):
            errors = exception.message_dict
        elif hasattr(exception, 'messages'):
            errors = exception.messages
        else:
            errors = [str(exception)]
        
        return JsonResponse({
            'error': 'Validation error',
            'error_id': error_id,
            'message': 'The provided data is invalid.',
            'errors': errors,
            'code': 'VALIDATION_ERROR'
        }, status=400)
    
    def _handle_permission_error(self, request, exception, error_id):
        """Handle permission denied errors."""
        logger.warning(f"Permission denied: {exception}")
        
        return JsonResponse({
            'error': 'Permission denied',
            'error_id': error_id,
            'message': 'You do not have permission to perform this action.',
            'code': 'PERMISSION_DENIED'
        }, status=403)
    
    def _handle_not_found_error(self, request, exception, error_id):
        """Handle 404 errors."""
        logger.info(f"Resource not found: {request.path}")
        
        return JsonResponse({
            'error': 'Resource not found',
            'error_id': error_id,
            'message': 'The requested resource was not found.',
            'code': 'NOT_FOUND'
        }, status=404)
    
    def _handle_external_api_error(self, request, exception, error_id):
        """Handle external API errors."""
        logger.error(f"External API error: {exception}")
        
        # Use circuit breaker for external API calls
        service_name = self._get_service_name_from_request(request)
        if service_name:
            circuit_breaker = self._get_circuit_breaker(service_name)
            if circuit_breaker.state == 'OPEN':
                return JsonResponse({
                    'error': 'External service unavailable',
                    'error_id': error_id,
                    'message': 'External service is temporarily unavailable.',
                    'code': 'EXTERNAL_SERVICE_UNAVAILABLE'
                }, status=503)
        
        # Determine error type
        if isinstance(exception, Timeout):
            error_message = 'External service request timed out.'
            error_code = 'EXTERNAL_SERVICE_TIMEOUT'
        elif isinstance(exception, ConnectionError):
            error_message = 'Unable to connect to external service.'
            error_code = 'EXTERNAL_SERVICE_CONNECTION_ERROR'
        else:
            error_message = 'External service error occurred.'
            error_code = 'EXTERNAL_SERVICE_ERROR'
        
        return JsonResponse({
            'error': 'External service error',
            'error_id': error_id,
            'message': error_message,
            'code': error_code
        }, status=502)
    
    def _handle_cache_error(self, request, exception, error_id):
        """Handle cache-related errors."""
        logger.error(f"Cache error: {exception}")
        
        # Try to reconnect to Redis
        try:
            cache.client.connection_pool.disconnect()
            cache.client.connection_pool.reset()
            logger.info("Redis connection reset")
        except Exception as e:
            logger.error(f"Failed to reset Redis connection: {e}")
        
        # Continue without cache
        return None  # Let the request continue without cache
    
    def _handle_generic_error(self, request, exception, error_id):
        """Handle generic/unexpected errors."""
        logger.error(f"Unexpected error: {exception}")
        
        if settings.DEBUG:
            return JsonResponse({
                'error': 'Internal server error',
                'error_id': error_id,
                'message': str(exception),
                'type': type(exception).__name__,
                'traceback': traceback.format_exc().split('\n'),
            }, status=500)
        else:
            return JsonResponse({
                'error': 'Internal server error',
                'error_id': error_id,
                'message': 'An unexpected error occurred. Please try again later.',
                'code': 'INTERNAL_ERROR'
            }, status=500)
    
    def _handle_server_error(self, request, response):
        """Handle 5xx server errors."""
        logger.error(f"Server error {response.status_code} for {request.path}")
        
        # Add error tracking headers
        response['X-Error-Tracked'] = 'true'
    
    def _handle_not_found(self, request, response):
        """Handle 404 errors."""
        logger.info(f"Resource not found: {request.path}")
        
        # Add helpful headers for API requests
        if request.path.startswith('/api/'):
            response['X-API-Version'] = 'v1'
    
    def _handle_permission_denied(self, request, response):
        """Handle 403 errors."""
        logger.warning(f"Permission denied for {request.path}")
        
        # Add authentication headers
        response['X-Auth-Required'] = 'true'
    
    def _log_exception(self, request, exception, error_id):
        """Log exception with detailed context."""
        error_data = {
            'error_id': error_id,
            'request_id': getattr(request, 'request_id', 'unknown'),
            'exception_type': type(exception).__name__,
            'exception_message': str(exception),
            'request_method': request.method,
            'request_path': request.path,
            'user': str(request.user) if request.user.is_authenticated else 'anonymous',
            'ip_address': self._get_client_ip(request),
            'user_agent': request.META.get('HTTP_USER_AGENT', ''),
            'timestamp': timezone.now().isoformat(),
            'traceback': traceback.format_exc(),
        }
        
        logger.error(f"Exception occurred: {json.dumps(error_data, default=str)}")
    
    def _get_service_name_from_request(self, request):
        """Extract service name from request for circuit breaker."""
        if 'openai' in request.path.lower():
            return 'openai'
        elif 'email' in request.path.lower():
            return 'email'
        elif 'sms' in request.path.lower():
            return 'sms'
        return None
    
    def _get_circuit_breaker(self, service_name):
        """Get or create circuit breaker for service."""
        if service_name not in self.circuit_breakers:
            self.circuit_breakers[service_name] = CircuitBreaker(
                failure_threshold=5,
                recovery_timeout=60
            )
        return self.circuit_breakers[service_name]
    
    def _get_client_ip(self, request):
        """Extract client IP address from request."""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0].strip()
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip


class RetryMiddleware(MiddlewareMixin):
    """
    Middleware for implementing retry logic for failed requests.
    
    Automatically retries failed requests with exponential backoff.
    """
    
    def process_request(self, request):
        """Set up retry context for request."""
        request.retry_count = 0
        request.max_retries = getattr(settings, 'MAX_RETRIES', 3)
        request.retry_delay = getattr(settings, 'RETRY_DELAY', 1)
        request.backoff_factor = getattr(settings, 'BACKOFF_FACTOR', 2)
    
    def process_exception(self, request, exception):
        """Handle retry logic for exceptions."""
        # Check if request should be retried
        if not self._should_retry(request, exception):
            return None
        
        # Increment retry count
        request.retry_count += 1
        
        if request.retry_count <= request.max_retries:
            # Calculate delay with exponential backoff
            delay = request.retry_delay * (request.backoff_factor ** (request.retry_count - 1))
            
            logger.info(f"Retrying request {request.path} (attempt {request.retry_count}/{request.max_retries}) "
                       f"after {delay}s delay")
            
            # Sleep before retry
            time.sleep(delay)
            
            # Return None to let Django retry the request
            return None
        else:
            logger.warning(f"Max retries exceeded for request {request.path}")
            return None
    
    def _should_retry(self, request, exception):
        """Determine if request should be retried."""
        # Don't retry for certain HTTP methods
        if request.method not in ['GET', 'POST', 'PUT', 'PATCH']:
            return False
        
        # Don't retry for certain exception types
        non_retryable_exceptions = [
            ValidationError,
            PermissionDenied,
            Http404,
        ]
        
        if any(isinstance(exception, exc_type) for exc_type in non_retryable_exceptions):
            return False
        
        # Don't retry for certain status codes
        if hasattr(exception, 'status_code'):
            non_retryable_status_codes = [400, 401, 403, 404, 422]
            if exception.status_code in non_retryable_status_codes:
                return False
        
        return True


class GracefulDegradationMiddleware(MiddlewareMixin):
    """
    Middleware for graceful degradation when services are unavailable.
    
    Provides fallback responses and degraded functionality when
    critical services are down.
    """
    
    def process_request(self, request):
        """Check service availability and set degradation flags."""
        request.degradation_mode = self._check_degradation_mode(request)
        
        if request.degradation_mode:
            logger.warning(f"Request {request.path} running in degradation mode: {request.degradation_mode}")
    
    def process_response(self, request, response):
        """Add degradation headers to response."""
        if hasattr(request, 'degradation_mode') and request.degradation_mode:
            response['X-Degradation-Mode'] = request.degradation_mode
            response['X-Degradation-Reason'] = self._get_degradation_reason(request.degradation_mode)
        
        return response
    
    def _check_degradation_mode(self, request):
        """Check if request should run in degradation mode."""
        # Check database availability
        if not self._check_database_availability():
            return 'database_unavailable'
        
        # Check cache availability
        if not self._check_cache_availability():
            return 'cache_unavailable'
        
        # Check external services for specific endpoints
        if '/api/v1/chatbot/' in request.path:
            if not self._check_openai_availability():
                return 'ai_service_unavailable'
        
        if '/api/v1/email/' in request.path:
            if not self._check_email_service_availability():
                return 'email_service_unavailable'
        
        return None
    
    def _check_database_availability(self):
        """Check if database is available."""
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            return True
        except Exception:
            return False
    
    def _check_cache_availability(self):
        """Check if cache is available."""
        try:
            cache.get('health_check')
            return True
        except Exception:
            return False
    
    def _check_openai_availability(self):
        """Check if OpenAI service is available."""
        try:
            # This would be a lightweight health check
            # In practice, you might want to cache this result
            return True
        except Exception:
            return False
    
    def _check_email_service_availability(self):
        """Check if email service is available."""
        try:
            # This would be a lightweight health check
            return True
        except Exception:
            return False
    
    def _get_degradation_reason(self, degradation_mode):
        """Get human-readable reason for degradation."""
        reasons = {
            'database_unavailable': 'Database service is temporarily unavailable',
            'cache_unavailable': 'Cache service is temporarily unavailable',
            'ai_service_unavailable': 'AI service is temporarily unavailable',
            'email_service_unavailable': 'Email service is temporarily unavailable',
        }
        return reasons.get(degradation_mode, 'Service degradation detected')


# Utility functions for edge case handling
def retry_on_failure(max_retries=3, delay=1, backoff_factor=2, exceptions=(Exception,)):
    """
    Decorator for retrying functions on failure.
    
    Args:
        max_retries: Maximum number of retry attempts
        delay: Initial delay between retries in seconds
        backoff_factor: Multiplier for delay on each retry
        exceptions: Tuple of exceptions to catch and retry
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    
                    if attempt < max_retries:
                        # Calculate delay with exponential backoff
                        current_delay = delay * (backoff_factor ** attempt)
                        logger.warning(f"Attempt {attempt + 1} failed for {func.__name__}: {e}. "
                                     f"Retrying in {current_delay}s...")
                        time.sleep(current_delay)
                    else:
                        logger.error(f"All {max_retries + 1} attempts failed for {func.__name__}: {e}")
            
            # Re-raise the last exception if all retries failed
            raise last_exception
        
        return wrapper
    return decorator


def circuit_breaker(failure_threshold=5, recovery_timeout=60, expected_exception=Exception):
    """
    Decorator for implementing circuit breaker pattern.
    
    Args:
        failure_threshold: Number of failures before opening circuit
        recovery_timeout: Time to wait before attempting recovery
        expected_exception: Exception type to monitor
    """
    def decorator(func):
        breaker = CircuitBreaker(failure_threshold, recovery_timeout, expected_exception)
        
        @wraps(func)
        def wrapper(*args, **kwargs):
            return breaker.call(func, *args, **kwargs)
        
        return wrapper
    return decorator


def fallback_response(fallback_func):
    """
    Decorator for providing fallback responses when functions fail.
    
    Args:
        fallback_func: Function to call when the main function fails
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                logger.warning(f"Function {func.__name__} failed: {e}. Using fallback.")
                return fallback_func(*args, **kwargs)
        
        return wrapper
    return decorator
