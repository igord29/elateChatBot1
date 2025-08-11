import React from 'react';
import ReactDOM from 'react-dom';
import ChatbotWidget from './components/ChatbotWidget';
import './styles/chatbot.css';

class ElateChatbotClass {
    constructor() {
        this.config = null;
        this.widget = null;
    }

    init(config = {}) {
        this.config = {
            apiUrl: 'http://localhost:3000',
            websocketUrl: 'ws://localhost:3001',
            theme: {
                // Elate colors
                primaryColor: '#FD7400',     // accent
                secondaryColor: '#1B242D',   // main
                backgroundColor: '#ffffff',
                textColor: '#1B242D',
                borderRadius: '12px',
                shadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
            },
            branding: {
                companyName: 'Elate Moving',
                logo: 'https://via.placeholder.com/40x40/2563eb/ffffff?text=EM',
                welcomeMessage: 'Hi! I\'m Dave from Elate Moving. How can I help you today?'
            },
            features: {
                fileUpload: true,
                voiceMessages: false,
                typingIndicator: true,
                readReceipts: true
            },
            ...config
        };

        this.renderWidget();
        console.log('🚀 Elate Moving Chatbot initialized');
    }

    renderWidget() {
        const container = document.getElementById('chatbot-container');
        if (!container) {
            console.error('❌ Chatbot container not found');
            return;
        }

        ReactDOM.render(
            <ChatbotWidget config={this.config} />,
            container
        );
    }

    destroy() {
        const container = document.getElementById('chatbot-container');
        if (container) {
            ReactDOM.unmountComponentAtNode(container);
        }
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.renderWidget();
    }
}

// Create a singleton instance and expose it globally
const ElateChatbot = new ElateChatbotClass();
if (typeof window !== 'undefined') {
    window.ElateChatbot = ElateChatbot;
}

export default ElateChatbot; 