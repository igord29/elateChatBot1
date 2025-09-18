/**
 * Email Service for Elate Moving Chatbot
 * Handles sending welcome emails with conversation summaries
 */

import nodemailer from 'nodemailer';

/**
 * Create email transporter based on environment configuration
 */
function createTransporter() {
  const emailConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };

  // Validate required email configuration
  if (!emailConfig.auth.user || !emailConfig.auth.pass) {
    console.warn('⚠️ Email configuration incomplete. SMTP_USER and SMTP_PASS required.');
    return null;
  }

  try {
    const transporter = nodemailer.createTransporter(emailConfig);
    console.log('✅ Email transporter created successfully');
    return transporter;
  } catch (error) {
    console.error('❌ Failed to create email transporter:', error.message);
    return null;
  }
}

/**
 * Generate conversation summary from thread messages
 */
function generateConversationSummary(messages, customerEmail) {
  if (!messages || messages.length === 0) {
    return {
      summary: "No conversation history available.",
      keyPoints: [],
      nextSteps: []
    };
  }

  // Filter out system messages and focus on user/assistant conversation
  const conversationMessages = messages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .reverse(); // Show in chronological order

  const summary = `You had a conversation with our Elate Moving specialist about your moving needs.`;
  
  const keyPoints = [];
  const nextSteps = [];

  // Extract key information from conversation
  conversationMessages.forEach((msg, index) => {
    if (msg.role === 'user') {
      const content = msg.content[0]?.text?.value || '';
      
      // Look for specific moving-related information
      if (content.toLowerCase().includes('move') || content.toLowerCase().includes('moving')) {
        keyPoints.push(`You mentioned: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
      }
      
      if (content.toLowerCase().includes('date') || content.toLowerCase().includes('when')) {
        keyPoints.push(`Timing discussed: Moving date or timeline mentioned`);
      }
      
      if (content.toLowerCase().includes('from') || content.toLowerCase().includes('to')) {
        keyPoints.push(`Location details: Origin and destination discussed`);
      }
    }
  });

  // Add standard next steps
  nextSteps.push('Our moving specialist will review your requirements');
  nextSteps.push('You will receive a detailed quote within 24 hours');
  nextSteps.push('A team member will contact you to schedule a consultation');

  return {
    summary,
    keyPoints: keyPoints.length > 0 ? keyPoints : ['Moving requirements discussed'],
    nextSteps,
    messageCount: conversationMessages.length
  };
}

/**
 * Create HTML email template for conversation summary
 */
function createEmailTemplate(customerName, customerEmail, conversationData) {
  const { summary, keyPoints, nextSteps, messageCount } = conversationData;
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Elate Moving Conversation Summary</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8f9fa;
        }
        .email-container {
            background: white;
            border-radius: 10px;
            padding: 30px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #707070 0%, #FF4c01 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            margin-bottom: 30px;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .header p {
            margin: 5px 0 0 0;
            opacity: 0.9;
        }
        .content-section {
            margin-bottom: 25px;
        }
        .content-section h2 {
            color: #FF4c01;
            border-bottom: 2px solid #707070;
            padding-bottom: 5px;
            margin-bottom: 15px;
        }
        .key-points, .next-steps {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #FF4c01;
        }
        .key-points ul, .next-steps ul {
            margin: 0;
            padding-left: 20px;
        }
        .key-points li, .next-steps li {
            margin-bottom: 8px;
        }
        .contact-info {
            background: #e3f2fd;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            margin-top: 30px;
        }
        .contact-info h3 {
            color: #FF4c01;
            margin-top: 0;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e1e5e9;
            color: #666;
            font-size: 14px;
        }
        .highlight {
            background: #fff3cd;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1>🚚 Elate Moving</h1>
            <p>Professional Moving Services Nationwide</p>
        </div>

        <div class="content-section">
            <h2>Thank You for Your Interest!</h2>
            <p>Hi ${customerName || 'Valued Customer'},</p>
            <p>Thank you for taking the time to speak with our Elate Moving specialist today. We're excited to help make your move as smooth and stress-free as possible.</p>
        </div>

        <div class="content-section">
            <h2>Conversation Summary</h2>
            <p>${summary}</p>
            <p><span class="highlight">${messageCount} messages</span> were exchanged during our conversation.</p>
        </div>

        <div class="content-section">
            <h2>Key Points Discussed</h2>
            <div class="key-points">
                <ul>
                    ${keyPoints.map(point => `<li>${point}</li>`).join('')}
                </ul>
            </div>
        </div>

        <div class="content-section">
            <h2>What Happens Next</h2>
            <div class="next-steps">
                <ul>
                    ${nextSteps.map(step => `<li>${step}</li>`).join('')}
                </ul>
            </div>
        </div>

        <div class="contact-info">
            <h3>Need Immediate Assistance?</h3>
            <p><strong>Phone:</strong> <a href="tel:+1-800-ELATE-01">1-800-ELATE-01</a></p>
            <p><strong>Email:</strong> <a href="mailto:info@elatemoving.com">info@elatemoving.com</a></p>
            <p><strong>Website:</strong> <a href="https://elatemoving.com">elatemoving.com</a></p>
        </div>

        <div class="footer">
            <p>This email was sent to ${customerEmail} because you requested information about our moving services.</p>
            <p>&copy; 2024 Elate Moving. All rights reserved.</p>
            <p>Professional • Reliable • Trusted</p>
        </div>
    </div>
</body>
</html>
  `.trim();
}

/**
 * Send welcome email with conversation summary
 */
export async function sendWelcomeEmail(customerEmail, customerName, threadId, conversationMessages) {
  try {
    console.log(`📧 Preparing to send welcome email to: ${customerEmail}`);
    
    const transporter = createTransporter();
    if (!transporter) {
      console.warn('⚠️ Email service not configured, skipping welcome email');
      return { success: false, error: 'Email service not configured' };
    }

    // Generate conversation summary
    const conversationData = generateConversationSummary(conversationMessages, customerEmail);
    
    // Create email content
    const htmlContent = createEmailTemplate(customerName, customerEmail, conversationData);
    const textContent = `
Thank you for your interest in Elate Moving!

Hi ${customerName || 'Valued Customer'},

Thank you for taking the time to speak with our Elate Moving specialist today. We're excited to help make your move as smooth and stress-free as possible.

CONVERSATION SUMMARY:
${conversationData.summary}
${conversationData.messageCount} messages were exchanged during our conversation.

KEY POINTS DISCUSSED:
${conversationData.keyPoints.map(point => `• ${point}`).join('\n')}

WHAT HAPPENS NEXT:
${conversationData.nextSteps.map(step => `• ${step}`).join('\n')}

NEED IMMEDIATE ASSISTANCE?
Phone: 1-800-ELATE-01
Email: info@elatemoving.com
Website: elatemoving.com

This email was sent to ${customerEmail} because you requested information about our moving services.

© 2024 Elate Moving. All rights reserved.
Professional • Reliable • Trusted
    `.trim();

    // Email configuration
    const mailOptions = {
      from: {
        name: 'Elate Moving',
        address: process.env.SMTP_FROM || process.env.SMTP_USER
      },
      to: customerEmail,
      subject: 'Your Elate Moving Conversation Summary - Next Steps',
      text: textContent,
      html: htmlContent,
      replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_USER
    };

    // Send email
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Welcome email sent successfully:', result.messageId);
    
    return { 
      success: true, 
      messageId: result.messageId,
      customerEmail,
      customerName 
    };

  } catch (error) {
    console.error('❌ Failed to send welcome email:', error.message);
    return { 
      success: false, 
      error: error.message,
      customerEmail,
      customerName 
    };
  }
}

/**
 * Verify email configuration
 */
export function verifyEmailConfig() {
  const requiredVars = ['SMTP_USER', 'SMTP_PASS'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.warn(`⚠️ Missing email configuration: ${missing.join(', ')}`);
    return false;
  }
  
  console.log('✅ Email configuration verified');
  return true;
}

export default {
  sendWelcomeEmail,
  verifyEmailConfig,
  createTransporter
};
