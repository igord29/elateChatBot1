/**
 * WebSocket Server with CRM Webhook Integration
 * This is an enhanced version of your websocket-server.js with CRM webhook support
 */

require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const OpenAI = require('openai');
const CRMWebhookHandler = require('./crm-webhook-handler');

class MovingWebSocketServer {
    constructor() {
        this.port = process.env.WEBSOCKET_PORT || 3001;
        this.server = null;
        this.wss = null;
        this.activeConnections = new Map();
        this.adminConnections = new Map();
        this.conversationHistory = new Map();
        this.connectionCounter = 0;
        
        // Initialize services
        this.initializeOpenAI();
        this.initializeCRMWebhook();
        this.initializeConversationFlows();
        
        console.log('🗣️ Moving Conversation Flows initialized');
    }

    initializeOpenAI() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            this.openai = null;
            console.warn('⚠️ OPENAI_API_KEY not set. Running in AI-disabled mode.');
            return;
        }
        this.openai = new OpenAI({ apiKey });
    }

    initializeCRMWebhook() {
        this.crmWebhook = new CRMWebhookHandler();
        console.log(`🔗 CRM Webhook: ${this.crmWebhook.enabled ? 'Enabled' : 'Disabled'}`);
    }

    initializeConversationFlows() {
        // Your existing conversation flows initialization
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
    }

    async start() {
        this.server = http.createServer();
        this.wss = new WebSocket.Server({ server: this.server });

        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });

        this.server.listen(this.port, () => {
            console.log(`🚀 WebSocket server starting on port ${this.port}...`);
            console.log(`✅ WebSocket server running on port ${this.port}`);
            console.log(`📊 Active connections: ${this.activeConnections.size}`);
            console.log(`👨‍💼 Admin connections: ${this.adminConnections.size}`);
        });
    }

    handleConnection(ws, req) {
        const connectionId = this.generateConnectionId();
        const ip = req.socket.remoteAddress;
        const conversationId = this.generateConversationId();

        const connection = {
            id: connectionId,
            ws,
            ip,
            conversationId,
            isAdmin: false,
            connectedAt: new Date(),
            lastActivity: new Date()
        };

        this.activeConnections.set(connectionId, connection);
        this.conversationHistory.set(conversationId, []);

        console.log(`🔌 New WebSocket connection: ${connectionId} from ${ip}`);

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                this.handleMessage(connectionId, message);
            } catch (error) {
                console.error('❌ Error parsing message:', error);
                this.sendError(connectionId, 'Invalid message format');
            }
        });

        ws.on('close', () => {
            this.handleDisconnection(connectionId);
        });

        ws.on('error', (error) => {
            console.error(`❌ WebSocket error for ${connectionId}:`, error);
            this.handleDisconnection(connectionId);
        });

        // Send welcome message
        this.sendMessage(connectionId, {
            type: 'welcome',
            message: 'Connected to Elate Moving Chatbot',
            connectionId,
            conversationId
        });
    }

    handleDisconnection(connectionId) {
        const connection = this.activeConnections.get(connectionId);
        if (connection) {
            if (connection.isAdmin) {
                this.adminConnections.delete(connectionId);
            }
            this.activeConnections.delete(connectionId);
            console.log(`🔌 User disconnected: ${connectionId}`);
        }
    }

    async handleMessage(connectionId, message) {
        const connection = this.activeConnections.get(connectionId);
        if (!connection) {
            console.error(`❌ Connection not found: ${connectionId}`);
            return;
        }

        connection.lastActivity = new Date();

        switch (message.type) {
            case 'user_message':
                await this.handleUserMessage(connectionId, message);
                break;
            case 'admin_message':
                this.handleAdminMessage(connectionId, message);
                break;
            case 'lead_submission':
                await this.handleLeadSubmission(connectionId, message);
                break;
            case 'admin_join':
                this.handleAdminJoin(connectionId, message);
                break;
            case 'admin_leave':
                this.handleAdminLeave(connectionId, message);
                break;
            default:
                console.warn(`⚠️ Unknown message type: ${message.type}`);
        }
    }

    async handleUserMessage(connectionId, message) {
        const connection = this.activeConnections.get(connectionId);
        
        // Store user message in conversation history
        this.addToConversationHistory(connection.conversationId, {
            type: 'user',
            content: message.content,
            timestamp: new Date().toISOString()
        });

        // Send typing indicator
        this.sendMessage(connectionId, {
            type: 'typing',
            message: 'Dave is typing...'
        });

        try {
            let content = '';
            const apiKeyAvailable = !!process.env.OPENAI_API_KEY;
            const assistantsEnabled = apiKeyAvailable && String(process.env.OPENAI_ASSISTANTS_ENABLED || '').toLowerCase() === 'true';
            const assistantId = process.env.OPENAI_ASSISTANT_ID;

            if (assistantsEnabled && assistantId) {
                // Use OpenAI Assistants (Responses API)
                const response = await this.openai.responses.create({
                    assistant_id: assistantId,
                    input: message.content
                });
                content = response.content[0].text.value;
            } else if (this.openai) {
                // Use OpenAI Chat Completions API
                const response = await this.openai.chat.completions.create({
                    model: process.env.OPENAI_MODEL || 'gpt-4',
                    messages: [
                        {
                            role: 'system',
                            content: `You are Dave, a professional moving consultant for Elate Moving. 
                            Help customers with their moving needs, ask qualifying questions, and provide helpful advice.
                            When you have enough information, guide them to provide contact details for a quote.`
                        },
                        {
                            role: 'user',
                            content: message.content
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 150
                });
                content = response.choices[0].message.content;
            } else {
                content = "I'm sorry, I'm having trouble connecting to our AI service. Please try again later or contact us directly.";
            }

            // Store bot response in conversation history
            this.addToConversationHistory(connection.conversationId, {
                type: 'bot',
                content: content,
                timestamp: new Date().toISOString()
            });

            // Send response to user
            this.sendMessage(connectionId, {
                type: 'bot_message',
                content: content,
                timestamp: new Date().toISOString()
            });

            // Broadcast to admins
            this.broadcastToAdmins({
                type: 'user_message',
                connectionId,
                content: message.content,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error processing message:', error);
            this.sendMessage(connectionId, {
                type: 'error',
                message: 'Sorry, I encountered an error. Please try again.'
            });
        }
    }

    async handleLeadSubmission(connectionId, message) {
        const connection = this.activeConnections.get(connectionId);
        
        // Store lead data
        const leadData = {
            ...message.data,
            connectionId,
            conversationId: connection.conversationId,
            ip: connection.ip,
            submittedAt: new Date().toISOString(),
            conversationHistory: this.conversationHistory.get(connection.conversationId) || []
        };

        try {
            // Submit to CRM via webhook
            const webhookResult = await this.crmWebhook.submitLead(leadData);
            
            if (webhookResult.success) {
                console.log(`✅ Lead submitted to CRM successfully: ${webhookResult.leadId}`);
                
                // Broadcast to all admins
                this.broadcastToAdmins({
                    type: 'new_lead',
                    leadData: {
                        ...leadData,
                        leadId: webhookResult.leadId,
                        webhookSuccess: true
                    },
                    timestamp: new Date().toISOString()
                });

                // Send confirmation to user
                this.sendMessage(connectionId, {
                    type: 'lead_submitted',
                    message: 'Thank you! Our team will contact you within 24 hours.',
                    leadId: webhookResult.leadId,
                    timestamp: new Date().toISOString()
                });

            } else {
                console.error(`❌ Failed to submit lead to CRM: ${webhookResult.error}`);
                
                // Still broadcast to admins but mark as webhook failed
                this.broadcastToAdmins({
                    type: 'new_lead',
                    leadData: {
                        ...leadData,
                        webhookSuccess: false,
                        webhookError: webhookResult.error
                    },
                    timestamp: new Date().toISOString()
                });

                // Send confirmation to user (they don't need to know about webhook failure)
                this.sendMessage(connectionId, {
                    type: 'lead_submitted',
                    message: 'Thank you! Our team will contact you within 24 hours.',
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error('❌ Error handling lead submission:', error);
            
            // Send error response to user
            this.sendMessage(connectionId, {
                type: 'error',
                message: 'Sorry, there was an error submitting your information. Please try again or contact us directly.'
            });
        }

        console.log(`📝 New lead submitted from ${connectionId}: ${message.data.firstName} ${message.data.lastName}`);
    }

    // ... (Include all your existing methods like handleAdminMessage, broadcastToAdmins, etc.)

    sendMessage(connectionId, message) {
        const connection = this.activeConnections.get(connectionId);
        if (connection && connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.send(JSON.stringify(message));
        }
    }

    sendError(connectionId, errorMessage) {
        this.sendMessage(connectionId, {
            type: 'error',
            message: errorMessage,
            timestamp: new Date().toISOString()
        });
    }

    addToConversationHistory(conversationId, message) {
        if (!this.conversationHistory.has(conversationId)) {
            this.conversationHistory.set(conversationId, []);
        }
        this.conversationHistory.get(conversationId).push(message);
    }

    generateConnectionId() {
        return `${++this.connectionCounter}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    generateConversationId() {
        return `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Test CRM webhook connectivity
    async testCRMWebhook() {
        const result = await this.crmWebhook.testConnection();
        console.log('🔗 CRM Webhook Test Result:', result);
        return result;
    }
}

// Start the server
const server = new MovingWebSocketServer();
server.start().catch(console.error);

module.exports = MovingWebSocketServer;
