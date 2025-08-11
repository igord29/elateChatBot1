const { Pool } = require('pg');
const Redis = require('ioredis');
const moment = require('moment');

class AnalyticsDashboard {
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

        console.log('📊 Analytics Dashboard initialized');
    }

    // Real-time Metrics
    async getRealTimeMetrics() {
        try {
            const [
                activeConversations,
                todayLeads,
                todayConversions,
                averageResponseTime
            ] = await Promise.all([
                this.getActiveConversations(),
                this.getTodayLeads(),
                this.getTodayConversions(),
                this.getAverageResponseTime()
            ]);

            return {
                activeConversations,
                todayLeads,
                todayConversions,
                averageResponseTime,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ Error getting real-time metrics:', error);
            throw error;
        }
    }

    async getActiveConversations() {
        const result = await this.pgPool.query(
            `SELECT COUNT(*) as count 
             FROM conversations 
             WHERE status = 'active' 
             AND updated_at > NOW() - INTERVAL '1 hour'`
        );
        return parseInt(result.rows[0].count);
    }

    async getTodayLeads() {
        const result = await this.pgPool.query(
            `SELECT COUNT(*) as count 
             FROM leads 
             WHERE DATE(created_at) = CURRENT_DATE`
        );
        return parseInt(result.rows[0].count);
    }

    async getTodayConversions() {
        const result = await this.pgPool.query(
            `SELECT COUNT(*) as count 
             FROM leads 
             WHERE DATE(created_at) = CURRENT_DATE 
             AND status = 'converted'`
        );
        return parseInt(result.rows[0].count);
    }

    async getAverageResponseTime() {
        const result = await this.pgPool.query(
            `SELECT AVG(EXTRACT(EPOCH FROM (m2.created_at - m1.created_at))) as avg_time
             FROM messages m1
             JOIN messages m2 ON m1.conversation_id = m2.conversation_id
             WHERE m1.role = 'user' 
             AND m2.role = 'assistant'
             AND m2.created_at > m1.created_at
             AND m2.created_at > NOW() - INTERVAL '24 hours'`
        );
        return Math.round(result.rows[0].avg_time || 0);
    }

    // Conversion Analytics
    async getConversionAnalytics(startDate, endDate) {
        try {
            const result = await this.pgPool.query(
                `SELECT 
                    DATE(created_at) as date,
                    COUNT(*) as total_leads,
                    COUNT(CASE WHEN status = 'converted' THEN 1 END) as conversions,
                    ROUND(
                        COUNT(CASE WHEN status = 'converted' THEN 1 END)::DECIMAL / 
                        COUNT(*)::DECIMAL * 100, 2
                    ) as conversion_rate
                FROM leads 
                WHERE created_at BETWEEN $1 AND $2
                GROUP BY DATE(created_at)
                ORDER BY date`,
                [startDate, endDate]
            );

            return result.rows;
        } catch (error) {
            console.error('❌ Error getting conversion analytics:', error);
            throw error;
        }
    }

    // Lead Source Analytics
    async getLeadSourceAnalytics() {
        try {
            const result = await this.pgPool.query(
                `SELECT 
                    CASE 
                        WHEN metadata->>'source' IS NOT NULL THEN metadata->>'source'
                        ELSE 'unknown'
                    END as source,
                    COUNT(*) as total_leads,
                    COUNT(CASE WHEN status = 'converted' THEN 1 END) as conversions,
                    ROUND(
                        COUNT(CASE WHEN status = 'converted' THEN 1 END)::DECIMAL / 
                        COUNT(*)::DECIMAL * 100, 2
                    ) as conversion_rate
                FROM leads 
                WHERE created_at > NOW() - INTERVAL '30 days'
                GROUP BY source
                ORDER BY total_leads DESC`
            );

            return result.rows;
        } catch (error) {
            console.error('❌ Error getting lead source analytics:', error);
            throw error;
        }
    }

    // Service Type Analytics
    async getServiceTypeAnalytics() {
        try {
            const result = await this.pgPool.query(
                `SELECT 
                    service_type,
                    COUNT(*) as total_leads,
                    AVG(estimated_cost) as avg_cost,
                    AVG(estimated_distance) as avg_distance,
                    COUNT(CASE WHEN status = 'converted' THEN 1 END) as conversions
                FROM leads 
                WHERE created_at > NOW() - INTERVAL '30 days'
                GROUP BY service_type
                ORDER BY total_leads DESC`
            );

            return result.rows;
        } catch (error) {
            console.error('❌ Error getting service type analytics:', error);
            throw error;
        }
    }

    // Geographic Analytics
    async getGeographicAnalytics() {
        try {
            const result = await this.pgPool.query(
                `SELECT 
                    SUBSTRING(origin_address FROM '([^,]+),?\s*[A-Z]{2}\s*\d{5}') as city,
                    COUNT(*) as total_leads,
                    AVG(estimated_cost) as avg_cost,
                    COUNT(CASE WHEN status = 'converted' THEN 1 END) as conversions
                FROM leads 
                WHERE created_at > NOW() - INTERVAL '30 days'
                AND origin_address IS NOT NULL
                GROUP BY city
                HAVING COUNT(*) > 1
                ORDER BY total_leads DESC
                LIMIT 10`
            );

            return result.rows;
        } catch (error) {
            console.error('❌ Error getting geographic analytics:', error);
            throw error;
        }
    }

    // Chatbot Performance Analytics
    async getChatbotPerformanceAnalytics() {
        try {
            const result = await this.pgPool.query(
                `SELECT 
                    DATE(created_at) as date,
                    COUNT(DISTINCT conversation_id) as conversations,
                    COUNT(*) as total_messages,
                    AVG(message_length) as avg_message_length,
                    COUNT(CASE WHEN role = 'user' THEN 1 END) as user_messages,
                    COUNT(CASE WHEN role = 'assistant' THEN 1 END) as bot_messages
                FROM messages 
                WHERE created_at > NOW() - INTERVAL '30 days'
                GROUP BY DATE(created_at)
                ORDER BY date`
            );

            return result.rows;
        } catch (error) {
            console.error('❌ Error getting chatbot performance analytics:', error);
            throw error;
        }
    }

    // Predictive Analytics
    async getPredictiveAnalytics() {
        try {
            // Lead scoring prediction
            const leadScoring = await this.pgPool.query(
                `SELECT 
                    AVG(CASE WHEN status = 'converted' THEN estimated_cost END) as avg_conversion_value,
                    AVG(CASE WHEN status = 'converted' THEN estimated_distance END) as avg_conversion_distance,
                    COUNT(CASE WHEN status = 'converted' THEN 1 END)::DECIMAL / COUNT(*)::DECIMAL as conversion_probability
                FROM leads 
                WHERE created_at > NOW() - INTERVAL '90 days'`
            );

            // Seasonal trends
            const seasonalTrends = await this.pgPool.query(
                `SELECT 
                    EXTRACT(MONTH FROM created_at) as month,
                    COUNT(*) as total_leads,
                    AVG(estimated_cost) as avg_cost,
                    COUNT(CASE WHEN status = 'converted' THEN 1 END) as conversions
                FROM leads 
                WHERE created_at > NOW() - INTERVAL '1 year'
                GROUP BY EXTRACT(MONTH FROM created_at)
                ORDER BY month`
            );

            // Peak hours analysis
            const peakHours = await this.pgPool.query(
                `SELECT 
                    EXTRACT(HOUR FROM created_at) as hour,
                    COUNT(*) as total_leads,
                    COUNT(CASE WHEN status = 'converted' THEN 1 END) as conversions
                FROM leads 
                WHERE created_at > NOW() - INTERVAL '30 days'
                GROUP BY EXTRACT(HOUR FROM created_at)
                ORDER BY hour`
            );

            return {
                leadScoring: leadScoring.rows[0],
                seasonalTrends: seasonalTrends.rows,
                peakHours: peakHours.rows
            };
        } catch (error) {
            console.error('❌ Error getting predictive analytics:', error);
            throw error;
        }
    }

    // A/B Testing Analytics
    async getABTestingAnalytics(experimentName) {
        try {
            const result = await this.pgPool.query(
                `SELECT 
                    variant,
                    COUNT(*) as total_users,
                    COUNT(CASE WHEN event_type = 'conversion' THEN 1 END) as conversions,
                    ROUND(
                        COUNT(CASE WHEN event_type = 'conversion' THEN 1 END)::DECIMAL / 
                        COUNT(*)::DECIMAL * 100, 2
                    ) as conversion_rate,
                    AVG(CASE WHEN event_type = 'conversion' THEN event_data->>'value' END) as avg_value
                FROM ab_testing 
                WHERE experiment_name = $1
                GROUP BY variant
                ORDER BY variant`,
                [experimentName]
            );

            return result.rows;
        } catch (error) {
            console.error('❌ Error getting A/B testing analytics:', error);
            throw error;
        }
    }

    // Revenue Analytics
    async getRevenueAnalytics(startDate, endDate) {
        try {
            const result = await this.pgPool.query(
                `SELECT 
                    DATE(created_at) as date,
                    SUM(estimated_cost) as total_revenue,
                    COUNT(*) as total_leads,
                    AVG(estimated_cost) as avg_lead_value,
                    SUM(CASE WHEN status = 'converted' THEN estimated_cost ELSE 0 END) as converted_revenue,
                    COUNT(CASE WHEN status = 'converted' THEN 1 END) as conversions
                FROM leads 
                WHERE created_at BETWEEN $1 AND $2
                GROUP BY DATE(created_at)
                ORDER BY date`,
                [startDate, endDate]
            );

            return result.rows;
        } catch (error) {
            console.error('❌ Error getting revenue analytics:', error);
            throw error;
        }
    }

    // Customer Journey Analytics
    async getCustomerJourneyAnalytics() {
        try {
            const result = await this.pgPool.query(
                `SELECT 
                    conversation_id,
                    COUNT(*) as message_count,
                    MIN(created_at) as first_message,
                    MAX(created_at) as last_message,
                    EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) as duration_seconds,
                    COUNT(CASE WHEN role = 'user' THEN 1 END) as user_messages,
                    COUNT(CASE WHEN role = 'assistant' THEN 1 END) as bot_messages,
                    CASE 
                        WHEN EXISTS (SELECT 1 FROM leads WHERE conversation_id = c.conversation_id) 
                        THEN 'converted' 
                        ELSE 'abandoned' 
                    END as outcome
                FROM messages m
                JOIN conversations c ON m.conversation_id = c.id
                WHERE m.created_at > NOW() - INTERVAL '30 days'
                GROUP BY conversation_id, c.conversation_id
                ORDER BY message_count DESC`
            );

            return result.rows;
        } catch (error) {
            console.error('❌ Error getting customer journey analytics:', error);
            throw error;
        }
    }

    // Performance Metrics
    async getPerformanceMetrics() {
        try {
            const metrics = await Promise.all([
                this.getResponseTimeMetrics(),
                this.getUptimeMetrics(),
                this.getErrorMetrics(),
                this.getScalabilityMetrics()
            ]);

            return {
                responseTime: metrics[0],
                uptime: metrics[1],
                errors: metrics[2],
                scalability: metrics[3]
            };
        } catch (error) {
            console.error('❌ Error getting performance metrics:', error);
            throw error;
        }
    }

    async getResponseTimeMetrics() {
        const result = await this.pgPool.query(
            `SELECT 
                AVG(response_time) as avg_response_time,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time) as p95_response_time,
                PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time) as p99_response_time,
                MAX(response_time) as max_response_time
            FROM performance_metrics 
            WHERE created_at > NOW() - INTERVAL '24 hours'`
        );

        return result.rows[0];
    }

    async getUptimeMetrics() {
        // Calculate uptime based on health checks
        const result = await this.pgPool.query(
            `SELECT 
                COUNT(CASE WHEN status = 'healthy' THEN 1 END)::DECIMAL / 
                COUNT(*)::DECIMAL * 100 as uptime_percentage
            FROM health_checks 
            WHERE created_at > NOW() - INTERVAL '24 hours'`
        );

        return result.rows[0];
    }

    async getErrorMetrics() {
        const result = await this.pgPool.query(
            `SELECT 
                error_type,
                COUNT(*) as error_count,
                AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) as avg_resolution_time
            FROM error_logs 
            WHERE created_at > NOW() - INTERVAL '24 hours'
            GROUP BY error_type
            ORDER BY error_count DESC`
        );

        return result.rows;
    }

    async getScalabilityMetrics() {
        // Get concurrent connections, memory usage, etc.
        const result = await this.pgPool.query(
            `SELECT 
                AVG(active_connections) as avg_concurrent_connections,
                MAX(active_connections) as peak_concurrent_connections,
                AVG(memory_usage) as avg_memory_usage,
                AVG(cpu_usage) as avg_cpu_usage
            FROM system_metrics 
            WHERE created_at > NOW() - INTERVAL '24 hours'`
        );

        return result.rows[0];
    }

    // Real-time Dashboard Data
    async getDashboardData() {
        try {
            const [
                realTimeMetrics,
                conversionAnalytics,
                leadSourceAnalytics,
                serviceTypeAnalytics,
                geographicAnalytics,
                predictiveAnalytics
            ] = await Promise.all([
                this.getRealTimeMetrics(),
                this.getConversionAnalytics(
                    moment().subtract(30, 'days').format('YYYY-MM-DD'),
                    moment().format('YYYY-MM-DD')
                ),
                this.getLeadSourceAnalytics(),
                this.getServiceTypeAnalytics(),
                this.getGeographicAnalytics(),
                this.getPredictiveAnalytics()
            ]);

            return {
                realTimeMetrics,
                conversionAnalytics,
                leadSourceAnalytics,
                serviceTypeAnalytics,
                geographicAnalytics,
                predictiveAnalytics,
                lastUpdated: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ Error getting dashboard data:', error);
            throw error;
        }
    }

    // Export Analytics Data
    async exportAnalyticsData(startDate, endDate, format = 'json') {
        try {
            const data = await this.getDashboardData();
            
            if (format === 'csv') {
                return this.convertToCSV(data);
            } else if (format === 'excel') {
                return this.convertToExcel(data);
            } else {
                return JSON.stringify(data, null, 2);
            }
        } catch (error) {
            console.error('❌ Error exporting analytics data:', error);
            throw error;
        }
    }

    convertToCSV(data) {
        // Implementation for CSV conversion
        const csvRows = [];
        
        // Add headers
        csvRows.push(['Metric', 'Value', 'Date']);
        
        // Add data rows
        Object.entries(data.realTimeMetrics).forEach(([key, value]) => {
            csvRows.push([key, value, new Date().toISOString()]);
        });
        
        return csvRows.map(row => row.join(',')).join('\n');
    }

    convertToExcel(data) {
        // Implementation for Excel conversion
        // In production, use a library like 'xlsx'
        return data;
    }

    // Cache Analytics Data
    async cacheAnalyticsData() {
        try {
            const dashboardData = await this.getDashboardData();
            
            await this.redis.setex(
                'analytics:dashboard',
                300, // 5 minutes cache
                JSON.stringify(dashboardData)
            );
            
            console.log('✅ Analytics data cached successfully');
        } catch (error) {
            console.error('❌ Error caching analytics data:', error);
        }
    }

    async getCachedAnalyticsData() {
        try {
            const cached = await this.redis.get('analytics:dashboard');
            return cached ? JSON.parse(cached) : null;
        } catch (error) {
            console.error('❌ Error getting cached analytics data:', error);
            return null;
        }
    }
}

module.exports = AnalyticsDashboard; 