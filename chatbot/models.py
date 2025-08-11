"""
Chatbot models for Elate Moving Chatbot.

This module contains models for managing chatbot conversations,
messages, AI responses, and conversation flows.
"""

from django.db import models
from django.conf import settings
from django.utils import timezone
from django.core.validators import MinValueValidator, MaxValueValidator
import uuid
import json


class Conversation(models.Model):
    """
    Model to track chatbot conversations.
    
    Each conversation represents a chat session between a user
    and the chatbot, including metadata and conversation state.
    """
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='conversations')
    
    # Conversation Information
    title = models.CharField(max_length=255, blank=True, verbose_name="Conversation Title")
    description = models.TextField(blank=True, verbose_name="Conversation Description")
    
    # Status and State
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('paused', 'Paused'),
        ('completed', 'Completed'),
        ('abandoned', 'Abandoned'),
    ]
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active', verbose_name="Status")
    is_archived = models.BooleanField(default=False, verbose_name="Archived")
    
    # Context and Data
    context_data = models.JSONField(default=dict, verbose_name="Context Data")
    user_preferences = models.JSONField(default=dict, verbose_name="User Preferences")
    conversation_flow = models.CharField(max_length=100, blank=True, verbose_name="Current Flow")
    
    # Analytics
    message_count = models.PositiveIntegerField(default=0, verbose_name="Message Count")
    user_message_count = models.PositiveIntegerField(default=0, verbose_name="User Message Count")
    bot_message_count = models.PositiveIntegerField(default=0, verbose_name="Bot Message Count")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Updated At")
    last_activity = models.DateTimeField(auto_now=True, verbose_name="Last Activity")
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name="Completed At")
    
    # Meta
    class Meta:
        verbose_name = "Conversation"
        verbose_name_plural = "Conversations"
        db_table = 'conversations'
        indexes = [
            models.Index(fields=['user', 'created_at']),
            models.Index(fields=['status']),
            models.Index(fields=['last_activity']),
        ]
        ordering = ['-last_activity']
    
    def __str__(self):
        return f"Conversation {self.id} - {self.title or 'Untitled'}"
    
    def get_duration(self):
        """Get the conversation duration in seconds."""
        end_time = self.completed_at or timezone.now()
        return (end_time - self.created_at).total_seconds()
    
    def update_activity(self):
        """Update the last activity timestamp."""
        self.last_activity = timezone.now()
        self.save(update_fields=['last_activity'])
    
    def complete_conversation(self):
        """Mark the conversation as completed."""
        self.status = 'completed'
        self.completed_at = timezone.now()
        self.save(update_fields=['status', 'completed_at'])
    
    def get_context_value(self, key, default=None):
        """Get a value from the context data."""
        return self.context_data.get(key, default)
    
    def set_context_value(self, key, value):
        """Set a value in the context data."""
        self.context_data[key] = value
        self.save(update_fields=['context_data'])
    
    def get_user_preference(self, key, default=None):
        """Get a user preference value."""
        return self.user_preferences.get(key, default)
    
    def set_user_preference(self, key, value):
        """Set a user preference value."""
        self.user_preferences[key] = value
        self.save(update_fields=['user_preferences'])


