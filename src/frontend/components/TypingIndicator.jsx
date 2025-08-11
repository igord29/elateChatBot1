import React from 'react';
import './TypingIndicator.css';

const TypingIndicator = () => {
    return (
        <div className="message-wrapper bot">
            <div className="message-bubble bot">
                <div className="message-avatar">
                    <img 
                        src="https://via.placeholder.com/32x32/2563eb/ffffff?text=D" 
                        alt="Dave"
                        className="avatar-image"
                    />
                </div>
                <div className="message-content">
                    <div className="typing-indicator">
                        <div className="typing-dots">
                            <div className="dot"></div>
                            <div className="dot"></div>
                            <div className="dot"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TypingIndicator; 