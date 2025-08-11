# Use Python 3.11 slim image for security and performance
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    DJANGO_SETTINGS_MODULE=elate_chatbot.settings \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
        git \
        gettext \
        libffi-dev \
        libssl-dev \
        libjpeg-dev \
        libpng-dev \
        libwebp-dev \
        libxml2-dev \
        libxslt-dev \
        libgdal-dev \
        gdal-bin \
        postgresql-client \
        nginx \
        supervisor \
        cron \
        vim \
        htop \
        netcat-openbsd \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r django && useradd -r -g django django

# Install Python dependencies
COPY requirements.txt /app/
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && pip install gunicorn[gevent] psutil

# Copy project files
COPY . /app/

# Create necessary directories
RUN mkdir -p /app/staticfiles \
    /app/media \
    /app/logs \
    /app/tmp \
    /var/log/supervisor \
    /var/log/nginx \
    /var/log/celery

# Set proper permissions
RUN chown -R django:django /app \
    && chmod +x /app/scripts/*.sh \
    && chmod +x /app/entrypoint.sh

# Create symbolic links for logs
RUN ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log

# Copy configuration files
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/supervisor/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/supervisor/celery.conf /etc/supervisor/conf.d/celery.conf

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health/ || exit 1

# Expose port
EXPOSE 8000

# Switch to non-root user
USER django

# Collect static files
RUN python manage.py collectstatic --noinput

# Run database migrations
RUN python manage.py migrate --noinput

# Create superuser if it doesn't exist
RUN python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
if not User.objects.filter(email='admin@elate-moving.com').exists():
    User.objects.create_superuser('admin', 'admin@elate-moving.com', 'admin123')
"

# Switch back to root for supervisor
USER root

# Start supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
