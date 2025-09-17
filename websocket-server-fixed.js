/**
 * Enhanced WebSocket Server with OpenAI Assistant Integration
 * Handles proper Assistant runs with tool calls and CRM webhook integration
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const MovingConversationFlows = require('./moving-conversation-flows');
const { postLeadToCRM, notifyLead } = require('./crm-webhook-handler');

class EnhancedWebSocketServer {
    constructor(port = 3001) {
        this.port = port;
        this.wss = null;
        this.connections = new Map();
        this.adminConnections = new Set();
        this.flow = new MovingConversationFlows();
        
        // Initialize OpenAI client
        this.openai = null;
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            console.log('✅ OpenAI client initialized');
        } else {
            console.warn('⚠️ OPENAI_API_KEY not set. Running in AI-disabled mode.');
        }
    }

    start() {
        this.wss = new WebSocket.Server({ port: this.port });
        
        this.wss.on('connection', (ws, req) => {
            const connectionId = uuidv4();
            const clientIP = req.socket.remoteAddress;
            
            console.log(`🔌 New WebSocket connection: ${connectionId} from ${clientIP}`);
            
            // Store connection info
            this.connections.set(connectionId, {
                ws,
                connectedAt: new Date(),
                userId: null,
                conversationId: null,
                threadId: null
            });

            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    await this.handleMessage(connectionId, message);
                } catch (error) {
                    console.error('❌ Error handling message:', error);
                    this.sendError(connectionId, 'Invalid message format');
                }
            });

            ws.on('close', () => {
                console.log(`🔌 User disconnected: ${connectionId}`);
                this.connections.delete(connectionId);
                this.adminConnections.delete(connectionId);
            });

            ws.on('error', (error) => {
                console.error(`❌ WebSocket error for ${connectionId}:`, error);
            });

            // Send welcome message
            this.sendMessage(connectionId, {
                type: 'welcome',
                message: 'Connected to Elate Moving Chatbot',
                connectionId
            });
        });

        console.log(`🚀 Enhanced WebSocket server starting on port ${this.port}...`);
        console.log(`✅ Enhanced WebSocket server running on port ${this.port}`);
        console.log(`📊 Active connections: ${this.connections.size}`);
        console.log(`👨‍💼 Admin connections: ${this.adminConnections.size}`);
    }

    async handleMessage(connectionId, message) {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        console.log(`📨 Received message from ${connectionId}:`, message.type);

        switch (message.type) {
            case 'user_message':
                await this.handleUserMessage(connectionId, message);
                break;
            case 'admin_join':
                this.handleAdminJoin(connectionId);
                break;
            case 'lead_submission':
                await this.handleLeadSubmission(connectionId, message);
                break;
            default:
                console.warn(`⚠️ Unknown message type: ${message.type}`);
        }
    }

    async handleUserMessage(connectionId, message) {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        // Set conversation context
        connection.conversationId = message.conversationId || connection.conversationId || uuidv4();
        connection.userId = message.userId || connection.userId || connectionId;

        // Send typing indicator
        this.sendMessage(connectionId, { type: 'typing_indicator', isTyping: true });

        try {
            let response = '';
            const apiKeyAvailable = !!process.env.OPENAI_API_KEY;
            const assistantsEnabled = apiKeyAvailable && String(process.env.OPENAI_ASSISTANTS_ENABLED || '').toLowerCase() === 'true';
            const assistantId = process.env.OPENAI_ASSISTANT_ID;

            if (assistantsEnabled && assistantId && this.openai) {
                // Use OpenAI Assistants with proper runs
                response = await this.handleAssistantRun(connection, message.content);
            } else {
                // Fallback to internal conversation flow
                const flowResponse = await this.flow.handleConversation(
                    message.content,
                    connection.userId,
                    connection.conversationId
                );
                response = flowResponse?.content || 'Thanks for your message!';
            }

            // Send response
            this.sendMessage(connectionId, {
                type: 'bot_message',
                content: response,
                conversationId: connection.conversationId
            });

            // Notify admins
            this.notifyAdmins({
                type: 'new_message',
                userId: connection.userId,
                conversationId: connection.conversationId,
                userMessage: message.content,
                botResponse: response,
                timestamp: new Date()
            });

        } catch (error) {
            console.error('❌ Error handling user message:', error);
            this.sendError(connectionId, 'Sorry, I encountered an error. Please try again.');
        } finally {
            // Stop typing indicator
            this.sendMessage(connectionId, { type: 'typing_indicator', isTyping: false });
        }
    }

    async handleAssistantRun(connection, userMessage) {
        try {
            const assistantId = process.env.OPENAI_ASSISTANT_ID;
            
            // Create or get thread
            let threadId = connection.threadId;
            if (!threadId) {
                const thread = await this.openai.beta.threads.create();
                threadId = thread.id;
                connection.threadId = threadId;
                console.log(`🧵 Created new thread: ${threadId}`);
            }

            // Add user message to thread
            await this.openai.beta.threads.messages.create(threadId, {
                role: 'user',
                content: userMessage
            });

            // Create run
            const run = await this.openai.beta.threads.runs.create(threadId, {
                assistant_id: assistantId
            });

            console.log(`🏃 Created run: ${run.id} for thread: ${threadId}`);

            // Poll run status and handle tool calls
            let currentRun = run;
            while (currentRun.status === 'in_progress' || currentRun.status === 'queued') {
                await new Promise(resolve => setTimeout(resolve, 1000));
                currentRun = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
                console.log(`🔄 Run status: ${currentRun.status}`);
            }

            // Handle requires_action (tool calls)
            if (currentRun.status === 'requires_action') {
                console.log('🔧 Run requires action - handling tool calls');
                const toolOutputs = await this.handleToolCalls(threadId, currentRun, connection);
                
                // Continue the run after submitting tool outputs
                currentRun = await this.openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
                    tool_outputs: toolOutputs
                });

                // Poll again until completion
                while (currentRun.status === 'in_progress' || currentRun.status === 'queued') {
                    await new Promise(resolve => setTimeout(resolve, 400));
                    currentRun = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
                    console.log(`🔄 Run status after tool calls: ${currentRun.status}`);
                }
            }

            if (currentRun.status === 'completed') {
                // Get the latest messages
                const messages = await this.openai.beta.threads.messages.list(threadId);
                const latestMessage = messages.data[0];
                
                if (latestMessage.role === 'assistant') {
                    return latestMessage.content[0]?.text?.value || 'Thanks for your message!';
                }
            }

            return 'Thanks for your message!';

        } catch (error) {
            console.error('❌ Error in Assistant run:', error);
            throw error;
        }
    }

    async handleToolCalls(threadId, run, connection) {
        const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
        const toolOutputs = [];

        for (const toolCall of toolCalls) {
            console.log(`🔧 Handling tool call: ${toolCall.function.name}`);
            
            if (toolCall.function.name === 'submit_lead') {
                try {
                    const args = JSON.parse(toolCall.function.arguments || '{}');
                    
                    // Normalize / enrich without trusting model for source
                    const lead = {
                        ...args,
                        source: 'chat_conversation',
                        full_name: args.full_name || [args.first_name, args.last_name].filter(Boolean).join(' '),
                    };

                    // Optional: map to CRM expected keys if different
                    if (args.origin) lead.origin_address = args.origin;
                    if (args.destination) lead.destination_address = args.destination;
                    
                    // POST to CRM (primary) and optional notification
                    const crm = await postLeadToCRM(lead);
                    try { 
                        await notifyLead({ 
                            event: 'new_lead', 
                            source: lead.source, 
                            full_name: lead.full_name, 
                            phone: lead.phone, 
                            crm_status: crm.ok ? 'accepted' : 'failed' 
                        }); 
                    } catch (notifyError) {
                        console.warn('⚠️ Notification failed:', notifyError.message);
                    }
                    
                    // Notify admins
                    this.notifyAdmins({
                        type: 'lead_submitted',
                        leadData: lead,
                        crmResult: crm,
                        conversationId: connection.conversationId,
                        userId: connection.userId,
                        timestamp: new Date()
                    });

                    // Return minimal tool output so the run can complete
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ ok: crm.ok })
                    });

                } catch (error) {
                    console.error('❌ Error submitting lead:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ 
                            success: false, 
                            error: error.message 
                        })
                    });
                }
            } else {
                // Handle other tool calls
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({ success: false, error: 'Unknown tool call' })
                });
            }
        }

        return toolOutputs;
    }

    async handleLeadSubmission(connectionId, message) {
        try {
            const leadData = message.leadData;
            
            // Submit to CRM webhook
            const crmResult = await postLeadToCRM(leadData);
            
            // Send notification (optional)
            await notifyLead(leadData);

            // Send confirmation to user
            this.sendMessage(connectionId, {
                type: 'lead_confirmation',
                success: crmResult.ok,
                message: crmResult.ok ? 'Lead submitted successfully!' : 'Failed to submit lead',
                leadId: crmResult.body?.leadId || 'unknown'
            });

            // Notify admins
            this.notifyAdmins({
                type: 'lead_submitted',
                leadData,
                crmResult,
                conversationId: message.conversationId,
                userId: message.userId,
                timestamp: new Date()
            });

        } catch (error) {
            console.error('❌ Error handling lead submission:', error);
            this.sendError(connectionId, 'Failed to submit lead. Please try again.');
        }
    }

    handleAdminJoin(connectionId) {
        this.adminConnections.add(connectionId);
        console.log(`👨‍💼 Admin joined: ${connectionId}`);
        
        // Send current connections info
        const connectionsInfo = Array.from(this.connections.entries()).map(([id, conn]) => ({
            id,
            connectedAt: conn.connectedAt,
            userId: conn.userId,
            conversationId: conn.conversationId
        }));

        this.sendMessage(connectionId, {
            type: 'admin_dashboard',
            connections: connectionsInfo,
            totalConnections: this.connections.size
        });
    }

    notifyAdmins(data) {
        const adminMessage = JSON.stringify(data);
        this.adminConnections.forEach(adminId => {
            const adminConnection = this.connections.get(adminId);
            if (adminConnection && adminConnection.ws.readyState === WebSocket.OPEN) {
                adminConnection.ws.send(adminMessage);
            }
        });
    }

    sendMessage(connectionId, message) {
        const connection = this.connections.get(connectionId);
        if (connection && connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.send(JSON.stringify(message));
        }
    }

    sendError(connectionId, errorMessage) {
        this.sendMessage(connectionId, {
            type: 'error',
            message: errorMessage
        });
    }
}

// Start server if run directly
if (require.main === module) {
    const server = new EnhancedWebSocketServer();
    server.start();
}

module.exports = EnhancedWebSocketServer;
