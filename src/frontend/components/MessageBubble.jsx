import React from 'react';
import './MessageBubble.css';

const MessageBubble = ({ 
    content, 
    sender, 
    timestamp, 
    isWelcome, 
    isLeadSubmitted, 
    metadata 
}) => {
    const isBot = sender === 'bot';
    const avatar = metadata?.avatarUrl || 'https://via.placeholder.com/32x32/2563eb/ffffff?text=D';
    
    const renderContent = () => {
        // Handle different message types
        if (isWelcome) {
            return (
                <div className="welcome-message">
                    <div className="welcome-icon">👋</div>
                    <div className="welcome-text">{content}</div>
                </div>
            );
        }
        
        if (isLeadSubmitted) {
            return (
                <div className="success-message">
                    <div className="success-icon">✅</div>
                    <div className="success-text">{content}</div>
                </div>
            );
        }
        
        // Handle structured messages with metadata
        if (metadata && metadata.type) {
            switch (metadata.type) {
                case 'quick_replies':
                    return (
                        <div className="quick-replies">
                            <div className="message-text">{content}</div>
                            <div className="quick-reply-buttons">
                                {metadata.options?.map((option, index) => (
                                    <button key={index} className="quick-reply-btn">
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                    
                case 'quote_estimate':
                    return (
                        <div className="quote-message">
                            <div className="quote-header">
                                <span className="quote-icon">💰</span>
                                <span className="quote-title">Moving Estimate</span>
                            </div>
                            <div className="quote-details">
                                <div className="quote-item">
                                    <span className="quote-label">Distance:</span>
                                    <span className="quote-value">{metadata.distance} miles</span>
                                </div>
                                <div className="quote-item">
                                    <span className="quote-label">Service:</span>
                                    <span className="quote-value">{metadata.serviceType}</span>
                                </div>
                                <div className="quote-item total">
                                    <span className="quote-label">Estimated Cost:</span>
                                    <span className="quote-value">${metadata.estimatedCost}</span>
                                </div>
                            </div>
                        </div>
                    );
                    
                case 'lead_form_request':
                    return (
                        <div className="lead-form-request">
                            <div className="message-text">{content}</div>
                            <button className="lead-form-btn">
                                Fill Out Form
                            </button>
                        </div>
                    );
                    
                default:
                    return <div className="message-text">{content}</div>;
            }
        }
        
        return <div className="message-text">{content}</div>;
    };

    return (
        <div className={`message-bubble ${isBot ? 'bot' : 'user'}`}>
            {isBot && (
                <div className="message-avatar">
                    <img 
                        src={avatar}
                        alt="Agent"
                        className="avatar-image"
                    />
                </div>
            )}
            
            <div className="message-content">
                {renderContent()}
                <div className="message-timestamp">{timestamp}</div>
            </div>
            
            {!isBot && (
                <div className="message-status">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20,6 9,17 4,12"></polyline>
                    </svg>
                </div>
            )}
        </div>
    );
};

export default MessageBubble; 