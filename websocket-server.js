import dotenv from 'dotenv';
dotenv.config();
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import MovingConversationFlow from './moving-conversation-flows.js';
import OpenAI from 'openai';
import { validateMoveDate } from './utils/date-validation.js';

class ChatbotWebSocketServer {
    constructor(port = 3001) {
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });
        
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

            if (assistantsEnabled && assistantId && this.openai) {
                // Use proper OpenAI Assistants API with threads and runs (faster than Responses API)
                try {
                    const result = await this.runAssistantWithTimeout(
                        message.content,
                        assistantId,
                        connection.threadId || null
                    );
                    
                    console.log(`✅ Assistant response received: ${result.text ? result.text.substring(0, 100) : 'NO TEXT'}`);
                    
                    // Store threadId for future messages
                    if (!connection.threadId && result.threadId) {
                        connection.threadId = result.threadId;
                    }
                    
                    content = result.text || result || 'Thanks for your message!';
                } catch (assistantError) {
                    console.error('❌ Assistant run error:', assistantError);
                    content = "I'm sorry, I encountered an error processing your message. Please try again.";
                }
            } else {
                // Default to internal conversation flow
                const flowResponse = await this.flow.handleConversation(
                    message.content,
                    connection.userId || connectionId,
                    connection.conversationId
                );
                content = flowResponse?.content || 'Thanks!';
            }

            // Ensure content is a string
            if (typeof content !== 'string') {
                console.error('❌ Content is not a string:', typeof content, content);
                content = String(content || 'Thanks for your message!');
            }
            
            console.log(`📤 Streaming message to client (${content.length} chars): ${content.substring(0, 100)}...`);
            await this.streamBotMessage(connection.ws, content);
        } catch (error) {
            console.error('❌ Bot response error:', error);
            connection.ws.send(JSON.stringify({
                type: 'bot_message',
                content: 'I ran into an issue responding. Please try again.',
                timestamp: new Date().toISOString()
            }));
            // Turn off typing indicator
            connection.ws.send(JSON.stringify({ type: 'typing_indicator', isTyping: false }));
        }
    }

    /**
     * Run OpenAI Assistant with proper timeout protection
     * Uses threads and runs API (faster than deprecated Responses API)
     */
    async runAssistantWithTimeout(userText, assistantId, threadId = null) {
        const MAX_WAIT_TIME = 30000; // 30 second timeout (reduced from 60s for faster feedback)
        const POLL_INTERVAL = 500; // Poll every 500ms (faster polling)
        const MAX_POLL_ATTEMPTS = 60; // Max attempts
        const startTime = Date.now();
        let pollAttempts = 0;

        try {
            // Create or get thread
            let currentThreadId = threadId;
            if (!currentThreadId) {
                const thread = await this.openai.beta.threads.create();
                currentThreadId = thread.id;
                console.log(`🧵 Created new thread: ${currentThreadId}`);
                
                // Add conversation guidance for new threads — v3 aligned
                await this.openai.beta.threads.messages.create(currentThreadId, {
                    role: "user",
                    content: `CONVERSATION RULES — FOLLOW THESE EVERY TIME:

1. ONE question per response. Never stack or combine questions.
   - Bad: "What's your name and phone?" ❌
   - Good: "What's your name?" ✅ (then wait, then ask phone next)
2. Get contact info FIRST — name, then phone. This is priority so we capture the lead even if they drop off.
3. Keep it natural and conversational — talk like a real person, not a script. Always be closing.

MOVE DATE HANDLING:

When someone gives you a move date:
1. IMMEDIATELY call validate_move_date with exactly what they said
2. Handle the response based on the function's return:

   If valid=true AND needs_confirmation=true AND date_passed_this_year=false:
   - Date is upcoming, year was inferred
   - Confirm casually: "Got it — so that's [full_date]?"

   If valid=false AND needs_confirmation=true AND date_passed_this_year=true:
   - Month/day already passed this year, next year assumed
   - Confirm: "[month day] already passed this year — you thinking [next year]?"

   If valid=true AND needs_confirmation=false:
   - Full valid date given
   - Confirm: "Got it, [full_date]. We're good?"

   If valid=false AND needs_confirmation=false:
   - Date has explicitly passed
   - Use the message from the function, ask for a new future date

   If user confirms → move forward. If user says no → ask "No worries — what date works for you?"

3. Wait for them to confirm before moving on

YEAR INFERENCE:
- If the month/day hasn't happened yet → assume current year, confirm
- If it already passed → assume next year, check with them
- Sound natural about it, like you already know what they mean
- NEVER say "parse", "format", "validated", "processed", or any technical terms
- If function returns error → just ask naturally: "Just wanna make sure I got that right — what date works for you?"

ADDRESS RULES:
- If they mention apartment/condo but no unit number → you MUST ask for it
- Check BOTH origin and destination for unit numbers
- If it's a house → no unit needed, move on`
                });
            }

            // Add user message to thread
            await this.openai.beta.threads.messages.create(currentThreadId, {
                role: "user",
                content: userText
            });

            // Create run
            let run = await this.openai.beta.threads.runs.create(currentThreadId, {
                assistant_id: assistantId
            });

            console.log(`🏃 Created run: ${run.id} for thread: ${currentThreadId}`);

            // Poll run status with timeout protection
            while (pollAttempts < MAX_POLL_ATTEMPTS) {
                // Check timeout
                if (Date.now() - startTime > MAX_WAIT_TIME) {
                    throw new Error('Assistant response timeout after 30 seconds');
                }

                run = await this.openai.beta.threads.runs.retrieve(currentThreadId, run.id);
                console.log(`🔄 Run status: ${run.status} (${pollAttempts + 1}/${MAX_POLL_ATTEMPTS})`);

                // Handle error statuses
                if (run.status === "failed" || run.status === "expired" || run.status === "cancelled") {
                    const errorMsg = run.last_error?.message || `Run ${run.status}`;
                    console.error(`❌ Run failed: ${errorMsg}`);
                    throw new Error(errorMsg);
                }

                // Handle tool calls
                if (run.status === "requires_action") {
                    const outputs = [];
                    for (const call of run.required_action.submit_tool_outputs.tool_calls) {
                        if (call.function.name === "validate_move_date") {
                            try {
                                const args = JSON.parse(call.function.arguments || '{}');
                                const { date_string } = args;
                                
                                console.log(`📅 Validating move date: ${date_string}`);
                                const validationResult = validateMoveDate(date_string);
                                
                                if (validationResult.valid) {
                                    console.log(`✅ Date validated successfully: ${validationResult.full_date}`);
                                } else {
                                    console.log(`❌ Date validation failed: ${validationResult.message}`);
                                }
                                
                                outputs.push({
                                    tool_call_id: call.id,
                                    output: JSON.stringify(validationResult)
                                });
                            } catch (error) {
                                console.error('❌ Error in validate_move_date tool call:', error);
                                outputs.push({
                                    tool_call_id: call.id,
                                    output: JSON.stringify({
                                        valid: false,
                                        message: `Error validating date: ${error.message}`,
                                        error: error.message
                                    })
                                });
                            }
                        } else {
                            // For other tool calls, return ok (simplified handling)
                            outputs.push({
                                tool_call_id: call.id,
                                output: JSON.stringify({ ok: true })
                            });
                        }
                    }
                    await this.openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { 
                        tool_outputs: outputs 
                    });
                    pollAttempts = 0; // Reset counter
                    continue;
                }

                // Check if completed
                if (run.status === "completed") {
                    break;
                }

                // Continue polling
                if (run.status === "queued" || run.status === "in_progress") {
                    await new Promise(r => setTimeout(r, POLL_INTERVAL));
                    pollAttempts++;
                    continue;
                }

                // Unknown status - break
                console.warn(`⚠️ Unknown run status: ${run.status}`);
                break;
            }

            if (pollAttempts >= MAX_POLL_ATTEMPTS) {
                throw new Error('Max poll attempts reached');
            }

            // Get the latest assistant message
            const messages = await this.openai.beta.threads.messages.list(currentThreadId, {
                order: "desc",
                limit: 5  // Get more messages to find the assistant's response
            });

            // Find the most recent assistant message
            let last = null;
            for (const msg of messages.data) {
                if (msg.role === 'assistant' && msg.run_id === run.id) {
                    last = msg;
                    break;
                }
            }
            
            // Fallback to first message if no match
            if (!last && messages.data.length > 0) {
                last = messages.data.find(msg => msg.role === 'assistant') || messages.data[0];
            }

            let text = "";
            
            if (last) {
                console.log(`📨 Processing message: role=${last.role}, content type=${Array.isArray(last.content) ? 'array' : typeof last.content}`);
                
                if (Array.isArray(last.content)) {
                    for (const p of last.content) {
                        if (p.type === "text" && p.text) {
                            text += p.text.value || p.text || '';
                        } else if (p.type === "text" && typeof p === 'string') {
                            text += p;
                        }
                    }
                } else if (last.content && typeof last.content === 'string') {
                    text = last.content;
                } else if (last.content && last.content.text) {
                    text = last.content.text.value || last.content.text || '';
                }
            }

            // Log for debugging
            console.log(`📝 Extracted text length: ${text.length}, content preview: ${text.substring(0, 150)}`);

            if (!text || text.trim().length === 0) {
                console.warn('⚠️ No text content found in assistant message. Full message:', JSON.stringify(last, null, 2));
                text = "I'm sorry, I didn't receive a proper response. Could you please try again?";
            }

            // Process to ensure only one question
            const processedText = this.extractFirstQuestion(text.trim());

            return {
                text: processedText,
                threadId: currentThreadId
            };

        } catch (error) {
            console.error('❌ Error in assistant run:', error);
            throw error;
        }
    }

    /**
     * Detects and extracts only the first question from content if multiple questions are present
     * This ensures the chatbot asks one question at a time
     */
    extractFirstQuestion(content) {
        if (!content || typeof content !== 'string') return content;
        
        let processedContent = content.trim();
        
        // Pattern to detect multiple questions in the same sentence
        // Examples: "what's your name and phone?" or "what's your name? what's your phone?"
        const multipleQuestionPatterns = [
            /\b(?:and|or|,)\s+(?:what|when|where|who|why|how|which|do|are|can|would|could|is|will)\b/gi,  // "and what..." or ", what..."
            /\?\s+(?:what|when|where|who|why|how|which|do|are|can|would|could|is|will)\b/gi,  // "? what..."
            /\b(?:name|phone|email|address|date|number)\s+(?:and|or|,)\s+(?:name|phone|email|address|date|number|best|your)\b/gi,  // "name and phone", "name and best phone"
            /\b(?:full\s+)?name\s+and\s+(?:best\s+)?(?:phone|email|address)\b/gi,  // "name and phone", "full name and best phone"
            /\b(?:what'?s|what\s+is)\s+your\s+.*?\s+and\s+.*?\?/gi,  // "what's your X and Y?"
        ];
        
        // Check for multiple questions in one sentence
        let hasMultipleQuestions = multipleQuestionPatterns.some(pattern => pattern.test(content));
        
        // Also check for common patterns like "name and phone" or "name, phone, email"
        const dataCollectionPattern = /\b(?:name|phone|email|address|date|number)\s+(?:and|,)\s+(?:name|phone|email|address|date|number|best|your)\b/gi;
        if (dataCollectionPattern.test(content)) {
            hasMultipleQuestions = true;
        }
        
        // Count question marks
        const questionCount = (content.match(/\?/g) || []).length;
        
        if (questionCount > 1 || hasMultipleQuestions) {
            // Multiple questions detected - extract first one
            if (questionCount > 1) {
                // Split by question marks
                const firstQuestionEnd = content.indexOf('?');
                if (firstQuestionEnd !== -1) {
                    processedContent = content.substring(0, firstQuestionEnd + 1).trim();
                    console.log('⚠️ Multiple questions detected (by ?). Using first question only:', processedContent.substring(0, 100));
                }
            } else if (hasMultipleQuestions) {
                // Try multiple split strategies
                let splitIndex = -1;
                
                // Strategy 1: Split on "and" before data collection terms (name, phone, email, etc.)
                const dataSplitPattern = /\s+and\s+(?:best\s+)?(?:phone|email|address|date|number)\b/i;
                splitIndex = content.search(dataSplitPattern);
                
                // Strategy 2: Split on "and" before question words
                if (splitIndex === -1) {
                    const questionSplitPattern = /\s+(?:and|or|,)\s+(?:what|when|where|who|why|how|which|do|are|can|would|could|is|will)/i;
                    splitIndex = content.search(questionSplitPattern);
                }
                
                // Strategy 3: Split on comma before data collection terms
                if (splitIndex === -1) {
                    const commaSplitPattern = /,\s+(?:best\s+)?(?:phone|email|address|date|number|name)\b/i;
                    splitIndex = content.search(commaSplitPattern);
                }
                
                if (splitIndex !== -1) {
                    // Find the end of the first part (before the "and/or" connector)
                    let endIndex = splitIndex;
                    
                    // Try to find a natural break point (comma, period, or end of sentence)
                    const beforeSplit = content.substring(0, splitIndex);
                    const lastComma = beforeSplit.lastIndexOf(',');
                    const lastPeriod = beforeSplit.lastIndexOf('.');
                    const lastQuestion = beforeSplit.lastIndexOf('?');
                    
                    // Use the last punctuation mark before the split, or just split at "and/or"
                    if (lastComma > lastPeriod && lastComma > lastQuestion) {
                        endIndex = lastComma + 1;
                    } else if (lastPeriod > lastQuestion) {
                        endIndex = lastPeriod + 1;
                    } else if (lastQuestion !== -1) {
                        endIndex = lastQuestion + 1;
                    }
                    
                    processedContent = content.substring(0, endIndex).trim();
                    
                    // If we didn't end with punctuation, add a question mark if it makes sense
                    if (!processedContent.match(/[.!?]$/)) {
                        // Check if the original had a question mark at the end
                        if (content.trim().endsWith('?')) {
                            processedContent += '?';
                        }
                    }
                    
                    console.log('⚠️ Multiple questions detected (by pattern). Using first question only:', processedContent.substring(0, 100));
                } else {
                    // Fallback: if we detect multiple questions but can't split, just take first part before "and"
                    // This handles cases like "what's your name and phone?"
                    const andPatterns = [
                        /\s+and\s+(?:the\s+)?(?:best\s+)?(?:phone|email|address|date|number)\b/i,
                        /\s+and\s+(?:your\s+)?(?:phone|email|address|date|number)\b/i,
                    ];
                    
                    let andIndex = -1;
                    for (const pattern of andPatterns) {
                        const match = content.match(pattern);
                        if (match) {
                            andIndex = content.indexOf(match[0]);
                            break;
                        }
                    }
                    
                    // Also try simple " and " search
                    if (andIndex === -1) {
                        const simpleAndIndex = content.toLowerCase().indexOf(' and ');
                        if (simpleAndIndex !== -1) {
                            const afterAnd = content.substring(simpleAndIndex + 5).toLowerCase();
                            if (/\b(?:phone|email|address|date|number|name|best|the)\b/.test(afterAnd)) {
                                andIndex = simpleAndIndex;
                            }
                        }
                    }
                    
                    if (andIndex !== -1 && content.trim().endsWith('?')) {
                        processedContent = content.substring(0, andIndex).trim() + '?';
                        console.log('⚠️ Multiple questions detected (by "and"). Using first question only:', processedContent.substring(0, 100));
                    }
                }
            }
        }
        
        return processedContent;
    }

    async streamBotMessage(ws, content) {
        try {
            // Process content to ensure only one question is asked
            const processedContent = this.extractFirstQuestion(content);
            
            ws.send(JSON.stringify({ type: 'bot_stream_start', timestamp: new Date().toISOString() }));
            const chunks = processedContent.split(/(\s+)/); // stream by words incl. spaces
            for (const chunk of chunks) {
                if (ws.readyState !== WebSocket.OPEN) break;
                ws.send(JSON.stringify({ type: 'bot_stream_delta', delta: chunk }));
                // Increased delay from 30ms to 80ms for slower, more readable streaming
                await new Promise(r => setTimeout(r, 80));
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

export default ChatbotWebSocketServer;

// Start server if run directly
const isMainModule = import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || 
                     process.argv[1]?.endsWith('websocket-server.js');

if (isMainModule) {
    const server = new ChatbotWebSocketServer(process.env.WEBSOCKET_PORT || 3001);
    global.chatbotServer = server;
    server.start();
} 
