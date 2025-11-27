/**
 * Vercel API route for OpenAI Assistant chat with lead submission
 * Handles assistant runs, tool calls, and webhook submissions
 */

import OpenAI from 'openai';
import crypto from 'crypto';
import { sendWelcomeEmail } from '../services/email-service.js';
import { validateMoveDate } from '../utils/date-validation.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate deterministic lead hash for idempotency
 */
function leadHash(lead) {
  const basis = [
    (lead.full_name || "").trim().toLowerCase(),
    (lead.phone || "").replace(/\D+/g, ""),
    (lead.origin_address || "").trim().toLowerCase(),
    (lead.destination_address || "").trim().toLowerCase(),
    (lead.move_date || "").trim()
  ].join("|");
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

/**
 * Normalize phone number to E.164 format
 */
function e164(phone) {
  const digits = (phone || "").replace(/\D+/g, "");
  return digits ? `+${digits}` : "";
}

/**
 * Sanitize and normalize lead data
 */
function sanitizeLead(lead) {
  return {
    ...lead,
    full_name: lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" "),
    phone: e164(lead.phone),
    source: "chat_conversation", // Always inject this
    // Ensure required fields are present
    first_name: (lead.first_name || "").trim(),
    last_name: (lead.last_name || "").trim(),
    email: (lead.email || "").trim().toLowerCase(),
    service_type: (lead.service_type || "").trim(),
    move_date: (lead.move_date || "").trim(),
    origin_address: (lead.origin_address || "").trim(),
    destination_address: (lead.destination_address || "").trim(),
    notes: (lead.notes || "").trim()
  };
}

/**
 * Submit lead to CRM webhook with retry logic
 */
async function postLeadToCRM(lead) {
  const url = process.env.CRM_WEBHOOK_URL;
  if (!url) throw new Error("CRM_WEBHOOK_URL is not set");

  const clean = sanitizeLead(lead);
  const id = leadHash(clean);
  
  console.log(`📤 Submitting lead to CRM webhook: ${url} (ID: ${id})`);
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Lead-Id": id
    },
    body: JSON.stringify({ ...clean, lead_id: id }),
  });
  
  const text = await response.text();
  let body;
  try { 
    body = JSON.parse(text); 
  } catch { 
    body = text; 
  }
  
  if (response.ok) {
    console.log('✅ Lead submitted to CRM successfully');
  } else {
    console.error('❌ Failed to submit lead to CRM:', response.status, response.statusText);
  }
  
  return { ok: response.ok, status: response.status, body };
}

/**
 * Send lead notification (optional)
 */
async function notifyLead(lead) {
  const url = process.env.LEAD_NOTIFICATION_WEBHOOK;
  if (!url) return { ok: true, skipped: true };

  console.log(`📧 Sending lead notification: ${url}`);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lead),
  });

  const text = await response.text();
  let body;
  try { 
    body = JSON.parse(text); 
  } catch { 
    body = text; 
  }

  if (response.ok) {
    console.log('✅ Lead notification sent successfully');
  } else {
    console.error('❌ Failed to send lead notification:', response.status, response.statusText);
  }

  return { ok: response.ok, status: response.status, body };
}

/**
 * Handle submit_lead tool call
 */
