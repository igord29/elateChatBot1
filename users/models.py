"""
Custom User model for Elate Moving Chatbot.

This model extends Django's AbstractUser to provide additional fields
specific to the moving company chatbot application.
"""

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.core.validators import RegexValidator
from django.utils import timezone
import uuid


class CustomUser(AbstractUser):
    """
    Custom User model with additional fields for moving company chatbot.
    
    Extends Django's AbstractUser to include:
    - Phone number validation
    - Address information
    - Moving preferences
    - Account verification status
    - Last activity tracking
    """
    
    # Remove username field since we're using email
    username = None
    
    # Basic Information
    email = models.EmailField(unique=True, verbose_name="Email Address")
    phone_regex = RegexValidator(
        regex=r'^\+?1?\d{9,15}$',
        message="Phone number must be entered in the format: '+999999999'. Up to 15 digits allowed."
    )
    phone_number = models.CharField(validators=[phone_regex], max_length=17, blank=True, verbose_name="Phone Number")
    
    # Address Information
    address_line_1 = models.CharField(max_length=255, blank=True, verbose_name="Address Line 1")
    address_line_2 = models.CharField(max_length=255, blank=True, verbose_name="Address Line 2")
    city = models.CharField(max_length=100, blank=True, verbose_name="City")
    state = models.CharField(max_length=100, blank=True, verbose_name="State/Province")
    postal_code = models.CharField(max_length=20, blank=True, verbose_name="Postal Code")
    country = models.CharField(max_length=100, default="United States", verbose_name="Country")
    
    # Moving Preferences
    MOVING_TYPE_CHOICES = [
        ('residential', 'Residential'),
        ('commercial', 'Commercial'),
        ('long_distance', 'Long Distance'),
        ('local', 'Local'),
        ('international', 'International'),
    ]
    
    preferred_moving_type = models.CharField(
        max_length=20,
        choices=MOVING_TYPE_CHOICES,
        blank=True,
        verbose_name="Preferred Moving Type"
    )
    
    # Account Status
    is_verified = models.BooleanField(default=False, verbose_name="Email Verified")
    is_active = models.BooleanField(default=True, verbose_name="Active")
    date_joined = models.DateTimeField(default=timezone.now, verbose_name="Date Joined")
    last_login = models.DateTimeField(auto_now=True, verbose_name="Last Login")
    last_activity = models.DateTimeField(auto_now=True, verbose_name="Last Activity")
    
    # Security
    email_verification_token = models.UUIDField(default=uuid.uuid4, editable=False)
    password_reset_token = models.UUIDField(null=True, blank=True, editable=False)
    password_reset_expires = models.DateTimeField(null=True, blank=True)
    
    # Preferences
    notification_preferences = models.JSONField(default=dict, verbose_name="Notification Preferences")
    privacy_settings = models.JSONField(default=dict, verbose_name="Privacy Settings")
    
    # Meta
    class Meta:
        verbose_name = "User"
        verbose_name_plural = "Users"
        db_table = 'users'
        indexes = [
            models.Index(fields=['email']),
            models.Index(fields=['phone_number']),
            models.Index(fields=['date_joined']),
            models.Index(fields=['last_activity']),
        ]
    
    def __str__(self):
        return self.email
    
    def get_full_name(self):
        """Return the full name of the user."""
        return f"{self.first_name} {self.last_name}".strip()
    
    def get_short_name(self):
        """Return the short name of the user."""
        return self.first_name
    
    def get_address(self):
        """Return the complete address as a string."""
        address_parts = []
        if self.address_line_1:
            address_parts.append(self.address_line_1)
        if self.address_line_2:
            address_parts.append(self.address_line_2)
        if self.city:
            address_parts.append(self.city)
        if self.state:
            address_parts.append(self.state)
        if self.postal_code:
            address_parts.append(self.postal_code)
        if self.country:
            address_parts.append(self.country)
        
        return ", ".join(address_parts)
    
    def update_last_activity(self):
        """Update the last activity timestamp."""
        self.last_activity = timezone.now()
        self.save(update_fields=['last_activity'])
    
    def generate_verification_token(self):
        """Generate a new email verification token."""
        self.email_verification_token = uuid.uuid4()
        self.save(update_fields=['email_verification_token'])
        return self.email_verification_token
    
    def generate_password_reset_token(self):
        """Generate a new password reset token."""
        self.password_reset_token = uuid.uuid4()
        self.password_reset_expires = timezone.now() + timezone.timedelta(hours=24)
        self.save(update_fields=['password_reset_token', 'password_reset_expires'])
        return self.password_reset_token
    
    def is_password_reset_token_valid(self):
        """Check if the password reset token is still valid."""
        if not self.password_reset_token or not self.password_reset_expires:
            return False
        return timezone.now() < self.password_reset_expires
    
    def clear_password_reset_token(self):
        """Clear the password reset token."""
        self.password_reset_token = None
        self.password_reset_expires = None
        self.save(update_fields=['password_reset_token', 'password_reset_expires'])