class Message(models.Model):
    """
    Model to store individual messages in conversations.
    
    Each message represents a single exchange between the user
    and the chatbot, including content, metadata, and AI processing info.
    """
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    
    # Message Content
    content = models.TextField(verbose_name="Message Content")
    content_type = models.CharField(max_length=50, default='text', verbose_name="Content Type")
    
    # Message Type
    MESSAGE_TYPE_CHOICES = [
        ('user', 'User Message'),
        ('bot', 'Bot Message'),
        ('system', 'System Message'),
        ('error', 'Error Message'),
    ]
    
    message_type = models.CharField(max_length=20, choices=MESSAGE_TYPE_CHOICES, verbose_name="Message Type")
    
    # AI Processing Information
    ai_model_used = models.CharField(max_length=100, blank=True, verbose_name="AI Model Used")
    ai_processing_time = models.FloatField(null=True, blank=True, verbose_name="AI Processing Time (seconds)")
    ai_tokens_used = models.PositiveIntegerField(null=True, blank=True, verbose_name="AI Tokens Used")
    ai_cost = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True, verbose_name="AI Cost")
    
    # Intent and Entities
    detected_intent = models.CharField(max_length=100, blank=True, verbose_name="Detected Intent")
    confidence_score = models.FloatField(
        validators=[MinValueValidator(0.0), MaxValueValidator(1.0)],
        null=True,
        blank=True,
        verbose_name="Confidence Score"
    )
    entities = models.JSONField(default=list, verbose_name="Detected Entities")
    
    # Message Metadata
    metadata = models.JSONField(default=dict, verbose_name="Message Metadata")
    is_processed = models.BooleanField(default=False, verbose_name="Processed")
    processing_errors = models.JSONField(default=list, verbose_name="Processing Errors")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    processed_at = models.DateTimeField(null=True, blank=True, verbose_name="Processed At")
    
    # Meta
    class Meta:
        verbose_name = "Message"
        verbose_name_plural = "Messages"
        db_table = 'messages'
        indexes = [
            models.Index(fields=['conversation', 'created_at']),
            models.Index(fields=['message_type']),
            models.Index(fields=['detected_intent']),
            models.Index(fields=['created_at']),
        ]
        ordering = ['created_at']
    
    def __str__(self):
        return f"{self.message_type.title()} Message - {self.content[:50]}..."
    
    def mark_as_processed(self, processing_time=None, tokens_used=None, cost=None):
        """Mark the message as processed."""
        self.is_processed = True
        self.processed_at = timezone.now()
        if processing_time is not None:
            self.ai_processing_time = processing_time
        if tokens_used is not None:
            self.ai_tokens_used = tokens_used
        if cost is not None:
            self.ai_cost = cost
        self.save(update_fields=['is_processed', 'processed_at', 'ai_processing_time', 'ai_tokens_used', 'ai_cost'])
    
    def add_processing_error(self, error_message, error_type='general'):
        """Add a processing error to the message."""
        self.processing_errors.append({
            'message': error_message,
            'type': error_type,
            'timestamp': timezone.now().isoformat(),
        })
        self.save(update_fields=['processing_errors'])
    
    def get_entity_value(self, entity_type):
        """Get the value of a specific entity type."""
        for entity in self.entities:
            if entity.get('type') == entity_type:
                return entity.get('value')
        return None
    
    def get_metadata_value(self, key, default=None):
        """Get a value from the metadata."""
        return self.metadata.get(key, default)
    
    def set_metadata_value(self, key, value):
        """Set a value in the metadata."""
        self.metadata[key] = value
        self.save(update_fields=['metadata'])


class ConversationFlow(models.Model):
    """
    Model to define conversation flows and their states.
    
    This model stores the structure and logic for different
    conversation flows that the chatbot can follow.
    """
    
    name = models.CharField(max_length=100, unique=True, verbose_name="Flow Name")
    description = models.TextField(blank=True, verbose_name="Description")
    
    # Flow Configuration
    flow_config = models.JSONField(verbose_name="Flow Configuration")
    is_active = models.BooleanField(default=True, verbose_name="Active")
    priority = models.PositiveIntegerField(default=0, verbose_name="Priority")
    
    # Triggers and Conditions
    trigger_intents = models.JSONField(default=list, verbose_name="Trigger Intents")
    trigger_keywords = models.JSONField(default=list, verbose_name="Trigger Keywords")
    conditions = models.JSONField(default=dict, verbose_name="Flow Conditions")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Updated At")
    
    # Meta
    class Meta:
        verbose_name = "Conversation Flow"
        verbose_name_plural = "Conversation Flows"
        db_table = 'conversation_flows'
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
            models.Index(fields=['priority']),
        ]
        ordering = ['-priority', 'name']
    
    def __str__(self):
        return self.name
    
    def is_triggered_by_intent(self, intent):
        """Check if the flow is triggered by a specific intent."""
        return intent in self.trigger_intents
    
    def is_triggered_by_keyword(self, keyword):
        """Check if the flow is triggered by a specific keyword."""
        return keyword.lower() in [k.lower() for k in self.trigger_keywords]
    
    def check_conditions(self, context_data):
        """Check if the flow conditions are met."""
        for condition_key, condition_value in self.conditions.items():
            if context_data.get(condition_key) != condition_value:
                return False
        return True
    
    def get_flow_step(self, step_name):
        """Get a specific step from the flow configuration."""
        return self.flow_config.get('steps', {}).get(step_name)


