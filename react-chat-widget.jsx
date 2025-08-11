import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiMessageCircle, FiX, FiSend, FiUser, FiBot } from 'react-icons/fi';

const ChatWidget = ({ 
    apiKey, 
    assistantId, 
    websocketUrl = 'ws://localhost:3001',
    theme = 'default',
    position = 'bottom-right',
    initialMessage = "Hi! I'm Dave from Elate Moving. Ready to make your move stress-free?",
    onLeadSubmit,
    onError
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionId, setConnectionId] = useState(null);
    const [threadId, setThreadId] = useState(null);
    const [showLeadForm, setShowLeadForm] = useState(false);
    const [leadData, setLeadData] = useState({});
    
    const wsRef = useRef(null);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);

    // Initialize chat
    useEffect(() => {
        if (isOpen && !threadId) {
            initializeChat();
        }
    }, [isOpen]);

    // WebSocket connection
    useEffect(() => {
        if (isOpen) {
            connectWebSocket();
        } else {
            disconnectWebSocket();
        }

        return () => {
            disconnectWebSocket();
        };
    }, [isOpen]);

    // Auto-scroll to bottom
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const initializeChat = async () => {
        try {
            console.log('🚀 Initializing chat...');
            
            // Create OpenAI thread
            const response = await fetch('https://api.openai.com/v1/threads', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'OpenAI-Beta': 'assistants=v2'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to create thread: ${response.status}`);
            }

            const thread = await response.json();
            setThreadId(thread.id);
            
            // Add initial message
            addMessage(initialMessage, 'bot', 'Dave');
            
            console.log('✅ Chat initialized successfully');
        } catch (error) {
            console.error('❌ Chat initialization failed:', error);
            onError?.(error);
        }
    };

    const connectWebSocket = () => {
        try {
            console.log('🔌 Connecting to WebSocket...');
            
            wsRef.current = new WebSocket(websocketUrl);
            
            wsRef.current.onopen = () => {
                console.log('✅ WebSocket connected');
                setIsConnected(true);
                
                // Send connection message
                wsRef.current.send(JSON.stringify({
                    type: 'connection_established',
                    timestamp: new Date().toISOString()
                }));
            };

            wsRef.current.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleWebSocketMessage(data);
                } catch (error) {
                    console.error('❌ Error parsing WebSocket message:', error);
                }
            };

            wsRef.current.onclose = () => {
                console.log('🔌 WebSocket disconnected');
                setIsConnected(false);
                
                // Attempt reconnection
                if (isOpen) {
                    reconnectTimeoutRef.current = setTimeout(() => {
                        console.log('🔄 Attempting to reconnect...');
                        connectWebSocket();
                    }, 3000);
                }
            };

            wsRef.current.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                setIsConnected(false);
            };

        } catch (error) {
            console.error('❌ WebSocket connection failed:', error);
        }
    };

    const disconnectWebSocket = () => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
    };

    const handleWebSocketMessage = (data) => {
        switch (data.type) {
            case 'connection_established':
                setConnectionId(data.connectionId);
                break;
            case 'admin_message':
                addMessage(data.content, 'admin', data.adminName);
                break;
            case 'lead_submitted':
                addMessage(data.message, 'bot', 'Dave');
                break;
            case 'error':
                console.error('WebSocket error:', data.message);
                onError?.(new Error(data.message));
                break;
            default:
                console.warn('Unknown WebSocket message type:', data.type);
        }
    };

    const sendMessage = async (content) => {
        if (!content.trim() || isTyping) return;

        const userMessage = content.trim();
        setInputValue('');
        addMessage(userMessage, 'user');

        // Send to WebSocket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'chat_message',
                content: userMessage,
                timestamp: new Date().toISOString()
            }));
        }

        // Send to OpenAI
        await sendToOpenAI(userMessage);
    };

    const sendToOpenAI = async (content) => {
        if (!threadId) return;

        setIsTyping(true);

        try {
            // Add message to thread
            await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'OpenAI-Beta': 'assistants=v2'
                },
                body: JSON.stringify({
                    role: 'user',
                    content
                })
            });

            // Run assistant
            const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'OpenAI-Beta': 'assistants=v2'
                },
                body: JSON.stringify({
                    assistant_id: assistantId
                })
            });

            const run = await runResponse.json();
            
            // Poll for completion
            await pollRunStatus(run.id);

        } catch (error) {
            console.error('❌ Error sending to OpenAI:', error);
            addMessage('Sorry, I encountered an error. Please try again.', 'bot', 'Dave');
            onError?.(error);
        } finally {
            setIsTyping(false);
        }
    };

    const pollRunStatus = async (runId) => {
        const maxAttempts = 30;
        let attempts = 0;

        while (attempts < maxAttempts) {
            try {
                const response = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'OpenAI-Beta': 'assistants=v2'
                    }
                });

                const run = await response.json();

                if (run.status === 'completed') {
                    // Get the latest message
                    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'OpenAI-Beta': 'assistants=v2'
                        }
                    });

                    const messagesData = await messagesResponse.json();
                    const latestMessage = messagesData.data[0];

                    if (latestMessage && latestMessage.content[0]?.text?.value) {
                        const botResponse = latestMessage.content[0].text.value;
                        addMessage(botResponse, 'bot', 'Dave');
                        
                        // Check for form trigger
                        checkForFormTrigger(botResponse);
                    }
                    break;
                } else if (run.status === 'failed') {
                    throw new Error('Assistant run failed');
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            } catch (error) {
                console.error('❌ Error polling run status:', error);
                break;
            }
        }
    };

    const checkForFormTrigger = (message) => {
        const triggerPhrases = [
            "let me get the specific details",
            "run through our quote process",
            "need to get some specifics",
            "ask you a few specific questions"
        ];

        const shouldShowForm = triggerPhrases.some(phrase => 
            message.toLowerCase().includes(phrase)
        );

        if (shouldShowForm) {
            setTimeout(() => {
                setShowLeadForm(true);
            }, 1000);
        }
    };

    const addMessage = (content, type, sender = '') => {
        const newMessage = {
            id: Date.now() + Math.random(),
            content,
            type,
            sender,
            timestamp: new Date().toISOString()
        };

        setMessages(prev => [...prev, newMessage]);
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        sendMessage(inputValue);
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(inputValue);
        }
    };

    const handleLeadSubmit = async (formData) => {
        try {
            // Send to WebSocket
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: 'lead_submission',
                    data: formData,
                    timestamp: new Date().toISOString()
                }));
            }

            // Call parent callback
            onLeadSubmit?.(formData);

            setShowLeadForm(false);
            addMessage('Thank you! Our team will contact you within 24 hours.', 'bot', 'Dave');

        } catch (error) {
            console.error('❌ Error submitting lead:', error);
            onError?.(error);
        }
    };

    const getThemeStyles = () => {
        const themes = {
            default: {
                primary: '#007bff',
                secondary: '#6c757d',
                background: '#ffffff',
                text: '#333333',
                border: '#e0e0e0'
            },
            dark: {
                primary: '#007bff',
                secondary: '#6c757d',
                background: '#2d3748',
                text: '#ffffff',
                border: '#4a5568'
            },
            moving: {
                primary: '#28a745',
                secondary: '#6c757d',
                background: '#ffffff',
                text: '#333333',
                border: '#e0e0e0'
            }
        };

        return themes[theme] || themes.default;
    };

    const styles = getThemeStyles();

    return (
        <div className={`chat-widget-container ${position}`}>
            {/* Chat Toggle Button */}
            <motion.button
                className="chat-toggle-btn"
                onClick={() => setIsOpen(!isOpen)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                style={{
                    backgroundColor: styles.primary,
                    color: '#ffffff'
                }}
            >
                <AnimatePresence mode="wait">
                    {isOpen ? (
                        <motion.div
                            key="close"
                            initial={{ rotate: 0 }}
                            animate={{ rotate: 180 }}
                            exit={{ rotate: 0 }}
                        >
                            <FiX size={24} />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="open"
                            initial={{ rotate: 180 }}
                            animate={{ rotate: 0 }}
                            exit={{ rotate: 180 }}
                        >
                            <FiMessageCircle size={24} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.button>

            {/* Chat Window */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        className="chat-window"
                        initial={{ opacity: 0, scale: 0.8, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.8, y: 20 }}
                        transition={{ duration: 0.3 }}
                        style={{
                            backgroundColor: styles.background,
                            border: `1px solid ${styles.border}`
                        }}
                    >
                        {/* Header */}
                        <div 
                            className="chat-header"
                            style={{ backgroundColor: styles.primary, color: '#ffffff' }}
                        >
                            <div className="header-content">
                                <div className="agent-info">
                                    <div className="agent-avatar">
                                        <FiBot size={20} />
                                    </div>
                                    <div>
                                        <h3>Dave - Elate Moving</h3>
                                        <p>Your Moving Specialist</p>
                                    </div>
                                </div>
                                <div className="connection-status">
                                    <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
                                    <span>{isConnected ? 'Online' : 'Offline'}</span>
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="chat-messages">
                            <AnimatePresence>
                                {messages.map((message) => (
                                    <motion.div
                                        key={message.id}
                                        className={`message ${message.type}-message`}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        transition={{ duration: 0.3 }}
                                    >
                                        <div className="message-content">
                                            {message.sender && (
                                                <div className="message-sender">{message.sender}</div>
                                            )}
                                            <div className="message-text">{message.content}</div>
                                            <div className="message-time">
                                                {new Date(message.timestamp).toLocaleTimeString()}
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>

                            {/* Typing Indicator */}
                            <AnimatePresence>
                                {isTyping && (
                                    <motion.div
                                        className="typing-indicator"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                    >
                                        <div className="typing-dots">
                                            <span></span>
                                            <span></span>
                                            <span></span>
                                        </div>
                                        Dave is typing...
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Lead Form */}
                        <AnimatePresence>
                            {showLeadForm && (
                                <motion.div
                                    className="lead-form"
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                >
                                    <LeadForm onSubmit={handleLeadSubmit} />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Input */}
                        {!showLeadForm && (
                            <div className="chat-input-container">
                                <form onSubmit={handleSubmit}>
                                    <div className="input-wrapper">
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            value={inputValue}
                                            onChange={(e) => setInputValue(e.target.value)}
                                            onKeyPress={handleKeyPress}
                                            placeholder="Type your message..."
                                            disabled={isTyping}
                                            style={{
                                                border: `1px solid ${styles.border}`,
                                                color: styles.text
                                            }}
                                        />
                                        <button
                                            type="submit"
                                            disabled={!inputValue.trim() || isTyping}
                                            style={{
                                                backgroundColor: inputValue.trim() ? styles.primary : styles.secondary
                                            }}
                                        >
                                            <FiSend size={16} />
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            <style jsx>{`
                .chat-widget-container {
                    position: fixed;
                    z-index: 1000;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }

                .chat-widget-container.bottom-right {
                    bottom: 20px;
                    right: 20px;
                }

                .chat-widget-container.bottom-left {
                    bottom: 20px;
                    left: 20px;
                }

                .chat-toggle-btn {
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    border: none;
                    cursor: pointer;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s ease;
                }

                .chat-window {
                    position: absolute;
                    bottom: 80px;
                    right: 0;
                    width: 350px;
                    height: 500px;
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .chat-header {
                    padding: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .agent-info {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .agent-avatar {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.2);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .agent-info h3 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
                }

                .agent-info p {
                    margin: 0;
                    font-size: 12px;
                    opacity: 0.8;
                }

                .connection-status {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                }

                .status-indicator {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    transition: background-color 0.3s ease;
                }

                .status-indicator.connected {
                    background-color: #28a745;
                }

                .status-indicator.disconnected {
                    background-color: #dc3545;
                }

                .chat-messages {
                    flex: 1;
                    padding: 16px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .message {
                    max-width: 80%;
                    padding: 12px 16px;
                    border-radius: 18px;
                    word-wrap: break-word;
                }

                .user-message {
                    align-self: flex-end;
                    background-color: #007bff;
                    color: white;
                }

                .bot-message, .admin-message {
                    align-self: flex-start;
                    background-color: #f8f9fa;
                    color: #333;
                    border: 1px solid #e9ecef;
                }

                .admin-message {
                    background-color: #fff3cd;
                    border-color: #ffeaa7;
                }

                .message-sender {
                    font-size: 12px;
                    font-weight: 600;
                    margin-bottom: 4px;
                    opacity: 0.8;
                }

                .message-time {
                    font-size: 10px;
                    opacity: 0.6;
                    margin-top: 4px;
                }

                .typing-indicator {
                    align-self: flex-start;
                    padding: 12px 16px;
                    background-color: #f8f9fa;
                    border-radius: 18px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    color: #6c757d;
                }

                .typing-dots {
                    display: flex;
                    gap: 4px;
                }

                .typing-dots span {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background-color: #6c757d;
                    animation: typing 1.4s infinite;
                }

                .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
                .typing-dots span:nth-child(3) { animation-delay: 0.4s; }

                @keyframes typing {
                    0%, 60%, 100% { transform: translateY(0); }
                    30% { transform: translateY(-6px); }
                }

                .chat-input-container {
                    padding: 16px;
                    border-top: 1px solid #e9ecef;
                }

                .input-wrapper {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }

                .input-wrapper input {
                    flex: 1;
                    padding: 12px 16px;
                    border-radius: 25px;
                    border: 1px solid #ddd;
                    outline: none;
                    font-size: 14px;
                    transition: border-color 0.3s ease;
                }

                .input-wrapper input:focus {
                    border-color: #007bff;
                    box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
                }

                .input-wrapper button {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    border: none;
                    color: white;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s ease;
                }

                .input-wrapper button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .lead-form {
                    padding: 16px;
                    border-top: 1px solid #e9ecef;
                    background-color: #f8f9fa;
                }

                @media (max-width: 480px) {
                    .chat-window {
                        width: calc(100vw - 40px);
                        height: calc(100vh - 120px);
                        bottom: 80px;
                        right: 20px;
                    }
                }
            `}</style>
        </div>
    );
};

// Lead Form Component
const LeadForm = ({ onSubmit }) => {
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        phoneNumber: '',
        email: '',
        originAddress: '',
        destinationAddress: '',
        moveDate: '',
        serviceType: ''
    });

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(formData);
    };

    return (
        <form onSubmit={handleSubmit} className="lead-form-content">
            <h4>Let me get your details for an accurate quote:</h4>
            
            <div className="form-row">
                <div className="form-field">
                    <label>First Name *</label>
                    <input
                        type="text"
                        value={formData.firstName}
                        onChange={(e) => handleChange('firstName', e.target.value)}
                        required
                    />
                </div>
                <div className="form-field">
                    <label>Last Name *</label>
                    <input
                        type="text"
                        value={formData.lastName}
                        onChange={(e) => handleChange('lastName', e.target.value)}
                        required
                    />
                </div>
            </div>

            <div className="form-row">
                <div className="form-field">
                    <label>Phone Number *</label>
                    <input
                        type="tel"
                        value={formData.phoneNumber}
                        onChange={(e) => handleChange('phoneNumber', e.target.value)}
                        required
                    />
                </div>
                <div className="form-field">
                    <label>Email *</label>
                    <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => handleChange('email', e.target.value)}
                        required
                    />
                </div>
            </div>

            <div className="form-field">
                <label>Moving From Address *</label>
                <input
                    type="text"
                    value={formData.originAddress}
                    onChange={(e) => handleChange('originAddress', e.target.value)}
                    required
                />
            </div>

            <div className="form-field">
                <label>Moving To Address *</label>
                <input
                    type="text"
                    value={formData.destinationAddress}
                    onChange={(e) => handleChange('destinationAddress', e.target.value)}
                    required
                />
            </div>

            <div className="form-row">
                <div className="form-field">
                    <label>Move Date *</label>
                    <input
                        type="date"
                        value={formData.moveDate}
                        onChange={(e) => handleChange('moveDate', e.target.value)}
                        required
                    />
                </div>
                <div className="form-field">
                    <label>Service Type *</label>
                    <select
                        value={formData.serviceType}
                        onChange={(e) => handleChange('serviceType', e.target.value)}
                        required
                    >
                        <option value="">Select Service</option>
                        <option value="full-service">Full-Service (Pack, Move, Unpack)</option>
                        <option value="pack-and-move">Pack and Move Only</option>
                        <option value="labor-and-truck">Labor and Truck</option>
                        <option value="labor-only">Labor Only</option>
                        <option value="specialty">Specialty Items</option>
                    </select>
                </div>
            </div>

            <button type="submit" className="submit-btn">
                Get My Quote
            </button>

            <style jsx>{`
                .lead-form-content h4 {
                    margin: 0 0 16px 0;
                    font-size: 16px;
                    color: #333;
                }

                .form-row {
                    display: flex;
                    gap: 12px;
                }

                .form-field {
                    flex: 1;
                    margin-bottom: 12px;
                }

                .form-field label {
                    display: block;
                    margin-bottom: 4px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #333;
                }

                .form-field input,
                .form-field select {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    font-size: 14px;
                    transition: border-color 0.3s ease;
                }

                .form-field input:focus,
                .form-field select:focus {
                    outline: none;
                    border-color: #007bff;
                    box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
                }

                .submit-btn {
                    width: 100%;
                    padding: 12px;
                    background-color: #28a745;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background-color 0.3s ease;
                }

                .submit-btn:hover {
                    background-color: #218838;
                }

                @media (max-width: 480px) {
                    .form-row {
                        flex-direction: column;
                        gap: 0;
                    }
                }
            `}</style>
        </form>
    );
};

export default ChatWidget; 