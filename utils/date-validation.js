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

    // Check if year is explicitly mentioned in the original string
    const yearMatch = cleanedString.match(/\b(19|20)\d{2}\b/);
    const hasExplicitYear = !!yearMatch;

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
                    return { month: monthIndex, day: parseInt(match[2]), hasYear: false };
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
                    return { month: monthIndex, day: parseInt(match[2]), hasYear: false };
                }
            }
            return null;
        },
        // MM/DD without year: "10/20"
        () => {
            const numericNoYearPattern = /^(\d{1,2})[\/\-](\d{1,2})$/;
            const match = cleanedString.match(numericNoYearPattern);
            if (match) {
                return { month: parseInt(match[1]) - 1, day: parseInt(match[2]), hasYear: false };
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
            if (result) {
                if (result instanceof Date && !isNaN(result.getTime())) {
                    return { date: result, hasExplicitYear };
                } else if (result.month !== undefined && result.day !== undefined) {
                    // Return month/day object for year inference
                    return { monthDay: result, hasExplicitYear: false };
                }
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
 * Formats a date to "Month Day" format (no year)
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date string
 */
function formatMonthDay(date) {
    return date.toLocaleDateString('en-US', {
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
 * Calculates days between two dates
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {number} - Number of days between dates
 */
function daysBetween(date1, date2) {
    const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds
    return Math.round(Math.abs((date1 - date2) / oneDay));
}

/**
 * Validates that the move date is in the future
 * Handles various formats flexibly with smart messaging and time context
 * @param {string} dateString - Date string to validate
 * @returns {Object} - Validation result with valid flag, message, and parsed date info
 */
export function validateMoveDate(dateString) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset to start of day for comparison
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1; // JavaScript months are 0-indexed

        // Try to parse the date string
        const parseResult = parseDateFuzzy(dateString);

        if (!parseResult) {
            return {
                valid: false,
                needs_confirmation: false,
                message: "Just to make sure I have this right—what month and day were you thinking for your move?",
                error: 'Date parsing failed'
            };
        }

        // Handle month/day without year (needs year inference)
        if (parseResult.monthDay) {
            const { month, day } = parseResult.monthDay;
            
            // First try current year
            const testDateCurrentYear = new Date(currentYear, month, day);
            testDateCurrentYear.setHours(0, 0, 0, 0);

            // Calculate next year's date
            const nextYearDate = new Date(currentYear + 1, month, day);
            nextYearDate.setHours(0, 0, 0, 0);
            const daysUntilNextYear = daysBetween(nextYearDate, today);

            // If that date has already passed this year
            if (testDateCurrentYear < today) {
                // Date has passed - check if next year is soon (within 90 days)
                if (daysUntilNextYear <= 90) {
                    // It's coming up soon - be conversational about it
                    let timePhrase;
                    if (daysUntilNextYear <= 30) {
                        timePhrase = "coming up soon";
                    } else if (daysUntilNextYear <= 60) {
                        const monthsAway = Math.floor(daysUntilNextYear / 30);
                        timePhrase = `about ${monthsAway} month${monthsAway > 1 ? 's' : ''} away`;
                    } else {
                        timePhrase = "in a couple months";
                    }
                    
                    return {
                        valid: true,
                        needs_confirmation: true,
                        assumed_year: currentYear + 1,
                        month_day: formatMonthDay(nextYearDate),
                        full_date: formatDateLong(nextYearDate),
                        formatted_date: formatDateISO(nextYearDate),
                        year: String(currentYear + 1),
                        message: `Perfect! ${formatDateLong(nextYearDate)}—that's ${timePhrase}.`,
                        date_passed_this_year: true,
                        is_soon: true
                    };
                } else {
                    // Further out - standard confirmation
                    return {
                        valid: false,
                        needs_confirmation: true,
                        assumed_year: currentYear + 1,
                        month_day: formatMonthDay(nextYearDate),
                        full_assumed_date: formatDateLong(nextYearDate),
                        formatted_date: formatDateISO(nextYearDate),
                        message: `${formatMonthDay(nextYearDate)} has already passed this year. Are you thinking ${formatDateLong(nextYearDate)}?`,
                        date_passed_this_year: true,
                        is_soon: false
                    };
                }
            } else {
                // Date is still upcoming this year - assume current year and just confirm
                const daysUntil = daysBetween(testDateCurrentYear, today);
                
                // Add natural time context if it's very soon
                let timeContext = "";
                if (daysUntil <= 14) {
                    timeContext = `—that's in about ${daysUntil} day${daysUntil > 1 ? 's' : ''}`;
                } else if (daysUntil <= 30) {
                    timeContext = "—coming up in a few weeks";
                }
                
                return {
                    valid: true,
                    needs_confirmation: true,
                    assumed_year: currentYear,
                    month_day: formatMonthDay(testDateCurrentYear),
                    full_date: formatDateLong(testDateCurrentYear),
                    formatted_date: formatDateISO(testDateCurrentYear),
                    year: String(currentYear),
                    message: `Perfect! Just to confirm, that's ${formatDateLong(testDateCurrentYear)}${timeContext}?`,
                    date_passed_this_year: false
                };
            }
        }

        // User provided explicit year - validate it
        let parsedDate = parseResult.date;
        if (!parsedDate) {
            return {
                valid: false,
                needs_confirmation: false,
                message: "Just to make sure I have this right—what month and day were you thinking for your move?",
                error: 'Date parsing failed'
            };
        }

        // Reset time to start of day for comparison
        parsedDate.setHours(0, 0, 0, 0);

        // Final check: is the date in the past?
        if (parsedDate < today) {
            return {
                valid: false,
                needs_confirmation: false,
                message: `I see that ${formatDateLong(parsedDate)} has already passed—we're at ${formatDateLong(today)} now. What date in the future works for you?`,
                parsed_date: formatDateLong(parsedDate),
                today: formatDateLong(today)
            };
        }

        // Valid future date with explicit year
        return {
            valid: true,
            needs_confirmation: false,
            full_date: formatDateLong(parsedDate),
            formatted_date: formatDateISO(parsedDate),
            month_day: formatMonthDay(parsedDate),
            year: String(parsedDate.getFullYear())
        };

    } catch (error) {
        // Last resort - ask for clarification naturally
        return {
            valid: false,
            needs_confirmation: false,
            message: "Just to make sure I have this right—what month and day were you thinking for your move?",
            error: error.message
        };
    }
}
