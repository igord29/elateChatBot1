require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const axios = require('axios');

class MovingChatbotAPI {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.dbDisabled = false;
        this.memoryStore = {
            conversations: [],
            messages: [],
            leads: [],
            analytics: []
        };
        
        // Initialize services
        this.initializeDatabase();
        this.initializeRedis();
        this.initializeOpenAI();
        
        // Setup middleware
        this.setupMiddleware();
        this.setupRoutes();
        
        console.log('🚀 Moving Chatbot API starting...');
    }

    async initializeDatabase() {
        try {
            this.pgPool = new Pool({
                user: process.env.DB_USER || 'postgres',
                host: process.env.DB_HOST || 'localhost',
                database: process.env.DB_NAME || 'moving_chatbot',
                password: process.env.DB_PASSWORD || 'password',
                port: process.env.DB_PORT || 5432,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            await this.pgPool.query('SELECT NOW()');
            console.log('✅ PostgreSQL connected successfully');

            await this.initializeSchema();
        } catch (error) {
            console.warn('⚠️ Database unavailable. Falling back to in-memory store for development. Error:', error.code || error.message);
            this.dbDisabled = true;
            this.pgPool = null;
        }
    }

    async initializeRedis() {
        try {
            this.redis = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD,
                retryDelayOnFailover: 100,
                maxRetriesPerRequest: 3
            });

            await this.redis.ping();
            console.log('✅ Redis connected successfully');
        } catch (error) {
            console.warn('⚠️ Redis unavailable. Continuing without Redis cache.');
            this.redis = null;
        }
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

    async initializeSchema() {
        if (this.dbDisabled) return;
        const schemaQueries = [
            `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
            // Users table
            `CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                role VARCHAR(50) DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            // Conversations table
            `CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id),
                thread_id VARCHAR(255) NOT NULL,
                assistant_id VARCHAR(255) NOT NULL,
                status VARCHAR(50) DEFAULT 'active',
                lead_data JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            // Messages table
            `CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                role VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            // Leads table
            `CREATE TABLE IF NOT EXISTS leads (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id),
                first_name VARCHAR(100) NOT NULL,
                last_name VARCHAR(100) NOT NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(50) NOT NULL,
                origin_address TEXT NOT NULL,
                destination_address TEXT NOT NULL,
                move_date DATE NOT NULL,
                service_type VARCHAR(100) NOT NULL,
                estimated_distance DECIMAL(10,2),
                estimated_cost DECIMAL(10,2),
                status VARCHAR(50) DEFAULT 'new',
                assigned_to UUID REFERENCES users(id),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            // Analytics table
            `CREATE TABLE IF NOT EXISTS analytics (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_type VARCHAR(100) NOT NULL,
                event_data JSONB,
                user_id UUID REFERENCES users(id),
                conversation_id UUID REFERENCES conversations(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            // A/B testing tables
            `CREATE TABLE IF NOT EXISTS ab_testing_experiments (
                id UUID PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                variants JSONB NOT NULL,
                traffic_split JSONB NOT NULL,
                start_date TIMESTAMP,
                end_date TIMESTAMP,
                goals JSONB,
                hypothesis TEXT,
                status VARCHAR(50) DEFAULT 'draft',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                stopped_at TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS ab_testing_assignments (
                user_id VARCHAR(255) NOT NULL,
                experiment_id UUID REFERENCES ab_testing_experiments(id) ON DELETE CASCADE,
                variant_id UUID NOT NULL,
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS ab_testing_events (
                id UUID PRIMARY KEY,
                user_id VARCHAR(255),
                experiment_id UUID REFERENCES ab_testing_experiments(id) ON DELETE CASCADE,
                variant_id UUID,
                event_type VARCHAR(100) NOT NULL,
                event_data JSONB,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            // Indexes
            `CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)`,
            `CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`,
            `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
            `CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics(event_type)`,
            `CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics(created_at)`,
            `CREATE INDEX IF NOT EXISTS idx_ab_assignments_experiment ON ab_testing_assignments(experiment_id)`,
            `CREATE INDEX IF NOT EXISTS idx_ab_events_experiment ON ab_testing_events(experiment_id)`
        ];

        for (const query of schemaQueries) {
            await this.pgPool.query(query);
        }

        console.log('✅ Database schema initialized');
    }

    setupMiddleware() {
        this.app.use(helmet());
        this.app.use(cors({
            origin: process.env.NODE_ENV === 'production' 
                ? ['https://yourwebsite.com', 'https://admin.yourwebsite.com']
                : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080'],
            credentials: true
        }));
        const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: 'Too many requests from this IP, please try again later.' });
        this.app.use('/api/', limiter);
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        this.app.use((req, res, next) => { console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`); next(); });
        this.app.use((error, req, res, next) => {
            console.error('❌ API Error:', error);
            res.status(500).json({ error: 'Internal server error', message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong' });
        });
    }

    setupRoutes() {
        this.app.get('/health', async (req, res) => {
            try {
                let dbStatus = this.dbDisabled ? 'disabled' : 'connected';
                if (!this.dbDisabled && this.pgPool) await this.pgPool.query('SELECT NOW()');
                const redisStatus = this.redis ? await this.redis.ping() : 'disabled';
                res.json({ status: 'healthy', timestamp: new Date().toISOString(), database: dbStatus, redis: redisStatus === 'PONG' ? 'connected' : 'disconnected', uptime: process.uptime() });
            } catch (error) {
                res.status(503).json({ status: 'unhealthy', error: error.message });
            }
        });

        // Auth routes
        this.app.post('/api/auth/register', this.handleRegister.bind(this));
        this.app.post('/api/auth/login', this.handleLogin.bind(this));
        this.app.post('/api/auth/refresh', this.handleRefreshToken.bind(this));

        // Authenticated conversation routes
        this.app.post('/api/conversations', this.authenticateToken, this.handleCreateConversation.bind(this));
        this.app.get('/api/conversations', this.authenticateToken, this.handleGetConversations.bind(this));
        this.app.get('/api/conversations/:id', this.authenticateToken, this.handleGetConversation.bind(this));
        this.app.post('/api/conversations/:id/messages', this.authenticateToken, this.handleAddMessage.bind(this));

        // Public widget routes
        this.app.post('/api/widget/conversations', this.handleCreateWidgetConversation.bind(this));
        this.app.post('/api/widget/conversations/:id/messages', this.handleAddWidgetMessage.bind(this));

        // Leads
        this.app.post('/api/leads', this.handleCreateLead.bind(this));
        this.app.get('/api/leads', this.authenticateToken, this.handleGetLeads.bind(this));
        this.app.put('/api/leads/:id', this.authenticateToken, this.handleUpdateLead.bind(this));
        this.app.post('/api/leads/:id/assign', this.authenticateToken, this.handleAssignLead.bind(this));

        // Analytics
        this.app.post('/api/analytics', this.handleTrackEvent.bind(this));
        this.app.get('/api/analytics', this.authenticateToken, this.handleGetAnalytics.bind(this));

        // Quote/Distance
        this.app.post('/api/quote/calculate', this.handleCalculateQuote.bind(this));
        this.app.post('/api/distance/calculate', this.handleCalculateDistance.bind(this));

        // Admin
        this.app.get('/api/admin/dashboard', this.authenticateToken, this.handleGetDashboard.bind(this));
        this.app.get('/api/admin/conversations', this.authenticateToken, this.handleGetAllConversations.bind(this));
    }

    authenticateToken(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Access token required' });
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) return res.status(403).json({ error: 'Invalid or expired token' });
            req.user = user; next();
        });
    }

    // Public widget conversation handlers (no auth)
    async handleCreateWidgetConversation(req, res) {
        try {
            const assistantId = req.body?.assistantId || 'default-assistant';
            const threadId = uuidv4();
            if (this.dbDisabled) {
                const convo = { id: uuidv4(), user_id: null, thread_id: threadId, assistant_id: assistantId, status: 'active', created_at: new Date(), updated_at: new Date() };
                this.memoryStore.conversations.push(convo);
                await this.trackEvent('widget_conversation_created', { conversationId: convo.id, assistantId });
                return res.status(201).json({ message: 'Conversation created successfully', conversation: convo });
            }
            const result = await this.pgPool.query('INSERT INTO conversations (user_id, thread_id, assistant_id) VALUES ($1, $2, $3) RETURNING *', [null, threadId, assistantId]);
            await this.trackEvent('widget_conversation_created', { conversationId: result.rows[0].id, assistantId });
            res.status(201).json({ message: 'Conversation created successfully', conversation: result.rows[0] });
        } catch (error) {
            console.error('Create widget conversation error:', error);
            res.status(500).json({ error: 'Failed to create conversation' });
        }
    }

    async handleAddWidgetMessage(req, res) {
        try {
            const { id } = req.params;
            const { role = 'user', content, metadata } = req.body;
            if (this.dbDisabled) {
                const convo = this.memoryStore.conversations.find(c => c.id === id);
                if (!convo) return res.status(404).json({ error: 'Conversation not found' });
                const msg = { id: uuidv4(), conversation_id: id, role, content, metadata: metadata || null, created_at: new Date() };
                this.memoryStore.messages.push(msg);
                convo.updated_at = new Date();
                await this.trackEvent('widget_message_sent', { conversationId: id, role, messageLength: (content || '').length });
                return res.status(201).json({ message: 'Message added successfully', data: msg });
            }
            const conversationResult = await this.pgPool.query('SELECT id FROM conversations WHERE id = $1', [id]);
            if (conversationResult.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
            const result = await this.pgPool.query('INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, $2, $3, $4) RETURNING *', [id, role, content, metadata]);
            await this.pgPool.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
            await this.trackEvent('widget_message_sent', { conversationId: id, role, messageLength: (content || '').length });
            res.status(201).json({ message: 'Message added successfully', data: result.rows[0] });
        } catch (error) {
            console.error('Add widget message error:', error);
            res.status(500).json({ error: 'Failed to add message' });
        }
    }

    // Authentication handlers
    async handleRegister(req, res) {
        try {
            const { email, password, firstName, lastName } = req.body;

            // Validate input
            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password are required' });
            }

            // Check if user exists
            if (!this.dbDisabled) {
                const existingUser = await this.pgPool.query(
                    'SELECT id FROM users WHERE email = $1',
                    [email]
                );

                if (existingUser.rows.length > 0) {
                    return res.status(409).json({ error: 'User already exists' });
                }
            }

            // Hash password
            const saltRounds = 12;
            const passwordHash = await bcrypt.hash(password, saltRounds);

            // Create user
            if (!this.dbDisabled) {
                const result = await this.pgPool.query(
                    'INSERT INTO users (email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING id, email, first_name, last_name, role',
                    [email, passwordHash, firstName, lastName]
                );

                const user = result.rows[0];
                const token = jwt.sign(
                    { userId: user.id, email: user.email, role: user.role },
                    process.env.JWT_SECRET,
                    { expiresIn: '24h' }
                );

                res.status(201).json({
                    message: 'User created successfully',
                    user: {
                        id: user.id,
                        email: user.email,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        role: user.role
                    },
                    token
                });
            } else {
                const user = { id: uuidv4(), email, password_hash: passwordHash, first_name: firstName, last_name: lastName, role: 'user', created_at: new Date(), updated_at: new Date() };
                this.memoryStore.users.push(user);
                const token = jwt.sign(
                    { userId: user.id, email: user.email, role: user.role },
                    process.env.JWT_SECRET,
                    { expiresIn: '24h' }
                );
                res.status(201).json({
                    message: 'User created successfully',
                    user: {
                        id: user.id,
                        email: user.email,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        role: user.role
                    },
                    token
                });
            }

        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ error: 'Registration failed' });
        }
    }

    async handleLogin(req, res) {
        try {
            const { email, password } = req.body;

            // Validate input
            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password are required' });
            }

            // Find user
            if (!this.dbDisabled) {
                const result = await this.pgPool.query(
                    'SELECT id, email, password_hash, first_name, last_name, role FROM users WHERE email = $1',
                    [email]
                );

                if (result.rows.length === 0) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }

                const user = result.rows[0];

                // Verify password
                const isValidPassword = await bcrypt.compare(password, user.password_hash);
                if (!isValidPassword) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }

                // Generate token
                const token = jwt.sign(
                    { userId: user.id, email: user.email, role: user.role },
                    process.env.JWT_SECRET,
                    { expiresIn: '24h' }
                );

                res.json({
                    message: 'Login successful',
                    user: {
                        id: user.id,
                        email: user.email,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        role: user.role
                    },
                    token
                });
            } else {
                const user = this.memoryStore.users.find(u => u.email === email);
                if (!user) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
                const isValidPassword = await bcrypt.compare(password, user.password_hash);
                if (!isValidPassword) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
                const token = jwt.sign(
                    { userId: user.id, email: user.email, role: user.role },
                    process.env.JWT_SECRET,
                    { expiresIn: '24h' }
                );
                res.json({
                    message: 'Login successful',
                    user: {
                        id: user.id,
                        email: user.email,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        role: user.role
                    },
                    token
                });
            }

        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Login failed' });
        }
    }

    async handleRefreshToken(req, res) {
        try {
            const { token } = req.body;

            if (!token) {
                return res.status(400).json({ error: 'Token is required' });
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const newToken = jwt.sign(
                { userId: decoded.userId, email: decoded.email, role: decoded.role },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.json({ token: newToken });

        } catch (error) {
            console.error('Token refresh error:', error);
            res.status(401).json({ error: 'Invalid token' });
        }
    }

    // Conversation handlers
    async handleCreateConversation(req, res) {
        try {
            const { assistantId, threadId } = req.body;
            const userId = req.user.userId;

            if (this.dbDisabled) {
                const convo = { id: uuidv4(), user_id: userId, thread_id: threadId, assistant_id: assistantId, status: 'active', created_at: new Date(), updated_at: new Date() };
                this.memoryStore.conversations.push(convo);
                await this.trackEvent('conversation_created', { conversationId: convo.id, assistantId, userId });
                return res.status(201).json({ message: 'Conversation created successfully', conversation: convo });
            }

            const result = await this.pgPool.query(
                'INSERT INTO conversations (user_id, thread_id, assistant_id) VALUES ($1, $2, $3) RETURNING *',
                [userId, threadId, assistantId]
            );

            // Track analytics
            await this.trackEvent('conversation_created', {
                conversationId: result.rows[0].id,
                assistantId,
                userId
            });

            res.status(201).json({
                message: 'Conversation created successfully',
                conversation: result.rows[0]
            });

        } catch (error) {
            console.error('Create conversation error:', error);
            res.status(500).json({ error: 'Failed to create conversation' });
        }
    }

    async handleGetConversations(req, res) {
        try {
            const userId = req.user.userId;
            const { page = 1, limit = 10 } = req.query;
            const offset = (page - 1) * limit;

            if (this.dbDisabled) {
                const conversations = this.memoryStore.conversations.filter(c => c.user_id === userId).slice(offset, offset + limit);
                res.json({
                    conversations: conversations,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: this.memoryStore.conversations.filter(c => c.user_id === userId).length
                    }
                });
                return;
            }

            const result = await this.pgPool.query(
                `SELECT c.*, 
                        COUNT(m.id) as message_count,
                        MAX(m.created_at) as last_message_at
                 FROM conversations c
                 LEFT JOIN messages m ON c.id = m.conversation_id
                 WHERE c.user_id = $1
                 GROUP BY c.id
                 ORDER BY c.updated_at DESC
                 LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            );

            res.json({
                conversations: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: result.rows.length
                }
            });

        } catch (error) {
            console.error('Get conversations error:', error);
            res.status(500).json({ error: 'Failed to get conversations' });
        }
    }

    async handleGetConversation(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.userId;

            if (this.dbDisabled) {
                const conversation = this.memoryStore.conversations.find(c => c.id === id);
                if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
                const messages = this.memoryStore.messages.filter(m => m.conversation_id === id).sort((a, b) => a.created_at - b.created_at);
                return res.json({ conversation, messages });
            }

            // Get conversation
            const conversationResult = await this.pgPool.query(
                'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
                [id, userId]
            );

            if (conversationResult.rows.length === 0) {
                return res.status(404).json({ error: 'Conversation not found' });
            }

            // Get messages
            const messagesResult = await this.pgPool.query(
                'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
                [id]
            );

            res.json({
                conversation: conversationResult.rows[0],
                messages: messagesResult.rows
            });

        } catch (error) {
            console.error('Get conversation error:', error);
            res.status(500).json({ error: 'Failed to get conversation' });
        }
    }

    async handleAddMessage(req, res) {
        try {
            const { id } = req.params;
            const { role, content, metadata } = req.body;
            const userId = req.user.userId;

            if (this.dbDisabled) {
                const convo = this.memoryStore.conversations.find(c => c.id === id);
                if (!convo) return res.status(404).json({ error: 'Conversation not found' });
                const msg = { id: uuidv4(), conversation_id: id, role, content, metadata: metadata || null, created_at: new Date() };
                this.memoryStore.messages.push(msg);
                convo.updated_at = new Date();
                await this.trackEvent('message_sent', { conversationId: id, role, messageLength: content.length, userId });
                return res.status(201).json({ message: 'Message added successfully', message: msg });
            }

            // Verify conversation belongs to user
            const conversationResult = await this.pgPool.query(
                'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
                [id, userId]
            );

            if (conversationResult.rows.length === 0) {
                return res.status(404).json({ error: 'Conversation not found' });
            }

            // Add message
            const result = await this.pgPool.query(
                'INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, $2, $3, $4) RETURNING *',
                [id, role, content, metadata]
            );

            // Update conversation timestamp
            await this.pgPool.query(
                'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                [id]
            );

            // Track analytics
            await this.trackEvent('message_sent', {
                conversationId: id,
                role,
                messageLength: content.length,
                userId
            });

            res.status(201).json({
                message: 'Message added successfully',
                message: result.rows[0]
            });

        } catch (error) {
            console.error('Add message error:', error);
            res.status(500).json({ error: 'Failed to add message' });
        }
    }

    // Lead handlers
    async handleCreateLead(req, res) {
        try {
            const {
                conversationId,
                firstName,
                lastName,
                email,
                phone,
                originAddress,
                destinationAddress,
                moveDate,
                serviceType
            } = req.body;

            if (this.dbDisabled) {
                const distance = await this.calculateDistance(originAddress, destinationAddress);
                const estimatedCost = await this.calculateQuote({ distance, serviceType, moveDate });
                const lead = { id: uuidv4(), conversation_id: conversationId || null, first_name: firstName, last_name: lastName, email, phone, origin_address: originAddress, destination_address: destinationAddress, move_date: moveDate, service_type: serviceType, estimated_distance: distance, estimated_cost: estimatedCost, status: 'new', created_at: new Date(), updated_at: new Date() };
                this.memoryStore.leads.push(lead);
                await this.trackEvent('lead_created', { leadId: lead.id, conversationId, serviceType, estimatedCost });
                await this.sendLeadNotifications({ first_name: firstName, last_name: lastName });
                return res.status(201).json({ message: 'Lead created successfully', lead });
            }

            // Calculate distance and estimate
            const distance = await this.calculateDistance(originAddress, destinationAddress);
            const estimatedCost = await this.calculateQuote({
                distance,
                serviceType,
                moveDate
            });

            const result = await this.pgPool.query(
                `INSERT INTO leads (
                    conversation_id, first_name, last_name, email, phone,
                    origin_address, destination_address, move_date, service_type,
                    estimated_distance, estimated_cost
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                [
                    conversationId, firstName, lastName, email, phone,
                    originAddress, destinationAddress, moveDate, serviceType,
                    distance, estimatedCost
                ]
            );

            // Track analytics
            await this.trackEvent('lead_created', {
                leadId: result.rows[0].id,
                conversationId,
                serviceType,
                estimatedCost
            });

            // Send notifications (implement your notification logic here)
            await this.sendLeadNotifications(result.rows[0]);

            res.status(201).json({
                message: 'Lead created successfully',
                lead: result.rows[0]
            });

        } catch (error) {
            console.error('Create lead error:', error);
            res.status(500).json({ error: 'Failed to create lead' });
        }
    }

    async handleGetLeads(req, res) {
        try {
            const { status, page = 1, limit = 20 } = req.query;
            const offset = (page - 1) * limit;

            if (this.dbDisabled) {
                const leads = this.memoryStore.leads.filter(l => status ? l.status === status : true).slice(offset, offset + limit);
                res.json({
                    leads: leads,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: this.memoryStore.leads.filter(l => status ? l.status === status : true).length
                    }
                });
                return;
            }

            let query = 'SELECT * FROM leads';
            let params = [];
            let paramCount = 0;

            if (status) {
                paramCount++;
                query += ` WHERE status = $${paramCount}`;
                params.push(status);
            }

            query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            params.push(limit, offset);

            const result = await this.pgPool.query(query, params);

            res.json({
                leads: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: result.rows.length
                }
            });

        } catch (error) {
            console.error('Get leads error:', error);
            res.status(500).json({ error: 'Failed to get leads' });
        }
    }

    async handleUpdateLead(req, res) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            if (this.dbDisabled) {
                const lead = this.memoryStore.leads.find(l => l.id === id);
                if (!lead) return res.status(404).json({ error: 'Lead not found' });
                lead.status = updateData.status;
                lead.notes = updateData.notes;
                lead.updated_at = new Date();
                return res.json({ message: 'Lead updated successfully', lead });
            }

            const result = await this.pgPool.query(
                'UPDATE leads SET status = $1, notes = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
                [updateData.status, updateData.notes, id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Lead not found' });
            }

            res.json({
                message: 'Lead updated successfully',
                lead: result.rows[0]
            });

        } catch (error) {
            console.error('Update lead error:', error);
            res.status(500).json({ error: 'Failed to update lead' });
        }
    }

    async handleAssignLead(req, res) {
        try {
            const { id } = req.params;
            const { assignedTo } = req.body;

            if (this.dbDisabled) {
                const lead = this.memoryStore.leads.find(l => l.id === id);
                if (!lead) return res.status(404).json({ error: 'Lead not found' });
                lead.assigned_to = assignedTo;
                lead.updated_at = new Date();
                return res.json({ message: 'Lead assigned successfully', lead });
            }

            const result = await this.pgPool.query(
                'UPDATE leads SET assigned_to = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
                [assignedTo, id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Lead not found' });
            }

            res.json({
                message: 'Lead assigned successfully',
                lead: result.rows[0]
            });

        } catch (error) {
            console.error('Assign lead error:', error);
            res.status(500).json({ error: 'Failed to assign lead' });
        }
    }

    // Analytics handlers
    async handleTrackEvent(req, res) {
        try {
            const { eventType, eventData, userId, conversationId } = req.body;

            await this.trackEvent(eventType, eventData, userId, conversationId);

            res.json({ message: 'Event tracked successfully' });

        } catch (error) {
            console.error('Track event error:', error);
            res.status(500).json({ error: 'Failed to track event' });
        }
    }

    async handleGetAnalytics(req, res) {
        try {
            const { startDate, endDate, eventType } = req.query;

            if (this.dbDisabled) {
                const analytics = this.memoryStore.analytics.filter(a => {
                    const date = new Date(a.created_at).toISOString().split('T')[0];
                    const matchesDate = startDate && date === startDate;
                    const matchesEventType = eventType && a.event_type === eventType;
                    return matchesDate || matchesEventType;
                }).slice(0, 100); // Limit to 100 for memory store
                res.json({
                    analytics: analytics,
                    summary: await this.getAnalyticsSummary(startDate, endDate)
                });
                return;
            }

            let query = 'SELECT * FROM analytics WHERE 1=1';
            let params = [];
            let paramCount = 0;

            if (startDate) {
                paramCount++;
                query += ` AND created_at >= $${paramCount}`;
                params.push(startDate);
            }

            if (endDate) {
                paramCount++;
                query += ` AND created_at <= $${paramCount}`;
                params.push(endDate);
            }

            if (eventType) {
                paramCount++;
                query += ` AND event_type = $${paramCount}`;
                params.push(eventType);
            }

            query += ' ORDER BY created_at DESC';

            const result = await this.pgPool.query(query, params);

            res.json({
                analytics: result.rows,
                summary: await this.getAnalyticsSummary(startDate, endDate)
            });

        } catch (error) {
            console.error('Get analytics error:', error);
            res.status(500).json({ error: 'Failed to get analytics' });
        }
    }

    // Utility methods
    async trackEvent(eventType, eventData, userId = null, conversationId = null) {
        try {
            if (this.dbDisabled) {
                this.memoryStore.analytics.push({ id: uuidv4(), event_type: eventType, event_data: eventData, user_id: userId, conversation_id: conversationId, created_at: new Date() });
                return;
            }
            await this.pgPool.query(
                'INSERT INTO analytics (event_type, event_data, user_id, conversation_id) VALUES ($1, $2, $3, $4)',
                [eventType, eventData, userId, conversationId]
            );

            // Cache analytics data in Redis for quick access
            if (this.redis) {
                const cacheKey = `analytics:${eventType}:${new Date().toISOString().split('T')[0]}`;
                await this.redis.incr(cacheKey);
                await this.redis.expire(cacheKey, 86400); // 24 hours
            }

        } catch (error) {
            console.error('Track event error:', error);
        }
    }

    async getAnalyticsSummary(startDate, endDate) {
        try {
            if (this.dbDisabled) {
                const summary = this.memoryStore.analytics.filter(a => {
                    const date = new Date(a.created_at).toISOString().split('T')[0];
                    const matchesDate = startDate && date === startDate;
                    const matchesEndDate = endDate && date === endDate;
                    return (matchesDate || matchesEndDate) && a.event_type;
                }).reduce((acc, curr) => {
                    const date = new Date(curr.created_at).toISOString().split('T')[0];
                    if (!acc[date]) acc[date] = {};
                    acc[date][curr.event_type] = (acc[date][curr.event_type] || 0) + 1;
                    return acc;
                }, {});
                return Object.entries(summary).map(([date, events]) => ({ date, ...events }));
            }

            const result = await this.pgPool.query(
                `SELECT 
                    event_type,
                    COUNT(*) as count,
                    DATE(created_at) as date
                FROM analytics 
                WHERE created_at >= $1 AND created_at <= $2
                GROUP BY event_type, DATE(created_at)
                ORDER BY date DESC, count DESC`,
                [startDate || '2024-01-01', endDate || new Date().toISOString()]
            );

            return result.rows;
        } catch (error) {
            console.error('Get analytics summary error:', error);
            return [];
        }
    }

    async calculateDistance(origin, destination) {
        try {
            // Use Google Maps API or similar service
            const response = await axios.get(
                `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${process.env.GOOGLE_MAPS_API_KEY}`
            );

            if (response.data.rows[0].elements[0].status === 'OK') {
                return response.data.rows[0].elements[0].distance.value / 1000; // Convert to km
            }

            return 0;
        } catch (error) {
            console.error('Calculate distance error:', error);
            return 0;
        }
    }

    async calculateQuote({ distance, serviceType, moveDate }) {
        try {
            // Base rates per km
            const baseRates = {
                'full-service': 2.5,
                'pack-and-move': 2.0,
                'labor-and-truck': 1.5,
                'labor-only': 0.5,
                'specialty': 3.0
            };

            let baseCost = distance * (baseRates[serviceType] || 2.0);

            // Seasonal pricing adjustments
            const moveMonth = new Date(moveDate).getMonth();
            const seasonalMultiplier = this.getSeasonalMultiplier(moveMonth);
            baseCost *= seasonalMultiplier;

            // Minimum cost
            const minimumCost = 500;
            return Math.max(baseCost, minimumCost);

        } catch (error) {
            console.error('Calculate quote error:', error);
            return 500; // Default minimum
        }
    }

    getSeasonalMultiplier(month) {
        // Peak season (May-September): 1.2x
        // Off-peak season (October-April): 0.9x
        const peakMonths = [4, 5, 6, 7, 8]; // May-September
        return peakMonths.includes(month) ? 1.2 : 0.9;
    }

    async sendLeadNotifications(lead) {
        try {
            // Send email notification
            // Implement your email service integration here

            // Send Slack notification
            // Implement your Slack integration here

            // Send SMS notification
            // Implement your SMS service integration here

            console.log(`📧 Lead notification sent for: ${lead.first_name} ${lead.last_name}`);
        } catch (error) {
            console.error('Send notifications error:', error);
        }
    }

    // Admin handlers
    async handleGetDashboard(req, res) {
        try {
            if (this.dbDisabled) {
                const totalLeads = this.memoryStore.leads.length;
                const activeConversations = this.memoryStore.conversations.filter(c => c.status === 'active').length;
                const recentLeads = this.memoryStore.leads.slice(0, 5);
                const analytics = this.memoryStore.analytics.slice(0, 100); // Limit for memory store
                res.json({
                    dashboard: {
                        totalLeads: totalLeads,
                        activeConversations: activeConversations,
                        recentLeads: recentLeads,
                        analytics: analytics
                    }
                });
                return;
            }

            const [
                totalLeads,
                activeConversations,
                recentLeads,
                analytics
            ] = await Promise.all([
                this.pgPool.query('SELECT COUNT(*) FROM leads'),
                this.pgPool.query('SELECT COUNT(*) FROM conversations WHERE status = $1', ['active']),
                this.pgPool.query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 5'),
                this.getAnalyticsSummary()
            ]);

            res.json({
                dashboard: {
                    totalLeads: parseInt(totalLeads.rows[0].count),
                    activeConversations: parseInt(activeConversations.rows[0].count),
                    recentLeads: recentLeads.rows,
                    analytics: analytics
                }
            });

        } catch (error) {
            console.error('Get dashboard error:', error);
            res.status(500).json({ error: 'Failed to get dashboard' });
        }
    }

    async handleGetAllConversations(req, res) {
        try {
            const { page = 1, limit = 20 } = req.query;
            const offset = (page - 1) * limit;

            if (this.dbDisabled) {
                const conversations = this.memoryStore.conversations.slice(offset, offset + limit);
                res.json({
                    conversations: conversations,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: this.memoryStore.conversations.length
                    }
                });
                return;
            }

            const result = await this.pgPool.query(
                `SELECT c.*, u.email as user_email, COUNT(m.id) as message_count
                 FROM conversations c
                 LEFT JOIN users u ON c.user_id = u.id
                 LEFT JOIN messages m ON c.id = m.conversation_id
                 GROUP BY c.id, u.email
                 ORDER BY c.updated_at DESC
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            );

            res.json({
                conversations: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: result.rows.length
                }
            });

        } catch (error) {
            console.error('Get all conversations error:', error);
            res.status(500).json({ error: 'Failed to get conversations' });
        }
    }

    // Quote calculation endpoint
    async handleCalculateQuote(req, res) {
        try {
            const { originAddress, destinationAddress, serviceType, moveDate } = req.body;

            if (this.dbDisabled) {
                const distance = await this.calculateDistance(originAddress, destinationAddress);
                const estimatedCost = await this.calculateQuote({ distance, serviceType, moveDate });
                res.json({
                    distance: distance.toFixed(2),
                    estimatedCost: estimatedCost.toFixed(2),
                    serviceType,
                    moveDate
                });
                return;
            }

            const distance = await this.calculateDistance(originAddress, destinationAddress);
            const estimatedCost = await this.calculateQuote({
                distance,
                serviceType,
                moveDate
            });

            res.json({
                distance: distance.toFixed(2),
                estimatedCost: estimatedCost.toFixed(2),
                serviceType,
                moveDate
            });

        } catch (error) {
            console.error('Calculate quote error:', error);
            res.status(500).json({ error: 'Failed to calculate quote' });
        }
    }

    // Distance calculation endpoint
    async handleCalculateDistance(req, res) {
        try {
            const { origin, destination } = req.body;

            if (this.dbDisabled) {
                const distance = await this.calculateDistance(origin, destination);
                res.json({
                    distance: distance.toFixed(2),
                    origin,
                    destination
                });
                return;
            }

            const distance = await this.calculateDistance(origin, destination);

            res.json({
                distance: distance.toFixed(2),
                origin,
                destination
            });

        } catch (error) {
            console.error('Calculate distance error:', error);
            res.status(500).json({ error: 'Failed to calculate distance' });
        }
    }

    start() {
        this.app.listen(this.port, () => {
            console.log(`✅ Moving Chatbot API running on port ${this.port}`);
            console.log(`📊 Health check: http://localhost:${this.port}/health`);
        });
    }
}

// Start server if run directly
if (require.main === module) {
    const api = new MovingChatbotAPI();
    api.start();
}

module.exports = MovingChatbotAPI; 