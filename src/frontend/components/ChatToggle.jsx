import React from 'react';
import './ChatToggle.css';

const ChatToggle = ({ isOpen, onToggle, config, isMinimized, onMaximize }) => {
    const getToggleContent = () => {
        if (isMinimized) {
            return (
                <div className="minimized-toggle" onClick={onMaximize}>
                    <div className="minimized-content">
                        <img 
                            src={config.branding.logo} 
                            alt={config.branding.companyName}
                            className="minimized-logo"
                        />
                        <span className="minimized-text">Chat</span>
                    </div>
                </div>
            );
        }

        return (
            <div className="chat-toggle" onClick={onToggle}>
                <div className="toggle-content">
                    {isOpen ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    ) : (
                        <>
                            <div className="toggle-avatar">
                                <img 
                                    src={config.branding.logo} 
                                    alt={config.branding.companyName}
                                    className="avatar-image"
                                />
                                <div className="notification-badge">
                                    <span>1</span>
                                </div>
                            </div>
                            <div className="toggle-text">
                                <span className="company-name">{config.branding.companyName}</span>
                                <span className="status-text">Chat with us</span>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className={`chat-toggle-container ${isOpen ? 'open' : ''} ${isMinimized ? 'minimized' : ''}`}>
            {getToggleContent()}
        </div>
    );
};

export default ChatToggle; 