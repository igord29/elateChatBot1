"""
Celery configuration for Elate Chatbot Django application.

This module configures Celery for handling background tasks such as:
- AI response generation
- Email notifications
- Analytics processing
- Data cleanup
"""

import os
from celery import Celery
from django.conf import settings

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'elate_chatbot.settings')

# Create the Celery app
app = Celery('elate_chatbot')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django apps.
app.autodiscover_tasks(lambda: settings.INSTALLED_APPS)

# Celery Configuration
app.conf.update(
    # Task routing
    task_routes={
        'chatbot.tasks.*': {'queue': 'chatbot'},
        'users.tasks.*': {'queue': 'users'},
        'analytics.tasks.*': {'queue': 'analytics'},
        'leads.tasks.*': {'queue': 'leads'},
    },
    
    # Task serialization
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    
    # Task execution
    task_always_eager=False,
    task_eager_propagates=True,
    task_ignore_result=False,
    task_store_errors_even_if_ignored=True,
    
    # Worker configuration
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1000,
    worker_disable_rate_limits=False,
    
    # Result backend
    result_backend='django-db',
    result_expires=3600,  # 1 hour
    
    # Beat schedule
    beat_schedule={
        'cleanup-old-conversations': {
            'task': 'chatbot.tasks.cleanup_old_conversations',
            'schedule': 86400.0,  # Daily
        },
        'process-analytics': {
            'task': 'analytics.tasks.process_daily_analytics',
            'schedule': 3600.0,  # Hourly
        },
        'send-email-notifications': {
            'task': 'users.tasks.send_pending_notifications',
            'schedule': 300.0,  # Every 5 minutes
        },
        'update-conversation-analytics': {
            'task': 'chatbot.tasks.update_conversation_analytics',
            'schedule': 1800.0,  # Every 30 minutes
        },
    },
    
    # Task time limits
    task_soft_time_limit=300,  # 5 minutes
    task_time_limit=600,  # 10 minutes
    
    # Retry configuration
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    
    # Monitoring
    worker_send_task_events=True,
    task_send_sent_event=True,
    
    # Security
    security_key=settings.SECRET_KEY,
    security_certificate=None,
    security_cert_store=None,
)


@app.task(bind=True)
def debug_task(self):
    """Debug task to test Celery configuration."""
    print(f'Request: {self.request!r}')
    return 'Celery is working!'


@app.task(bind=True, autoretry_for=(Exception,), retry_kwargs={'max_retries': 3})
def retry_task(self, *args, **kwargs):
    """Example task with automatic retry on failure."""
    try:
        # Task logic here
        return "Task completed successfully"
    except Exception as exc:
        # Log the error
        print(f"Task failed: {exc}")
        # Re-raise to trigger retry
        raise self.retry(exc=exc, countdown=60)  # Retry after 1 minute


# Task error handling
@app.task(bind=True)
def handle_task_failure(self, exc, task_id, args, kwargs, einfo):
    """Handle task failures and log them."""
    from django.core.mail import mail_admins
    from django.conf import settings
    
    error_message = f"""
    Task {task_id} failed:
    Exception: {exc}
    Args: {args}
    Kwargs: {kwargs}
    Traceback: {einfo}
    """
    
    # Log the error
    import logging
    logger = logging.getLogger('celery')
    logger.error(error_message)
    
    # Send email notification in production
    if not settings.DEBUG:
        mail_admins(
            subject=f'Celery Task Failed: {task_id}',
            message=error_message,
        )


# Health check task
@app.task
def health_check():
    """Health check task to verify system status."""
    from django.db import connection
    from django.core.cache import cache
    
    health_status = {
        'database': False,
        'cache': False,
        'celery': True,
    }
    
    # Check database
    try:
        connection.ensure_connection()
        health_status['database'] = True
    except Exception as e:
        health_status['database'] = False
        health_status['database_error'] = str(e)
    
    # Check cache
    try:
        cache.set('health_check', 'ok', 10)
        if cache.get('health_check') == 'ok':
            health_status['cache'] = True
    except Exception as e:
        health_status['cache'] = False
        health_status['cache_error'] = str(e)
    
    return health_status


# Periodic cleanup tasks
@app.task
def cleanup_expired_sessions():
    """Clean up expired user sessions."""
    from django.utils import timezone
    from datetime import timedelta
    from users.models import UserSession
    
    # Delete sessions older than 30 days
    cutoff_date = timezone.now() - timedelta(days=30)
    deleted_count = UserSession.objects.filter(
        last_activity__lt=cutoff_date
    ).delete()[0]
    
    return f"Deleted {deleted_count} expired sessions"


@app.task
def cleanup_old_ai_responses():
    """Clean up old AI responses to save storage."""
    from django.utils import timezone
    from datetime import timedelta
    from chatbot.models import AIResponse
    
    # Delete AI responses older than 90 days
    cutoff_date = timezone.now() - timedelta(days=90)
    deleted_count = AIResponse.objects.filter(
        created_at__lt=cutoff_date
    ).delete()[0]
    
    return f"Deleted {deleted_count} old AI responses"


# Performance monitoring tasks
@app.task
def monitor_system_performance():
    """Monitor system performance metrics."""
    import psutil
    from django.core.cache import cache
    
    # Get system metrics
    cpu_percent = psutil.cpu_percent(interval=1)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    
    metrics = {
        'cpu_percent': cpu_percent,
        'memory_percent': memory.percent,
        'memory_available': memory.available,
        'disk_percent': disk.percent,
        'disk_free': disk.free,
        'timestamp': timezone.now().isoformat(),
    }
    
    # Store metrics in cache for monitoring
    cache.set('system_metrics', metrics, 300)  # 5 minutes
    
    return metrics


# Queue monitoring
@app.task
def monitor_queue_sizes():
    """Monitor Celery queue sizes."""
    from celery.task.control import inspect
    
    i = inspect()
    
    # Get active queues
    active_queues = i.active()
    reserved_queues = i.reserved()
    scheduled_queues = i.scheduled()
    
    queue_stats = {
        'active': active_queues,
        'reserved': reserved_queues,
        'scheduled': scheduled_queues,
        'timestamp': timezone.now().isoformat(),
    }
    
    return queue_stats
