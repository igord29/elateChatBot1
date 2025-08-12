#!/bin/bash

# Elate Chatbot DigitalOcean Deployment Script
# This script automates the deployment of the Elate Chatbot on a DigitalOcean droplet

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN=${1:-"your-domain.com"}
DROPLET_IP=${2:-"your-droplet-ip"}
EMAIL=${3:-"admin@your-domain.com"}

echo -e "${BLUE}🚀 Starting Elate Chatbot Deployment on DigitalOcean${NC}"
echo -e "${BLUE}Domain: ${DOMAIN}${NC}"
echo -e "${BLUE}Droplet IP: ${DROPLET_IP}${NC}"
echo -e "${BLUE}Email: ${EMAIL}${NC}"

# Function to print status messages
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    if ! command_exists docker; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command_exists docker-compose; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    if ! command_exists ssh; then
        print_error "SSH is not available. Please ensure SSH is installed."
        exit 1
    fi
    
    print_status "Prerequisites check passed"
}

# Generate secure secrets
generate_secrets() {
    print_status "Generating secure secrets..."
    
    # Generate Django secret key
    DJANGO_SECRET_KEY=$(python3 -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())")
    
    # Generate database password
    DB_PASSWORD=$(openssl rand -base64 32)
    
    # Generate Grafana password
    GRAFANA_PASSWORD=$(openssl rand -base64 16)
    
    # Create .env file
    cat > .env << EOF
# Django Settings
SECRET_KEY=${DJANGO_SECRET_KEY}
DEBUG=False
ALLOWED_HOSTS=${DOMAIN},www.${DOMAIN},${DROPLET_IP}
CSRF_TRUSTED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}

# Database Configuration
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql://elate_user:${DB_PASSWORD}@db:5432/elate_chatbot

# Redis Configuration
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/1
CELERY_RESULT_BACKEND=redis://redis:6379/2

# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key-here

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-email-app-password
EMAIL_USE_TLS=True
EMAIL_USE_SSL=False
DEFAULT_FROM_EMAIL=your-email@gmail.com

# Celery Configuration
CELERY_TASK_ALWAYS_EAGER=False
CELERY_TASK_EAGER_PROPAGATES=True

# Logging Configuration
LOG_LEVEL=INFO
LOG_FILE=/app/logs/django.log

# Performance Monitoring
PERFORMANCE_MONITORING=True
SLOW_QUERY_THRESHOLD=1.0
LOG_SLOW_QUERIES=True
MEMORY_MONITORING=True

# Session Management
MAX_CONCURRENT_SESSIONS=5
SESSION_INACTIVITY_TIMEOUT=3600
SESSION_CLEANUP_INTERVAL=100
SESSION_COOKIE_AGE=1209600

# Edge Case Handling
MAX_RETRIES=3
RETRY_DELAY=1
BACKOFF_FACTOR=2
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_RECOVERY_TIMEOUT=60
REQUEST_SIZE_LIMIT=10485760
RATE_LIMIT_ENABLED=True
RATE_LIMIT_ANONYMOUS=100
RATE_LIMIT_AUTHENTICATED=1000

# Security Settings
SECURE_SSL_REDIRECT=True
SECURE_HSTS_SECONDS=31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS=True
SECURE_HSTS_PRELOAD=True
SECURE_CONTENT_TYPE_NOSNIFF=True
SECURE_BROWSER_XSS_FILTER=True
SECURE_FRAME_DENY=True
SECURE_REFERRER_POLICY=strict-origin-when-cross-origin

# CORS Settings
CORS_ALLOWED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}
CORS_ALLOW_CREDENTIALS=True

# Static Files
STATIC_URL=/static/
STATIC_ROOT=/app/staticfiles
MEDIA_URL=/media/
MEDIA_ROOT=/app/media

# Cache Configuration
CACHE_BACKEND=django_redis.cache.RedisCache
CACHE_LOCATION=redis://redis:6379/1
CACHE_OPTIONS={
    "CLIENT_CLASS": "django_redis.client.DefaultClient",
    "CONNECTION_POOL_KWARGS": {"max_connections": 50},
    "SERIALIZER": "django_redis.serializers.json.JSONSerializer",
}

# Monitoring and Analytics
GRAFANA_PASSWORD=${GRAFANA_PASSWORD}

# Backup Configuration
BACKUP_RETENTION_DAYS=30
BACKUP_SCHEDULE=0 2 * * *

# SSL Certificate Paths
SSL_CERT_PATH=/etc/nginx/ssl/cert.pem
SSL_KEY_PATH=/etc/nginx/ssl/key.pem
EOF
    
    print_status "Environment file created with secure secrets"
}

