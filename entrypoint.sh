#!/bin/bash

# Exit on any error
set -e

# Function to log messages
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to wait for database
wait_for_db() {
    log "Waiting for database..."
    while ! nc -z postgres 5432; do
        sleep 1
    done
    log "Database is ready!"
}

# Function to wait for Redis
wait_for_redis() {
    log "Waiting for Redis..."
    while ! nc -z redis 6379; do
        sleep 1
    done
    log "Redis is ready!"
}

# Function to run database migrations
run_migrations() {
    log "Running database migrations..."
    python manage.py migrate --noinput
    log "Migrations completed!"
}

# Function to collect static files
collect_static() {
    log "Collecting static files..."
    python manage.py collectstatic --noinput
    log "Static files collected!"
}

# Function to create superuser if it doesn't exist
create_superuser() {
    log "Checking for superuser..."
    python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
if not User.objects.filter(email='admin@elate-moving.com').exists():
    User.objects.create_superuser('admin', 'admin@elate-moving.com', 'admin123')
    print('Superuser created successfully!')
else:
    print('Superuser already exists!')
"
}

# Function to setup initial data
setup_initial_data() {
    log "Setting up initial data..."
    python manage.py shell -c "
from chatbot.models import ChatbotConfiguration, ConversationFlow
from django.contrib.sites.models import Site

# Create default site
site, created = Site.objects.get_or_create(
    id=1,
    defaults={'domain': 'elate-moving.com', 'name': 'Elate Moving'}
)
if created:
    print('Default site created!')

# Create default chatbot configuration
config, created = ChatbotConfiguration.objects.get_or_create(
    name='default',
    defaults={
        'description': 'Default chatbot configuration',
        'default_model': 'gpt-4',
        'default_temperature': 0.7,
        'default_max_tokens': 1000,
        'response_delay': 0.5,
        'typing_indicator': True,
        'max_conversation_length': 50,
        'auto_greet': True,
        'auto_farewell': True,
        'context_window_size': 10,
    }
)
if created:
    print('Default chatbot configuration created!')

# Create default conversation flows
flows_data = [
    {
        'name': 'greeting',
        'description': 'Greeting flow for new users',
        'trigger_intents': ['greeting', 'hello', 'hi'],
        'trigger_keywords': ['hello', 'hi', 'hey', 'good morning', 'good afternoon'],
        'flow_config': {
            'steps': {
                'greet': {
                    'type': 'message',
                    'content': 'Hello! Welcome to Elate Moving. How can I help you today?',
                    'next': 'wait_for_response'
                }
            }
        }
    },
    {
        'name': 'moving_quote',
        'description': 'Flow for getting moving quotes',
        'trigger_intents': ['get_quote', 'moving_quote', 'estimate'],
        'trigger_keywords': ['quote', 'estimate', 'price', 'cost', 'moving'],
        'flow_config': {
            'steps': {
                'ask_location': {
                    'type': 'question',
                    'content': 'Where are you moving from and to?',
                    'next': 'ask_date'
                },
                'ask_date': {
                    'type': 'question',
                    'content': 'When do you plan to move?',
                    'next': 'ask_size'
                },
                'ask_size': {
                    'type': 'question',
                    'content': 'What size is your move? (1-2 bedroom, 3+ bedroom, office, etc.)',
                    'next': 'provide_quote'
                }
            }
        }
    }
]

for flow_data in flows_data:
    flow, created = ConversationFlow.objects.get_or_create(
        name=flow_data['name'],
        defaults=flow_data
    )
    if created:
        print(f'Conversation flow {flow_data[\"name\"]} created!')
"
    log "Initial data setup completed!"
}

# Function to check if this is the first run
is_first_run() {
    [ ! -f /app/.initialized ]
}

# Function to mark as initialized
mark_initialized() {
    touch /app/.initialized
}

# Main execution
main() {
    log "Starting Elate Chatbot application..."
    
    # Wait for dependencies
    wait_for_db
    wait_for_redis
    
    # Run migrations
    run_migrations
    
    # Collect static files
    collect_static
    
    # Setup initial data on first run
    if is_first_run; then
        log "First run detected, setting up initial data..."
        create_superuser
        setup_initial_data
        mark_initialized
        log "Initial setup completed!"
    fi
    
    # Start the application
    log "Starting application..."
    exec "$@"
}

# Run main function with all arguments
main "$@"
