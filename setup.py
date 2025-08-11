#!/usr/bin/env python3
"""
Setup script for Elate Moving Chatbot Django application.

This script automates the initial setup process including:
- Environment configuration
- Database setup
- Initial data creation
- Service verification
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

def run_command(command, check=True, capture_output=False):
    """Run a shell command and return the result."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            check=check,
            capture_output=capture_output,
            text=True
        )
        return result
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {command}")
        print(f"Error: {e}")
        return None

def check_python_version():
    """Check if Python version is compatible."""
    if sys.version_info < (3, 11):
        print("❌ Python 3.11 or higher is required")
        print(f"Current version: {sys.version}")
        return False
    print(f"✅ Python version: {sys.version}")
    return True

def check_dependencies():
    """Check if required dependencies are installed."""
    print("\n🔍 Checking dependencies...")
    
    # Check Docker
    docker_result = run_command("docker --version", check=False, capture_output=True)
    if docker_result and docker_result.returncode == 0:
        print("✅ Docker is installed")
    else:
        print("❌ Docker is not installed or not accessible")
        print("Please install Docker from https://docker.com")
        return False
    
    # Check Docker Compose
    compose_result = run_command("docker-compose --version", check=False, capture_output=True)
    if compose_result and compose_result.returncode == 0:
        print("✅ Docker Compose is installed")
    else:
        print("❌ Docker Compose is not installed or not accessible")
        return False
    
    return True

def setup_environment():
    """Setup environment configuration."""
    print("\n🔧 Setting up environment...")
    
    env_file = Path(".env")
    env_example = Path("env.example")
    
    if not env_example.exists():
        print("❌ env.example file not found")
        return False
    
    if env_file.exists():
        print("⚠️  .env file already exists")
        response = input("Do you want to overwrite it? (y/N): ")
        if response.lower() != 'y':
            print("Skipping environment setup")
            return True
    
    # Copy env.example to .env
    shutil.copy(env_example, env_file)
    print("✅ Environment file created")
    
    # Prompt for configuration
    print("\n📝 Please configure your environment variables:")
    print("Edit the .env file with your settings:")
    print("- SECRET_KEY: Generate a secure secret key")
    print("- OPENAI_API_KEY: Your OpenAI API key")
    print("- Database credentials")
    print("- Email settings (for production)")
    
    return True

def setup_docker():
    """Setup Docker services."""
    print("\n🐳 Setting up Docker services...")
    
    # Build and start services
    print("Building Docker images...")
    result = run_command("docker-compose build")
    if not result:
        print("❌ Failed to build Docker images")
        return False
    
    print("Starting services...")
    result = run_command("docker-compose up -d")
    if not result:
        print("❌ Failed to start services")
        return False
    
    print("✅ Docker services started")
    return True

def setup_database():
    """Setup database and run migrations."""
    print("\n🗄️  Setting up database...")
    
    # Wait for services to be ready
    print("Waiting for services to be ready...")
    import time
    time.sleep(10)
    
    # Run migrations
    print("Running database migrations...")
    result = run_command("docker-compose exec django python manage.py migrate")
    if not result:
        print("❌ Failed to run migrations")
        return False
    
    print("✅ Database setup completed")
    return True

def setup_initial_data():
    """Setup initial data and superuser."""
    print("\n📊 Setting up initial data...")
    
    # Setup chatbot data
    print("Setting up chatbot configuration...")
    result = run_command("docker-compose exec django python manage.py setup_chatbot")
    if not result:
        print("❌ Failed to setup chatbot data")
        return False
    
    # Create superuser
    print("Creating superuser...")
    superuser_script = """
from django.contrib.auth import get_user_model
User = get_user_model()
if not User.objects.filter(email='admin@elate-moving.com').exists():
    User.objects.create_superuser('admin', 'admin@elate-moving.com', 'admin123')
    print('Superuser created: admin@elate-moving.com / admin123')
else:
    print('Superuser already exists')
"""
    
    result = run_command(f"docker-compose exec django python manage.py shell -c \"{superuser_script}\"")
    if not result:
        print("❌ Failed to create superuser")
        return False
    
    print("✅ Initial data setup completed")
    return True

def verify_services():
    """Verify that all services are running correctly."""
    print("\n🔍 Verifying services...")
    
    # Check service status
    result = run_command("docker-compose ps")
    if not result:
        print("❌ Failed to check service status")
        return False
    
    # Check Django health
    print("Checking Django application...")
    result = run_command("curl -f http://localhost:8000/health/", check=False)
    if result and result.returncode == 0:
        print("✅ Django application is running")
    else:
        print("❌ Django application is not responding")
        return False
    
    # Check PostgreSQL
    print("Checking PostgreSQL...")
    result = run_command("docker-compose exec postgres pg_isready -U postgres", check=False)
    if result and result.returncode == 0:
        print("✅ PostgreSQL is running")
    else:
        print("❌ PostgreSQL is not responding")
        return False
    
    # Check Redis
    print("Checking Redis...")
    result = run_command("docker-compose exec redis redis-cli ping", check=False)
    if result and result.returncode == 0:
        print("✅ Redis is running")
    else:
        print("❌ Redis is not responding")
        return False
    
    return True

def display_next_steps():
    """Display next steps for the user."""
    print("\n🎉 Setup completed successfully!")
    print("\n📋 Next steps:")
    print("1. Access the application:")
    print("   - Django Admin: http://localhost:8000/admin/")
    print("   - API Documentation: http://localhost:8000/api/docs/")
    print("   - Frontend: http://localhost:3000/")
    print("   - Celery Flower: http://localhost:5555/")
    
    print("\n2. Default credentials:")
    print("   - Admin: admin@elate-moving.com / admin123")
    
    print("\n3. Useful commands:")
    print("   - View logs: docker-compose logs -f")
    print("   - Stop services: docker-compose down")
    print("   - Restart services: docker-compose restart")
    print("   - Update code: docker-compose up --build")
    
    print("\n4. Development:")
    print("   - Edit code in the src/ directory")
    print("   - Changes will be reflected automatically")
    print("   - Check logs for any errors")
    
    print("\n5. Production deployment:")
    print("   - Update .env with production settings")
    print("   - Use docker-compose.prod.yml for production")
    print("   - Configure SSL certificates")
    print("   - Set up monitoring and backups")

def main():
    """Main setup function."""
    print("🚀 Elate Moving Chatbot Setup")
    print("=" * 50)
    
    # Check Python version
    if not check_python_version():
        sys.exit(1)
    
    # Check dependencies
    if not check_dependencies():
        sys.exit(1)
    
    # Setup environment
    if not setup_environment():
        sys.exit(1)
    
    # Setup Docker
    if not setup_docker():
        sys.exit(1)
    
    # Setup database
    if not setup_database():
        sys.exit(1)
    
    # Setup initial data
    if not setup_initial_data():
        sys.exit(1)
    
    # Verify services
    if not verify_services():
        sys.exit(1)
    
    # Display next steps
    display_next_steps()

if __name__ == "__main__":
    main()
