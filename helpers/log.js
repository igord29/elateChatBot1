/**
 * Structured logging with PII masking
 * Ensures logs don't dump full payloads with sensitive data
 */

/**
 * Mask phone number for logging
 * @param {string} phone - Phone number
 * @returns {string} - Masked phone number
 */
function maskPhone(phone) {
    const digits = (phone || "").replace(/\D+/g, "");
    return digits ? digits.replace(/.(?=.{4}$)/g, "*") : "";
}

/**
 * Mask email for logging
 * @param {string} email - Email address
 * @returns {string} - Masked email
 */
function maskEmail(email) {
    if (!email) return "";
    const [local, domain] = email.split("@");
    if (!domain) return email;
    const maskedLocal = local.length > 2 ? local.slice(0, 2) + "*".repeat(local.length - 2) : local;
    return `${maskedLocal}@${domain}`;
}

/**
 * Log lead event with structured data
 * @param {string} event - Event name
 * @param {string} lead_id - Lead ID
 * @param {Object} extra - Additional data
 */
function logLeadEvent(event, lead_id, extra = {}) {
    const logData = {
        ts: new Date().toISOString(),
        event,
        lead_id,
        ...extra
    };
    
    console.log(JSON.stringify(logData));
}

/**
 * Log lead submission with masked PII
 * @param {string} event - Event name
 * @param {string} lead_id - Lead ID
 * @param {Object} lead - Lead data (will be masked)
 * @param {Object} extra - Additional data
 */
function logLeadSubmission(event, lead_id, lead, extra = {}) {
    const maskedLead = {
        full_name: lead.full_name ? lead.full_name.split(' ').map((name, i) => i === 0 ? name : name.charAt(0) + '*'.repeat(name.length - 1)).join(' ') : '',
        phone: maskPhone(lead.phone),
        email: maskEmail(lead.email),
        source: lead.source,
        service_type: lead.service_type
    };
    
    logLeadEvent(event, lead_id, {
        lead: maskedLead,
        ...extra
    });
}

module.exports = {
    maskPhone,
    maskEmail,
    logLeadEvent,
    logLeadSubmission
};
