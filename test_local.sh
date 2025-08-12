#!/bin/bash

# Elate Chatbot Local Testing Script
# This script sets up and tests the Elate Chatbot locally before deployment

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 Starting Elate Chatbot Local Testing${NC}"

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
    
    print_status "Prerequisites check passed"
}

# Generate self-signed SSL certificates for local testing
generate_ssl_certificates() {
    print_status "Generating self-signed SSL certificates for local testing..."
    
    # Create SSL directory
    mkdir -p nginx/ssl
    
    # Generate self-signed certificate
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout nginx/ssl/key.pem \
        -out nginx/ssl/cert.pem \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
    
    print_status "SSL certificates generated"
}

# Setup local environment
setup_local_environment() {
    print_status "Setting up local environment..."
    
    # Copy environment template
    if [ ! -f .env ]; then
        cp env.local.example .env
        print_status "Environment file created from template"
    else
        print_warning "Environment file already exists, skipping creation"
    fi
    
    # Create necessary directories
    mkdir -p logs backups static media
    
    print_status "Local environment setup completed"
}

# Build and start services
start_services() {
    print_status "Building and starting services..."
    
    # Build images
    docker-compose -f docker-compose.local.yml build
    
    # Start core services
    docker-compose -f docker-compose.local.yml up -d db redis
    
    # Wait for database to be ready
    print_status "Waiting for database to be ready..."
    sleep 10
    
    # Start remaining services
    docker-compose -f docker-compose.local.yml up -d
    
    print_status "Services started successfully"
}

# Wait for services to be ready
wait_for_services() {
    print_status "Waiting for services to be ready..."
    
    # Wait for database
    echo "Waiting for database..."
    until docker-compose -f docker-compose.local.yml exec -T db pg_isready -U elate_user -d elate_chatbot; do
        sleep 2
    done
    
    # Wait for Redis
    echo "Waiting for Redis..."
    until docker-compose -f docker-compose.local.yml exec -T redis redis-cli ping; do
        sleep 2
    done
    
    # Wait for web service
    echo "Waiting for web service..."
    until curl -f -s http://localhost:8000/health/ > /dev/null; do
        sleep 2
    done
    
    print_status "All services are ready"
}

# Run database migrations
run_migrations() {
    print_status "Running database migrations..."
    
    docker-compose -f docker-compose.local.yml exec -T web python manage.py migrate
    
    print_status "Database migrations completed"
}

# Create superuser
create_superuser() {
    print_status "Creating superuser..."
    
    # Check if superuser already exists
    if docker-compose -f docker-compose.local.yml exec -T web python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); print('Superuser exists:', User.objects.filter(is_superuser=True).exists())" | grep -q "True"; then
        print_warning "Superuser already exists, skipping creation"
    else
        docker-compose -f docker-compose.local.yml exec -T web python manage.py createsuperuser --noinput
        print_status "Superuser created"
    fi
}

# Collect static files
collect_static() {
    print_status "Collecting static files..."
    
    docker-compose -f docker-compose.local.yml exec -T web python manage.py collectstatic --noinput
    
    print_status "Static files collected"
}

# Load test data
load_test_data() {
    print_status "Loading test data..."
    
    # Create test data using Django management command
    docker-compose -f docker-compose.local.yml exec -T web python manage.py shell -c "
from django.contrib.auth import get_user_model
from chatbot.models import Conversation, Message, AIResponse
from users.models import UserProfile

User = get_user_model()

# Create test user if not exists
if not User.objects.filter(email='test@example.com').exists():
    user = User.objects.create_user(
        email='test@example.com',
        password='testpass123',
        first_name='Test',
        last_name='User'
    )
    print(f'Created test user: {user.email}')

# Create test conversation
conversation = Conversation.objects.create(
    user=User.objects.first(),
    title='Test Conversation',
    is_active=True
)

# Create test messages
Message.objects.create(
    conversation=conversation,
    content='Hello, this is a test message',
    message_type='user'
)

AIResponse.objects.create(
    conversation=conversation,
    content='Hello! I am the Elate Chatbot. How can I help you today?',
    model_used='gpt-4',
    tokens_used=25
)

print('Test data loaded successfully')
"
    
    print_status "Test data loaded"
}

# Run tests
run_tests() {
    print_status "Running tests..."
    
    # Run Django tests
    docker-compose -f docker-compose.local.yml exec -T web python manage.py test --verbosity=2
    
    print_status "Tests completed"
}

# Health check
health_check() {
    print_status "Performing health check..."
    
    # Check if services are running
    if docker-compose -f docker-compose.local.yml ps | grep -q "Up"; then
        print_status "All services are running"
    else
        print_error "Some services are not running"
        docker-compose -f docker-compose.local.yml ps
        exit 1
    fi
    
    # Check if website is accessible
    if curl -f -s http://localhost:8000/health/ > /dev/null; then
        print_status "Website is accessible"
    else
        print_warning "Website health check failed"
    fi
    
    # Check if admin interface is accessible
    if curl -f -s http://localhost:8000/admin/ > /dev/null; then
        print_status "Admin interface is accessible"
    else
        print_warning "Admin interface check failed"
    fi
    
    print_status "Health check completed"
}

