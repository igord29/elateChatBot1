/**
 * Retry fetch with exponential backoff
 * Handles 429/5xx/timeouts for webhook robustness
 */

/**
 * Retry fetch with exponential backoff
 * @param {string} url - URL to fetch
 * @param {Object} init - Fetch options
 * @param {Object} options - Retry options
 * @param {number} options.retries - Number of retries (default: 3)
 * @param {number} options.baseMs - Base delay in milliseconds (default: 300)
 * @returns {Promise<Response>} - Fetch response
 */
async function retryFetch(url, init = {}, { retries = 3, baseMs = 300 } = {}) {
    let lastError;
    
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url, init);
            
            // Don't retry on success or client errors (except 429)
            if (response.status < 500 && response.status !== 429) {
                return response;
            }
            
            // Log retry reason
            console.warn(`⚠️ Retrying fetch (attempt ${i + 1}/${retries + 1}): ${response.status} ${response.statusText}`);
            
        } catch (error) {
            lastError = error;
            console.warn(`⚠️ Fetch error (attempt ${i + 1}/${retries + 1}):`, error.message);
        }
        
        // Don't delay after the last attempt
        if (i < retries) {
            const delay = baseMs * Math.pow(2, i);
            console.log(`⏳ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    // If we have a last error, throw it
    if (lastError) {
        throw lastError;
    }
    
    // Final attempt without retry logic
    console.log(`🔄 Final attempt without retry logic...`);
    return await fetch(url, init);
}

export {
    retryFetch
};
