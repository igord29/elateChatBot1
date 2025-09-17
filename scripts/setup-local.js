#!/usr/bin/env node

/**
 * Elate Moving Chatbot - Local Development Setup Script
 * This script helps set up the local development environment for testing
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
    log(`✅ ${message}`, 'green');
}

function logWarning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
    log(`❌ ${message}`, 'red');
}

function logInfo(message) {
    log(`ℹ️  ${message}`, 'blue');
}

function logStep(message) {
    log(`\n${colors.bright}${message}${colors.reset}`, 'cyan');
}

// Check if file exists
function fileExists(filePath) {
    return fs.existsSync(filePath);
}

// Create directory if it doesn't exist
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logSuccess(`Created directory: ${dirPath}`);
    }
}

// Copy file if it doesn't exist
function copyFileIfNotExists(source, destination) {
    if (!fileExists(destination)) {
        fs.copyFileSync(source, destination);
        logSuccess(`Created ${destination} from template`);
        return true;
    } else {
        logWarning(`${destination} already exists, skipping`);
        return false;
    }
}

// Check if command is available
function commandExists(command) {
    try {
        execSync(`which ${command}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// Check if running in WSL
function isWSL() {
    try {
        const fs = require('fs');
        return fs.existsSync('/proc/version') && 
               fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
    } catch {
        return false;
    }
}

// Check Node.js version
function checkNodeVersion() {
    const version = process.version;
    const majorVersion = parseInt(version.slice(1).split('.')[0]);
    
    if (majorVersion < 16) {
        logError(`Node.js version ${version} is not supported. Please install Node.js 16 or higher.`);
        process.exit(1);
    }
    
    logSuccess(`Node.js version: ${version}`);
}

// Setup environment file
function setupEnvironmentFile() {
    logStep('Setting up environment configuration...');
    
    const envExamplePath = path.join(__dirname, '..', 'env.example');
    const envPath = path.join(__dirname, '..', '.env');
    
    if (copyFileIfNotExists(envExamplePath, envPath)) {
        logInfo('Please update the .env file with your configuration:');
        logInfo('- Set your OpenAI API key for AI functionality');
        logInfo('- Configure database settings if using PostgreSQL');
        logInfo('- Update Redis settings if using Redis');
    }
}

// Setup directories
function setupDirectories() {
    logStep('Creating necessary directories...');
    
    const directories = [
        'logs',
        'uploads',
        'backups',
        'static',
        'media'
    ];
    
    directories.forEach(dir => {
        ensureDirectoryExists(path.join(__dirname, '..', dir));
    });
}

// Install dependencies
function installDependencies() {
    logStep('Installing dependencies...');
    
    try {
        logInfo('Installing npm dependencies...');
        execSync('npm install', { stdio: 'inherit' });
        logSuccess('Dependencies installed successfully');
    } catch (error) {
        logError('Failed to install dependencies');
        logError(error.message);
        process.exit(1);
    }
}

// Check prerequisites
function checkPrerequisites() {
    logStep('Checking prerequisites...');
    
    // Check Node.js
    checkNodeVersion();
    
    // Check npm
    try {
        const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
        logSuccess(`npm version: ${npmVersion}`);
    } catch (error) {
        logError('npm is not available');
        process.exit(1);
    }
    
    // Check for optional dependencies
    const optionalDeps = [
        { name: 'Docker', command: 'docker' },
        { name: 'PostgreSQL', command: 'psql' },
        { name: 'Redis', command: 'redis-cli' }
    ];
    
    optionalDeps.forEach(dep => {
        if (commandExists(dep.command)) {
            logSuccess(`${dep.name} is available`);
        } else {
            logWarning(`${dep.name} is not available (optional)`);
        }
    });
}

// Create test data
function createTestData() {
    logStep('Setting up test data...');
    
    const testDataPath = path.join(__dirname, '..', 'test-data.json');
    const testData = {
        conversations: [
            {
                id: 'test-conversation-1',
                userId: 'test-user-1',
                messages: [
                    {
                        id: 'msg-1',
                        type: 'user',
                        content: 'Hi, I need help with moving services',
                        timestamp: new Date().toISOString()
                    },
                    {
                        id: 'msg-2',
                        type: 'bot',
                        content: 'Hello! I\'m Dave from Elate Moving. I\'d be happy to help you with your moving needs. What type of move are you planning?',
                        timestamp: new Date().toISOString()
                    }
                ],
                status: 'active',
                createdAt: new Date().toISOString()
            }
        ],
        users: [
            {
                id: 'test-user-1',
                email: 'test@example.com',
                firstName: 'Test',
                lastName: 'User',
                createdAt: new Date().toISOString()
            }
        ]
    };
    
    fs.writeFileSync(testDataPath, JSON.stringify(testData, null, 2));
    logSuccess('Test data created');
}

// Create startup script
function createStartupScript() {
    logStep('Creating startup scripts...');
    
    const scripts = {
        'start-local.bat': `@echo off
echo Starting Elate Moving Chatbot locally...
npm run test:local
pause`,
        'start-local.sh': `#!/bin/bash
echo "Starting Elate Moving Chatbot locally..."
npm run test:local`,
        'start-local-wsl.sh': `#!/bin/bash
echo "🚀 Starting Elate Moving Chatbot in WSL..."
echo "📁 Working directory: $(pwd)"
echo "🔧 Node version: $(node --version)"
echo "📦 NPM version: $(npm --version)"
echo ""
echo "Starting services..."
npm run test:local`
    };
    
    Object.entries(scripts).forEach(([filename, content]) => {
        const filePath = path.join(__dirname, '..', filename);
        fs.writeFileSync(filePath, content);
        
        if (filename.endsWith('.sh')) {
            fs.chmodSync(filePath, '755');
        }
        
        logSuccess(`Created ${filename}`);
    });
}

// Display next steps
function displayNextSteps() {
    logStep('Setup Complete! Next Steps:');
    
    logInfo('1. Update your .env file with your configuration:');
    logInfo('   - Set OPENAI_API_KEY for AI functionality');
    logInfo('   - Configure database settings if needed');
    
    logInfo('2. Start the chatbot locally:');
    logInfo('   - Windows: run start-local.bat');
    logInfo('   - Mac/Linux: run ./start-local.sh');
    logInfo('   - Or manually: npm run test:local');
    
    logInfo('3. Access the chatbot:');
    logInfo('   - Frontend: http://localhost:8080');
    logInfo('   - Backend API: http://localhost:3000');
    logInfo('   - WebSocket: ws://localhost:3001');
    
    logInfo('4. Test the chatbot:');
    logInfo('   - Open http://localhost:8080 in your browser');
    logInfo('   - Start a conversation with the chatbot');
    
    logInfo('5. Monitor logs:');
    logInfo('   - Check the logs/ directory for application logs');
    logInfo('   - Watch console output for real-time debugging');
    
    logWarning('Note: Make sure to set your OpenAI API key in .env for full functionality');
}

// Main setup function
function main() {
    log(`${colors.bright}${colors.cyan}🚀 Elate Moving Chatbot - Local Development Setup${colors.reset}\n`);
    
    try {
        checkPrerequisites();
        setupEnvironmentFile();
        setupDirectories();
        installDependencies();
        createTestData();
        createStartupScript();
        displayNextSteps();
        
        logSuccess('\n🎉 Setup completed successfully!');
        
    } catch (error) {
        logError('\n❌ Setup failed:');
        logError(error.message);
        process.exit(1);
    }
}

// Run setup if this script is executed directly
if (require.main === module) {
    main();
}

module.exports = {
    main,
    checkPrerequisites,
    setupEnvironmentFile,
    setupDirectories,
    installDependencies,
    createTestData,
    createStartupScript
};