# Display testing information
display_info() {
    echo -e "${BLUE}🎉 Local testing setup completed successfully!${NC}"
    echo -e "${BLUE}📋 Testing Information:${NC}"
    echo -e "${GREEN}Website: http://localhost:8000${NC}"
    echo -e "${GREEN}Admin Panel: http://localhost:8000/admin/${NC}"
    echo -e "${GREEN}API Documentation: http://localhost:8000/api/docs/${NC}"
    echo -e "${GREEN}Celery Flower: http://localhost:5555${NC}"
    echo -e "${GREEN}pgAdmin: http://localhost:5050${NC}"
    echo -e "${GREEN}Redis Commander: http://localhost:8081${NC}"
    echo -e "${GREEN}MailHog: http://localhost:8025${NC}"
    echo -e "${YELLOW}pgAdmin Credentials: admin@localhost / admin123${NC}"
    echo -e "${BLUE}📁 Important Files:${NC}"
    echo -e "${GREEN}Environment file: .env${NC}"
    echo -e "${GREEN}Docker Compose: docker-compose.local.yml${NC}"
    echo -e "${GREEN}Logs directory: logs/${NC}"
    echo -e "${BLUE}🔧 Useful Commands:${NC}"
    echo -e "${GREEN}View logs: docker-compose -f docker-compose.local.yml logs -f${NC}"
    echo -e "${GREEN}Restart services: docker-compose -f docker-compose.local.yml restart${NC}"
    echo -e "${GREEN}Stop services: docker-compose -f docker-compose.local.yml down${NC}"
    echo -e "${GREEN}Run tests: docker-compose -f docker-compose.local.yml exec web python manage.py test${NC}"
    echo -e "${GREEN}Access Django shell: docker-compose -f docker-compose.local.yml exec web python manage.py shell${NC}"
    echo -e "${BLUE}🧪 Testing Checklist:${NC}"
    echo -e "${GREEN}□ Visit http://localhost:8000 and test the chatbot${NC}"
    echo -e "${GREEN}□ Check admin interface at http://localhost:8000/admin/${NC}"
    echo -e "${GREEN}□ Test WebSocket connections${NC}"
    echo -e "${GREEN}□ Verify Celery tasks in Flower at http://localhost:5555${NC}"
    echo -e "${GREEN}□ Check email functionality in MailHog at http://localhost:8025${NC}"
    echo -e "${GREEN}□ Monitor database in pgAdmin at http://localhost:5050${NC}"
    echo -e "${GREEN}□ View Redis data in Redis Commander at http://localhost:8081${NC}"
}

# Test specific functionality
test_functionality() {
    print_status "Testing specific functionality..."
    
    # Test API endpoints
    echo "Testing API endpoints..."
    curl -f -s http://localhost:8000/api/v1/health/ > /dev/null && print_status "Health API endpoint working"
    
    # Test WebSocket connection
    echo "Testing WebSocket connection..."
    # This would require a WebSocket client test
    
    # Test Celery tasks
    echo "Testing Celery tasks..."
    docker-compose -f docker-compose.local.yml exec -T web python manage.py shell -c "
from celery import current_app
result = current_app.send_task('chatbot.tasks.test_task')
print(f'Celery task sent: {result.id}')
"
    
    print_status "Functionality tests completed"
}

# Cleanup function
cleanup() {
    print_status "Cleaning up..."
    
    # Stop services
    docker-compose -f docker-compose.local.yml down
    
    # Remove volumes (optional)
    if [ "$1" = "--clean" ]; then
        docker volume prune -f
        print_status "Volumes cleaned up"
    fi
    
    print_status "Cleanup completed"
}

# Main function
main() {
    case "${1:-setup}" in
        "setup")
            check_prerequisites
            generate_ssl_certificates
            setup_local_environment
            start_services
            wait_for_services
            run_migrations
            create_superuser
            collect_static
            load_test_data
            health_check
            display_info
            ;;
        "test")
            run_tests
            test_functionality
            ;;
        "health")
            health_check
            ;;
        "logs")
            docker-compose -f docker-compose.local.yml logs -f
            ;;
        "restart")
            docker-compose -f docker-compose.local.yml restart
            ;;
        "stop")
            docker-compose -f docker-compose.local.yml down
            ;;
        "cleanup")
            cleanup "$2"
            ;;
        "help")
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  setup     - Set up and start all services (default)"
            echo "  test      - Run tests and functionality checks"
            echo "  health    - Perform health check"
            echo "  logs      - View service logs"
            echo "  restart   - Restart all services"
            echo "  stop      - Stop all services"
            echo "  cleanup   - Stop services and clean up (--clean for volumes)"
            echo "  help      - Show this help message"
            ;;
        *)
            print_error "Unknown command: $1"
            echo "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"
