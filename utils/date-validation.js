/**
 * Date Validation Utility
 * Validates that move dates are in the future
 * Handles various formats flexibly
 * Converts Python datetime/dateutil logic to JavaScript
 */

/**
 * Parses a date string with multiple format strategies
 * @param {string} dateString - Date string to parse
 * @returns {Object|null} - Object with parsed date and hasYear flag, or null if parsing fails
 */
function parseDateFuzzy(dateString) {
    if (!dateString || typeof dateString !== 'string') {
        return null;
    }

    // Clean up the input - remove ordinal indicators (st, nd, rd, th)
    const cleanedString = dateString.replace(/(\d+)(st|nd|rd|th)/gi, '$1').trim();
    
    if (!cleanedString) return null;

    // Check if year is present in original string
    const yearMatch = cleanedString.match(/\b(19|20)\d{2}\b/);
    const hasYear = !!yearMatch;

    // Try multiple common date formats (in order of specificity)
    const formats = [
        // Full month name with year: "October 20 2025" or "October 20, 2025"
        () => {
            const fullMonthPattern = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})$/i;
            const match = cleanedString.match(fullMonthPattern);
            if (match) {
                const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                    'july', 'august', 'september', 'october', 'november', 'december'];
                const monthIndex = monthNames.indexOf(match[1].toLowerCase());
                if (monthIndex !== -1) {
                    return new Date(parseInt(match[3]), monthIndex, parseInt(match[2]));
                }
            }
            return null;
        },
        // Abbreviated month with year: "Oct 20 2025" or "Oct 20, 2025"
        () => {
            const abbrMonthPattern = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2}),?\s+(\d{4})$/i;
            const match = cleanedString.match(abbrMonthPattern);
            if (match) {
                const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                const monthIndex = monthAbbr.indexOf(match[1].toLowerCase());
                if (monthIndex !== -1) {
                    return new Date(parseInt(match[3]), monthIndex, parseInt(match[2]));
                }
            }
            return null;
        },
        // MM/DD/YYYY or MM-DD-YYYY: "10/20/2025" or "10-20-2025"
        () => {
            const numericPattern = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
            const match = cleanedString.match(numericPattern);
            if (match) {
                return new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
            }
            return null;
        },
        // Full month name without year: "October 20"
        () => {
            const fullMonthNoYearPattern = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})$/i;
            const match = cleanedString.match(fullMonthNoYearPattern);
            if (match) {
                const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                    'july', 'august', 'september', 'october', 'november', 'december'];
                const monthIndex = monthNames.indexOf(match[1].toLowerCase());
                if (monthIndex !== -1) {
                    const currentYear = new Date().getFullYear();
                    return new Date(currentYear, monthIndex, parseInt(match[2]));
                }
            }
            return null;
        },
        // Abbreviated month without year: "Oct 20"
        () => {
            const abbrMonthNoYearPattern = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})$/i;
            const match = cleanedString.match(abbrMonthNoYearPattern);
            if (match) {
                const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                const monthIndex = monthAbbr.indexOf(match[1].toLowerCase());
                if (monthIndex !== -1) {
                    const currentYear = new Date().getFullYear();
                    return new Date(currentYear, monthIndex, parseInt(match[2]));
                }
            }
            return null;
        },
        // MM/DD without year: "10/20"
        () => {
            const numericNoYearPattern = /^(\d{1,2})[\/\-](\d{1,2})$/;
            const match = cleanedString.match(numericNoYearPattern);
            if (match) {
                const currentYear = new Date().getFullYear();
                return new Date(currentYear, parseInt(match[1]) - 1, parseInt(match[2]));
            }
            return null;
        },
        // ISO format: 2025-10-20
        () => {
            const isoPattern = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
            const match = cleanedString.match(isoPattern);
            if (match) {
                return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
            }
            return null;
        },
        // Try native Date parsing as fallback
        () => {
            const parsed = new Date(cleanedString);
            if (!isNaN(parsed.getTime())) {
                return parsed;
            }
            return null;
        }
    ];

    // Try each format
    for (const formatFn of formats) {
        try {
            const result = formatFn();
            if (result && !isNaN(result.getTime())) {
                return { date: result, hasYear };
            }
        } catch (error) {
            // Continue to next format
        }
    }

    return null;
}

/**
 * Formats a date to "Month Day, Year" format
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date string
 */
function formatDateLong(date) {
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Formats a date to YYYY-MM-DD format
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date string
 */
function formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Validates that the move date is in the future
 * Handles various formats flexibly
 * @param {string} dateString - Date string to validate
 * @returns {Object} - Validation result with valid flag, message, and parsed date info
 */
export function validateMoveDate(dateString) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset to start of day for comparison

        // Try to parse the date string
        const parseResult = parseDateFuzzy(dateString);

        if (!parseResult || !parseResult.date) {
            return {
                valid: false,
                message: "I want to make sure I get your move date right. Could you give me the month and day? For example, 'December 15' or '12/15'",
                error: 'Date parsing failed'
            };
        }

        let parsedDate = parseResult.date;
        const hasYear = parseResult.hasYear;

        // Reset time to start of day for comparison
        parsedDate.setHours(0, 0, 0, 0);

        // If no year was in the original string, determine the correct year
        if (!hasYear || parsedDate.getFullYear() === 1900) {
            const currentYear = today.getFullYear();
            
            // Try current year first
            const testDate = new Date(parsedDate);
            testDate.setFullYear(currentYear);
            
            // If that date has passed, use next year
            if (testDate < today) {
                parsedDate.setFullYear(currentYear + 1);
            } else {
                parsedDate.setFullYear(currentYear);
            }
        }

        // Check if date is in the future (allow same day moves - date >= today)
        if (parsedDate < today) {
            // Suggest next year's date
            const suggestedDate = new Date(parsedDate);
            suggestedDate.setFullYear(parsedDate.getFullYear() + 1);
            
            const formattedDate = formatDateLong(parsedDate);
            const suggestedFormatted = formatDateLong(suggestedDate);
            
            return {
                valid: false,
                message: `I see that ${formattedDate} has already passed. Did you mean ${suggestedFormatted}?`,
                suggested_date: formatDateLong(suggestedDate)
            };
        }

        // Format the validated date
        const formattedDate = formatDateLong(parsedDate);
        const isoDate = formatDateISO(parsedDate);

        return {
            valid: true,
            full_date: formattedDate,
            formatted_date: isoDate,
            message: `Great! Your move date is ${formattedDate}.`
        };

    } catch (error) {
        // Last resort - ask for clarification naturally
        return {
            valid: false,
            message: "I want to make sure I get your move date right. Could you give me the month and day? For example, 'December 15' or '12/15'",
            error: error.message
        };
    }
}

