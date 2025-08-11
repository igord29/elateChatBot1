import React from 'react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import './ChatMessages.css';

const ChatMessages = ({ messages, isTyping, messagesEndRef }) => {
    const formatTime = (timestamp) => {
        return new Date(timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    };

    const renderMessage = (message) => {
        return (
            <div key={message.id} className={`message-wrapper ${message.sender}`}>
                <MessageBubble 
                    content={message.content}
                    sender={message.sender}
                    timestamp={formatTime(message.timestamp)}
                    isWelcome={message.isWelcome}
                    isLeadSubmitted={message.isLeadSubmitted}
                    metadata={message.metadata}
                />
            </div>
        );
    };

    return (
        <div className="chat-messages">
            <div className="messages-container">
                {messages.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                        </div>
                        <p className="empty-state-text">Start a conversation</p>
                    </div>
                ) : (
                    <>
                        {messages.map(renderMessage)}
                        {isTyping && <TypingIndicator />}
                    </>
                )}
                <div ref={messagesEndRef} className="messages-end" />
            </div>
        </div>
    );
};

export default ChatMessages; 