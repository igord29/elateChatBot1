import React, { useState, useRef, useEffect } from 'react';
import './ChatInput.css';

const ChatInput = ({ onSendMessage, isTyping, inputRef, config }) => {
    const [message, setMessage] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [showQuickActions, setShowQuickActions] = useState(false);
    
    const textareaRef = useRef(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
        }
    }, [message]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (message.trim() && !isTyping) {
            onSendMessage(message);
            setMessage('');
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const handleQuickAction = (action) => {
        onSendMessage(action);
        setShowQuickActions(false);
    };

    const quickActions = [
        { label: 'Get a Quote', action: 'I would like to get a quote for my move' },
        { label: 'Schedule Appointment', action: 'I want to schedule an appointment' },
        { label: 'Service Information', action: 'What services do you offer?' },
        { label: 'Pricing', action: 'What are your rates?' }
    ];

    return (
        <div className="chat-input-container">
            {showQuickActions && (
                <div className="quick-actions">
                    <div className="quick-actions-header">
                        <span>Quick Actions</span>
                        <button 
                            className="close-quick-actions"
                            onClick={() => setShowQuickActions(false)}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div className="quick-actions-list">
                        {quickActions.map((action, index) => (
                            <button
                                key={index}
                                className="quick-action-btn"
                                onClick={() => handleQuickAction(action.action)}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            
            <form className="chat-input-form" onSubmit={handleSubmit}>
                <div className={`input-wrapper ${isFocused ? 'focused' : ''}`}>
                    <button
                        type="button"
                        className="quick-actions-toggle"
                        onClick={() => setShowQuickActions(!showQuickActions)}
                        title="Quick Actions"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="1"></circle>
                            <circle cx="19" cy="12" r="1"></circle>
                            <circle cx="5" cy="12" r="1"></circle>
                        </svg>
                    </button>
                    
                    <textarea
                        ref={textareaRef}
                        className="chat-input"
                        placeholder="Type your message..."
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyPress={handleKeyPress}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        disabled={isTyping}
                        rows={1}
                    />
                    
                    <button
                        type="submit"
                        className={`send-button ${message.trim() && !isTyping ? 'active' : ''}`}
                        disabled={!message.trim() || isTyping}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22,2 15,22 11,13 2,9"></polygon>
                        </svg>
                    </button>
                </div>
                
                {isTyping && (
                    <div className="typing-status">
                        <span>Dave is typing...</span>
                    </div>
                )}
            </form>
        </div>
    );
};

export default ChatInput; 