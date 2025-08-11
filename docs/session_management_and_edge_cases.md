# Session Management and Edge Case Handling

This document provides a comprehensive overview of the session management and edge case handling systems implemented in the Elate Chatbot Django application.

## Table of Contents

1. [Session Management Overview](#session-management-overview)
2. [Session Management Middleware](#session-management-middleware)
3. [Session Security](#session-security)
4. [Session Cleanup](#session-cleanup)
5. [Edge Case Handling Overview](#edge-case-handling-overview)
6. [Edge Case Handling Middleware](#edge-case-handling-middleware)
7. [Circuit Breaker Pattern](#circuit-breaker-pattern)
8. [Retry Mechanisms](#retry-mechanisms)
9. [Graceful Degradation](#graceful-degradation)
10. [Configuration](#configuration)
11. [Testing](#testing)
12. [Monitoring and Logging](#monitoring-and-logging)
13. [Best Practices](#best-practices)

## Session Management Overview

The session management system provides comprehensive tracking and security for user sessions, including:

- **Session Creation and Tracking**: Automatic creation and tracking of user sessions
- **Authentication State Management**: Handling of authenticated and anonymous users
- **Session Security Validation**: Detection of session hijacking and suspicious activity
- **Concurrent Session Limits**: Prevention of session abuse
- **Session Cleanup**: Automatic cleanup of expired and inactive sessions

### Key Features

- **Real-time Session Tracking**: Track user activity, page views, and chat interactions
- **Device Detection**: Automatic detection of device type, browser, and operating system
- **IP Address Monitoring**: Track and validate IP address changes
- **User Agent Validation**: Detect suspicious user agent changes
- **Rate Limiting**: Prevent abuse through request rate monitoring
- **Automatic Cleanup**: Clean up expired and orphaned sessions

## Session Management Middleware

### SessionManagementMiddleware

The main session management middleware that handles:

#### Process Request
- Validates session security
- Creates or updates user sessions
- Tracks user activity
- Handles concurrent session limits

#### Process Response
- Updates session activity metrics
- Adds session headers to responses
- Tracks request duration

#### Key Methods

```python
def _handle_authenticated_session(self, request):
    """Handle session for authenticated users."""
    # Get or create user session
    # Update user activity
    # Log session activity

def _handle_anonymous_session(self, request):
    """Handle session for anonymous users."""
    # Track anonymous session for analytics
    # Store in cache for analytics

def _validate_session_security(self, request):
    """Validate session security."""
    # Check session consistency
    # Detect suspicious activity

def _check_concurrent_sessions(self, request):
    """Check concurrent session limits."""
    # Enforce maximum concurrent sessions
    # End oldest sessions if limit exceeded
```

### SessionCleanupMiddleware

Handles automatic cleanup of sessions:

#### Cleanup Types
- **Expired Django Sessions**: Remove sessions past their expiration date
- **Inactive User Sessions**: End sessions with no recent activity
- **Orphaned Sessions**: End user sessions without corresponding Django sessions

#### Cleanup Frequency
- Runs every 100 requests (configurable)
- Uses cache to track cleanup frequency
- Prevents excessive cleanup operations

## Session Security

### Security Validations

#### Session Consistency Check
- **IP Address Changes**: Monitors IP address changes (allows some changes for mobile/VPN)
- **User Agent Changes**: Strict validation of user agent consistency
- **Device Type Changes**: Tracks device type changes

#### Suspicious Activity Detection
- **High Request Rate**: Detects requests exceeding 100 per minute
- **Rapid Session Changes**: Monitors for rapid session modifications
- **Unusual Patterns**: Identifies patterns that may indicate abuse

### Security Responses

#### Security Violation Response
```json
{
    "error": "Security violation detected",
    "message": "Your session has been terminated due to security concerns. Please log in again.",
    "code": "SECURITY_VIOLATION"
}
```

#### Concurrent Session Response
```json
{
    "error": "Too many active sessions",
    "message": "You have too many active sessions. Please try again.",
    "code": "CONCURRENT_SESSION_LIMIT"
}
```

## Session Cleanup

### Automatic Cleanup Process

1. **Expired Django Sessions**
   - Removes sessions past `SESSION_COOKIE_AGE`
   - Uses Django's built-in session expiration

2. **Inactive User Sessions**
   - Ends sessions inactive for `SESSION_INACTIVITY_TIMEOUT`
   - Default: 1 hour of inactivity

3. **Orphaned Sessions**
   - Ends user sessions without corresponding Django sessions
   - Prevents session inconsistencies

### Cleanup Configuration

```python
SESSION_MANAGEMENT = {
    'MAX_CONCURRENT_SESSIONS': 5,
    'SESSION_INACTIVITY_TIMEOUT': 3600,  # 1 hour
    'SESSION_CLEANUP_INTERVAL': 100,     # requests
    'SESSION_COOKIE_AGE': 1209600,       # 2 weeks
}
```

## Edge Case Handling Overview

The edge case handling system provides comprehensive error handling and recovery mechanisms:

- **Database Connection Failures**: Automatic reconnection and fallback
- **External API Failures**: Circuit breaker pattern for external services
- **Network Timeouts**: Retry mechanisms with exponential backoff
- **Data Validation Errors**: Graceful handling of invalid data
- **Graceful Degradation**: Service continues with reduced functionality

### Key Features

- **Circuit Breaker Pattern**: Prevents cascading failures
- **Retry Mechanisms**: Automatic retry with exponential backoff
- **Graceful Degradation**: Continue operation with reduced functionality
- **Comprehensive Logging**: Detailed error tracking and monitoring
- **Fallback Strategies**: Alternative responses when services fail

## Edge Case Handling Middleware

### EdgeCaseHandlingMiddleware

The main edge case handling middleware:

#### Process Request
- System health checks
- Request data validation
- Retry context setup

#### Process Response
- Response header addition
- Error tracking
- Performance monitoring

#### Process Exception
- Exception type detection
- Specific error handling
- Circuit breaker integration

### Key Methods

```python
def _check_system_health(self):
    """Check if all critical systems are healthy."""
    # Database connection check
    # Redis connection check

def _validate_request_data(self, request):
    """Validate incoming request data."""
    # Request size validation
    # Content type validation

def _handle_database_error(self, request, exception, error_id):
    """Handle database-related errors."""
    # Connection restoration
    # Appropriate error response

def _handle_external_api_error(self, request, exception, error_id):
    """Handle external API errors."""
    # Circuit breaker integration
    # Error type detection
```

## Circuit Breaker Pattern

### Circuit Breaker States

1. **CLOSED**: Normal operation, calls pass through
2. **OPEN**: Circuit is open, calls fail fast
3. **HALF_OPEN**: Testing if service has recovered

### Circuit Breaker Configuration

```python
EDGE_CASE_HANDLING = {
    'CIRCUIT_BREAKER_FAILURE_THRESHOLD': 5,
    'CIRCUIT_BREAKER_RECOVERY_TIMEOUT': 60,  # seconds
}
```

### Circuit Breaker Implementation

```python
class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=60):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.state = 'CLOSED'
        self.failure_count = 0
        self.last_failure_time = None

    def call(self, func, *args, **kwargs):
        """Execute function with circuit breaker protection."""
        if self.state == 'OPEN':
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = 'HALF_OPEN'
            else:
                raise Exception("Circuit breaker is OPEN")
        
        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except self.expected_exception as e:
            self._on_failure()
            raise e
```

## Retry Mechanisms

### RetryMiddleware

Provides automatic retry functionality:

#### Retry Logic
- **Exponential Backoff**: Delay increases with each retry
- **Maximum Retries**: Configurable retry limit
- **Selective Retry**: Only retry appropriate requests and errors

#### Retry Configuration

```python
EDGE_CASE_HANDLING = {
    'MAX_RETRIES': 3,
    'RETRY_DELAY': 1,        # seconds
    'BACKOFF_FACTOR': 2,     # multiplier
}
```

#### Retry Decorator

```python
@retry_on_failure(max_retries=3, delay=1, backoff_factor=2)
def external_api_call():
    # Function that may fail
    pass
```

### Retry Conditions

#### Requests That Are Retried
- GET, POST, PUT, PATCH requests
- Network timeouts
- Temporary service failures
- Database connection issues

#### Requests That Are Not Retried
- DELETE requests
- Validation errors
- Permission denied errors
- 404 errors

## Graceful Degradation

### GracefulDegradationMiddleware

Provides graceful degradation when services are unavailable:

#### Degradation Modes
- **Database Unavailable**: Continue with cached data
- **Cache Unavailable**: Continue without caching
- **AI Service Unavailable**: Use fallback responses
- **Email Service Unavailable**: Queue emails for later

#### Degradation Headers

```http
X-Degradation-Mode: ai_service_unavailable
X-Degradation-Reason: AI service is temporarily unavailable
```

### Fallback Strategies

#### Fallback Decorator

```python
def fallback_response(fallback_func):
    """Decorator for providing fallback responses."""
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

@fallback_response(lambda: {"message": "Service temporarily unavailable"})
def ai_response_generation():
    # AI service call
    pass
```

## Configuration

### Django Settings

```python
# Session Management Configuration
SESSION_MANAGEMENT = {
    'MAX_CONCURRENT_SESSIONS': 5,
    'SESSION_INACTIVITY_TIMEOUT': 3600,  # 1 hour
    'SESSION_CLEANUP_INTERVAL': 100,     # requests
    'SESSION_COOKIE_AGE': 1209600,       # 2 weeks
}

# Edge Case Handling Configuration
EDGE_CASE_HANDLING = {
    'MAX_RETRIES': 3,
    'RETRY_DELAY': 1,  # seconds
    'BACKOFF_FACTOR': 2,
    'CIRCUIT_BREAKER_FAILURE_THRESHOLD': 5,
    'CIRCUIT_BREAKER_RECOVERY_TIMEOUT': 60,  # seconds
    'REQUEST_SIZE_LIMIT': 10 * 1024 * 1024,  # 10MB
    'RATE_LIMIT_ENABLED': True,
    'RATE_LIMIT_ANONYMOUS': 100,  # requests per hour
    'RATE_LIMIT_AUTHENTICATED': 1000,  # requests per hour
}
```

### Environment Variables

```bash
# Session Management
MAX_CONCURRENT_SESSIONS=5
SESSION_INACTIVITY_TIMEOUT=3600
SESSION_CLEANUP_INTERVAL=100

# Edge Case Handling
MAX_RETRIES=3
RETRY_DELAY=1
BACKOFF_FACTOR=2
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_RECOVERY_TIMEOUT=60
REQUEST_SIZE_LIMIT=10485760
```

## Testing

### Test Coverage

The system includes comprehensive test coverage:

#### Session Management Tests
- Session creation and tracking
- Authentication state management
- Session security validation
- Concurrent session handling
- Session cleanup
- Signal handlers

#### Edge Case Handling Tests
- Database connection failures
- External API failures
- Network timeouts
- Data validation errors
- Circuit breaker patterns
- Retry mechanisms
- Graceful degradation

### Running Tests

```bash
# Run all tests
python manage.py test

# Run specific test modules
python manage.py test tests.test_session_management
python manage.py test tests.test_edge_case_handling

# Run with coverage
coverage run --source='.' manage.py test
coverage report
coverage html
```

### Test Examples

#### Session Management Test
```python
def test_session_security_violation(self):
    """Test session security violation handling."""
    request = self.factory.get('/api/v1/chatbot/conversations/')
    request.user = self.user
    request.session = self.session
    
    # Create user session with different user agent
    user_session = UserSession.objects.create(
        user=self.user,
        session_key=self.session.session_key,
        ip_address='127.0.0.1',
        user_agent='Original User Agent',
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
```

#### Edge Case Handling Test
```python
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
```

## Monitoring and Logging

### Logging Configuration

The system provides comprehensive logging:

#### Log Levels
- **INFO**: Normal operations, session creation, cleanup
- **WARNING**: Security violations, suspicious activity
- **ERROR**: System failures, exceptions
- **DEBUG**: Detailed debugging information

#### Log Format
```json
{
    "timestamp": "2024-01-15T10:30:00Z",
    "level": "INFO",
    "message": "New user session created",
    "user": "user@example.com",
    "session_id": "abc123",
    "ip_address": "192.168.1.1",
    "device_type": "desktop"
}
```

### Monitoring Metrics

#### Session Metrics
- Active sessions count
- Session duration
- Page views per session
- Chat interactions per session
- Security violations
- Concurrent session limits

#### Edge Case Metrics
- Circuit breaker state changes
- Retry attempts and successes
- Service availability
- Error rates by type
- Response times
- Degradation mode usage

### Health Checks

#### System Health Endpoint
```http
GET /health/
```

Response:
```json
{
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00Z",
    "database": "connected",
    "redis": "connected",
    "uptime": 3600
}
```

## Best Practices

### Session Management Best Practices

1. **Regular Cleanup**: Ensure session cleanup runs regularly
2. **Security Monitoring**: Monitor for security violations
3. **Rate Limiting**: Implement appropriate rate limits
4. **Session Timeouts**: Set reasonable session timeouts
5. **Device Tracking**: Track device changes for security

### Edge Case Handling Best Practices

1. **Circuit Breaker Configuration**: Set appropriate failure thresholds
2. **Retry Strategies**: Use exponential backoff for retries
3. **Fallback Responses**: Provide meaningful fallback responses
4. **Monitoring**: Monitor circuit breaker states and error rates
5. **Graceful Degradation**: Design for graceful degradation

### Security Best Practices

1. **Session Validation**: Validate session consistency
2. **Rate Limiting**: Implement rate limiting for all endpoints
3. **Input Validation**: Validate all input data
4. **Error Handling**: Don't expose sensitive information in errors
5. **Logging**: Log security events for monitoring

### Performance Best Practices

1. **Caching**: Use caching for frequently accessed data
2. **Database Optimization**: Optimize database queries
3. **Connection Pooling**: Use connection pooling for external services
4. **Monitoring**: Monitor performance metrics
5. **Cleanup**: Regular cleanup of expired data

## Troubleshooting

### Common Issues

#### Session Issues
1. **Sessions Not Being Created**: Check middleware configuration
2. **Sessions Not Being Cleaned Up**: Check cleanup interval settings
3. **Security Violations**: Review security validation logic
4. **Concurrent Session Limits**: Adjust maximum concurrent sessions

#### Edge Case Issues
1. **Circuit Breaker Not Opening**: Check failure threshold configuration
2. **Retries Not Working**: Verify retry configuration
3. **Degradation Not Working**: Check service availability checks
4. **Performance Issues**: Monitor and optimize slow operations

### Debugging

#### Enable Debug Logging
```python
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'level': 'DEBUG',
        },
    },
    'loggers': {
        'users.middleware': {
            'handlers': ['console'],
            'level': 'DEBUG',
        },
        'elate_chatbot.edge_case_middleware': {
            'handlers': ['console'],
            'level': 'DEBUG',
        },
    },
}
```

#### Check Middleware Order
Ensure middleware is in the correct order in `MIDDLEWARE` setting:

```python
MIDDLEWARE = [
    # Django core middleware first
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    
    # Custom middleware
    'users.middleware.SessionManagementMiddleware',
    'users.middleware.SessionCleanupMiddleware',
    'elate_chatbot.edge_case_middleware.EdgeCaseHandlingMiddleware',
    'elate_chatbot.edge_case_middleware.RetryMiddleware',
    'elate_chatbot.edge_case_middleware.GracefulDegradationMiddleware',
]
```

## Conclusion

The session management and edge case handling systems provide comprehensive protection and reliability for the Elate Chatbot application. By implementing these systems, the application can:

- Maintain secure and reliable user sessions
- Handle failures gracefully without affecting user experience
- Provide detailed monitoring and logging for troubleshooting
- Scale effectively with proper resource management
- Ensure high availability through circuit breakers and retry mechanisms

These systems are designed to be configurable, testable, and maintainable, providing a solid foundation for a production-ready chatbot application.