class AIResponse(models.Model):
    """
    Model to store AI-generated responses and their metadata.
    
    This model tracks AI responses, including the prompt used,
    response generated, and performance metrics.
    """
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.OneToOneField(Message, on_delete=models.CASCADE, related_name='ai_response')
    
    # AI Configuration
    model_name = models.CharField(max_length=100, verbose_name="AI Model Name")
    model_version = models.CharField(max_length=50, blank=True, verbose_name="Model Version")
    temperature = models.FloatField(default=0.7, verbose_name="Temperature")
    max_tokens = models.PositiveIntegerField(default=1000, verbose_name="Max Tokens")
    
    # Prompt and Response
    prompt = models.TextField(verbose_name="AI Prompt")
    response = models.TextField(verbose_name="AI Response")
    response_type = models.CharField(max_length=50, default='text', verbose_name="Response Type")
    
    # Performance Metrics
    processing_time = models.FloatField(verbose_name="Processing Time (seconds)")
    input_tokens = models.PositiveIntegerField(verbose_name="Input Tokens")
    output_tokens = models.PositiveIntegerField(verbose_name="Output Tokens")
    total_tokens = models.PositiveIntegerField(verbose_name="Total Tokens")
    cost = models.DecimalField(max_digits=10, decimal_places=6, verbose_name="Cost")
    
    # Quality Metrics
    response_quality_score = models.FloatField(
        validators=[MinValueValidator(0.0), MaxValueValidator(1.0)],
        null=True,
        blank=True,
        verbose_name="Response Quality Score"
    )
    user_satisfaction_score = models.FloatField(
        validators=[MinValueValidator(0.0), MaxValueValidator(5.0)],
        null=True,
        blank=True,
        verbose_name="User Satisfaction Score"
    )
    
    # Metadata
    metadata = models.JSONField(default=dict, verbose_name="Response Metadata")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    
    # Meta
    class Meta:
        verbose_name = "AI Response"
        verbose_name_plural = "AI Responses"
        db_table = 'ai_responses'
        indexes = [
            models.Index(fields=['model_name']),
            models.Index(fields=['created_at']),
            models.Index(fields=['cost']),
        ]
    
    def __str__(self):
        return f"AI Response for {self.message.id}"
    
    def get_cost_per_token(self):
        """Calculate the cost per token."""
        if self.total_tokens > 0:
            return self.cost / self.total_tokens
        return 0
    
    def get_processing_speed(self):
        """Calculate tokens per second processing speed."""
        if self.processing_time > 0:
            return self.total_tokens / self.processing_time
        return 0
    
    def set_user_satisfaction(self, score):
        """Set the user satisfaction score."""
        if 0 <= score <= 5:
            self.user_satisfaction_score = score
            self.save(update_fields=['user_satisfaction_score'])
    
    def get_metadata_value(self, key, default=None):
        """Get a value from the metadata."""
        return self.metadata.get(key, default)
    
    def set_metadata_value(self, key, value):
        """Set a value in the metadata."""
        self.metadata[key] = value
        self.save(update_fields=['metadata'])


