require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const MovingConversationFlow = require('./moving-conversation-flows');
const OpenAI = require('openai');

class ChatbotWebSocketServer {
    constructor(port = 3001) {
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        
        this.activeConnections = new Map();
        this.adminConnections = new Set();
        this.conversationHistory = new Map();
        this.flow = new MovingConversationFlow();
        const apiKey = process.env.OPENAI_API_KEY;
        this.openai = apiKey ? new OpenAI({ apiKey }) : null;
        
        this.setupMiddleware();
        this.setupWebSocketHandlers();
        this.setupRoutes();
        
        console.log(`🚀 WebSocket server starting on port ${port}...`);
    }

    setupMiddleware() {
        this.app.use(cors({
            origin: process.env.NODE_ENV === 'production' 
                ? ['https://yourwebsite.com', 'https://admin.yourwebsite.com']
                : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080'],
            credentials: true
        }));
        this.app.use(express.json());
    }

    setupWebSocketHandlers() {
        this.wss.on('connection', (ws, req) => {
            const connectionId = uuidv4();
            const userAgent = req.headers['user-agent'] || 'Unknown';
            const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
            
            console.log(`🔌 New WebSocket connection: ${connectionId} from ${ip}`);
            
            // Store connection info
            this.activeConnections.set(connectionId, {
                ws,
                ip,
                userAgent,
                connectedAt: new Date(),
                isAdmin: false,
                conversationId: null,
                userId: null,
                lastActivity: new Date()
            });

            // Send welcome/ack
            ws.send(JSON.stringify({
                type: 'connection_established',
                connectionId,
                timestamp: new Date().toISOString()
            }));

            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data);
                    await this.handleMessage(connectionId, message);
                } catch (error) {
                    console.error('❌ Error parsing WebSocket message:', error);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid message format',
                        timestamp: new Date().toISOString()
                    }));
                }
            });

            ws.on('close', () => {
                this.handleDisconnection(connectionId);
            });

            ws.on('error', (error) => {
                console.error(`❌ WebSocket error for ${connectionId}:`, error);
                this.handleDisconnection(connectionId);
            });

            // Set up heartbeat
            this.setupHeartbeat(connectionId, ws);
        });
    }

    setupHeartbeat(connectionId, ws) {
        const heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
            } else {
                clearInterval(heartbeat);
                this.handleDisconnection(connectionId);
            }
        }, 30000);

        ws.on('pong', () => {
            const connection = this.activeConnections.get(connectionId);
            if (connection) {
                connection.lastActivity = new Date();
            }
        });
    }

    async handleMessage(connectionId, message) {
        const connection = this.activeConnections.get(connectionId);
        if (!connection) return;

        connection.lastActivity = new Date();

        switch (message.type) {
            case 'init': {
                connection.userId = message.userId || connection.userId;
                connection.conversationId = message.conversationId || connection.conversationId || uuidv4();
                if (!this.conversationHistory.has(connection.conversationId)) {
                    this.conversationHistory.set(connection.conversationId, []);
                }
                break;
            }
            case 'chat_message':
                await this.handleChatMessage(connectionId, message);
                break;
            case 'admin_join':
                this.handleAdminJoin(connectionId, message);
                break;
            case 'admin_message':
                this.handleAdminMessage(connectionId, message);
                break;
            case 'typing_indicator':
                this.broadcastToAdmins({
                    type: 'user_typing',
                    connectionId,
                    isTyping: message.isTyping
                });
                break;
            case 'lead_submission':
                this.handleLeadSubmission(connectionId, message);
                break;
            default:
                console.warn(`⚠️ Unknown message type: ${message.type}`);
        }
    }

    async handleChatMessage(connectionId, message) {
        const connection = this.activeConnections.get(connectionId);
        
        // Ensure conversation setup
        if (!connection.conversationId) {
            connection.conversationId = uuidv4();
        }
        if (!this.conversationHistory.has(connection.conversationId)) {
            this.conversationHistory.set(connection.conversationId, []);
        }
        
        // Store in conversation history
        this.conversationHistory.get(connection.conversationId).push({
            ...message,
            timestamp: new Date().toISOString(),
            connectionId
        });

        // Broadcast to admins
        this.broadcastToAdmins({
            type: 'user_message',
            connectionId,
            message: message.content,
            timestamp: new Date().toISOString(),
            userInfo: {
                ip: connection.ip,
                userAgent: connection.userAgent,
                connectedAt: connection.connectedAt
            }
        });

        // Typing indicator ON
        connection.ws.send(JSON.stringify({ type: 'typing_indicator', isTyping: true }));

        // Determine response source
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
                content = response.output_text || 'Thanks!';
            } else {
                // Default to internal conversation flow
                const flowResponse = await this.flow.handleConversation(
                    message.content,
                    connection.userId || connectionId,
                    connection.conversationId
                );
                content = flowResponse?.content || 'Thanks!';
            }

            await this.streamBotMessage(connection.ws, content);
        } catch (error) {
            console.error('❌ Bot response error:', error);
            connection.ws.send(JSON.stringify({
                type: 'bot_message',
                content: 'I ran into an issue responding. Please try again.',
                timestamp: new Date().toISOString()
            }));
        }
    }

    async streamBotMessage(ws, content) {
        try {
            ws.send(JSON.stringify({ type: 'bot_stream_start', timestamp: new Date().toISOString() }));
            const chunks = content.split(/(\s+)/); // stream by words incl. spaces
            for (const chunk of chunks) {
                if (ws.readyState !== WebSocket.OPEN) break;
                ws.send(JSON.stringify({ type: 'bot_stream_delta', delta: chunk }));
                await new Promise(r => setTimeout(r, 30));
            }
            ws.send(JSON.stringify({ type: 'bot_stream_end', timestamp: new Date().toISOString() }));
            // Typing indicator OFF
            ws.send(JSON.stringify({ type: 'typing_indicator', isTyping: false }));
        } catch (e) {
            console.error('❌ Streaming error:', e);
        }
    }

    handleAdminJoin(connectionId, message) {
        const connection = this.activeConnections.get(connectionId);
        if (connection && message.adminToken === process.env.ADMIN_TOKEN) {
            connection.isAdmin = true;
            this.adminConnections.add(connectionId);
            
            // Send current active conversations to admin
            const activeConversations = Array.from(this.activeConnections.entries())
                .filter(([_, conn]) => !conn.isAdmin && conn.conversationId)
                .map(([id, conn]) => ({
                    connectionId: id,
                    ip: conn.ip,
                    connectedAt: conn.connectedAt,
                    lastActivity: conn.lastActivity,
                    conversationHistory: this.conversationHistory.get(conn.conversationId) || []
                }));

            connection.ws.send(JSON.stringify({
                type: 'admin_joined',
                activeConversations,
                timestamp: new Date().toISOString()
            }));

            console.log(`👨‍💼 Admin joined: ${connectionId}`);
        }
    }

    handleAdminMessage(connectionId, message) {
        const adminConnection = this.activeConnections.get(connectionId);
        if (!adminConnection || !adminConnection.isAdmin) return;

        const targetConnection = this.activeConnections.get(message.targetConnectionId);
        if (targetConnection && targetConnection.ws.readyState === WebSocket.OPEN) {
            targetConnection.ws.send(JSON.stringify({
                type: 'admin_message',
                content: message.content,
                adminName: message.adminName || 'Support',
                timestamp: new Date().toISOString()
            }));

            // Store admin message in conversation history
            if (targetConnection.conversationId) {
                this.conversationHistory.get(targetConnection.conversationId).push({
                    type: 'admin_message',
                    content: message.content,
                    adminName: message.adminName,
                    timestamp: new Date().toISOString(),
                    connectionId: message.targetConnectionId
                });
            }

            console.log(`👨‍💼 Admin message to ${message.targetConnectionId}: ${message.content}`);
        }
    }

    handleLeadSubmission(connectionId, message) {
        const connection = this.activeConnections.get(connectionId);
        
        // Store lead data
        const leadData = {
            ...message.data,
            connectionId,
            ip: connection.ip,
            submittedAt: new Date().toISOString(),
            conversationHistory: this.conversationHistory.get(connection.conversationId) || []
        };

        // Broadcast to all admins
        this.broadcastToAdmins({
            type: 'new_lead',
            leadData,
            timestamp: new Date().toISOString()
        });

        // Send confirmation to user
        connection.ws.send(JSON.stringify({
            type: 'lead_submitted',
            message: 'Thank you! Our team will contact you within 24 hours.',
            timestamp: new Date().toISOString()
        }));

        console.log(`📝 New lead submitted from ${connectionId}: ${message.data.firstName} ${message.data.lastName}`);
    }

    broadcastToAdmins(message) {
        this.adminConnections.forEach(adminId => {
            const adminConnection = this.activeConnections.get(adminId);
            if (adminConnection && adminConnection.ws.readyState === WebSocket.OPEN) {
                adminConnection.ws.send(JSON.stringify(message));
            }
        });
    }

    handleDisconnection(connectionId) {
        const connection = this.activeConnections.get(connectionId);
        if (connection) {
            if (connection.isAdmin) {
                this.adminConnections.delete(connectionId);
                console.log(`👨‍💼 Admin disconnected: ${connectionId}`);
            } else {
                // Notify admins of user disconnection
                this.broadcastToAdmins({
                    type: 'user_disconnected',
                    connectionId,
                    timestamp: new Date().toISOString()
                });
                console.log(`🔌 User disconnected: ${connectionId}`);
            }
            
            this.activeConnections.delete(connectionId);
        }
    }

    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                activeConnections: this.activeConnections.size,
                adminConnections: this.adminConnections.size,
                uptime: process.uptime()
            });
        });

        // Get conversation history
        this.app.get('/api/conversations/:conversationId', (req, res) => {
            const { conversationId } = req.params;
            const history = this.conversationHistory.get(conversationId) || [];
            res.json({ history });
        });

        // Get active connections (admin only)
        this.app.get('/api/connections', (req, res) => {
            if (req.headers.authorization !== `Bearer ${process.env.ADMIN_TOKEN}`) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const connections = Array.from(this.activeConnections.entries())
                .filter(([_, conn]) => !conn.isAdmin)
                .map(([id, conn]) => ({
                    connectionId: id,
                    ip: conn.ip,
                    connectedAt: conn.connectedAt,
                    lastActivity: conn.lastActivity,
                    conversationId: conn.conversationId
                }));

            res.json({ connections });
        });
    }

    start() {
        this.server.listen(this.port, () => {
            console.log(`✅ WebSocket server running on port ${this.port}`);
            console.log(`📊 Active connections: ${this.activeConnections.size}`);
            console.log(`👨‍💼 Admin connections: ${this.adminConnections.size}`);
        });
    }

    // Cleanup inactive connections
    cleanupInactiveConnections() {
        const now = new Date();
        const timeout = 5 * 60 * 1000; // 5 minutes

        for (const [connectionId, connection] of this.activeConnections.entries()) {
            if (now - connection.lastActivity > timeout) {
                console.log(`🧹 Cleaning up inactive connection: ${connectionId}`);
                connection.ws.close();
                this.activeConnections.delete(connectionId);
            }
        }
    }
}

// Start cleanup interval
setInterval(() => {
    if (global.chatbotServer) {
        global.chatbotServer.cleanupInactiveConnections();
    }
}, 60000); // Check every minute

module.exports = ChatbotWebSocketServer;

// Start server if run directly
if (require.main === module) {
    const server = new ChatbotWebSocketServer(process.env.WEBSOCKET_PORT || 3001);
    global.chatbotServer = server;
    server.start();
} 