# Create necessary directories
create_directories() {
    print_status "Creating necessary directories..."
    
    mkdir -p nginx/ssl
    mkdir -p postgres/backups
    mkdir -p redis
    mkdir -p logs
    mkdir -p backups
    mkdir -p monitoring/grafana/dashboards
    mkdir -p monitoring/grafana/datasources
    mkdir -p static
    mkdir -p media
    
    print_status "Directories created"
}

# Create Redis configuration
create_redis_config() {
    print_status "Creating Redis configuration..."
    
    cat > redis/redis.conf << EOF
# Redis configuration for production
bind 0.0.0.0
port 6379
timeout 0
tcp-keepalive 300
daemonize no
supervised no
pidfile /var/run/redis_6379.pid
loglevel notice
logfile ""
databases 16
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir /data
maxmemory 256mb
maxmemory-policy allkeys-lru
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-load-truncated yes
aof-use-rdb-preamble yes
EOF
    
    print_status "Redis configuration created"
}

# Create PostgreSQL initialization script
create_postgres_init() {
    print_status "Creating PostgreSQL initialization script..."
    
    cat > postgres/init.sql << EOF
-- PostgreSQL initialization script for Elate Chatbot
CREATE DATABASE elate_chatbot;
CREATE USER elate_user WITH PASSWORD '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON DATABASE elate_chatbot TO elate_user;
ALTER USER elate_user CREATEDB;
EOF
    
    print_status "PostgreSQL initialization script created"
}

# Create monitoring configuration
create_monitoring_config() {
    print_status "Creating monitoring configuration..."
    
    # Prometheus configuration
    cat > monitoring/prometheus.yml << EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  # - "first_rules.yml"
  # - "second_rules.yml"

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'django'
    static_configs:
      - targets: ['web:8000']
    metrics_path: '/metrics/'

  - job_name: 'celery'
    static_configs:
      - targets: ['celery-flower:5555']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']

  - job_name: 'postgres'
    static_configs:
      - targets: ['db:5432']
EOF
    
    # Grafana datasource
    cat > monitoring/grafana/datasources/prometheus.yml << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://monitoring:9090
    isDefault: true
EOF
    
    print_status "Monitoring configuration created"
}

# Setup SSL certificates with Let's Encrypt
setup_ssl() {
    print_status "Setting up SSL certificates..."
    
    # Create temporary nginx config for Let's Encrypt
    cat > nginx/nginx-letsencrypt.conf << EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
    
    # Run certbot to get SSL certificates
    docker run --rm -v $(pwd)/nginx/ssl:/etc/letsencrypt -v $(pwd)/nginx/nginx-letsencrypt.conf:/etc/nginx/conf.d/default.conf -p 80:80 nginx:alpine &
    NGINX_PID=$!
    
    sleep 5
    
    docker run --rm -v $(pwd)/nginx/ssl:/etc/letsencrypt -v $(pwd)/certbot/www:/var/www/certbot certbot/certbot certonly --webroot --webroot-path=/var/www/certbot --email ${EMAIL} --agree-tos --no-eff-email -d ${DOMAIN} -d www.${DOMAIN}
    
    kill $NGINX_PID
    
    # Copy certificates to nginx ssl directory
    cp nginx/ssl/live/${DOMAIN}/fullchain.pem nginx/ssl/cert.pem
    cp nginx/ssl/live/${DOMAIN}/privkey.pem nginx/ssl/key.pem
    
    print_status "SSL certificates obtained and configured"
}

# Build and start services
deploy_services() {
    print_status "Building and starting services..."
    
    # Build images
    docker-compose -f docker-compose.prod.yml build
    
    # Start services
    docker-compose -f docker-compose.prod.yml up -d
    
    print_status "Services started successfully"
}

# Wait for services to be ready
wait_for_services() {
    print_status "Waiting for services to be ready..."
    
    # Wait for database
    echo "Waiting for database..."
    docker-compose -f docker-compose.prod.yml exec -T db pg_isready -U elate_user -d elate_chatbot
    
    # Wait for Redis
    echo "Waiting for Redis..."
    docker-compose -f docker-compose.prod.yml exec -T redis redis-cli ping
    
    # Wait for web service
    echo "Waiting for web service..."
    docker-compose -f docker-compose.prod.yml exec -T web python manage.py check --deploy
    
    print_status "All services are ready"
}

# Run database migrations
run_migrations() {
    print_status "Running database migrations..."
    
    docker-compose -f docker-compose.prod.yml exec -T web python manage.py migrate
    
    print_status "Database migrations completed"
}

