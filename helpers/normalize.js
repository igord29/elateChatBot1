/**
 * Input validation and normalization helpers
 * Ensures clean, safe data before webhook submission
 */

/**
 * Normalize phone number to digits only
 * @param {string} phone - Phone number string
 * @returns {string} - Digits only
 */
function normPhone(phone = "") {
    return phone.replace(/\D+/g, "");
}

/**
 * Convert phone to E.164 format
 * @param {string} phone - Phone number
 * @returns {string} - E.164 formatted phone or empty string
 */
function e164(phone) {
    const digits = normPhone(phone);
    return digits ? `+${digits}` : "";
}

/**
 * Clip string to maximum length and trim
 * @param {string} str - String to clip
 * @param {number} max - Maximum length
 * @returns {string} - Clipped and trimmed string
 */
function clip(str, max = 300) {
    return (str || "").toString().trim().slice(0, max);
}

/**
 * Sanitize and normalize lead data
 * @param {Object} lead - Raw lead data
 * @returns {Object} - Cleaned lead data
 */
function sanitizeLead(lead) {
    return {
        ...lead,
        full_name: clip(lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" "), 120),
        phone: e164(lead.phone),
        origin_address: clip(lead.origin_address, 300),
        destination_address: clip(lead.destination_address, 300),
        notes: clip(lead.notes, 1000),
        // Ensure required fields are present
        first_name: clip(lead.first_name, 50),
        last_name: clip(lead.last_name, 50),
        email: clip(lead.email, 100).toLowerCase(),
        service_type: clip(lead.service_type, 50),
        move_date: clip(lead.move_date, 20)
    };
}

module.exports = {
    normPhone,
    e164,
    clip,
    sanitizeLead
};
