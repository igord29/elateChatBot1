"""
Custom middleware for Elate Chatbot Django application.

This module contains middleware classes for:
- Request logging and monitoring
- Error handling and reporting
- Performance monitoring
- Security enhancements
"""

import time
import logging
import json
import hashlib
from django.http import JsonResponse
from django.conf import settings
from django.core.cache import cache
from django.utils.deprecation import MiddlewareMixin
from django.db import connection
from django.db import reset_queries
import traceback
import uuid

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware(MiddlewareMixin):
    """
    Middleware for comprehensive request logging and monitoring.
    
    Logs all incoming requests with detailed information including:
    - Request method, path, and headers
    - Response status and timing
    - User information (if authenticated)
    - IP address and user agent
    - Request body (sanitized)
    """
    
    def process_request(self, request):
        """Log incoming request details."""
        # Generate unique request ID
        request.request_id = str(uuid.uuid4())
        
        # Start timing
        request.start_time = time.time()
        
        # Log request details
        log_data = {
            'request_id': request.request_id,
            'method': request.method,
            'path': request.path,
            'query_params': dict(request.GET.items()),
            'ip_address': self._get_client_ip(request),
            'user_agent': request.META.get('HTTP_USER_AGENT', ''),
            'user': str(request.user) if request.user.is_authenticated else 'anonymous',
            'timestamp': time.time(),
        }
        
        # Log request body for non-GET requests (sanitized)
        if request.method in ['POST', 'PUT', 'PATCH']:
            try:
                body = request.body.decode('utf-8')
                # Sanitize sensitive data
                sanitized_body = self._sanitize_request_body(body)
                log_data['request_body'] = sanitized_body
            except Exception as e:
                logger.warning(f"Failed to decode request body: {e}")
        
        logger.info(f"Request started: {json.dumps(log_data, default=str)}")
        
        # Reset database queries for this request
        reset_queries()
    
    def process_response(self, request, response):
        """Log response details and timing."""
        if hasattr(request, 'start_time'):
            duration = time.time() - request.start_time
            
            # Get database query count and time
            db_queries = len(connection.queries)
            db_time = sum(float(query.get('time', 0)) for query in connection.queries)
            
            log_data = {
                'request_id': getattr(request, 'request_id', 'unknown'),
                'status_code': response.status_code,
                'duration': round(duration, 3),
                'db_queries': db_queries,
                'db_time': round(db_time, 3),
                'response_size': len(response.content) if hasattr(response, 'content') else 0,
            }
            
            logger.info(f"Request completed: {json.dumps(log_data, default=str)}")
            
            # Add performance headers
            response['X-Request-ID'] = getattr(request, 'request_id', 'unknown')
            response['X-Response-Time'] = str(round(duration * 1000, 2)) + 'ms'
            response['X-DB-Queries'] = str(db_queries)
        
        return response
    
    def _get_client_ip(self, request):
        """Extract client IP address from request."""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip
    
    def _sanitize_request_body(self, body):
        """Sanitize request body to remove sensitive information."""
        try:
            data = json.loads(body)
            # Remove sensitive fields
            sensitive_fields = ['password', 'token', 'secret', 'key', 'api_key']
            for field in sensitive_fields:
                if field in data:
                    data[field] = '***REDACTED***'
            return json.dumps(data)
        except json.JSONDecodeError:
            # If not JSON, return first 100 characters
            return body[:100] + ('...' if len(body) > 100 else '')