class ChatbotConfiguration(models.Model):
    """
    Model to store chatbot configuration settings.
    
    This model allows for dynamic configuration of the chatbot
    behavior, AI settings, and response patterns.
    """
    
    name = models.CharField(max_length=100, unique=True, verbose_name="Configuration Name")
    description = models.TextField(blank=True, verbose_name="Description")
    
    # AI Configuration
    default_model = models.CharField(max_length=100, default='gpt-4', verbose_name="Default AI Model")
    default_temperature = models.FloatField(default=0.7, verbose_name="Default Temperature")
    default_max_tokens = models.PositiveIntegerField(default=1000, verbose_name="Default Max Tokens")
    
    # Response Configuration
    response_delay = models.FloatField(default=0.5, verbose_name="Response Delay (seconds)")
    typing_indicator = models.BooleanField(default=True, verbose_name="Show Typing Indicator")
    max_conversation_length = models.PositiveIntegerField(default=50, verbose_name="Max Conversation Length")
    
    # Behavior Configuration
    auto_greet = models.BooleanField(default=True, verbose_name="Auto Greet Users")
    auto_farewell = models.BooleanField(default=True, verbose_name="Auto Farewell")
    context_window_size = models.PositiveIntegerField(default=10, verbose_name="Context Window Size")
    
    # Configuration Data
    config_data = models.JSONField(default=dict, verbose_name="Configuration Data")
    is_active = models.BooleanField(default=True, verbose_name="Active")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Updated At")
    
    # Meta
    class Meta:
        verbose_name = "Chatbot Configuration"
        verbose_name_plural = "Chatbot Configurations"
        db_table = 'chatbot_configurations'
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
        ]
    
    def __str__(self):
        return self.name
    
    def get_config_value(self, key, default=None):
        """Get a configuration value."""
        return self.config_data.get(key, default)
    
    def set_config_value(self, key, value):
        """Set a configuration value."""
        self.config_data[key] = value
        self.save(update_fields=['config_data'])
    
    @classmethod
    def get_active_config(cls):
        """Get the active configuration."""
        return cls.objects.filter(is_active=True).first()


class ConversationAnalytics(models.Model):
    """
    Model to store conversation analytics and metrics.
    
    This model tracks various metrics about conversations
    for reporting and optimization purposes.
    """
    
    conversation = models.OneToOneField(Conversation, on_delete=models.CASCADE, related_name='analytics')
    
    # Engagement Metrics
    total_duration = models.FloatField(default=0.0, verbose_name="Total Duration (seconds)")
    average_response_time = models.FloatField(default=0.0, verbose_name="Average Response Time (seconds)")
    user_engagement_score = models.FloatField(
        validators=[MinValueValidator(0.0), MaxValueValidator(1.0)],
        default=0.0,
        verbose_name="User Engagement Score"
    )
    
    # Quality Metrics
    conversation_satisfaction = models.FloatField(
        validators=[MinValueValidator(0.0), MaxValueValidator(5.0)],
        null=True,
        blank=True,
        verbose_name="Conversation Satisfaction"
    )
    resolution_rate = models.FloatField(
        validators=[MinValueValidator(0.0), MaxValueValidator(1.0)],
        default=0.0,
        verbose_name="Resolution Rate"
    )
    
    # Cost Metrics
    total_ai_cost = models.DecimalField(max_digits=10, decimal_places=6, default=0.0, verbose_name="Total AI Cost")
    total_tokens_used = models.PositiveIntegerField(default=0, verbose_name="Total Tokens Used")
    
    # Analytics Data
    analytics_data = models.JSONField(default=dict, verbose_name="Analytics Data")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Updated At")
    
    # Meta
    class Meta:
        verbose_name = "Conversation Analytics"
        verbose_name_plural = "Conversation Analytics"
        db_table = 'conversation_analytics'
    
    def __str__(self):
        return f"Analytics for {self.conversation.id}"
    
    def update_metrics(self):
        """Update analytics metrics based on conversation data."""
        messages = self.conversation.messages.all()
        
        # Calculate total duration
        if messages.count() > 1:
            first_message = messages.first()
            last_message = messages.last()
            self.total_duration = (last_message.created_at - first_message.created_at).total_seconds()
        
        # Calculate average response time
        response_times = []
        for i in range(1, messages.count()):
            current_msg = messages[i]
            previous_msg = messages[i-1]
            if current_msg.message_type != previous_msg.message_type:
                response_time = (current_msg.created_at - previous_msg.created_at).total_seconds()
                response_times.append(response_time)
        
        if response_times:
            self.average_response_time = sum(response_times) / len(response_times)
        
        # Calculate total AI cost and tokens
        ai_responses = AIResponse.objects.filter(message__conversation=self.conversation)
        self.total_ai_cost = sum(response.cost for response in ai_responses)
        self.total_tokens_used = sum(response.total_tokens for response in ai_responses)
        
        self.save()
    
    def get_analytics_value(self, key, default=None):
        """Get a value from the analytics data."""
        return self.analytics_data.get(key, default)
    
    def set_analytics_value(self, key, value):
        """Set a value in the analytics data."""
        self.analytics_data[key] = value
        self.save(update_fields=['analytics_data'])
