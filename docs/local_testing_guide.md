# Local Testing Guide

This guide provides comprehensive instructions for testing the Elate Chatbot locally before deploying to production.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Local Environment Setup](#local-environment-setup)
4. [Testing Procedures](#testing-procedures)
5. [Development Tools](#development-tools)
6. [Debugging](#debugging)
7. [Troubleshooting](#troubleshooting)
8. [Testing Checklist](#testing-checklist)
9. [Performance Testing](#performance-testing)
10. [Security Testing](#security-testing)

## Prerequisites

### Required Software
- Docker (version 20.10+)
- Docker Compose (version 2.0+)
- Git
- OpenSSL (for SSL certificate generation)
- Curl (for health checks)

### System Requirements
- **Minimum**: 4GB RAM, 2 CPU cores
- **Recommended**: 8GB RAM, 4 CPU cores
- **Storage**: At least 10GB free space

### Optional Tools
- **pgAdmin**: Database management (included in setup)
- **Redis Commander**: Redis management (included in setup)
- **MailHog**: Email testing (included in setup)

## Quick Start

### 1. Clone and Setup
```bash
# Clone the repository
git clone https://github.com/your-username/elate-chatbot.git
cd elate-chatbot

# Make scripts executable
chmod +x test_local.sh
chmod +x deploy.sh

# Run the local testing setup
./test_local.sh setup
```

### 2. Access Your Application
Once setup is complete, you can access:

- **Main Application**: http://localhost:8000
- **Admin Panel**: http://localhost:8000/admin/
- **API Documentation**: http://localhost:8000/api/docs/
- **Celery Flower**: http://localhost:5555
- **pgAdmin**: http://localhost:5050 (admin@localhost / admin123)
- **Redis Commander**: http://localhost:8081
- **MailHog**: http://localhost:8025

## Local Environment Setup

### 1. Environment Configuration

The local testing setup uses `env.local.example` as a template:

```bash
# Copy environment template
cp env.local.example .env

# Edit environment variables
nano .env
```

**Key Configuration Changes:**
- `OPENAI_API_KEY`: Your OpenAI API key for testing
- `DEBUG=True`: Enable debug mode for development
- `ALLOWED_HOSTS`: Local development hosts
- `EMAIL_*`: MailHog configuration for email testing

### 2. SSL Certificates

Self-signed SSL certificates are automatically generated for local HTTPS testing:

```bash
# Certificates are generated automatically by test_local.sh
# Location: nginx/ssl/cert.pem and nginx/ssl/key.pem
```

### 3. Database Setup

PostgreSQL database is automatically configured:

- **Database**: `elate_chatbot`
- **User**: `elate_user`
- **Password**: `localdev` (configurable)
- **Port**: `5432`

### 4. Redis Setup

Redis is configured for caching and message brokering:

- **Port**: `6379`
- **Databases**: 16
- **Memory**: 512MB (development)

## Testing Procedures

### 1. Basic Functionality Testing

#### Test the Chatbot Interface
```bash
# Visit the main application
open http://localhost:8000

# Test basic chat functionality
# 1. Send a message
# 2. Verify AI response
# 3. Check conversation history
```

#### Test Admin Interface
```bash
# Access admin panel
open http://localhost:8000/admin/

# Login with superuser credentials
# Test CRUD operations for:
# - Users
# - Conversations
# - Messages
# - AI Responses
```

#### Test API Endpoints
```bash
# Health check
curl http://localhost:8000/health/

# API documentation
curl http://localhost:8000/api/docs/

# Test specific endpoints
curl -X POST http://localhost:8000/api/v1/chatbot/chat/ \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, how are you?"}'
```

### 2. WebSocket Testing

#### Test Real-time Communication
```bash
# Use browser developer tools or WebSocket client
# Connect to: ws://localhost:8001/ws/chat/

# Test message sending and receiving
# Verify real-time updates
```

#### WebSocket Test Script
```python
import websocket
import json

def on_message(ws, message):
    print(f"Received: {message}")

def on_error(ws, error):
    print(f"Error: {error}")

def on_close(ws, close_status_code, close_msg):
    print("WebSocket connection closed")

def on_open(ws):
    print("WebSocket connection opened")
    # Send test message
    ws.send(json.dumps({
        "type": "chat_message",
        "message": "Hello from WebSocket test"
    }))

# Connect to WebSocket
websocket.enableTrace(True)
ws = websocket.WebSocketApp("ws://localhost:8001/ws/chat/",
                          on_open=on_open,
                          on_message=on_message,
                          on_error=on_error,
                          on_close=on_close)
ws.run_forever()
```

### 3. Celery Task Testing

#### Monitor Celery Tasks
```bash
# Access Celery Flower
open http://localhost:5555

# Check active workers
# Monitor task execution
# View task results
```

#### Test Background Tasks
```bash
# Access Django shell
docker-compose -f docker-compose.local.yml exec web python manage.py shell

# Test task execution
from chatbot.tasks import process_chat_message
result = process_chat_message.delay("Test message")
print(f"Task ID: {result.id}")
```

### 4. Email Testing

#### Test Email Functionality
```bash
# Access MailHog
open http://localhost:8025

# Send test email from Django shell
docker-compose -f docker-compose.local.yml exec web python manage.py shell

# In Django shell:
from django.core.mail import send_mail
send_mail(
    'Test Email',
    'This is a test email from Elate Chatbot.',
    'noreply@localhost',
    ['test@example.com'],
    fail_silently=False,
)
```

### 5. Database Testing

#### Test Database Operations
```bash
# Access pgAdmin
open http://localhost:5050

# Login: admin@localhost / admin123
# Connect to database: localhost:5432
# Database: elate_chatbot
# Username: elate_user
# Password: localdev
```

#### Database Query Testing
```bash
# Access Django shell
docker-compose -f docker-compose.local.yml exec web python manage.py shell

# Test database queries
from chatbot.models import Conversation, Message
from users.models import CustomUser

# Count conversations
print(f"Total conversations: {Conversation.objects.count()}")

# Get recent messages
recent_messages = Message.objects.order_by('-created_at')[:10]
for msg in recent_messages:
    print(f"{msg.created_at}: {msg.content[:50]}...")
```

## Development Tools

### 1. Logging and Monitoring

#### View Application Logs
```bash
# View all service logs
docker-compose -f docker-compose.local.yml logs -f

# View specific service logs
docker-compose -f docker-compose.local.yml logs -f web
docker-compose -f docker-compose.local.yml logs -f celery
docker-compose -f docker-compose.local.yml logs -f db
```

#### Monitor Resource Usage
```bash
# Check container resource usage
docker stats

# Check disk usage
docker system df

# Monitor specific container
docker stats elate_chatbot_web_local
```

### 2. Debugging Tools

#### Django Debug Toolbar
- Automatically enabled in development
- Access via browser when DEBUG=True
- Provides SQL queries, cache hits, etc.

#### Django Shell
```bash
# Access Django shell
docker-compose -f docker-compose.local.yml exec web python manage.py shell

# Debug models
from chatbot.models import *
from users.models import *

# Debug settings
from django.conf import settings
print(settings.DEBUG)
```

#### Database Debugging
```bash
# Check database connections
docker-compose -f docker-compose.local.yml exec db psql -U elate_user -d elate_chatbot -c "\dt"

# Check Redis
docker-compose -f docker-compose.local.yml exec redis redis-cli ping
docker-compose -f docker-compose.local.yml exec redis redis-cli info
```

### 3. Testing Tools

#### Run Unit Tests
```bash
# Run all tests
docker-compose -f docker-compose.local.yml exec web python manage.py test

# Run specific test
docker-compose -f docker-compose.local.yml exec web python manage.py test chatbot.tests.test_models

# Run with coverage
docker-compose -f docker-compose.local.yml exec web python manage.py test --coverage
```

#### Run Integration Tests
```bash
# Test API endpoints
curl -X GET http://localhost:8000/api/v1/health/
curl -X POST http://localhost:8000/api/v1/chatbot/chat/ -H "Content-Type: application/json" -d '{"message": "test"}'

# Test WebSocket
# Use WebSocket client or browser developer tools
```

## Debugging

### 1. Common Issues

#### Service Not Starting
```bash
# Check service status
docker-compose -f docker-compose.local.yml ps

# Check service logs
docker-compose -f docker-compose.local.yml logs service_name

# Restart service
docker-compose -f docker-compose.local.yml restart service_name
```

#### Database Connection Issues
```bash
# Check database status
docker-compose -f docker-compose.local.yml exec db pg_isready -U elate_user

# Check database logs
docker-compose -f docker-compose.local.yml logs db

# Reset database (WARNING: This will delete all data)
docker-compose -f docker-compose.local.yml down
docker volume rm elate_chatbot_postgres_data
docker-compose -f docker-compose.local.yml up -d
```

#### Redis Connection Issues
```bash
# Check Redis status
docker-compose -f docker-compose.local.yml exec redis redis-cli ping

# Check Redis logs
docker-compose -f docker-compose.local.yml logs redis

# Reset Redis (WARNING: This will delete all data)
docker-compose -f docker-compose.local.yml down
docker volume rm elate_chatbot_redis_data
docker-compose -f docker-compose.local.yml up -d
```

### 2. Performance Issues

#### High Memory Usage
```bash
# Check memory usage
docker stats

# Optimize Redis memory
docker-compose -f docker-compose.local.yml exec redis redis-cli config set maxmemory 256mb

# Restart services
docker-compose -f docker-compose.local.yml restart
```

#### Slow Response Times
```bash
# Check database performance
docker-compose -f docker-compose.local.yml exec web python manage.py shell -c "
from django.db import connection
from django.db import reset_queries
import time

reset_queries()
start_time = time.time()

# Run your query here
from chatbot.models import Conversation
conversations = Conversation.objects.all()

end_time = time.time()
print(f'Query time: {end_time - start_time:.2f} seconds')
print(f'Number of queries: {len(connection.queries)}')
"
```

### 3. SSL Certificate Issues

#### Certificate Problems
```bash
# Regenerate SSL certificates
rm -rf nginx/ssl
./test_local.sh setup

# Or manually generate
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout nginx/ssl/key.pem \
    -out nginx/ssl/cert.pem \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

## Troubleshooting

### 1. Port Conflicts

If you get port conflicts, check what's using the ports:

```bash
# Check port usage
netstat -tulpn | grep :8000
netstat -tulpn | grep :5432
netstat -tulpn | grep :6379

# Kill process using port
sudo kill -9 <PID>
```

### 2. Permission Issues

```bash
# Fix file permissions
sudo chown -R $USER:$USER .
chmod +x *.sh

# Fix Docker permissions
sudo usermod -aG docker $USER
# Log out and back in
```

### 3. Docker Issues

```bash
# Clean up Docker
docker system prune -f
docker volume prune -f

# Reset everything
docker-compose -f docker-compose.local.yml down -v
docker system prune -af
./test_local.sh setup
```

### 4. Environment Issues

```bash
# Check environment variables
docker-compose -f docker-compose.local.yml exec web env | grep DJANGO

# Reload environment
docker-compose -f docker-compose.local.yml down
docker-compose -f docker-compose.local.yml up -d
```

## Testing Checklist

### ✅ Basic Setup
- [ ] Docker and Docker Compose installed
- [ ] Repository cloned
- [ ] Environment file configured
- [ ] SSL certificates generated
- [ ] All services running

### ✅ Core Functionality
- [ ] Website accessible at http://localhost:8000
- [ ] Admin panel accessible at http://localhost:8000/admin/
- [ ] Database connection working
- [ ] Redis connection working
- [ ] Static files loading correctly

### ✅ Chatbot Features
- [ ] Chat interface loads
- [ ] Messages can be sent
- [ ] AI responses received
- [ ] Conversation history saved
- [ ] WebSocket connections work

### ✅ Background Tasks
- [ ] Celery workers running
- [ ] Tasks processed correctly
- [ ] Celery Flower accessible
- [ ] Scheduled tasks working

### ✅ Email System
- [ ] MailHog accessible
- [ ] Emails sent correctly
- [ ] Email templates working
- [ ] Email queue processing

### ✅ API Testing
- [ ] Health endpoint working
- [ ] API documentation accessible
- [ ] Authentication working
- [ ] Rate limiting configured

### ✅ Security Testing
- [ ] CSRF protection enabled
- [ ] XSS protection working
- [ ] SQL injection protection
- [ ] Input validation working

### ✅ Performance Testing
- [ ] Response times acceptable
- [ ] Database queries optimized
- [ ] Caching working
- [ ] Memory usage reasonable

## Performance Testing

### 1. Load Testing

#### Basic Load Test
```bash
# Install Apache Bench
sudo apt-get install apache2-utils

# Test basic load
ab -n 100 -c 10 http://localhost:8000/health/

# Test API endpoints
ab -n 50 -c 5 -p test_data.json -T application/json http://localhost:8000/api/v1/chatbot/chat/
```

#### WebSocket Load Test
```python
import asyncio
import websockets
import json

async def test_websocket():
    uri = "ws://localhost:8001/ws/chat/"
    async with websockets.connect(uri) as websocket:
        # Send multiple messages
        for i in range(10):
            message = {
                "type": "chat_message",
                "message": f"Test message {i}"
            }
            await websocket.send(json.dumps(message))
            response = await websocket.recv()
            print(f"Response {i}: {response}")

asyncio.run(test_websocket())
```

### 2. Database Performance

#### Query Performance
```bash
# Enable query logging
docker-compose -f docker-compose.local.yml exec web python manage.py shell -c "
from django.db import connection
from django.conf import settings
settings.DEBUG = True

# Run performance test
from chatbot.models import Conversation, Message
import time

start_time = time.time()
conversations = Conversation.objects.select_related('user').prefetch_related('messages').all()
for conv in conversations:
    print(f'Conversation: {conv.title}, Messages: {conv.messages.count()}')
end_time = time.time()
print(f'Query time: {end_time - start_time:.2f} seconds')
"
```

### 3. Memory Usage

#### Monitor Memory
```bash
# Check container memory usage
docker stats --no-stream

# Check specific service
docker stats --no-stream elate_chatbot_web_local

# Monitor Redis memory
docker-compose -f docker-compose.local.yml exec redis redis-cli info memory
```

## Security Testing

### 1. Input Validation

#### Test SQL Injection
```bash
# Test with malicious input
curl -X POST http://localhost:8000/api/v1/chatbot/chat/ \
  -H "Content-Type: application/json" \
  -d '{"message": "'; DROP TABLE users; --"}'
```

#### Test XSS
```bash
# Test with script tags
curl -X POST http://localhost:8000/api/v1/chatbot/chat/ \
  -H "Content-Type: application/json" \
  -d '{"message": "<script>alert(\"XSS\")</script>"}'
```

### 2. Authentication Testing

#### Test Unauthorized Access
```bash
# Test admin access without authentication
curl http://localhost:8000/admin/

# Test API endpoints without tokens
curl http://localhost:8000/api/v1/users/
```

### 3. Rate Limiting

#### Test Rate Limits
```bash
# Send multiple requests quickly
for i in {1..20}; do
  curl -X POST http://localhost:8000/api/v1/chatbot/chat/ \
    -H "Content-Type: application/json" \
    -d '{"message": "test"}'
done
```

---

## Quick Commands Reference

### Setup and Management
```bash
# Setup local environment
./test_local.sh setup

# Run tests
./test_local.sh test

# Health check
./test_local.sh health

# View logs
./test_local.sh logs

# Restart services
./test_local.sh restart

# Stop services
./test_local.sh stop

# Cleanup
./test_local.sh cleanup
```

### Development Commands
```bash
# Access Django shell
docker-compose -f docker-compose.local.yml exec web python manage.py shell

# Run migrations
docker-compose -f docker-compose.local.yml exec web python manage.py migrate

# Create superuser
docker-compose -f docker-compose.local.yml exec web python manage.py createsuperuser

# Collect static files
docker-compose -f docker-compose.local.yml exec web python manage.py collectstatic

# Run tests
docker-compose -f docker-compose.local.yml exec web python manage.py test
```

### Monitoring Commands
```bash
# View all logs
docker-compose -f docker-compose.local.yml logs -f

# View specific service logs
docker-compose -f docker-compose.local.yml logs -f web

# Check service status
docker-compose -f docker-compose.local.yml ps

# Monitor resources
docker stats
```

This comprehensive local testing guide ensures your Elate Chatbot is thoroughly tested before deployment to production.