class UserProfile(models.Model):
    """
    Extended user profile with additional information.
    
    This model stores additional user information that might not be
    needed for authentication but is useful for the application.
    """
    
    user = models.OneToOneField(CustomUser, on_delete=models.CASCADE, related_name='profile')
    
    # Additional Personal Information
    date_of_birth = models.DateField(null=True, blank=True, verbose_name="Date of Birth")
    gender = models.CharField(max_length=10, blank=True, verbose_name="Gender")
    
    # Moving History
    previous_moves_count = models.PositiveIntegerField(default=0, verbose_name="Previous Moves Count")
    last_move_date = models.DateField(null=True, blank=True, verbose_name="Last Move Date")
    
    # Preferences
    preferred_contact_method = models.CharField(
        max_length=20,
        choices=[
            ('email', 'Email'),
            ('phone', 'Phone'),
            ('sms', 'SMS'),
        ],
        default='email',
        verbose_name="Preferred Contact Method"
    )
    
    # Marketing Preferences
    marketing_emails = models.BooleanField(default=True, verbose_name="Marketing Emails")
    sms_notifications = models.BooleanField(default=False, verbose_name="SMS Notifications")
    push_notifications = models.BooleanField(default=True, verbose_name="Push Notifications")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Updated At")
    
    class Meta:
        verbose_name = "User Profile"
        verbose_name_plural = "User Profiles"
        db_table = 'user_profiles'
    
    def __str__(self):
        return f"Profile for {self.user.email}"
    
    def get_age(self):
        """Calculate and return the user's age."""
        if self.date_of_birth:
            today = timezone.now().date()
            return today.year - self.date_of_birth.year - (
                (today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day)
            )
        return None


class UserSession(models.Model):
    """
    Track user sessions for analytics and security.
    
    This model stores information about user sessions including:
    - Session start and end times
    - IP address and user agent
    - Device information
    - Session activity
    """
    
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='sessions')
    session_key = models.CharField(max_length=40, unique=True, verbose_name="Session Key")
    
    # Session Information
    ip_address = models.GenericIPAddressField(verbose_name="IP Address")
    user_agent = models.TextField(verbose_name="User Agent")
    device_type = models.CharField(max_length=20, blank=True, verbose_name="Device Type")
    browser = models.CharField(max_length=50, blank=True, verbose_name="Browser")
    operating_system = models.CharField(max_length=50, blank=True, verbose_name="Operating System")
    
    # Timestamps
    started_at = models.DateTimeField(auto_now_add=True, verbose_name="Started At")
    last_activity = models.DateTimeField(auto_now=True, verbose_name="Last Activity")
    ended_at = models.DateTimeField(null=True, blank=True, verbose_name="Ended At")
    
    # Session Data
    is_active = models.BooleanField(default=True, verbose_name="Active")
    page_views = models.PositiveIntegerField(default=0, verbose_name="Page Views")
    chat_interactions = models.PositiveIntegerField(default=0, verbose_name="Chat Interactions")
    
    class Meta:
        verbose_name = "User Session"
        verbose_name_plural = "User Sessions"
        db_table = 'user_sessions'
        indexes = [
            models.Index(fields=['user', 'started_at']),
            models.Index(fields=['ip_address']),
            models.Index(fields=['is_active']),
        ]
    
    def __str__(self):
        return f"Session {self.session_key} for {self.user.email}"
    
    def end_session(self):
        """End the session."""
        self.is_active = False
        self.ended_at = timezone.now()
        self.save(update_fields=['is_active', 'ended_at'])
    
    def get_duration(self):
        """Get the session duration in seconds."""
        end_time = self.ended_at or timezone.now()
        return (end_time - self.started_at).total_seconds()
    
    def update_activity(self):
        """Update the last activity timestamp."""
        self.last_activity = timezone.now()
        self.save(update_fields=['last_activity'])
