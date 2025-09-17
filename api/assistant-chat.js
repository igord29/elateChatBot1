/**
 * Vercel API route for OpenAI Assistant chat with lead submission
 * Handles assistant runs, tool calls, and webhook submissions
 */

import OpenAI from 'openai';
import crypto from 'crypto';

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

    // Poll run status and handle tool calls
    while (true) {
      run = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
      console.log(`🔄 Run status: ${run.status}`);

      if (run.status === "requires_action") {
        const outputs = [];
        for (const call of run.required_action.submit_tool_outputs.tool_calls) {
          if (call.function.name === "submit_lead") {
            const result = await handleSubmitLeadToolCall(call);
            outputs.push({ 
              tool_call_id: call.id, 
              output: JSON.stringify(result) 
            });
          } else {
            outputs.push({ 
              tool_call_id: call.id, 
              output: JSON.stringify({ ok: true }) 
            });
          }
        }
        await openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { 
          tool_outputs: outputs 
        });
        continue;
      }

      if (run.status === "queued" || run.status === "in_progress") {
        await new Promise(r => setTimeout(r, 400));
        continue;
      }

      break;
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

    return res.status(200).json({
      status: run.status,
      text: text.trim(),
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
