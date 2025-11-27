/**
 * Date Validation Utility
 * Validates that move dates are in the future
 * Converts Python dateutil.parser logic to JavaScript
 */

/**
 * Parses a date string with fuzzy matching (handles various formats)
 * @param {string} dateString - Date string to parse
 * @returns {Date|null} - Parsed date or null if parsing fails
 */
function parseDateFuzzy(dateString) {
    if (!dateString || typeof dateString !== 'string') {
        return null;
    }

    const trimmed = dateString.trim();
    if (!trimmed) return null;

    // Try multiple parsing strategies
    const strategies = [
        // ISO format: 2025-10-12
        () => {
            const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (isoMatch) {
                return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
            }
            return null;
        },
        // US format: 10/12/2025, 10/12/25
        () => {
            const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
            if (usMatch) {
                const month = parseInt(usMatch[1]) - 1;
                const day = parseInt(usMatch[2]);
                let year = parseInt(usMatch[3]);
                if (year < 100) {
                    year += 2000; // Assume 2000s for 2-digit years
                }
                return new Date(year, month, day);
            }
            return null;
        },
        // Month name formats: "October 12", "October 12, 2025", "Oct 12 2025"
        () => {
            const monthNames = [
                'january', 'february', 'march', 'april', 'may', 'june',
                'july', 'august', 'september', 'october', 'november', 'december'
            ];
            const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            
            const lower = trimmed.toLowerCase();
            let monthIndex = -1;
            let day = null;
            let year = null;

            // Try full month names
            for (let i = 0; i < monthNames.length; i++) {
                if (lower.includes(monthNames[i])) {
                    monthIndex = i;
                    break;
                }
            }

            // Try abbreviated month names
            if (monthIndex === -1) {
                for (let i = 0; i < monthAbbr.length; i++) {
                    if (lower.includes(monthAbbr[i])) {
                        monthIndex = i;
                        break;
                    }
                }
            }

            if (monthIndex === -1) return null;

            // Extract day and year
            const dayMatch = trimmed.match(/\b(\d{1,2})\b/);
            if (dayMatch) {
                day = parseInt(dayMatch[1]);
            }

            const yearMatch = trimmed.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
                year = parseInt(yearMatch[0]);
            }

            if (day === null) return null;

            // Use current year if not specified
            if (year === null) {
                year = new Date().getFullYear();
            }

            return new Date(year, monthIndex, day);
        },
        // Try native Date parsing as fallback
        () => {
            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) {
                return parsed;
            }
            return null;
        }
    ];

    // Try each strategy
    for (const strategy of strategies) {
        try {
            const result = strategy();
            if (result && !isNaN(result.getTime())) {
                return result;
            }
        } catch (error) {
            // Continue to next strategy
        }
    }

    return null;
}

/**
 * Validates that the move date is in the future
 * @param {string} dateString - Date string to validate
 * @returns {Object} - Validation result with valid flag, message, and parsed date info
 */
export function validateMoveDate(dateString) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset to start of day for comparison

        // Try to parse the date string
        let parsedDate = parseDateFuzzy(dateString);

        if (!parsedDate) {
            return {
                valid: false,
                message: `Could not parse the date '${dateString}'. Please provide a date in a format like 'October 12' or '10/12/2025'.`,
                error: 'Date parsing failed'
            };
        }

        // Reset time to start of day for comparison
        parsedDate.setHours(0, 0, 0, 0);

        // If no year provided and date has passed this year, assume next year
        const currentYear = today.getFullYear();
        if (parsedDate.getFullYear() === currentYear && parsedDate < today) {
            // Date has passed this year, assume next year
            parsedDate = new Date(parsedDate);
            parsedDate.setFullYear(currentYear + 1);
        }

        // Check if date is in the future
        if (parsedDate <= today) {
            const formattedDate = parsedDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            return {
                valid: false,
                message: `The date ${formattedDate} has already passed. Please provide a future date.`,
                suggested_date: null
            };
        }

        // Format the validated date
        const formattedDate = parsedDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        return {
            valid: true,
            full_date: formattedDate,
            message: `Valid future date: ${formattedDate}`
        };

    } catch (error) {
        return {
            valid: false,
            message: `Could not parse the date '${dateString}'. Please provide a date in a format like 'October 12' or '10/12/2025'.`,
            error: error.message
        };
    }
}