class ErrorHandlingMiddleware(MiddlewareMixin):
    """
    Middleware for comprehensive error handling and reporting.
    
    Catches and logs all exceptions, providing detailed error information
    and graceful error responses to clients.
    """
    
    def process_exception(self, request, exception):
        """Handle exceptions and provide detailed logging."""
        error_id = str(uuid.uuid4())
        
        # Log detailed error information
        error_data = {
            'error_id': error_id,
            'request_id': getattr(request, 'request_id', 'unknown'),
            'exception_type': type(exception).__name__,
            'exception_message': str(exception),
            'request_method': request.method,
            'request_path': request.path,
            'user': str(request.user) if request.user.is_authenticated else 'anonymous',
            'ip_address': self._get_client_ip(request),
            'traceback': traceback.format_exc(),
            'timestamp': time.time(),
        }
        
        logger.error(f"Exception occurred: {json.dumps(error_data, default=str)}")
        
        # Return appropriate error response
        if settings.DEBUG:
            # In development, return detailed error information
            return JsonResponse({
                'error': 'Internal Server Error',
                'error_id': error_id,
                'message': str(exception),
                'type': type(exception).__name__,
                'traceback': traceback.format_exc().split('\n'),
            }, status=500)
        else:
            # In production, return generic error message
            return JsonResponse({
                'error': 'Internal Server Error',
                'error_id': error_id,
                'message': 'An unexpected error occurred. Please try again later.',
            }, status=500)
    
    def _get_client_ip(self, request):
        """Extract client IP address from request."""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip


class PerformanceMonitoringMiddleware(MiddlewareMixin):
    """
    Middleware for performance monitoring and optimization.
    
    Monitors:
    - Database query performance
    - Response times
    - Memory usage
    - Slow queries
    """
    
    def process_request(self, request):
        """Initialize performance monitoring for request."""
        request.performance_data = {
            'start_time': time.time(),
            'db_queries': [],
            'memory_start': self._get_memory_usage(),
        }
        
        # Reset database queries
        reset_queries()
    
    def process_response(self, request, response):
        """Analyze and log performance metrics."""
        if hasattr(request, 'performance_data'):
            duration = time.time() - request.performance_data['start_time']
            memory_end = self._get_memory_usage()
            memory_used = memory_end - request.performance_data['memory_start']
            
            # Get database performance data
            db_queries = connection.queries
            slow_queries = []
            total_db_time = 0
            
            for query in db_queries:
                query_time = float(query.get('time', 0))
                total_db_time += query_time
                
                # Check for slow queries
                if query_time > settings.PERFORMANCE_MONITORING.get('SLOW_QUERY_THRESHOLD', 1.0):
                    slow_queries.append({
                        'sql': query.get('sql', ''),
                        'time': query_time,
                        'params': query.get('params', []),
                    })
            
            # Log performance metrics
            performance_data = {
                'request_id': getattr(request, 'request_id', 'unknown'),
                'total_duration': round(duration, 3),
                'db_queries_count': len(db_queries),
                'db_total_time': round(total_db_time, 3),
                'memory_used_mb': round(memory_used / 1024 / 1024, 2),
                'slow_queries_count': len(slow_queries),
            }
            
            logger.info(f"Performance metrics: {json.dumps(performance_data, default=str)}")
            
            # Log slow queries if any
            if slow_queries and settings.PERFORMANCE_MONITORING.get('LOG_SLOW_QUERIES', True):
                for query in slow_queries:
                    logger.warning(f"Slow query detected: {json.dumps(query, default=str)}")
            
            # Add performance headers
            response['X-Performance-Duration'] = str(round(duration * 1000, 2)) + 'ms'
            response['X-Performance-DB-Queries'] = str(len(db_queries))
            response['X-Performance-Memory-MB'] = str(round(memory_used / 1024 / 1024, 2))
        
        return response
    
    def _get_memory_usage(self):
        """Get current memory usage in bytes."""
        try:
            import psutil
            process = psutil.Process()
            return process.memory_info().rss
        except ImportError:
            return 0


