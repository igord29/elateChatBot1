"""
Session Management Middleware for Elate Chatbot.

This module provides comprehensive session management including:
- Session creation and tracking
- Authentication state management
- Session security and validation
- Concurrent session handling
- Session cleanup and maintenance
"""

import time
import logging
import json
import hashlib
from datetime import datetime, timedelta
from django.http import JsonResponse
from django.conf import settings
from django.core.cache import cache
from django.utils.deprecation import MiddlewareMixin
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db import transaction
from django.contrib.sessions.models import Session
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.dispatch import receiver
import uuid
import user_agents

from .models import UserSession, CustomUser

logger = logging.getLogger(__name__)
User = get_user_model()


class SessionManagementMiddleware(MiddlewareMixin):
    """
    Comprehensive session management middleware.
    
    Handles:
    - Session creation and tracking
    - Authentication state management
    - Session security validation
    - Concurrent session limits
    - Session cleanup
    """
    
    def process_request(self, request):
        """Process incoming request for session management."""
        # Skip for static files and health checks
        if self._should_skip_session_management(request):
            return None
        
        # Track request start time
        request.session_start_time = time.time()
        
        # Handle session creation for authenticated users
        if request.user.is_authenticated:
            self._handle_authenticated_session(request)
        else:
            self._handle_anonymous_session(request)
        
        # Validate session security
        if not self._validate_session_security(request):
            return self._create_security_violation_response(request)
        
        # Check concurrent session limits
        if not self._check_concurrent_sessions(request):
            return self._create_concurrent_session_response(request)
    
    def process_response(self, request, response):
        """Process response for session management."""
        if hasattr(request, 'session_start_time'):
            duration = time.time() - request.session_start_time
            
            # Update session activity for authenticated users
            if request.user.is_authenticated and hasattr(request, 'user_session'):
                self._update_session_activity(request, duration)
            
            # Add session headers
            response['X-Session-Duration'] = str(round(duration * 1000, 2)) + 'ms'
            if hasattr(request, 'user_session'):
                response['X-Session-ID'] = str(request.user_session.session_key)
        
        return response
    
    def _should_skip_session_management(self, request):
        """Determine if session management should be skipped."""
        skip_paths = [
            '/static/',
            '/media/',
            '/health/',
            '/admin/jsi18n/',
            '/favicon.ico',
        ]
        
        return any(request.path.startswith(path) for path in skip_paths)
    
    def _handle_authenticated_session(self, request):
        """Handle session for authenticated users."""
        try:
            # Get or create user session
            user_session = self._get_or_create_user_session(request)
            request.user_session = user_session
            
            # Update user's last activity
            self._update_user_activity(request.user)
            
            # Log session activity
            logger.info(f"Authenticated session: user={request.user.email}, "
                       f"session_id={user_session.session_key}, "
                       f"ip={self._get_client_ip(request)}")
            
        except Exception as e:
            logger.error(f"Error handling authenticated session: {e}")
            # Don't break the request flow, just log the error
    
    def _handle_anonymous_session(self, request):
        """Handle session for anonymous users."""
        try:
            # Track anonymous session for analytics
            session_data = {
                'ip_address': self._get_client_ip(request),
                'user_agent': request.META.get('HTTP_USER_AGENT', ''),
                'timestamp': timezone.now(),
                'path': request.path,
            }
            
            # Store in cache for analytics
            cache_key = f"anonymous_session:{hashlib.md5(str(session_data).encode()).hexdigest()}"
            cache.set(cache_key, session_data, 3600)  # 1 hour TTL
            
        except Exception as e:
            logger.error(f"Error handling anonymous session: {e}")
    
    def _get_or_create_user_session(self, request):
        """Get existing user session or create new one."""
        try:
            # Try to get existing active session
            user_session = UserSession.objects.filter(
                user=request.user,
                is_active=True,
                session_key=request.session.session_key
            ).first()
            
            if user_session:
                # Update last activity
                user_session.last_activity = timezone.now()
                user_session.save(update_fields=['last_activity'])
                return user_session
            
            # Create new session
            return self._create_new_user_session(request)
            
        except Exception as e:
            logger.error(f"Error getting/creating user session: {e}")
            return None
    
    def _create_new_user_session(self, request):
        """Create a new user session."""
        try:
            # Parse user agent
            user_agent_string = request.META.get('HTTP_USER_AGENT', '')
            user_agent = user_agents.parse(user_agent_string)
            
            # Create session
            user_session = UserSession.objects.create(
                user=request.user,
                session_key=request.session.session_key,
                ip_address=self._get_client_ip(request),
                user_agent=user_agent_string,
                device_type=self._get_device_type(user_agent),
                browser=user_agent.browser.family,
                operating_system=user_agent.os.family,
                is_active=True,
            )
            
            # Log new session creation
            logger.info(f"New user session created: user={request.user.email}, "
                       f"session_id={user_session.session_key}, "
                       f"device={user_session.device_type}")
            
            return user_session
            
        except Exception as e:
            logger.error(f"Error creating new user session: {e}")
            return None
    
    def _get_device_type(self, user_agent):
        """Determine device type from user agent."""
        if user_agent.is_mobile:
            return 'mobile'
        elif user_agent.is_tablet:
            return 'tablet'
        elif user_agent.is_pc:
            return 'desktop'
        else:
            return 'unknown'
    
    def _update_user_activity(self, user):
        """Update user's last activity timestamp."""
        try:
            user.last_activity = timezone.now()
            user.save(update_fields=['last_activity'])
        except Exception as e:
            logger.error(f"Error updating user activity: {e}")
    
    def _update_session_activity(self, request, duration):
        """Update session activity metrics."""
        try:
            user_session = request.user_session
            user_session.page_views += 1
            
            # Update chat interactions if this is a chat-related request
            if '/api/v1/chatbot/' in request.path:
                user_session.chat_interactions += 1
            
            user_session.save(update_fields=['page_views', 'chat_interactions'])
            
        except Exception as e:
            logger.error(f"Error updating session activity: {e}")
    
    def _validate_session_security(self, request):
        """Validate session security."""
        if not request.user.is_authenticated:
            return True
        
        try:
            # Check for session hijacking indicators
            if not self._check_session_consistency(request):
                logger.warning(f"Session consistency check failed for user {request.user.email}")
                return False
            
            # Check for suspicious activity
            if self._detect_suspicious_activity(request):
                logger.warning(f"Suspicious activity detected for user {request.user.email}")
                return False
            
            return True
            
        except Exception as e:
            logger.error(f"Error validating session security: {e}")
            return False
    
    def _check_session_consistency(self, request):
        """Check if session is consistent with user's typical behavior."""
        try:
            user_session = getattr(request, 'user_session', None)
            if not user_session:
                return True
            
            # Check IP address consistency
            if user_session.ip_address != self._get_client_ip(request):
                # Allow some IP changes (mobile networks, VPNs)
                # But log for monitoring
                logger.info(f"IP address changed for user {request.user.email}: "
                           f"from {user_session.ip_address} to {self._get_client_ip(request)}")
            
            # Check user agent consistency
            if user_session.user_agent != request.META.get('HTTP_USER_AGENT', ''):
                logger.warning(f"User agent changed for user {request.user.email}")
                return False
            
            return True
            
        except Exception as e:
            logger.error(f"Error checking session consistency: {e}")
            return False
    
    def _detect_suspicious_activity(self, request):
        """Detect suspicious activity patterns."""
        try:
            client_ip = self._get_client_ip(request)
            
            # Check for rapid requests
            cache_key = f"request_rate:{client_ip}:{request.user.id}"
            request_count = cache.get(cache_key, 0)
            
            if request_count > 100:  # More than 100 requests per minute
                logger.warning(f"High request rate detected for user {request.user.email}")
                return True
            
            # Increment request count
            cache.set(cache_key, request_count + 1, 60)  # 1 minute TTL
            
            return False
            
        except Exception as e:
            logger.error(f"Error detecting suspicious activity: {e}")
            return False
    
    def _check_concurrent_sessions(self, request):
        """Check concurrent session limits."""
        try:
            # Get user's active sessions
            active_sessions = UserSession.objects.filter(
                user=request.user,
                is_active=True
            ).count()
            
            # Check against limit (configurable)
            max_concurrent_sessions = getattr(settings, 'MAX_CONCURRENT_SESSIONS', 5)
            
            if active_sessions >= max_concurrent_sessions:
                # End oldest session
                oldest_session = UserSession.objects.filter(
                    user=request.user,
                    is_active=True
                ).order_by('last_activity').first()
                
                if oldest_session:
                    oldest_session.end_session()
                    logger.info(f"Ended oldest session for user {request.user.email} "
                               f"due to concurrent session limit")
            
            return True
            
        except Exception as e:
            logger.error(f"Error checking concurrent sessions: {e}")
            return True  # Don't block on error
    
    def _create_security_violation_response(self, request):
        """Create response for security violations."""
        logger.warning(f"Security violation detected for user {request.user.email}")
        
        # End the session
        if hasattr(request, 'user_session'):
            request.user_session.end_session()
        
        return JsonResponse({
            'error': 'Security violation detected',
            'message': 'Your session has been terminated due to security concerns. Please log in again.',
            'code': 'SECURITY_VIOLATION'
        }, status=403)
    
    def _create_concurrent_session_response(self, request):
        """Create response for concurrent session violations."""
        return JsonResponse({
            'error': 'Too many active sessions',
            'message': 'You have too many active sessions. Please try again.',
            'code': 'CONCURRENT_SESSION_LIMIT'
        }, status=429)
    
    def _get_client_ip(self, request):
        """Extract client IP address from request."""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0].strip()
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip


class SessionCleanupMiddleware(MiddlewareMixin):
    """
    Middleware for cleaning up expired and inactive sessions.
    
    Runs cleanup tasks periodically to maintain session hygiene.
    """
    
    def process_request(self, request):
        """Run session cleanup if needed."""
        # Run cleanup every 100 requests (configurable)
        cleanup_interval = getattr(settings, 'SESSION_CLEANUP_INTERVAL', 100)
        
        # Use cache to track cleanup frequency
        cache_key = 'session_cleanup_counter'
        counter = cache.get(cache_key, 0)
        
        if counter >= cleanup_interval:
            self._run_session_cleanup()
            cache.set(cache_key, 0, 3600)  # Reset counter
        else:
            cache.set(cache_key, counter + 1, 3600)
    
    def _run_session_cleanup(self):
        """Run session cleanup tasks."""
        try:
            # Clean up expired sessions
            self._cleanup_expired_sessions()
            
            # Clean up inactive sessions
            self._cleanup_inactive_sessions()
            
            # Clean up orphaned sessions
            self._cleanup_orphaned_sessions()
            
            logger.info("Session cleanup completed successfully")
            
        except Exception as e:
            logger.error(f"Error during session cleanup: {e}")
    
    def _cleanup_expired_sessions(self):
        """Clean up expired Django sessions."""
        try:
            # Get session timeout from settings
            session_timeout = getattr(settings, 'SESSION_COOKIE_AGE', 1209600)  # 2 weeks default
            cutoff_time = timezone.now() - timedelta(seconds=session_timeout)
            
            # Delete expired sessions
            expired_sessions = Session.objects.filter(expire_date__lt=cutoff_time)
            count = expired_sessions.count()
            expired_sessions.delete()
            
            if count > 0:
                logger.info(f"Cleaned up {count} expired Django sessions")
                
        except Exception as e:
            logger.error(f"Error cleaning up expired sessions: {e}")
    
    def _cleanup_inactive_sessions(self):
        """Clean up inactive user sessions."""
        try:
            # Get inactivity timeout from settings
            inactivity_timeout = getattr(settings, 'SESSION_INACTIVITY_TIMEOUT', 3600)  # 1 hour default
            cutoff_time = timezone.now() - timedelta(seconds=inactivity_timeout)
            
            # End inactive sessions
            inactive_sessions = UserSession.objects.filter(
                is_active=True,
                last_activity__lt=cutoff_time
            )
            
            count = 0
            for session in inactive_sessions:
                session.end_session()
                count += 1
            
            if count > 0:
                logger.info(f"Ended {count} inactive user sessions")
                
        except Exception as e:
            logger.error(f"Error cleaning up inactive sessions: {e}")
    
    def _cleanup_orphaned_sessions(self):
        """Clean up orphaned user sessions (no corresponding Django session)."""
        try:
            # Find user sessions without corresponding Django sessions
            django_session_keys = set(Session.objects.values_list('session_key', flat=True))
            
            orphaned_sessions = UserSession.objects.filter(
                is_active=True
            ).exclude(session_key__in=django_session_keys)
            
            count = 0
            for session in orphaned_sessions:
                session.end_session()
                count += 1
            
            if count > 0:
                logger.info(f"Ended {count} orphaned user sessions")
                
        except Exception as e:
            logger.error(f"Error cleaning up orphaned sessions: {e}")


# Signal handlers for session management
@receiver(user_logged_in)
def handle_user_login(sender, request, user, **kwargs):
    """Handle user login events."""
    try:
        logger.info(f"User logged in: {user.email}")
        
        # Create user session if middleware hasn't already
        if not hasattr(request, 'user_session'):
            middleware = SessionManagementMiddleware()
            middleware._handle_authenticated_session(request)
        
    except Exception as e:
        logger.error(f"Error handling user login: {e}")


@receiver(user_logged_out)
def handle_user_logout(sender, request, user, **kwargs):
    """Handle user logout events."""
    try:
        logger.info(f"User logged out: {user.email}")
        
        # End user session
        if hasattr(request, 'user_session'):
            request.user_session.end_session()
            logger.info(f"Ended session for user {user.email}")
        
    except Exception as e:
        logger.error(f"Error handling user logout: {e}")