async function handleSubmitLeadToolCall(call) {
  try {
    const args = JSON.parse(call.function.arguments || '{}');
    
    // Normalize / enrich without trusting model for source
    const lead = {
      ...args,
      source: "chat_conversation",
      full_name: args.full_name || [args.first_name, args.last_name].filter(Boolean).join(" "),
    };

    // Optional: map to CRM expected keys if different
    if (args.origin) lead.origin_address = args.origin;
    if (args.destination) lead.destination_address = args.destination;
    
    // POST to CRM (primary) and optional notification
    const crm = await postLeadToCRM(lead);
    try { 
      await notifyLead({ 
        event: "new_lead", 
        source: lead.source, 
        full_name: lead.full_name, 
        phone: lead.phone, 
        crm_status: crm.ok ? "accepted" : "failed" 
      }); 
    } catch (notifyError) {
      console.warn('⚠️ Notification failed:', notifyError.message);
    }

    console.log(`✅ Lead submitted via Assistant tool call: ${lead.full_name}`);
    return { ok: crm.ok };

  } catch (error) {
    console.error('❌ Error in submit_lead tool call:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Handle validate_move_date tool call
 */
async function handleValidateMoveDateToolCall(call) {
  try {
    const args = JSON.parse(call.function.arguments || '{}');
    const { date_string } = args;
    
    if (!date_string) {
      console.warn('⚠️ No date_string provided for validation');
      return { 
        valid: false, 
        message: 'Date string is required for validation' 
      };
    }

    console.log(`📅 Validating move date: ${date_string}`);
    
    const validationResult = validateMoveDate(date_string);
    
    if (validationResult.valid) {
      console.log(`✅ Date validated successfully: ${validationResult.full_date}`);
    } else {
      console.log(`❌ Date validation failed: ${validationResult.message}`);
    }
    
    return validationResult;

  } catch (error) {
    console.error('❌ Error in validate_move_date tool call:', error);
    return { 
      valid: false, 
      message: `Error validating date: ${error.message}`,
      error: error.message 
    };
  }
}

/**
 * Handle send_welcome_email tool call
 */
async function handleSendWelcomeEmailToolCall(call, threadId) {
  try {
    const args = JSON.parse(call.function.arguments || '{}');
    
    const { customer_email, customer_name } = args;
    
    if (!customer_email) {
      console.warn('⚠️ No customer email provided for welcome email');
      return { ok: false, error: 'Customer email is required' };
    }

    console.log(`📧 Sending welcome email to: ${customer_email}`);

    // Get conversation messages for summary
    let conversationMessages = [];
    try {
      const messages = await openai.beta.threads.messages.list(threadId, { 
        order: "asc" 
      });
      conversationMessages = messages.data;
    } catch (error) {
      console.warn('⚠️ Could not retrieve conversation messages:', error.message);
    }

    // Send welcome email
    const emailResult = await sendWelcomeEmail(
      customer_email, 
      customer_name, 
      threadId, 
      conversationMessages
    );

    if (emailResult.success) {
      console.log(`✅ Welcome email sent successfully to: ${customer_email}`);
      return { 
        ok: true, 
        messageId: emailResult.messageId,
        customerEmail: customer_email 
      };
    } else {
      console.error(`❌ Failed to send welcome email to: ${customer_email}`, emailResult.error);
      return { 
        ok: false, 
        error: emailResult.error,
        customerEmail: customer_email 
      };
    }

  } catch (error) {
    console.error('❌ Error in send_welcome_email tool call:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Detects and extracts only the first question from content if multiple questions are present
 * This ensures the chatbot asks one question at a time
 */
function extractFirstQuestion(content) {
  if (!content || typeof content !== 'string') return content;
  
  let processedContent = content.trim();
  
  // Pattern to detect multiple questions in the same sentence
  // Examples: "what's your name and phone?" or "what's your name? what's your phone?"
  const multipleQuestionPatterns = [
    /\b(?:and|or|,)\s+(?:what|when|where|who|why|how|which|do|are|can|would|could|is|will)\b/gi,  // "and what..." or ", what..."
    /\?\s+(?:what|when|where|who|why|how|which|do|are|can|would|could|is|will)\b/gi,  // "? what..."
    /\b(?:name|phone|email|address|date|number)\s+(?:and|or|,)\s+(?:name|phone|email|address|date|number|best|your)\b/gi,  // "name and phone", "name and best phone"
    /\b(?:full\s+)?name\s+and\s+(?:best\s+)?(?:phone|email|address)\b/gi,  // "name and phone", "full name and best phone"
    /\b(?:what'?s|what\s+is)\s+your\s+.*?\s+and\s+.*?\?/gi,  // "what's your X and Y?"
  ];
  
  // Check for multiple questions in one sentence
  let hasMultipleQuestions = multipleQuestionPatterns.some(pattern => pattern.test(content));
  
  // Also check for common patterns like "name and phone" or "name, phone, email"
  const dataCollectionPattern = /\b(?:name|phone|email|address|date|number)\s+(?:and|,)\s+(?:name|phone|email|address|date|number|best|your)\b/gi;
  if (dataCollectionPattern.test(content)) {
    hasMultipleQuestions = true;
  }
  
  // Count question marks
  const questionCount = (content.match(/\?/g) || []).length;
  
  if (questionCount > 1 || hasMultipleQuestions) {
    // Multiple questions detected - extract first one
    if (questionCount > 1) {
      // Split by question marks
      const firstQuestionEnd = content.indexOf('?');
      if (firstQuestionEnd !== -1) {
        processedContent = content.substring(0, firstQuestionEnd + 1).trim();
        console.log('⚠️ Multiple questions detected (by ?). Using first question only:', processedContent.substring(0, 100));
      }
    } else if (hasMultipleQuestions) {
      // Try multiple split strategies
      let splitIndex = -1;
      
      // Strategy 1: Split on "and" before data collection terms (name, phone, email, etc.)
      const dataSplitPattern = /\s+and\s+(?:best\s+)?(?:phone|email|address|date|number)\b/i;
      splitIndex = content.search(dataSplitPattern);
      
      // Strategy 2: Split on "and" before question words
      if (splitIndex === -1) {
        const questionSplitPattern = /\s+(?:and|or|,)\s+(?:what|when|where|who|why|how|which|do|are|can|would|could|is|will)/i;
        splitIndex = content.search(questionSplitPattern);
      }
      
      // Strategy 3: Split on comma before data collection terms
      if (splitIndex === -1) {
        const commaSplitPattern = /,\s+(?:best\s+)?(?:phone|email|address|date|number|name)\b/i;
        splitIndex = content.search(commaSplitPattern);
      }
      
      if (splitIndex !== -1) {
        // Find the end of the first part (before the "and/or" connector)
        let endIndex = splitIndex;
        
        // Try to find a natural break point (comma, period, or end of sentence)
        const beforeSplit = content.substring(0, splitIndex);
        const lastComma = beforeSplit.lastIndexOf(',');
        const lastPeriod = beforeSplit.lastIndexOf('.');
        const lastQuestion = beforeSplit.lastIndexOf('?');
        
        // Use the last punctuation mark before the split, or just split at "and/or"
        if (lastComma > lastPeriod && lastComma > lastQuestion) {
          endIndex = lastComma + 1;
        } else if (lastPeriod > lastQuestion) {
          endIndex = lastPeriod + 1;
        } else if (lastQuestion !== -1) {
          endIndex = lastQuestion + 1;
        }
        
        processedContent = content.substring(0, endIndex).trim();
        
        // If we didn't end with punctuation, add a question mark if it makes sense
        if (!processedContent.match(/[.!?]$/)) {
          // Check if the original had a question mark at the end
          if (content.trim().endsWith('?')) {
            processedContent += '?';
          }
        }
        
        console.log('⚠️ Multiple questions detected (by pattern). Using first question only:', processedContent.substring(0, 100));
      } else {
        // Fallback: if we detect multiple questions but can't split, just take first part before "and"
        // This handles cases like "what's your name and phone?"
        const andPatterns = [
          /\s+and\s+(?:the\s+)?(?:best\s+)?(?:phone|email|address|date|number)\b/i,
          /\s+and\s+(?:your\s+)?(?:phone|email|address|date|number)\b/i,
        ];
        
        let andIndex = -1;
        for (const pattern of andPatterns) {
          const match = content.match(pattern);
          if (match) {
            andIndex = content.indexOf(match[0]);
            break;
          }
        }
        
        // Also try simple " and " search
        if (andIndex === -1) {
          const simpleAndIndex = content.toLowerCase().indexOf(' and ');
          if (simpleAndIndex !== -1) {
            const afterAnd = content.substring(simpleAndIndex + 5).toLowerCase();
            if (/\b(?:phone|email|address|date|number|name|best|the)\b/.test(afterAnd)) {
              andIndex = simpleAndIndex;
            }
          }
        }
        
        if (andIndex !== -1 && content.trim().endsWith('?')) {
          processedContent = content.substring(0, andIndex).trim() + '?';
          console.log('⚠️ Multiple questions detected (by "and"). Using first question only:', processedContent.substring(0, 100));
        }
      }
    }
  }
  
  return processedContent;
}

/**
 * Main API handler
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse JSON body if it's a string
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }
    
    const { userText, threadId } = body;

    if (!userText) {
      return res.status(400).json({ error: 'userText is required' });
    }

    const assistantId = process.env.OPENAI_ASSISTANT_ID;
    if (!assistantId) {
      return res.status(500).json({ error: 'OPENAI_ASSISTANT_ID not configured' });
    }

    let currentThreadId = threadId;
    
    // Create or get thread
    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
      console.log(`🧵 Created new thread: ${currentThreadId}`);
    }

    // Add conversation guidance for new threads - STRONG enforcement
    if (!threadId) {
      await openai.beta.threads.messages.create(currentThreadId, {
        role: "user",
        content: `CRITICAL INSTRUCTION - YOU MUST FOLLOW THIS EXACTLY:

1. Ask ONLY ONE question per response. NEVER combine multiple questions.
2. Examples of what NOT to do:
   - "What's your name and phone?" ❌
   - "What's your name, phone, and email?" ❌
   - "What's your name? What's your phone?" ❌
3. Examples of what TO do:
   - "What's your full name?" ✅
   - "What's the best phone number to reach you?" ✅
4. When collecting contact info, ask for name FIRST, then wait for the answer before asking for phone.
5. Never use "and" to combine questions about different pieces of information.
6. Wait for the user's answer before asking the next question.
7. Keep conversations focused, conversational, and easy to follow. Be friendly and professional.

DATE VALIDATION INSTRUCTIONS:
- After receiving the move date from the user, IMMEDIATELY call the validate_move_date function with the user's date string.
- If valid=true: Confirm the full date with the user (e.g., "Just to confirm, that's October 12, 2024, correct?")
- If valid=false: Share the validation message with the user and ask them to provide a future date.
- Always confirm the complete date (month, day, year) before proceeding to the next question.`
      });
    }

    // Add user message to thread
    await openai.beta.threads.messages.create(currentThreadId, {
      role: "user",
      content: userText
    });

    // Create run
    let run = await openai.beta.threads.runs.create(currentThreadId, {
      assistant_id: assistantId
    });

    console.log(`🏃 Created run: ${run.id} for thread: ${currentThreadId}`);

    // Poll run status and handle tool calls with timeout protection
    const MAX_POLL_ATTEMPTS = 60; // Maximum 60 attempts (60 * 1s = 60 seconds max)
    const POLL_INTERVAL = 1000; // Poll every 1 second
    const MAX_WAIT_TIME = 60000; // 60 seconds total timeout
    let pollAttempts = 0;
    const startTime = Date.now();

    while (pollAttempts < MAX_POLL_ATTEMPTS) {
      // Check if we've exceeded the maximum wait time
      if (Date.now() - startTime > MAX_WAIT_TIME) {
        console.error(`⏱️ Timeout: Run ${run.id} exceeded ${MAX_WAIT_TIME}ms`);
        return res.status(504).json({ 
          error: 'Request timeout', 
          message: 'The assistant is taking too long to respond. Please try again.',
          threadId: currentThreadId 
        });
      }

      run = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
      console.log(`🔄 Run status: ${run.status} (attempt ${pollAttempts + 1}/${MAX_POLL_ATTEMPTS})`);

      // Handle error statuses
      if (run.status === "failed" || run.status === "expired" || run.status === "cancelled") {
        const errorMsg = run.last_error?.message || `Run ${run.status}`;
        console.error(`❌ Run failed: ${errorMsg}`, run.last_error);
        return res.status(500).json({ 
          error: 'Assistant run failed', 
          message: errorMsg,
          threadId: currentThreadId 
        });
      }

      if (run.status === "requires_action") {
        const outputs = [];
        for (const call of run.required_action.submit_tool_outputs.tool_calls) {
          if (call.function.name === "submit_lead") {
            const result = await handleSubmitLeadToolCall(call);
            outputs.push({ 
              tool_call_id: call.id, 
              output: JSON.stringify(result) 
            });
          } else if (call.function.name === "send_welcome_email") {
            const result = await handleSendWelcomeEmailToolCall(call, currentThreadId);
            outputs.push({ 
              tool_call_id: call.id, 
              output: JSON.stringify(result) 
            });
          } else if (call.function.name === "validate_move_date") {
            const result = await handleValidateMoveDateToolCall(call);
            outputs.push({ 
              tool_call_id: call.id, 
              output: JSON.stringify(result) 
            });
          } else {
            console.warn(`⚠️ Unknown tool call: ${call.function.name}`);
            outputs.push({ 
              tool_call_id: call.id, 
              output: JSON.stringify({ ok: true }) 
            });
          }
        }
        await openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { 
          tool_outputs: outputs 
        });
        pollAttempts = 0; // Reset counter after tool call submission
        continue;
      }

      if (run.status === "queued" || run.status === "in_progress") {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        pollAttempts++;
        continue;
      }

      // Completed or other terminal status
      if (run.status === "completed") {
        break;
      }

      // Unknown status - break to avoid infinite loop
      console.warn(`⚠️ Unknown run status: ${run.status}, breaking poll loop`);
      break;
    }

    // Check if we hit max attempts
    if (pollAttempts >= MAX_POLL_ATTEMPTS) {
      console.error(`⏱️ Max poll attempts reached for run ${run.id}`);
      return res.status(504).json({ 
        error: 'Request timeout', 
        message: 'The assistant is taking too long to respond. Please try again.',
        threadId: currentThreadId 
      });
    }

    // Get the latest messages
    const messages = await openai.beta.threads.messages.list(currentThreadId, { 
      order: "desc", 
      limit: 1 
    });
    const last = messages.data[0];
    let text = "";
    if (last) {
      for (const p of last.content) {
        if (p.type === "text") text += p.text.value;
      }
    }

    // Process text to ensure only one question is asked
    const processedText = extractFirstQuestion(text);

    return res.status(200).json({
      status: run.status,
      text: processedText,
      threadId: currentThreadId,
      runId: run.id
    });

  } catch (error) {
    console.error('❌ Error in assistant-chat API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