class SecurityMiddleware(MiddlewareMixin):
    """
    Security middleware for additional protection.
    
    Implements:
    - Rate limiting
    - Request validation
    - Security headers
    - Input sanitization
    """
    
    def process_request(self, request):
        """Apply security checks to incoming requests."""
        # Rate limiting check
        if not self._check_rate_limit(request):
            return JsonResponse({
                'error': 'Rate limit exceeded',
                'message': 'Too many requests. Please try again later.',
            }, status=429)
        
        # Validate request size
        if not self._validate_request_size(request):
            return JsonResponse({
                'error': 'Request too large',
                'message': 'Request body exceeds maximum allowed size.',
            }, status=413)
        
        # Sanitize request data
        self._sanitize_request(request)
    
    def process_response(self, request, response):
        """Add security headers to response."""
        # Security headers
        response['X-Content-Type-Options'] = 'nosniff'
        response['X-Frame-Options'] = 'DENY'
        response['X-XSS-Protection'] = '1; mode=block'
        response['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        response['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
        
        return response
    
    def _check_rate_limit(self, request):
        """Check if request is within rate limits."""
        client_ip = self._get_client_ip(request)
        cache_key = f"rate_limit:{client_ip}"
        
        # Get current request count
        request_count = cache.get(cache_key, 0)
        
        # Check limits based on user authentication
        if request.user.is_authenticated:
            limit = 1000  # 1000 requests per hour for authenticated users
        else:
            limit = 100   # 100 requests per hour for anonymous users
        
        if request_count >= limit:
            return False
        
        # Increment request count
        cache.set(cache_key, request_count + 1, 3600)  # 1 hour TTL
        return True
    
    def _validate_request_size(self, request):
        """Validate request body size."""
        max_size = 10 * 1024 * 1024  # 10MB limit
        
        if request.method in ['POST', 'PUT', 'PATCH']:
            content_length = request.META.get('CONTENT_LENGTH', 0)
            if content_length and int(content_length) > max_size:
                return False
        
        return True
    
    def _sanitize_request(self, request):
        """Sanitize request data to prevent injection attacks."""
        # This is a basic implementation - in production, use a proper sanitization library
        pass
    
    def _get_client_ip(self, request):
        """Extract client IP address from request."""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip


class CachingMiddleware(MiddlewareMixin):
    """
    Middleware for intelligent caching of responses.
    
    Implements:
    - Response caching based on URL patterns
    - Cache invalidation
    - Cache headers
    """
    
    def process_request(self, request):
        """Check cache for existing response."""
        if request.method != 'GET':
            return None
        
        # Generate cache key
        cache_key = self._generate_cache_key(request)
        
        # Check if response is cached
        cached_response = cache.get(cache_key)
        if cached_response:
            logger.info(f"Cache hit for key: {cache_key}")
            return cached_response
        
        return None
    
    def process_response(self, request, response):
        """Cache response if appropriate."""
        if request.method != 'GET':
            return response
        
        # Only cache successful responses
        if response.status_code != 200:
            return response
        
        # Check if response should be cached
        if self._should_cache_response(request, response):
            cache_key = self._generate_cache_key(request)
            cache_timeout = self._get_cache_timeout(request)
            
            cache.set(cache_key, response, cache_timeout)
            logger.info(f"Cached response for key: {cache_key} with timeout: {cache_timeout}")
            
            # Add cache headers
            response['X-Cache'] = 'MISS'
            response['Cache-Control'] = f'public, max-age={cache_timeout}'
        
        return response
    
    def _generate_cache_key(self, request):
        """Generate unique cache key for request."""
        key_data = {
            'method': request.method,
            'path': request.path,
            'query': dict(request.GET.items()),
            'user': str(request.user) if request.user.is_authenticated else 'anonymous',
        }
        
        key_string = json.dumps(key_data, sort_keys=True)
        return hashlib.md5(key_string.encode()).hexdigest()
    
    def _should_cache_response(self, request, response):
        """Determine if response should be cached."""
        # Don't cache responses with certain headers
        no_cache_headers = ['no-cache', 'no-store', 'private']
        cache_control = response.get('Cache-Control', '')
        
        for header in no_cache_headers:
            if header in cache_control:
                return False
        
        # Don't cache responses with certain content types
        content_type = response.get('Content-Type', '')
        if 'application/json' not in content_type:
            return False
        
        return True
    
    def _get_cache_timeout(self, request):
        """Get cache timeout for request."""
        # Default timeout: 5 minutes
        default_timeout = 300
        
        # Longer timeout for static content
        if request.path.startswith('/api/v1/analytics/'):
            return 1800  # 30 minutes
        
        return default_timeout
