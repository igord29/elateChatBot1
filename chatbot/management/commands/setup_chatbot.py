"""
Django management command to setup the chatbot with initial data.

This command creates:
- Default chatbot configuration
- Initial conversation flows
- Sample data for testing
"""

from django.core.management.base import BaseCommand
from django.contrib.sites.models import Site
from django.conf import settings
from chatbot.models import ChatbotConfiguration, ConversationFlow
from users.models import CustomUser
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Setup chatbot with initial configuration and data'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force',
            action='store_true',
            help='Force recreation of existing data',
        )
        parser.add_argument(
            '--skip-flows',
            action='store_true',
            help='Skip creating conversation flows',
        )

    def handle(self, *args, **options):
        self.stdout.write(
            self.style.SUCCESS('Starting chatbot setup...')
        )

        # Setup site
        self.setup_site()

        # Setup chatbot configuration
        self.setup_chatbot_config(options['force'])

        # Setup conversation flows
        if not options['skip_flows']:
            self.setup_conversation_flows(options['force'])

        # Setup sample data
        self.setup_sample_data()

        self.stdout.write(
            self.style.SUCCESS('Chatbot setup completed successfully!')
        )

    def setup_site(self):
        """Setup default site configuration."""
        self.stdout.write('Setting up site configuration...')
        
        site, created = Site.objects.get_or_create(
            id=1,
            defaults={
                'domain': 'elate-moving.com',
                'name': 'Elate Moving'
            }
        )
        
        if created:
            self.stdout.write(
                self.style.SUCCESS(f'Site created: {site.name} ({site.domain})')
            )
        else:
            self.stdout.write(
                self.style.WARNING(f'Site already exists: {site.name}')
            )

    def setup_chatbot_config(self, force=False):
        """Setup default chatbot configuration."""
        self.stdout.write('Setting up chatbot configuration...')
        
        if force:
            ChatbotConfiguration.objects.filter(name='default').delete()
        
        config, created = ChatbotConfiguration.objects.get_or_create(
            name='default',
            defaults={
                'description': 'Default chatbot configuration for Elate Moving',
                'default_model': 'gpt-4',
                'default_temperature': 0.7,
                'default_max_tokens': 1000,
                'response_delay': 0.5,
                'typing_indicator': True,
                'max_conversation_length': 50,
                'auto_greet': True,
                'auto_farewell': True,
                'context_window_size': 10,
                'config_data': {
                    'company_name': 'Elate Moving',
                    'company_description': 'Professional moving services',
                    'support_email': 'support@elate-moving.com',
                    'support_phone': '+1-555-123-4567',
                    'business_hours': 'Monday-Friday 8AM-6PM',
                    'service_areas': ['Local', 'Long Distance', 'International'],
                }
            }
        )
        
        if created:
            self.stdout.write(
                self.style.SUCCESS('Default chatbot configuration created')
            )
        else:
            self.stdout.write(
                self.style.WARNING('Default chatbot configuration already exists')
            )

    def setup_conversation_flows(self, force=False):
        """Setup initial conversation flows."""
        self.stdout.write('Setting up conversation flows...')
        
        flows_data = [
            {
                'name': 'greeting',
                'description': 'Greeting flow for new users',
                'trigger_intents': ['greeting', 'hello', 'hi'],
                'trigger_keywords': ['hello', 'hi', 'hey', 'good morning', 'good afternoon'],
                'priority': 100,
                'flow_config': {
                    'steps': {
                        'greet': {
                            'type': 'message',
                            'content': 'Hello! Welcome to Elate Moving. I\'m here to help you with your moving needs. How can I assist you today?',
                            'next': 'wait_for_response'
                        }
                    }
                }
            },
            {
                'name': 'moving_quote',
                'description': 'Flow for getting moving quotes',
                'trigger_intents': ['get_quote', 'moving_quote', 'estimate'],
                'trigger_keywords': ['quote', 'estimate', 'price', 'cost', 'moving', 'move'],
                'priority': 90,
                'flow_config': {
                    'steps': {
                        'ask_location': {
                            'type': 'question',
                            'content': 'Great! I\'d be happy to help you get a moving quote. First, where are you moving from and to?',
                            'next': 'ask_date'
                        },
                        'ask_date': {
                            'type': 'question',
                            'content': 'When do you plan to move? (Please provide a date or timeframe)',
                            'next': 'ask_size'
                        },
                        'ask_size': {
                            'type': 'question',
                            'content': 'What size is your move? (e.g., 1-2 bedroom apartment, 3+ bedroom house, office, etc.)',
                            'next': 'ask_special_items'
                        },
                        'ask_special_items': {
                            'type': 'question',
                            'content': 'Do you have any special items that need special handling? (e.g., piano, artwork, antiques)',
                            'next': 'provide_quote'
                        },
                        'provide_quote': {
                            'type': 'message',
                            'content': 'Thank you for the information! I\'ll have one of our moving specialists contact you within 24 hours with a detailed quote. Is there anything else I can help you with?',
                            'next': 'end'
                        }
                    }
                }
            },
            {
                'name': 'services',
                'description': 'Flow for information about services',
                'trigger_intents': ['services', 'what_services', 'help'],
                'trigger_keywords': ['services', 'help', 'what do you do', 'packing', 'storage'],
                'priority': 80,
                'flow_config': {
                    'steps': {
                        'list_services': {
                            'type': 'message',
                            'content': 'We offer a comprehensive range of moving services:\n\n• Local and Long Distance Moving\n• Residential and Commercial Moving\n• Packing and Unpacking Services\n• Storage Solutions\n• Piano and Specialty Item Moving\n• International Moving\n\nWhich service are you interested in?',
                            'next': 'wait_for_response'
                        }
                    }
                }
            },
            {
                'name': 'contact',
                'description': 'Flow for contact information',
                'trigger_intents': ['contact', 'phone', 'email'],
                'trigger_keywords': ['contact', 'phone', 'email', 'call', 'speak to someone'],
                'priority': 70,
                'flow_config': {
                    'steps': {
                        'provide_contact': {
                            'type': 'message',
                            'content': 'You can reach us through:\n\n📞 Phone: +1-555-123-4567\n📧 Email: info@elate-moving.com\n🌐 Website: www.elate-moving.com\n\nOur office hours are Monday-Friday 8AM-6PM. Would you like me to connect you with a moving specialist?',
                            'next': 'wait_for_response'
                        }
                    }
                }
            },
            {
                'name': 'pricing',
                'description': 'Flow for pricing information',
                'trigger_intents': ['pricing', 'cost', 'rates'],
                'trigger_keywords': ['pricing', 'cost', 'rates', 'how much', 'price'],
                'priority': 60,
                'flow_config': {
                    'steps': {
                        'explain_pricing': {
                            'type': 'message',
                            'content': 'Our pricing is based on several factors:\n\n• Distance of the move\n• Size and weight of items\n• Special handling requirements\n• Packing services needed\n• Storage requirements\n\nFor an accurate quote, I\'d be happy to gather some details about your specific move. Would you like to get a quote?',
                            'next': 'wait_for_response'
                        }
                    }
                }
            }
        ]

        for flow_data in flows_data:
            if force:
                ConversationFlow.objects.filter(name=flow_data['name']).delete()
            
            flow, created = ConversationFlow.objects.get_or_create(
                name=flow_data['name'],
                defaults=flow_data
            )
            
            if created:
                self.stdout.write(
                    self.style.SUCCESS(f'Conversation flow created: {flow.name}')
                )
            else:
                self.stdout.write(
                    self.style.WARNING(f'Conversation flow already exists: {flow.name}')
                )

    def setup_sample_data(self):
        """Setup sample data for testing."""
        self.stdout.write('Setting up sample data...')
        
        # Create sample users if they don't exist
        sample_users = [
            {
                'email': 'test@example.com',
                'first_name': 'John',
                'last_name': 'Doe',
                'phone_number': '+1234567890',
                'preferred_moving_type': 'residential'
            },
            {
                'email': 'demo@example.com',
                'first_name': 'Jane',
                'last_name': 'Smith',
                'phone_number': '+1987654321',
                'preferred_moving_type': 'commercial'
            }
        ]
        
        for user_data in sample_users:
            user, created = CustomUser.objects.get_or_create(
                email=user_data['email'],
                defaults=user_data
            )
            
            if created:
                self.stdout.write(
                    self.style.SUCCESS(f'Sample user created: {user.email}')
                )
            else:
                self.stdout.write(
                    self.style.WARNING(f'Sample user already exists: {user.email}')
                )
