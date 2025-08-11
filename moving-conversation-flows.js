const OpenAI = require('openai');

class MovingConversationFlow {
    constructor() {
        this.openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

        this.flows = {
            'quote-request': this.handleQuoteRequest.bind(this),
            'appointment-booking': this.handleAppointmentBooking.bind(this),
            'service-inquiry': this.handleServiceInquiry.bind(this),
            'pricing-question': this.handlePricingQuestion.bind(this),
            'emergency-move': this.handleEmergencyMove.bind(this),
            'specialty-items': this.handleSpecialtyItems.bind(this),
            'packing-services': this.handlePackingServices.bind(this),
            'storage-inquiry': this.handleStorageInquiry.bind(this),
            'insurance-question': this.handleInsuranceQuestion.bind(this),
            'timeline-planning': this.handleTimelinePlanning.bind(this)
        };

        this.context = new Map();
        this.serviceTypes = {
            'full-service': {
                name: 'Full Service Moving',
                description: 'We handle everything from packing to unpacking',
                baseRate: 2.5,
                features: ['packing', 'loading', 'transportation', 'unloading', 'unpacking']
            },
            'pack-and-move': {
                name: 'Pack and Move',
                description: 'We pack your items and handle the move',
                baseRate: 2.0,
                features: ['packing', 'loading', 'transportation', 'unloading']
            },
            'labor-and-truck': {
                name: 'Labor and Truck',
                description: 'We provide labor and transportation, you pack',
                baseRate: 1.5,
                features: ['loading', 'transportation', 'unloading']
            },
            'labor-only': {
                name: 'Labor Only',
                description: 'We provide loading and unloading labor',
                baseRate: 0.5,
                features: ['loading', 'unloading']
            },
            'specialty': {
                name: 'Specialty Items',
                description: 'Moving pianos, artwork, antiques, etc.',
                baseRate: 3.0,
                features: ['specialty-handling', 'custom-crating', 'white-glove-service']
            }
        };

        console.log('🗣️ Moving Conversation Flows initialized');
    }

    // Main Flow Handler
    async handleConversation(message, userId, conversationId) {
        try {
            // Detect conversation intent
            const intent = await this.detectIntent(message);
            
            // Get or create conversation context
            let context = this.context.get(conversationId) || this.initializeContext(conversationId, userId);
            
            // Update context with new message
            context.messages.push({
                role: 'user',
                content: message,
                timestamp: new Date()
            });

            // Route to appropriate flow
            const response = await this.routeToFlow(intent, context, message);
            
            // Update context with response
            context.messages.push({
                role: 'assistant',
                content: response.content,
                timestamp: new Date()
            });

            // Store updated context
            this.context.set(conversationId, context);

            return response;
        } catch (error) {
            console.error('❌ Error handling conversation:', error);
            return { content: "Let's get you a quote. What type of move are you planning?", type: 'error', context: 'general' };
        }
    }

