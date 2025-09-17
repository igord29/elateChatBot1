/**
 * Simplified CRM Webhook Handler for Elate Moving Chatbot
 * Handles lead submissions and sends them to Make.com webhook
 */

import fetch from 'node-fetch';
import { leadHash } from './helpers/idempotency.js';
import { sanitizeLead } from './helpers/normalize.js';
import { retryFetch } from './helpers/retryFetch.js';
import { logLeadSubmission } from './helpers/log.js';

function parseBody(text) { 
    try { 
        return JSON.parse(text); 
    } catch { 
        return text; 
    } 
}

/**
 * Submit a qualified lead to the CRM system via Make.com webhook
 * @param {Object} lead - The lead information
 * @returns {Promise<Object>} - Webhook response
 */
async function postLeadToCRM(lead) {
    const url = process.env.CRM_WEBHOOK_URL;
    if (!url) throw new Error("CRM_WEBHOOK_URL is not set");

    // Sanitize and normalize lead data
    const clean = sanitizeLead(lead);
    const id = leadHash(clean);
    
    logLeadSubmission("lead.post.start", id, clean, { url });
    
    const resp = await retryFetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Lead-Id": id
        },
        body: JSON.stringify({ ...clean, lead_id: id }),
    });
    
    const text = await resp.text();
    let body;
    try { 
        body = JSON.parse(text); 
    } catch { 
        body = text; 
    }
    
    logLeadSubmission("lead.post.done", id, clean, { 
        ok: resp.ok, 
        status: resp.status,
        response_size: text.length 
    });
    
    if (resp.ok) {
        console.log('✅ Lead submitted to CRM successfully');
    } else {
        console.error('❌ Failed to submit lead to CRM:', resp.status, resp.statusText);
    }
    
    return { ok: resp.ok, status: resp.status, body };
}

/**
 * Send lead notification to Make.com scenario (optional)
 * @param {Object} lead - The lead information
 * @returns {Promise<Object>} - Webhook response
 */
async function notifyLead(lead) {
    const url = process.env.LEAD_NOTIFICATION_WEBHOOK; // optional Make.com scenario
    if (!url) return { ok: true, skipped: true };
    
    console.log(`📧 Sending lead notification: ${url}`);
    
    const resp = await retryFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
    });
    
    const body = parseBody(await resp.text());
    
    if (resp.ok) {
        console.log('✅ Lead notification sent successfully:', body);
    } else {
        console.error('❌ Failed to send lead notification:', body);
    }
    
    return { ok: resp.ok, status: resp.status, body };
}

export {
    postLeadToCRM,
    notifyLead
};