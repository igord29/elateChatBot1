/**
 * Idempotency helpers for lead submission
 * Prevents duplicate leads by generating deterministic IDs
 */

import crypto from 'crypto';

/**
 * Generate a deterministic hash for a lead to prevent duplicates
 * @param {Object} lead - The lead data
 * @returns {string} - 16-character hash
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
 * Generate a unique lead ID with timestamp for tracking
 * @param {Object} lead - The lead data
 * @returns {string} - Unique lead ID
 */
function generateLeadId(lead) {
    const hash = leadHash(lead);
    const timestamp = Date.now().toString(36);
    return `lead_${hash}_${timestamp}`;
}

export {
    leadHash,
    generateLeadId
};
