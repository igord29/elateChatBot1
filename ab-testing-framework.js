const { Pool } = require('pg');
const Redis = require('ioredis');
const crypto = require('crypto');

class ABTestingFramework {
    constructor() {
        this.pgPool = new Pool({
            user: process.env.DB_USER || 'postgres',
            host: process.env.DB_HOST || 'localhost',
            database: process.env.DB_NAME || 'moving_chatbot',
            password: process.env.DB_PASSWORD || 'password',
            port: process.env.DB_PORT || 5432
        });

        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD
        });

        this.experiments = new Map();
        this.loadExperiments();

        console.log('🧪 A/B Testing Framework initialized');
    }

    // Experiment Management
    async createExperiment(experimentConfig) {
        try {
            const {
                name,
                description,
                variants,
                trafficSplit,
                startDate,
                endDate,
                goals,
                hypothesis
            } =experimentConfig;

            // Validate experiment configuration
            this.validateExperimentConfig(experimentConfig);

            const experiment = {
                id: crypto.randomUUID(),
                name,
                description,
                variants: variants.map(v => ({ ...v, id: crypto.randomUUID() })),
                trafficSplit,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                goals,
                hypothesis,
                status: 'draft',
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Store experiment in database
            await this.storeExperiment(experiment);

            // Cache experiment for quick access
            this.experiments.set(experiment.id, experiment);

            console.log(`✅ Experiment created: ${experiment.name}`);
            return experiment;
        } catch (error) {
            console.error('❌ Error creating experiment:', error);
            throw error;
        }
    }

    async startExperiment(experimentId) {
        try {
            const experiment = this.experiments.get(experimentId);
            if (!experiment) {
                throw new Error('Experiment not found');
            }

            experiment.status = 'active';
            experiment.startedAt = new Date();
            experiment.updatedAt = new Date();

            await this.updateExperiment(experiment);

            console.log(`🚀 Experiment started: ${experiment.name}`);
            return experiment;
        } catch (error) {
            console.error('❌ Error starting experiment:', error);
            throw error;
        }
    }

    async stopExperiment(experimentId) {
        try {
            const experiment = this.experiments.get(experimentId);
            if (!experiment) {
                throw new Error('Experiment not found');
            }

            experiment.status = 'stopped';
            experiment.stoppedAt = new Date();
            experiment.updatedAt = new Date();

            await this.updateExperiment(experiment);

            console.log(`🛑 Experiment stopped: ${experiment.name}`);
            return experiment;
        } catch (error) {
            console.error('❌ Error stopping experiment:', error);
            throw error;
        }
    }

    // Variant Assignment
    async getVariant(userId, experimentName) {
        try {
            const experiment = this.findExperimentByName(experimentName);
            if (!experiment || experiment.status !== 'active') {
                return 'control';
            }

            // Check if user already has a variant assigned
            const existingAssignment = await this.getUserAssignment(userId, experiment.id);
            if (existingAssignment) {
                return existingAssignment.variant;
            }

            // Assign variant based on traffic split
            const variant = this.assignVariant(userId, experiment);
            
            // Store assignment
            await this.storeUserAssignment(userId, experiment.id, variant);

            console.log(`🎯 User ${userId} assigned to variant ${variant} for experiment ${experimentName}`);
            return variant;
        } catch (error) {
            console.error('❌ Error getting variant:', error);
            return 'control'; // Fallback to control
        }
    }

    assignVariant(userId, experiment) {
        // Create consistent hash for user
        const hash = crypto.createHash('md5').update(`${userId}-${experiment.id}`).digest('hex');
        const hashValue = parseInt(hash.substring(0, 8), 16);
        const normalizedValue = hashValue / 0xffffffff;

        // Assign based on traffic split
        let cumulativeSplit = 0;
        for (const variant of experiment.variants) {
            cumulativeSplit += variant.trafficSplit;
            if (normalizedValue <= cumulativeSplit) {
                return variant.id;
            }
        }

        return experiment.variants[0].id; // Fallback to first variant
    }

    // Event Tracking
    async trackEvent(userId, experimentName, eventType, eventData = {}) {
        try {
            const experiment = this.findExperimentByName(experimentName);
            if (!experiment) {
                console.warn(`⚠️ Experiment not found: ${experimentName}`);
                return;
            }

            const assignment = await this.getUserAssignment(userId, experiment.id);
            if (!assignment) {
                console.warn(`⚠️ No variant assignment found for user ${userId} in experiment ${experimentName}`);
                return;
            }

            const event = {
                id: crypto.randomUUID(),
                userId,
                experimentId: experiment.id,
                variantId: assignment.variant,
                eventType,
                eventData,
                timestamp: new Date()
            };

            await this.storeEvent(event);

            // Cache event for real-time analytics
            await this.cacheEvent(event);

            console.log(`📊 Event tracked: ${eventType} for user ${userId} in experiment ${experimentName}`);
        } catch (error) {
            console.error('❌ Error tracking event:', error);
        }
    }

    // Statistical Analysis
    async getExperimentResults(experimentId) {
        try {
            const experiment = this.experiments.get(experimentId);
            if (!experiment) {
                throw new Error('Experiment not found');
            }

            const results = await Promise.all(
                experiment.variants.map(async (variant) => {
                    const variantResults = await this.getVariantResults(experimentId, variant.id);
                    return {
                        variant,
                        ...variantResults
                    };
                })
            );

            // Calculate statistical significance
            const significance = this.calculateStatisticalSignificance(results);

            return {
                experiment,
                results,
                significance,
                analysisDate: new Date()
            };
        } catch (error) {
            console.error('❌ Error getting experiment results:', error);
            throw error;
        }
    }

    async getVariantResults(experimentId, variantId) {
        const result = await this.pgPool.query(
            `SELECT 
                event_type,
                COUNT(*) as event_count,
                COUNT(DISTINCT user_id) as unique_users,
                AVG(CAST(event_data->>'value' AS DECIMAL)) as avg_value
            FROM ab_testing_events 
            WHERE experiment_id = $1 AND variant_id = $2
            GROUP BY event_type`,
            [experimentId, variantId]
        );

        return {
            events: result.rows,
            totalEvents: result.rows.reduce((sum, row) => sum + parseInt(row.event_count), 0),
            uniqueUsers: result.rows.reduce((sum, row) => sum + parseInt(row.unique_users), 0)
        };
    }

    calculateStatisticalSignificance(results) {
        // Implement statistical significance calculation
        // This is a simplified version - in production, use proper statistical libraries
        const control = results.find(r => r.variant.name === 'control');
        const treatment = results.find(r => r.variant.name !== 'control');

        if (!control || !treatment) {
            return { significant: false, pValue: 1.0 };
        }

        // Calculate conversion rates
        const controlRate = control.conversionRate || 0;
        const treatmentRate = treatment.conversionRate || 0;

        // Simple significance test (chi-square approximation)
        const difference = Math.abs(treatmentRate - controlRate);
        const pooledRate = (controlRate + treatmentRate) / 2;
        const standardError = Math.sqrt(pooledRate * (1 - pooledRate) * (1/control.uniqueUsers + 1/treatment.uniqueUsers));
        const zScore = difference / standardError;
        const pValue = 2 * (1 - this.normalCDF(Math.abs(zScore)));

        return {
            significant: pValue < 0.05,
            pValue,
            zScore,
            confidenceLevel: (1 - pValue) * 100
        };
    }

    normalCDF(x) {
        // Approximation of normal cumulative distribution function
        return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
    }

    erf(x) {
        // Approximation of error function
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;

        const sign = x >= 0 ? 1 : -1;
        x = Math.abs(x);

        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return sign * y;
    }

    // Database Operations
    async storeExperiment(experiment) {
        await this.pgPool.query(
            `INSERT INTO ab_testing_experiments (
                id, name, description, variants, traffic_split, 
                start_date, end_date, goals, hypothesis, status, 
                created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                experiment.id,
                experiment.name,
                experiment.description,
                JSON.stringify(experiment.variants),
                JSON.stringify(experiment.trafficSplit),
                experiment.startDate,
                experiment.endDate,
                JSON.stringify(experiment.goals),
                experiment.hypothesis,
                experiment.status,
                experiment.createdAt,
                experiment.updatedAt
            ]
        );
    }

    async updateExperiment(experiment) {
        await this.pgPool.query(
            `UPDATE ab_testing_experiments 
             SET status = $1, started_at = $2, stopped_at = $3, updated_at = $4
             WHERE id = $5`,
            [
                experiment.status,
                experiment.startedAt,
                experiment.stoppedAt,
                experiment.updatedAt,
                experiment.id
            ]
        );
    }

    async storeUserAssignment(userId, experimentId, variantId) {
        await this.pgPool.query(
            `INSERT INTO ab_testing_assignments (user_id, experiment_id, variant_id, assigned_at)
             VALUES ($1, $2, $3, $4)`,
            [userId, experimentId, variantId, new Date()]
        );
    }

    async getUserAssignment(userId, experimentId) {
        const result = await this.pgPool.query(
            `SELECT variant_id as variant FROM ab_testing_assignments 
             WHERE user_id = $1 AND experiment_id = $2`,
            [userId, experimentId]
        );

        return result.rows[0] || null;
    }

    async storeEvent(event) {
        await this.pgPool.query(
            `INSERT INTO ab_testing_events (
                id, user_id, experiment_id, variant_id, event_type, 
                event_data, timestamp
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                event.id,
                event.userId,
                event.experimentId,
                event.variantId,
                event.eventType,
                JSON.stringify(event.eventData),
                event.timestamp
            ]
        );
    }

    // Cache Operations
    async cacheEvent(event) {
        const cacheKey = `ab_testing:events:${event.experimentId}:${event.variantId}`;
        await this.redis.incr(cacheKey);
        await this.redis.expire(cacheKey, 3600); // 1 hour cache
    }

    // Utility Methods
    validateExperimentConfig(config) {
        const { name, variants, trafficSplit, startDate, endDate } = config;

        if (!name || !variants || !trafficSplit) {
            throw new Error('Missing required experiment configuration');
        }

        if (variants.length < 2) {
            throw new Error('Experiment must have at least 2 variants');
        }

        const totalSplit = variants.reduce((sum, variant) => sum + variant.trafficSplit, 0);
        if (Math.abs(totalSplit - 1) > 0.01) {
            throw new Error('Traffic split must sum to 1.0');
        }

        if (new Date(startDate) >= new Date(endDate)) {
            throw new Error('Start date must be before end date');
        }
    }

    findExperimentByName(name) {
        for (const experiment of this.experiments.values()) {
            if (experiment.name === name) {
                return experiment;
            }
        }
        return null;
    }

    async loadExperiments() {
        try {
            const result = await this.pgPool.query(
                `SELECT * FROM ab_testing_experiments WHERE status != 'deleted'`
            );

            for (const row of result.rows) {
                const experiment = {
                    ...row,
                    variants: JSON.parse(row.variants),
                    trafficSplit: JSON.parse(row.traffic_split),
                    goals: JSON.parse(row.goals)
                };
                this.experiments.set(experiment.id, experiment);
            }

            console.log(`📊 Loaded ${this.experiments.size} experiments`);
        } catch (error) {
            console.error('❌ Error loading experiments:', error);
        }
    }

    // Experiment Templates
    getExperimentTemplates() {
        return {
            'chatbot-welcome-message': {
                name: 'Chatbot Welcome Message',
                description: 'Test different welcome messages to improve engagement',
                variants: [
                    { name: 'control', trafficSplit: 0.5, content: 'Hi! I\'m Dave from Elate Moving. How can I help you today?' },
                    { name: 'friendly', trafficSplit: 0.25, content: 'Hey there! 👋 I\'m Dave, your moving buddy. Ready to make your move stress-free?' },
                    { name: 'professional', trafficSplit: 0.25, content: 'Welcome to Elate Moving. I\'m Dave, your moving specialist. What brings you here today?' }
                ],
                goals: ['engagement', 'conversion'],
                hypothesis: 'A more personalized welcome message will increase user engagement and lead to higher conversion rates.'
            },
            'quote-form-design': {
                name: 'Quote Form Design',
                description: 'Test different form layouts to improve completion rates',
                variants: [
                    { name: 'control', trafficSplit: 0.5, layout: 'single-column' },
                    { name: 'multi-step', trafficSplit: 0.25, layout: 'multi-step' },
                    { name: 'progressive', trafficSplit: 0.25, layout: 'progressive-disclosure' }
                ],
                goals: ['form_completion', 'conversion'],
                hypothesis: 'A multi-step form will reduce cognitive load and increase completion rates.'
            },
            'pricing-display': {
                name: 'Pricing Display',
                description: 'Test different pricing presentation methods',
                variants: [
                    { name: 'control', trafficSplit: 0.33, display: 'range' },
                    { name: 'exact', trafficSplit: 0.33, display: 'exact' },
                    { name: 'calculator', trafficSplit: 0.34, display: 'interactive' }
                ],
                goals: ['transparency', 'conversion'],
                hypothesis: 'Showing exact pricing will build trust and increase conversions.'
            }
        };
    }

    // Reporting
    async generateExperimentReport(experimentId) {
        try {
            const results = await this.getExperimentResults(experimentId);
            const experiment = results.experiment;

            const report = {
                experiment: {
                    name: experiment.name,
                    description: experiment.description,
                    status: experiment.status,
                    duration: this.calculateDuration(experiment.startDate, experiment.endDate)
                },
                results: results.results.map(result => ({
                    variant: result.variant.name,
                    users: result.uniqueUsers,
                    events: result.totalEvents,
                    conversionRate: this.calculateConversionRate(result.events),
                    avgValue: this.calculateAverageValue(result.events)
                })),
                significance: results.significance,
                recommendations: this.generateRecommendations(results),
                generatedAt: new Date()
            };

            return report;
        } catch (error) {
            console.error('❌ Error generating experiment report:', error);
            throw error;
        }
    }

    calculateConversionRate(events) {
        const conversionEvents = events.find(e => e.event_type === 'conversion');
        const totalEvents = events.reduce((sum, e) => sum + parseInt(e.event_count), 0);
        
        return conversionEvents ? (parseInt(conversionEvents.event_count) / totalEvents) * 100 : 0;
    }

    calculateAverageValue(events) {
        const conversionEvents = events.find(e => e.event_type === 'conversion');
        return conversionEvents ? parseFloat(conversionEvents.avg_value) || 0 : 0;
    }

    calculateDuration(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end - start);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    generateRecommendations(results) {
        const recommendations = [];

        if (results.significance.significant) {
            const bestVariant = results.results.reduce((best, current) => {
                const currentRate = this.calculateConversionRate(current.events);
                const bestRate = this.calculateConversionRate(best.events);
                return currentRate > bestRate ? current : best;
            });

            recommendations.push({
                type: 'winner',
                variant: bestVariant.variant.name,
                confidence: results.significance.confidenceLevel,
                action: `Implement ${bestVariant.variant.name} variant as the new default`
            });
        } else {
            recommendations.push({
                type: 'insufficient_data',
                action: 'Continue experiment to gather more data for statistical significance'
            });
        }

        return recommendations;
    }
}

module.exports = ABTestingFramework; 