# Create superuser
create_superuser() {
    print_status "Creating superuser..."
    
    # Check if superuser already exists
    if docker-compose -f docker-compose.prod.yml exec -T web python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); print('Superuser exists:', User.objects.filter(is_superuser=True).exists())" | grep -q "True"; then
        print_warning "Superuser already exists, skipping creation"
    else
        docker-compose -f docker-compose.prod.yml exec -T web python manage.py createsuperuser --noinput
        print_status "Superuser created"
    fi
}

# Collect static files
collect_static() {
    print_status "Collecting static files..."
    
    docker-compose -f docker-compose.prod.yml exec -T web python manage.py collectstatic --noinput
    
    print_status "Static files collected"
}

# Setup monitoring
setup_monitoring() {
    print_status "Setting up monitoring..."
    
    docker-compose -f docker-compose.prod.yml --profile monitoring up -d
    
    print_status "Monitoring services started"
}

# Create backup script
create_backup_script() {
    print_status "Creating backup script..."
    
    cat > backup.sh << 'EOF'
#!/bin/bash

# Backup script for Elate Chatbot
BACKUP_DIR="/app/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
echo "Creating database backup..."
docker-compose -f docker-compose.prod.yml exec -T db pg_dump -U elate_user elate_chatbot > $BACKUP_DIR/db_backup_$DATE.sql

# Backup media files
echo "Creating media backup..."
tar -czf $BACKUP_DIR/media_backup_$DATE.tar.gz -C /app media/

# Backup logs
echo "Creating logs backup..."
tar -czf $BACKUP_DIR/logs_backup_$DATE.tar.gz -C /app logs/

# Clean up old backups
find $BACKUP_DIR -name "*.sql" -mtime +$RETENTION_DAYS -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $DATE"
EOF
    
    chmod +x backup.sh
    
    # Add to crontab
    (crontab -l 2>/dev/null; echo "0 2 * * * $(pwd)/backup.sh") | crontab -
    
    print_status "Backup script created and scheduled"
}

# Health check
health_check() {
    print_status "Performing health check..."
    
    # Check if services are running
    if docker-compose -f docker-compose.prod.yml ps | grep -q "Up"; then
        print_status "All services are running"
    else
        print_error "Some services are not running"
        docker-compose -f docker-compose.prod.yml ps
        exit 1
    fi
    
    # Check if website is accessible
    if curl -f -s https://${DOMAIN}/health/ > /dev/null; then
        print_status "Website is accessible"
    else
        print_warning "Website health check failed"
    fi
    
    print_status "Health check completed"
}

# Display deployment information
display_info() {
    echo -e "${BLUE}🎉 Deployment completed successfully!${NC}"
    echo -e "${BLUE}📋 Deployment Information:${NC}"
    echo -e "${GREEN}Website: https://${DOMAIN}${NC}"
    echo -e "${GREEN}Admin Panel: https://${DOMAIN}/admin/${NC}"
    echo -e "${GREEN}API Documentation: https://${DOMAIN}/api/docs/${NC}"
    echo -e "${GREEN}Celery Flower: https://${DOMAIN}:5555${NC}"
    echo -e "${GREEN}Grafana: https://${DOMAIN}:3000${NC}"
    echo -e "${GREEN}Prometheus: https://${DOMAIN}:9090${NC}"
    echo -e "${YELLOW}Grafana Password: ${GRAFANA_PASSWORD}${NC}"
    echo -e "${BLUE}📁 Important Files:${NC}"
    echo -e "${GREEN}Environment file: .env${NC}"
    echo -e "${GREEN}Docker Compose: docker-compose.prod.yml${NC}"
    echo -e "${GREEN}Backup script: backup.sh${NC}"
    echo -e "${BLUE}🔧 Useful Commands:${NC}"
    echo -e "${GREEN}View logs: docker-compose -f docker-compose.prod.yml logs -f${NC}"
    echo -e "${GREEN}Restart services: docker-compose -f docker-compose.prod.yml restart${NC}"
    echo -e "${GREEN}Stop services: docker-compose -f docker-compose.prod.yml down${NC}"
    echo -e "${GREEN}Run backup: ./backup.sh${NC}"
}

# Main deployment function
main() {
    check_prerequisites
    generate_secrets
    create_directories
    create_redis_config
    create_postgres_init
    create_monitoring_config
    setup_ssl
    deploy_services
    wait_for_services
    run_migrations
    create_superuser
    collect_static
    setup_monitoring
    create_backup_script
    health_check
    display_info
}

# Run main function
main "$@"
