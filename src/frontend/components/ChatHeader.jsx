import React from 'react';
import './ChatHeader.css';

const ChatHeader = ({ config, isConnected, onMinimize, onClose }) => {
    return (
        <div className="chat-header">
            <div className="chat-header-content">
                <div className="chat-header-info">
                    <div className="chat-avatar">
                        <img 
                            src={config.branding.logo} 
                            alt={config.branding.companyName}
                            className="avatar-image"
                        />
                        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                            <div className="status-dot"></div>
                        </div>
                    </div>
                    
                    <div className="chat-header-text">
                        <h3 className="company-name">{config.branding.companyName}</h3>
                        <p className="status-text">
                            {isConnected ? 'Online' : 'Connecting...'}
                        </p>
                    </div>
                </div>
                
                <div className="chat-header-actions">
                    <button 
                        className="header-action-btn minimize-btn"
                        onClick={onMinimize}
                        title="Minimize"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                        </svg>
                    </button>
                    
                    <button 
                        className="header-action-btn close-btn"
                        onClick={onClose}
                        title="Close"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChatHeader; 