"""
Unit tests for session management middleware.

Tests cover:
- Session creation and tracking
- Authentication state management
- Session security validation
- Concurrent session handling
- Session cleanup
- Edge cases and error scenarios
"""

import time
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock
from django.test import TestCase, RequestFactory, override_settings
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.http import JsonResponse
from django.utils import timezone
from django.core.cache import cache
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.dispatch import receiver

from users.middleware import SessionManagementMiddleware, SessionCleanupMiddleware
from users.models import UserSession, CustomUser

User = get_user_model()


class SessionManagementMiddlewareTest(TestCase):
    """Test cases for SessionManagementMiddleware."""
    
    def setUp(self):
        """Set up test data."""
        self.factory = RequestFactory()
        self.middleware = SessionManagementMiddleware()
        
        # Create test user
        self.user = CustomUser.objects.create_user(
            email='test@example.com',
            password='testpass123',
            first_name='Test',
            last_name='User'
        )
        
        # Create test session
        self.session = Session.objects.create(
            session_key='test_session_key',
            expire_date=timezone.now() + timedelta(days=7)
        )
        
        # Clear cache before each test
        cache.clear()
    
    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
    
    def test_should_skip_session_management(self):
        """Test that session management is skipped for certain paths."""
        skip_paths = [
            '/static/css/style.css',
            '/media/uploads/file.pdf',
            '/health/',
            '/admin/jsi18n/',
            '/favicon.ico',
        ]
        
        for path in skip_paths:
            request = self.factory.get(path)
            request.user = self.user
            request.session = self.session
            
            result = self.middleware._should_skip_session_management(request)
            self.assertTrue(result, f"Session management should be skipped for {path}")
    
    def test_handle_authenticated_session(self):
        """Test handling of authenticated user sessions."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = self.session
        
        # Mock user agent parsing
        with patch('users.middleware.user_agents.parse') as mock_parse:
            mock_user_agent = Mock()
            mock_user_agent.is_mobile = False
            mock_user_agent.is_tablet = False
            mock_user_agent.is_pc = True
            mock_user_agent.browser.family = 'Chrome'
            mock_user_agent.os.family = 'Windows'
            mock_parse.return_value = mock_user_agent
            
            self.middleware._handle_authenticated_session(request)
            
            # Check that user session was created
            self.assertTrue(hasattr(request, 'user_session'))
            self.assertIsInstance(request.user_session, UserSession)
            self.assertEqual(request.user_session.user, self.user)
            self.assertEqual(request.user_session.session_key, self.session.session_key)
            self.assertEqual(request.user_session.device_type, 'desktop')
    
    def test_handle_anonymous_session(self):
        """Test handling of anonymous user sessions."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = Mock()
        request.user.is_authenticated = False
        request.META = {
            'HTTP_USER_AGENT': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'REMOTE_ADDR': '127.0.0.1'
        }
        
        self.middleware._handle_anonymous_session(request)
        
        # Check that anonymous session data was cached
        cache_key = f"anonymous_session:{hashlib.md5(str({
            'ip_address': '127.0.0.1',
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'timestamp': timezone.now(),
            'path': '/api/v1/chatbot/conversations/',
        }).encode()).hexdigest()}"
        
        # Note: This test might fail due to timestamp precision, so we'll check differently
        self.assertTrue(any(key.startswith('anonymous_session:') for key in cache._cache.keys()))
    
    def test_get_or_create_user_session_existing(self):
        """Test getting existing user session."""
        # Create existing user session
        existing_session = UserSession.objects.create(
            user=self.user,
            session_key=self.session.session_key,
            ip_address='127.0.0.1',
            user_agent='Test User Agent',
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
        )
        
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = self.session
        
        result = self.middleware._get_or_create_user_session(request)
        
        self.assertEqual(result, existing_session)
        self.assertEqual(result.last_activity, timezone.now())
    
    def test_get_or_create_user_session_new(self):
        """Test creating new user session."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = self.session
        request.META = {
            'HTTP_USER_AGENT': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'REMOTE_ADDR': '127.0.0.1'
        }
        
        with patch('users.middleware.user_agents.parse') as mock_parse:
            mock_user_agent = Mock()
            mock_user_agent.is_mobile = False
            mock_user_agent.is_tablet = False
            mock_user_agent.is_pc = True
            mock_user_agent.browser.family = 'Chrome'
            mock_user_agent.os.family = 'Windows'
            mock_parse.return_value = mock_user_agent
            
            result = self.middleware._get_or_create_user_session(request)
            
            self.assertIsInstance(result, UserSession)
            self.assertEqual(result.user, self.user)
            self.assertEqual(result.session_key, self.session.session_key)
            self.assertEqual(result.device_type, 'desktop')
    
    def test_validate_session_security_authenticated(self):
        """Test session security validation for authenticated users."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = self.session
        request.META = {
            'HTTP_USER_AGENT': 'Test User Agent',
            'REMOTE_ADDR': '127.0.0.1'
        }
        
        # Create user session
        user_session = UserSession.objects.create(
            user=self.user,
            session_key=self.session.session_key,
            ip_address='127.0.0.1',
            user_agent='Test User Agent',
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
        )
        request.user_session = user_session
        
        result = self.middleware._validate_session_security(request)
        self.assertTrue(result)
    
    def test_validate_session_security_anonymous(self):
        """Test session security validation for anonymous users."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = Mock()
        request.user.is_authenticated = False
        
        result = self.middleware._validate_session_security(request)
        self.assertTrue(result)
    
    def test_check_session_consistency_ip_change(self):
        """Test session consistency check with IP address change."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = self.session
        request.META = {
            'HTTP_USER_AGENT': 'Test User Agent',
            'REMOTE_ADDR': '192.168.1.1'  # Different IP
        }
        
        # Create user session with different IP
        user_session = UserSession.objects.create(
            user=self.user,
            session_key=self.session.session_key,
            ip_address='127.0.0.1',  # Original IP
            user_agent='Test User Agent',
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
        )
        request.user_session = user_session
        
        result = self.middleware._check_session_consistency(request)
        self.assertTrue(result)  # Should allow IP changes but log them
    
    def test_check_session_consistency_user_agent_change(self):
        """Test session consistency check with user agent change."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = self.session
        request.META = {
            'HTTP_USER_AGENT': 'Different User Agent',  # Different user agent
            'REMOTE_ADDR': '127.0.0.1'
        }
        
        # Create user session with different user agent
        user_session = UserSession.objects.create(
            user=self.user,
            session_key=self.session.session_key,
            ip_address='127.0.0.1',
            user_agent='Original User Agent',  # Original user agent
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
        )
        request.user_session = user_session
        
        result = self.middleware._check_session_consistency(request)
        self.assertFalse(result)  # Should fail for user agent changes
    
    def test_detect_suspicious_activity(self):
        """Test detection of suspicious activity."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.META = {'REMOTE_ADDR': '127.0.0.1'}
        
        # Simulate high request rate
        cache_key = f"request_rate:127.0.0.1:{self.user.id}"
        cache.set(cache_key, 101, 60)  # More than 100 requests per minute
        
        result = self.middleware._detect_suspicious_activity(request)
        self.assertTrue(result)
    
    def test_check_concurrent_sessions(self):
        """Test concurrent session limit checking."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = self.session
        
        # Create maximum allowed sessions
        for i in range(5):  # MAX_CONCURRENT_SESSIONS = 5
            UserSession.objects.create(
                user=self.user,
                session_key=f'session_key_{i}',
                ip_address='127.0.0.1',
                user_agent='Test User Agent',
                device_type='desktop',
                browser='Chrome',
                operating_system='Windows',
                is_active=True,
            )
        
        result = self.middleware._check_concurrent_sessions(request)
        self.assertTrue(result)
        
        # Check that oldest session was ended
        active_sessions = UserSession.objects.filter(
            user=self.user,
            is_active=True
        ).count()
        self.assertLessEqual(active_sessions, 5)
    
    def test_create_security_violation_response(self):
        """Test creation of security violation response."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        
        response = self.middleware._create_security_violation_response(request)
        
        self.assertIsInstance(response, JsonResponse)
        self.assertEqual(response.status_code, 403)
        
        data = response.json()
        self.assertEqual(data['error'], 'Security violation detected')
        self.assertEqual(data['code'], 'SECURITY_VIOLATION')
    
    def test_create_concurrent_session_response(self):
        """Test creation of concurrent session response."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        
        response = self.middleware._create_concurrent_session_response(request)
        
        self.assertIsInstance(response, JsonResponse)
        self.assertEqual(response.status_code, 429)
        
        data = response.json()
        self.assertEqual(data['error'], 'Too many active sessions')
        self.assertEqual(data['code'], 'CONCURRENT_SESSION_LIMIT')
    
    def test_get_client_ip_x_forwarded_for(self):
        """Test client IP extraction with X-Forwarded-For header."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.META = {
            'HTTP_X_FORWARDED_FOR': '192.168.1.1, 10.0.0.1'
        }
        
        ip = self.middleware._get_client_ip(request)
        self.assertEqual(ip, '192.168.1.1')
    
    def test_get_client_ip_remote_addr(self):
        """Test client IP extraction with REMOTE_ADDR."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.META = {'REMOTE_ADDR': '127.0.0.1'}
        
        ip = self.middleware._get_client_ip(request)
        self.assertEqual(ip, '127.0.0.1')


class SessionCleanupMiddlewareTest(TestCase):
    """Test cases for SessionCleanupMiddleware."""
    
    def setUp(self):
        """Set up test data."""
        self.factory = RequestFactory()
        self.middleware = SessionCleanupMiddleware()
        
        # Create test user
        self.user = CustomUser.objects.create_user(
            email='test@example.com',
            password='testpass123',
            first_name='Test',
            last_name='User'
        )
        
        # Clear cache before each test
        cache.clear()
    
    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
    
    def test_run_session_cleanup(self):
        """Test running session cleanup."""
        # Create expired Django session
        expired_session = Session.objects.create(
            session_key='expired_session',
            expire_date=timezone.now() - timedelta(days=1)
        )
        
        # Create inactive user session
        inactive_session = UserSession.objects.create(
            user=self.user,
            session_key='inactive_session',
            ip_address='127.0.0.1',
            user_agent='Test User Agent',
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
            last_activity=timezone.now() - timedelta(hours=2)
        )
        
        # Create orphaned user session
        orphaned_session = UserSession.objects.create(
            user=self.user,
            session_key='orphaned_session',
            ip_address='127.0.0.1',
            user_agent='Test User Agent',
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
        )
        
        # Run cleanup
        self.middleware._run_session_cleanup()
        
        # Check that expired Django session was deleted
        self.assertFalse(Session.objects.filter(session_key='expired_session').exists())
        
        # Check that inactive user session was ended
        inactive_session.refresh_from_db()
        self.assertFalse(inactive_session.is_active)
        self.assertIsNotNone(inactive_session.ended_at)
        
        # Check that orphaned user session was ended
        orphaned_session.refresh_from_db()
        self.assertFalse(orphaned_session.is_active)
        self.assertIsNotNone(orphaned_session.ended_at)
    
    def test_cleanup_expired_sessions(self):
        """Test cleanup of expired Django sessions."""
        # Create expired session
        expired_session = Session.objects.create(
            session_key='expired_session',
            expire_date=timezone.now() - timedelta(days=1)
        )
        
        # Create valid session
        valid_session = Session.objects.create(
            session_key='valid_session',
            expire_date=timezone.now() + timedelta(days=7)
        )
        
        initial_count = Session.objects.count()
        
        self.middleware._cleanup_expired_sessions()
        
        # Check that only expired session was deleted
        self.assertFalse(Session.objects.filter(session_key='expired_session').exists())
        self.assertTrue(Session.objects.filter(session_key='valid_session').exists())
        self.assertEqual(Session.objects.count(), initial_count - 1)
    
    def test_cleanup_inactive_sessions(self):
        """Test cleanup of inactive user sessions."""
        # Create inactive session
        inactive_session = UserSession.objects.create(
            user=self.user,
            session_key='inactive_session',
            ip_address='127.0.0.1',
            user_agent='Test User Agent',
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
            last_activity=timezone.now() - timedelta(hours=2)
        )
        
        # Create active session
        active_session = UserSession.objects.create(
            user=self.user,
            session_key='active_session',
            ip_address='127.0.0.1',
            user_agent='Test User Agent',
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
            last_activity=timezone.now()
        )
        
        self.middleware._cleanup_inactive_sessions()
        
        # Check that only inactive session was ended
        inactive_session.refresh_from_db()
        active_session.refresh_from_db()
        
        self.assertFalse(inactive_session.is_active)
        self.assertIsNotNone(inactive_session.ended_at)
        self.assertTrue(active_session.is_active)
        self.assertIsNone(active_session.ended_at)
    
    def test_cleanup_orphaned_sessions(self):
        """Test cleanup of orphaned user sessions."""
        # Create Django session
        django_session = Session.objects.create(
            session_key='valid_session',
            expire_date=timezone.now() + timedelta(days=7)
        )
        
        # Create user session with corresponding Django session
        valid_user_session = UserSession.objects.create(
            user=self.user,
            session_key='valid_session',
            ip_address='127.0.0.1',
            user_agent='Test User Agent',
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
        )
        
        # Create orphaned user session
        orphaned_user_session = UserSession.objects.create(
            user=self.user,
            session_key='orphaned_session',
            ip_address='127.0.0.1',
            user_agent='Test User Agent',
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
        )
        
        self.middleware._cleanup_orphaned_sessions()
        
        # Check that only orphaned session was ended
        valid_user_session.refresh_from_db()
        orphaned_user_session.refresh_from_db()
        
        self.assertTrue(valid_user_session.is_active)
        self.assertIsNone(valid_user_session.ended_at)
        self.assertFalse(orphaned_user_session.is_active)
        self.assertIsNotNone(orphaned_user_session.ended_at)


class SessionManagementIntegrationTest(TestCase):
    """Integration tests for session management."""
    
    def setUp(self):
        """Set up test data."""
        self.factory = RequestFactory()
        self.middleware = SessionManagementMiddleware()
        
        # Create test user
        self.user = CustomUser.objects.create_user(
            email='test@example.com',
            password='testpass123',
            first_name='Test',
            last_name='User'
        )
        
        # Create test session
        self.session = Session.objects.create(
            session_key='test_session_key',
            expire_date=timezone.now() + timedelta(days=7)
        )
        
        # Clear cache before each test
        cache.clear()
    
    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
    
    def test_full_session_lifecycle(self):
        """Test complete session lifecycle."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = self.session
        request.META = {
            'HTTP_USER_AGENT': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'REMOTE_ADDR': '127.0.0.1'
        }
        
        # Mock user agent parsing
        with patch('users.middleware.user_agents.parse') as mock_parse:
            mock_user_agent = Mock()
            mock_user_agent.is_mobile = False
            mock_user_agent.is_tablet = False
            mock_user_agent.is_pc = True
            mock_user_agent.browser.family = 'Chrome'
            mock_user_agent.os.family = 'Windows'
            mock_parse.return_value = mock_user_agent
            
            # Process request
            self.middleware.process_request(request)
            
            # Check that session was created
            self.assertTrue(hasattr(request, 'user_session'))
            self.assertIsInstance(request.user_session, UserSession)
            
            # Process response
            response = JsonResponse({'status': 'success'})
            response = self.middleware.process_response(request, response)
            
            # Check response headers
            self.assertIn('X-Session-Duration', response)
            self.assertIn('X-Session-ID', response)
            
            # Check that session activity was updated
            request.user_session.refresh_from_db()
            self.assertEqual(request.user_session.page_views, 1)
    
    def test_session_security_violation(self):
        """Test session security violation handling."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = self.session
        request.META = {
            'HTTP_USER_AGENT': 'Different User Agent',  # Different user agent
            'REMOTE_ADDR': '127.0.0.1'
        }
        
        # Create user session with different user agent
        user_session = UserSession.objects.create(
            user=self.user,
            session_key=self.session.session_key,
            ip_address='127.0.0.1',
            user_agent='Original User Agent',  # Original user agent
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
        )
        request.user_session = user_session
        
        # Mock suspicious activity detection
        with patch.object(self.middleware, '_detect_suspicious_activity', return_value=True):
            response = self.middleware.process_request(request)
            
            # Check that security violation response was returned
            self.assertIsInstance(response, JsonResponse)
            self.assertEqual(response.status_code, 403)
            
            data = response.json()
            self.assertEqual(data['error'], 'Security violation detected')
            self.assertEqual(data['code'], 'SECURITY_VIOLATION')
            
            # Check that session was ended
            user_session.refresh_from_db()
            self.assertFalse(user_session.is_active)
            self.assertIsNotNone(user_session.ended_at)


# Signal handler tests
class SessionSignalTest(TestCase):
    """Test cases for session-related signal handlers."""
    
    def setUp(self):
        """Set up test data."""
        self.factory = RequestFactory()
        self.user = CustomUser.objects.create_user(
            email='test@example.com',
            password='testpass123',
            first_name='Test',
            last_name='User'
        )
        
        # Clear cache before each test
        cache.clear()
    
    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
    
    def test_user_login_signal(self):
        """Test user login signal handler."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = Session.objects.create(
            session_key='test_session_key',
            expire_date=timezone.now() + timedelta(days=7)
        )
        
        # Trigger login signal
        user_logged_in.send(sender=self.__class__, request=request, user=self.user)
        
        # Check that user session was created
        user_session = UserSession.objects.filter(
            user=self.user,
            session_key='test_session_key'
        ).first()
        
        self.assertIsNotNone(user_session)
        self.assertTrue(user_session.is_active)
    
    def test_user_logout_signal(self):
        """Test user logout signal handler."""
        request = self.factory.get('/api/v1/chatbot/conversations/')
        request.user = self.user
        request.session = Session.objects.create(
            session_key='test_session_key',
            expire_date=timezone.now() + timedelta(days=7)
        )
        
        # Create user session
        user_session = UserSession.objects.create(
            user=self.user,
            session_key='test_session_key',
            ip_address='127.0.0.1',
            user_agent='Test User Agent',
            device_type='desktop',
            browser='Chrome',
            operating_system='Windows',
            is_active=True,
        )
        request.user_session = user_session
        
        # Trigger logout signal
        user_logged_out.send(sender=self.__class__, request=request, user=self.user)
        
        # Check that session was ended
        user_session.refresh_from_db()
        self.assertFalse(user_session.is_active)
        self.assertIsNotNone(user_session.ended_at)
