import React, { useState, useEffect, useRef } from 'react';
import ChatHeader from './ChatHeader';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import ChatToggle from './ChatToggle';
import LeadForm from './LeadForm';
import './ChatbotWidget.css';

const ChatbotWidget = ({ config }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [isTyping, setIsTyping] = useState(false);
    const [showLeadForm, setShowLeadForm] = useState(false);
    const [conversationId, setConversationId] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);

    const [streamBuffer, setStreamBuffer] = useState('');
    const wsRef = useRef(null);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    const avatarUrl = config?.branding?.avatarUrl || config?.branding?.logo;

    // Initialize WebSocket connection
    useEffect(() => {
        if (isOpen && !wsRef.current) {
            connectWebSocket();
        }
        
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [isOpen]);

    // Auto-scroll
    useEffect(() => { scrollToBottom(); }, [messages, streamBuffer]);

    // Generate user ID
    useEffect(() => {
        if (!userId) setUserId('user_' + Math.random().toString(36).substr(2, 9));
    }, [userId]);

    // Create conversation on open
    useEffect(() => {
        if (isOpen && !conversationId) {
            createConversation();
        }
    }, [isOpen]);

    const createConversation = async () => {
        try {
            const res = await fetch(`${config.apiUrl}/api/widget/conversations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assistantId: 'default-assistant' })
            });
            const data = await res.json();
            if (data?.conversation?.id) {
                setConversationId(data.conversation.id);
                // notify WS about context
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        type: 'init',
                        userId,
                        conversationId: data.conversation.id
                    }));
                }
            }
        } catch (e) {
            console.error('❌ Failed to create conversation:', e);
        }
    };

    const connectWebSocket = () => {
        try {
            wsRef.current = new WebSocket(config.websocketUrl);
            
            wsRef.current.onopen = () => {
                setIsConnected(true);
                wsRef.current.send(JSON.stringify({ type: 'init', userId, conversationId }));
            };

            wsRef.current.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            };

            wsRef.current.onclose = () => setIsConnected(false);
            wsRef.current.onerror = () => setIsConnected(false);
        } catch (error) {
            console.error('❌ Failed to connect WebSocket:', error);
        }
    };

    const handleWebSocketMessage = (data) => {
        switch (data.type) {
            case 'bot_stream_start':
                setStreamBuffer('');
                setIsTyping(true);
                addMessage({ id: Date.now(), content: '', sender: 'bot', timestamp: new Date(), streaming: true, metadata: { avatarUrl } });
                break;
            case 'bot_stream_delta': {
                const next = (data.delta || '');
                setStreamBuffer(prev => prev + next);
                setMessages(prev => {
                    const copy = [...prev];
                    for (let i = copy.length - 1; i >= 0; i--) {
                        if (copy[i].sender === 'bot' && copy[i].streaming) {
                            copy[i] = { ...copy[i], content: (copy[i].content || '') + next };
                            break;
                        }
                    }
                    return copy;
                });
                break; }
            case 'bot_stream_end':
                setMessages(prev => {
                    const copy = [...prev];
                    for (let i = copy.length - 1; i >= 0; i--) {
                        if (copy[i].sender === 'bot' && copy[i].streaming) {
                            copy[i] = { ...copy[i], streaming: false };
                            break;
                        }
                    }
                    return copy;
                });
                setIsTyping(false);
                setStreamBuffer('');
                break;
            case 'typing_indicator':
                setIsTyping(!!data.isTyping);
                break;
            case 'lead_form_request':
                setShowLeadForm(true);
                break;
            case 'conversation_created':
                setConversationId(data.conversationId);
                break;
            default:
                if (data.type === 'bot_message' && data.content) {
                    addMessage({ id: Date.now(), content: data.content, sender: 'bot', timestamp: new Date(), metadata: { avatarUrl } });
                    setIsTyping(false);
                }
        }
    };

    const addMessage = (message) => setMessages(prev => [...prev, message]);

    const sendMessage = async (content) => {
        if (!content.trim()) return;

        addMessage({ id: Date.now(), content: content.trim(), sender: 'user', timestamp: new Date() });
        setIsTyping(true);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'chat_message',
                content: content.trim(),
                userId,
                conversationId
            }));
        }

        try {
            if (conversationId) {
                fetch(`${config.apiUrl}/api/widget/conversations/${conversationId}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: 'user', content: content.trim() })
                }).catch(() => {});
            }
        } catch {}

        if (inputRef.current) inputRef.current.value = '';
    };

    const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); };

    const toggleChat = () => {
        setIsOpen(!isOpen);
        if (!isOpen && messages.length === 0) {
            addMessage({ id: Date.now(), content: config.branding.welcomeMessage, sender: 'bot', timestamp: new Date(), isWelcome: true, metadata: { avatarUrl } });
        }
    };

    const minimizeChat = () => setIsMinimized(true);
    const maximizeChat = () => setIsMinimized(false);

    const handleLeadSubmit = (leadData) => {
        fetch(`${config.apiUrl}/api/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...leadData, conversationId, source: 'chatbot' })
        })
        .then(r => r.json())
        .then(() => {
            addMessage({ id: Date.now(), content: 'Thank you! Our team will contact you within 24 hours.', sender: 'bot', timestamp: new Date(), isLeadSubmitted: true, metadata: { avatarUrl } });
            setShowLeadForm(false);
        })
        .catch(err => console.error('❌ Failed to submit lead:', err));
    };

    return (
        <div className="chatbot-widget" style={{ '--primary-color': config.theme.primaryColor }}>
            {isOpen && (
                <div className={`chatbot-container ${isMinimized ? 'minimized' : ''}`}>
                    <ChatHeader 
                        config={{ ...config, branding: { ...config.branding, logo: avatarUrl } }}
                        isConnected={isConnected}
                        onMinimize={minimizeChat}
                        onClose={() => setIsOpen(false)}
                    />
                    
                    {!isMinimized && (
                        <>
                            <ChatMessages 
                                messages={messages}
                                isTyping={isTyping}
                                messagesEndRef={messagesEndRef}
                            />
                            
                            {showLeadForm ? (
                                <LeadForm onSubmit={handleLeadSubmit} onCancel={() => setShowLeadForm(false)} />
                            ) : (
                                <ChatInput onSendMessage={sendMessage} isTyping={isTyping} inputRef={inputRef} config={config} />
                            )}
                        </>
                    )}
                </div>
            )}
            
            <ChatToggle 
                isOpen={isOpen}
                onToggle={toggleChat}
                config={{ ...config, branding: { ...config.branding, logo: avatarUrl } }}
                isMinimized={isMinimized}
                onMaximize={maximizeChat}
            />
        </div>
    );
};

export default ChatbotWidget; 