    // Intent Detection
    async detectIntent(message) {
        if (!this.openai) {
            // simple heuristic fallback
            const m = message.toLowerCase();
            if (m.includes('quote') || m.includes('estimate')) return 'quote-request';
            if (m.includes('book') || m.includes('schedule')) return 'appointment-booking';
            if (m.includes('price') || m.includes('cost')) return 'pricing-question';
            return 'service-inquiry';
        }
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'Classify the user intent to one of the known categories. Respond with only the category key.' },
                    { role: 'user', content: message }
                ],
                temperature: 0.1,
                max_tokens: 10
            });
            return response.choices[0].message.content.trim();
        } catch (error) {
            console.error('❌ Error detecting intent:', error);
            return 'quote-request'; // Default fallback
        }
    }

    // Flow Routing
    async routeToFlow(intent, context, message) {
        const flowHandler = this.flows[intent];
        
        if (flowHandler) {
            return await flowHandler(context, message);
        } else {
            return await this.handleGeneralInquiry(context, message);
        }
    }

    // Quote Request Flow
    async handleQuoteRequest(context, message) {
        const flow = [
            {
                question: 'What type of move are you planning?',
                options: Object.keys(this.serviceTypes).map(key => ({
                    value: key,
                    label: this.serviceTypes[key].name
                })),
                field: 'serviceType'
            },
            {
                question: 'What\'s your timeline for the move?',
                options: [
                    { value: 'immediate', label: 'Immediate (within 1 week)' },
                    { value: 'urgent', label: 'Urgent (1-2 weeks)' },
                    { value: 'planned', label: 'Planned (2-4 weeks)' },
                    { value: 'flexible', label: 'Flexible (1-3 months)' }
                ],
                field: 'timeline'
            },
            {
                question: 'Do you need packing services?',
                options: [
                    { value: 'full-packing', label: 'Full packing service' },
                    { value: 'partial-packing', label: 'Partial packing (fragile items)' },
                    { value: 'no-packing', label: 'No packing needed' }
                ],
                field: 'packingNeeds'
            },
            {
                question: 'Any special items? (piano, artwork, antiques, etc.)',
                options: [
                    { value: 'none', label: 'No special items' },
                    { value: 'piano', label: 'Piano' },
                    { value: 'artwork', label: 'Artwork/Collectibles' },
                    { value: 'antiques', label: 'Antiques' },
                    { value: 'multiple', label: 'Multiple special items' }
                ],
                field: 'specialItems'
            },
            {
                question: 'What\'s your budget range?',
                options: [
                    { value: 'budget', label: 'Budget-friendly' },
                    { value: 'standard', label: 'Standard service' },
                    { value: 'premium', label: 'Premium service' }
                ],
                field: 'budget'
            }
        ];

        return await this.executeFlow(flow, context, message);
    }

    // Appointment Booking Flow
    async handleAppointmentBooking(context, message) {
        const flow = [
            {
                question: 'What type of appointment do you need?',
                options: [
                    { value: 'estimate', label: 'Free estimate' },
                    { value: 'consultation', label: 'Moving consultation' },
                    { value: 'packing-demo', label: 'Packing demonstration' },
                    { value: 'storage-tour', label: 'Storage facility tour' }
                ],
                field: 'appointmentType'
            },
            {
                question: 'When would you like to schedule?',
                options: [
                    { value: 'today', label: 'Today' },
                    { value: 'tomorrow', label: 'Tomorrow' },
                    { value: 'this-week', label: 'This week' },
                    { value: 'next-week', label: 'Next week' },
                    { value: 'flexible', label: 'I\'m flexible' }
                ],
                field: 'preferredTime'
            },
            {
                question: 'What\'s your preferred contact method?',
                options: [
                    { value: 'phone', label: 'Phone call' },
                    { value: 'email', label: 'Email' },
                    { value: 'text', label: 'Text message' }
                ],
                field: 'contactMethod'
            }
        ];

        return await this.executeFlow(flow, context, message);
    }

    // Emergency Move Flow
    async handleEmergencyMove(context, message) {
        context.priority = 'high';
        context.urgent = true;

        const emergencyFlow = [
            {
                question: 'I understand this is urgent. When do you need to move?',
                options: [
                    { value: 'immediate', label: 'Immediate (today/tomorrow)' },
                    { value: 'this-week', label: 'This week' },
                    { value: 'next-week', label: 'Next week' }
                ],
                field: 'urgency'
            },
            {
                question: 'What\'s the reason for the emergency move?',
                options: [
                    { value: 'eviction', label: 'Eviction' },
                    { value: 'job-relocation', label: 'Job relocation' },
                    { value: 'family-emergency', label: 'Family emergency' },
                    { value: 'lease-ending', label: 'Lease ending' },
                    { value: 'other', label: 'Other' }
                ],
                field: 'emergencyReason'
            },
            {
                question: 'I\'ll connect you with our emergency team immediately. What\'s your phone number?',
                field: 'phoneNumber',
                type: 'input'
            }
        ];

        return await this.executeFlow(emergencyFlow, context, message);
    }

    // Specialty Items Flow
    async handleSpecialtyItems(context, message) {
        const flow = [
            {
                question: 'What type of specialty items do you have?',
                options: [
                    { value: 'piano', label: 'Piano' },
                    { value: 'artwork', label: 'Artwork/Paintings' },
                    { value: 'antiques', label: 'Antiques' },
                    { value: 'collectibles', label: 'Collectibles' },
                    { value: 'musical-instruments', label: 'Musical instruments' },
                    { value: 'multiple', label: 'Multiple types' }
                ],
                field: 'specialtyType'
            },
            {
                question: 'What\'s the approximate value of these items?',
                options: [
                    { value: 'under-5k', label: 'Under $5,000' },
                    { value: '5k-25k', label: '$5,000 - $25,000' },
                    { value: '25k-100k', label: '$25,000 - $100,000' },
                    { value: 'over-100k', label: 'Over $100,000' }
                ],
                field: 'itemValue'
            },
            {
                question: 'Do you have insurance for these items?',
                options: [
                    { value: 'yes', label: 'Yes, I have insurance' },
                    { value: 'no', label: 'No, I need insurance' },
                    { value: 'unsure', label: 'I\'m not sure' }
                ],
                field: 'insurance'
            }
        ];

        return await this.executeFlow(flow, context, message);
    }

    // Flow Execution Engine
    async executeFlow(flow, context, message) {
        const currentStep = context.currentStep || 0;
        
        if (currentStep >= flow.length) {
            // Flow completed, generate summary
            return await this.generateFlowSummary(context, flow);
        }

        const step = flow[currentStep];
        
        // Check if user provided an answer
        if (context.currentStep !== undefined) {
            const answer = await this.extractAnswer(message, step);
            if (answer) {
                context.data[step.field] = answer;
                context.currentStep = currentStep + 1;
                
                if (context.currentStep >= flow.length) {
                    return await this.generateFlowSummary(context, flow);
                }
            }
        }

        // Present next question
        const nextStep = flow[context.currentStep || 0];
        return {
            content: this.formatQuestion(nextStep),
            type: 'question',
            context: 'flow',
            step: context.currentStep || 0,
            options: nextStep.options
        };
    }

    // Answer Extraction
    async extractAnswer(message, step) {
        if (step.type === 'input') {
            return message.trim();
        }

        if (step.options) {
            // Try to match user input to options
            const userInput = message.toLowerCase();
            
            for (const option of step.options) {
                if (userInput.includes(option.value.toLowerCase()) || 
                    userInput.includes(option.label.toLowerCase())) {
                    return option.value;
                }
            }
        }

        return null;
    }

    // Question Formatting
    formatQuestion(step) {
        let question = step.question;
        
        if (step.options) {
            question += '\n\nPlease choose one:';
            step.options.forEach((option, index) => {
                question += `\n${index + 1}. ${option.label}`;
            });
        }

        return question;
    }

    // Flow Summary Generation
    async generateFlowSummary(context, flow) {
        const summary = {
            content: 'Thank you for providing that information! Here\'s a summary of your request:\n\n',
            type: 'summary',
            context: 'flow',
            data: context.data
        };

        // Build summary based on collected data
        for (const step of flow) {
            if (context.data[step.field]) {
                const option = step.options?.find(opt => opt.value === context.data[step.field]);
                summary.content += `• ${step.question.replace('?', '')}: ${option?.label || context.data[step.field]}\n`;
            }
        }

        summary.content += '\nI\'ll connect you with our team to provide a personalized quote and schedule your move.';

        return summary;
    }

    // Context Management
    initializeContext(conversationId, userId) {
        return {
            conversationId,
            userId,
            messages: [],
            data: {},
            currentStep: 0,
            priority: 'normal',
            urgent: false,
            createdAt: new Date(),
            lastActivity: new Date()
        };
    }

    // General Inquiry Handler
    async handleGeneralInquiry(context, message) {
        if (!this.openai) {
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'general'
            };
        }
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: `You are Dave, a friendly and knowledgeable moving specialist at Elate Moving. 
                    You help customers with moving-related questions and guide them through the process.
                    Be helpful, professional, and always offer to provide a quote or schedule an appointment.
                    Keep responses concise and conversational.`
                    },
                    ...context.messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    {
                        role: 'user',
                        content: message
                    }
                ],
                temperature: 0.7,
                max_tokens: 150
            });

            return {
                content: response.choices[0].message.content,
                type: 'general',
                context: 'conversation'
            };
        } catch (error) {
            console.error('❌ Error handling general inquiry:', error);
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'general'
            };
        }
    }

    // Service Inquiry Handler
    async handleServiceInquiry(context, message) {
        const services = Object.entries(this.serviceTypes).map(([key, service]) => 
            `• **${service.name}**: ${service.description}`
        ).join('\n');

        return {
            content: `Here are our moving services:\n\n${services}\n\nWhich service interests you most? I can provide more details or help you get a quote.`,
            type: 'service-info',
            context: 'services'
        };
    }

    // Pricing Question Handler
    async handlePricingQuestion(context, message) {
        if (!this.openai) {
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'pricing'
            };
        }
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: `You are Dave, a friendly and knowledgeable moving specialist at Elate Moving. 
                    You help customers with moving-related questions and guide them through the process.
                    Be helpful, professional, and always offer to provide a quote or schedule an appointment.
                    Keep responses concise and conversational.`
                    },
                    ...context.messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    {
                        role: 'user',
                        content: message
                    }
                ],
                temperature: 0.7,
                max_tokens: 150
            });

            return {
                content: response.choices[0].message.content,
                type: 'pricing-info',
                context: 'pricing'
            };
        } catch (error) {
            console.error('❌ Error handling pricing question:', error);
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'pricing'
            };
        }
    }

    // Packing Services Handler
    async handlePackingServices(context, message) {
        if (!this.openai) {
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'packing'
            };
        }
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: `You are Dave, a friendly and knowledgeable moving specialist at Elate Moving. 
                    You help customers with moving-related questions and guide them through the process.
                    Be helpful, professional, and always offer to provide a quote or schedule an appointment.
                    Keep responses concise and conversational.`
                    },
                    ...context.messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    {
                        role: 'user',
                        content: message
                    }
                ],
                temperature: 0.7,
                max_tokens: 150
            });

            return {
                content: response.choices[0].message.content,
                type: 'packing-info',
                context: 'packing'
            };
        } catch (error) {
            console.error('❌ Error handling packing services:', error);
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'packing'
            };
        }
    }

    // Storage Inquiry Handler
    async handleStorageInquiry(context, message) {
        if (!this.openai) {
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'storage'
            };
        }
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: `You are Dave, a friendly and knowledgeable moving specialist at Elate Moving. 
                    You help customers with moving-related questions and guide them through the process.
                    Be helpful, professional, and always offer to provide a quote or schedule an appointment.
                    Keep responses concise and conversational.`
                    },
                    ...context.messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    {
                        role: 'user',
                        content: message
                    }
                ],
                temperature: 0.7,
                max_tokens: 150
            });

            return {
                content: response.choices[0].message.content,
                type: 'storage-info',
                context: 'storage'
            };
        } catch (error) {
            console.error('❌ Error handling storage inquiry:', error);
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'storage'
            };
        }
    }

    // Insurance Question Handler
    async handleInsuranceQuestion(context, message) {
        if (!this.openai) {
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'insurance'
            };
        }
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: `You are Dave, a friendly and knowledgeable moving specialist at Elate Moving. 
                    You help customers with moving-related questions and guide them through the process.
                    Be helpful, professional, and always offer to provide a quote or schedule an appointment.
                    Keep responses concise and conversational.`
                    },
                    ...context.messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    {
                        role: 'user',
                        content: message
                    }
                ],
                temperature: 0.7,
                max_tokens: 150
            });

            return {
                content: response.choices[0].message.content,
                type: 'insurance-info',
                context: 'insurance'
            };
        } catch (error) {
            console.error('❌ Error handling insurance question:', error);
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'insurance'
            };
        }
    }

    // Timeline Planning Handler
    async handleTimelinePlanning(context, message) {
        if (!this.openai) {
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'timeline'
            };
        }
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: `You are Dave, a friendly and knowledgeable moving specialist at Elate Moving. 
                    You help customers with moving-related questions and guide them through the process.
                    Be helpful, professional, and always offer to provide a quote or schedule an appointment.
                    Keep responses concise and conversational.`
                    },
                    ...context.messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    {
                        role: 'user',
                        content: message
                    }
                ],
                temperature: 0.7,
                max_tokens: 150
            });

            return {
                content: response.choices[0].message.content,
                type: 'timeline-info',
                context: 'timeline'
            };
        } catch (error) {
            console.error('❌ Error handling timeline planning:', error);
            return {
                content: "I'm currently unable to provide a quote or schedule an appointment as my AI capabilities are offline. Please contact our support team directly.",
                type: 'error',
                context: 'timeline'
            };
        }
    }

    // Context Cleanup
    cleanupContext(conversationId) {
        this.context.delete(conversationId);
    }

    // Get Active Flows
    getActiveFlows() {
        const activeFlows = [];
        for (const [conversationId, context] of this.context.entries()) {
            if (context.currentStep !== undefined) {
                activeFlows.push({
                    conversationId,
                    userId: context.userId,
                    currentStep: context.currentStep,
                    data: context.data,
                    lastActivity: context.lastActivity
                });
            }
        }
        return activeFlows;
    }
}

module.exports = MovingConversationFlow; 