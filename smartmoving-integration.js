const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class SmartMovingIntegration {
    constructor() {
        this.baseURL = process.env.SMARTMOVING_BASE_URL || 'https://api.smartmoving.com/v1';
        this.apiKey = process.env.SMARTMOVING_API_KEY;
        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'MovingChatbot/1.0'
            },
            timeout: 10000
        });

        console.log('🔗 SmartMoving CRM integration initialized');
    }

    // Lead Management
    async createLead(leadData) {
        try {
            console.log('📝 Creating lead in SmartMoving CRM...');
            
            const smartMovingLead = this.transformLeadData(leadData);
            
            const response = await this.client.post('/leads', smartMovingLead);
            
            console.log('✅ Lead created successfully in SmartMoving CRM');
            
            // Store the SmartMoving lead ID for future reference
            await this.storeLeadMapping(leadData.id, response.data.id);
            
            return {
                success: true,
                smartMovingId: response.data.id,
                lead: response.data
            };
        } catch (error) {
            console.error('❌ Failed to create lead in SmartMoving:', error.response?.data || error.message);
            throw new Error(`SmartMoving integration failed: ${error.message}`);
        }
    }

    async updateLead(leadId, updateData) {
        try {
            const smartMovingId = await this.getSmartMovingLeadId(leadId);
            
            if (!smartMovingId) {
                throw new Error('Lead not found in SmartMoving CRM');
            }

            const response = await this.client.put(`/leads/${smartMovingId}`, updateData);
            
            console.log('✅ Lead updated successfully in SmartMoving CRM');
            
            return {
                success: true,
                lead: response.data
            };
        } catch (error) {
            console.error('❌ Failed to update lead in SmartMoving:', error.response?.data || error.message);
            throw new Error(`SmartMoving update failed: ${error.message}`);
        }
    }

    async getLead(leadId) {
        try {
            const smartMovingId = await this.getSmartMovingLeadId(leadId);
            
            if (!smartMovingId) {
                throw new Error('Lead not found in SmartMoving CRM');
            }

            const response = await this.client.get(`/leads/${smartMovingId}`);
            
            return response.data;
        } catch (error) {
            console.error('❌ Failed to get lead from SmartMoving:', error.response?.data || error.message);
            throw new Error(`SmartMoving retrieval failed: ${error.message}`);
        }
    }

    // Appointment Scheduling
    async scheduleAppointment(appointmentData) {
        try {
            console.log('📅 Scheduling appointment in SmartMoving CRM...');
            
            const smartMovingAppointment = this.transformAppointmentData(appointmentData);
            
            const response = await this.client.post('/appointments', smartMovingAppointment);
            
            console.log('✅ Appointment scheduled successfully in SmartMoving CRM');
            
            return {
                success: true,
                appointmentId: response.data.id,
                appointment: response.data
            };
        } catch (error) {
            console.error('❌ Failed to schedule appointment in SmartMoving:', error.response?.data || error.message);
            throw new Error(`SmartMoving appointment scheduling failed: ${error.message}`);
        }
    }

    async getAvailableSlots(date, duration = 120) {
        try {
            const response = await this.client.get('/appointments/available-slots', {
                params: {
                    date: date.toISOString().split('T')[0],
                    duration: duration,
                    service_type: 'moving'
                }
            });
            
            return response.data.slots;
        } catch (error) {
            console.error('❌ Failed to get available slots from SmartMoving:', error.response?.data || error.message);
            throw new Error(`SmartMoving slot retrieval failed: ${error.message}`);
        }
    }

    // Quote Management
    async createQuote(quoteData) {
        try {
            console.log('💰 Creating quote in SmartMoving CRM...');
            
            const smartMovingQuote = this.transformQuoteData(quoteData);
            
            const response = await this.client.post('/quotes', smartMovingQuote);
            
            console.log('✅ Quote created successfully in SmartMoving CRM');
            
            return {
                success: true,
                quoteId: response.data.id,
                quote: response.data
            };
        } catch (error) {
            console.error('❌ Failed to create quote in SmartMoving:', error.response?.data || error.message);
            throw new Error(`SmartMoving quote creation failed: ${error.message}`);
        }
    }

    async updateQuote(quoteId, updateData) {
        try {
            const response = await this.client.put(`/quotes/${quoteId}`, updateData);
            
            console.log('✅ Quote updated successfully in SmartMoving CRM');
            
            return {
                success: true,
                quote: response.data
            };
        } catch (error) {
            console.error('❌ Failed to update quote in SmartMoving:', error.response?.data || error.message);
            throw new Error(`SmartMoving quote update failed: ${error.message}`);
        }
    }

    // Team Management
    async assignLeadToTeam(leadId, teamId) {
        try {
            const smartMovingId = await this.getSmartMovingLeadId(leadId);
            
            if (!smartMovingId) {
                throw new Error('Lead not found in SmartMoving CRM');
            }

            const response = await this.client.put(`/leads/${smartMovingId}/assign`, {
                team_id: teamId,
                assigned_at: new Date().toISOString()
            });
            
            console.log('✅ Lead assigned to team successfully in SmartMoving CRM');
            
            return {
                success: true,
                assignment: response.data
            };
        } catch (error) {
            console.error('❌ Failed to assign lead to team in SmartMoving:', error.response?.data || error.message);
            throw new Error(`SmartMoving team assignment failed: ${error.message}`);
        }
    }

    async getTeamMembers(teamId) {
        try {
            const response = await this.client.get(`/teams/${teamId}/members`);
            
            return response.data.members;
        } catch (error) {
            console.error('❌ Failed to get team members from SmartMoving:', error.response?.data || error.message);
            throw new Error(`SmartMoving team member retrieval failed: ${error.message}`);
        }
    }

    // Data Transformation Methods
    transformLeadData(leadData) {
        return {
            external_id: leadData.id,
            first_name: leadData.firstName,
            last_name: leadData.lastName,
            email: leadData.email,
            phone: leadData.phoneNumber,
            origin_address: {
                street: leadData.originAddress,
                city: this.extractCity(leadData.originAddress),
                state: this.extractState(leadData.originAddress),
                zip_code: this.extractZipCode(leadData.originAddress)
            },
            destination_address: {
                street: leadData.destinationAddress,
                city: this.extractCity(leadData.destinationAddress),
                state: this.extractState(leadData.destinationAddress),
                zip_code: this.extractZipCode(leadData.destinationAddress)
            },
            move_date: leadData.moveDate,
            service_type: this.mapServiceType(leadData.serviceType),
            estimated_distance: leadData.estimatedDistance,
            estimated_cost: leadData.estimatedCost,
            source: 'chatbot',
            status: 'new',
            created_at: new Date().toISOString(),
            metadata: {
                conversation_id: leadData.conversationId,
                chatbot_version: '1.0',
                lead_score: this.calculateLeadScore(leadData)
            }
        };
    }

    transformAppointmentData(appointmentData) {
        return {
            lead_id: appointmentData.leadId,
            appointment_type: 'estimate',
            scheduled_at: appointmentData.scheduledAt,
            duration: appointmentData.duration || 120,
            notes: appointmentData.notes,
            team_member_id: appointmentData.teamMemberId,
            location: appointmentData.location,
            status: 'scheduled',
            created_at: new Date().toISOString()
        };
    }

    transformQuoteData(quoteData) {
        return {
            lead_id: quoteData.leadId,
            total_amount: quoteData.totalAmount,
            breakdown: quoteData.breakdown,
            valid_until: quoteData.validUntil,
            terms_and_conditions: quoteData.termsAndConditions,
            status: 'draft',
            created_at: new Date().toISOString()
        };
    }

    // Utility Methods
    mapServiceType(serviceType) {
        const serviceTypeMap = {
            'full-service': 'full_service',
            'pack-and-move': 'pack_and_move',
            'labor-and-truck': 'labor_and_truck',
            'labor-only': 'labor_only',
            'specialty': 'specialty_items'
        };
        
        return serviceTypeMap[serviceType] || 'full_service';
    }

    calculateLeadScore(leadData) {
        let score = 0;
        
        // Distance factor (longer moves = higher score)
        if (leadData.estimatedDistance > 100) score += 20;
        else if (leadData.estimatedDistance > 50) score += 15;
        else if (leadData.estimatedDistance > 25) score += 10;
        else score += 5;
        
        // Service type factor
        const serviceScores = {
            'full-service': 25,
            'pack-and-move': 20,
            'labor-and-truck': 15,
            'labor-only': 10,
            'specialty': 30
        };
        score += serviceScores[leadData.serviceType] || 15;
        
        // Urgency factor
        const daysUntilMove = this.calculateDaysUntilMove(leadData.moveDate);
        if (daysUntilMove <= 7) score += 30;
        else if (daysUntilMove <= 14) score += 20;
        else if (daysUntilMove <= 30) score += 10;
        
        return Math.min(score, 100);
    }

    calculateDaysUntilMove(moveDate) {
        const today = new Date();
        const move = new Date(moveDate);
        const diffTime = move - today;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    extractCity(address) {
        // Simple city extraction - in production, use a proper address parser
        const parts = address.split(',').map(part => part.trim());
        return parts[parts.length - 2] || '';
    }

    extractState(address) {
        // Simple state extraction - in production, use a proper address parser
        const parts = address.split(',').map(part => part.trim());
        const lastPart = parts[parts.length - 1];
        return lastPart && lastPart.length === 2 ? lastPart : '';
    }

    extractZipCode(address) {
        // Simple zip code extraction - in production, use a proper address parser
        const zipMatch = address.match(/\b\d{5}(?:-\d{4})?\b/);
        return zipMatch ? zipMatch[0] : '';
    }

    // Database mapping methods (simplified - in production, use proper database)
    async storeLeadMapping(chatbotLeadId, smartMovingLeadId) {
        // In production, store this in your database
        console.log(`📊 Storing lead mapping: ${chatbotLeadId} -> ${smartMovingLeadId}`);
    }

    async getSmartMovingLeadId(chatbotLeadId) {
        // In production, retrieve from your database
        console.log(`📊 Retrieving SmartMoving lead ID for: ${chatbotLeadId}`);
        return null; // Placeholder
    }

    // Webhook handlers for real-time updates
    async handleSmartMovingWebhook(webhookData) {
        try {
            console.log('🔄 Processing SmartMoving webhook...');
            
            const { event_type, data } = webhookData;
            
            switch (event_type) {
                case 'lead.updated':
                    await this.handleLeadUpdate(data);
                    break;
                case 'appointment.created':
                    await this.handleAppointmentCreated(data);
                    break;
                case 'quote.accepted':
                    await this.handleQuoteAccepted(data);
                    break;
                case 'lead.converted':
                    await this.handleLeadConverted(data);
                    break;
                default:
                    console.log(`⚠️ Unknown webhook event type: ${event_type}`);
            }
            
            console.log('✅ Webhook processed successfully');
        } catch (error) {
            console.error('❌ Failed to process SmartMoving webhook:', error);
            throw error;
        }
    }

    async handleLeadUpdate(data) {
        // Update local lead data
        console.log(`📝 Lead updated in SmartMoving: ${data.id}`);
        // Implement your local update logic here
    }

    async handleAppointmentCreated(data) {
        // Create local appointment record
        console.log(`📅 Appointment created in SmartMoving: ${data.id}`);
        // Implement your local appointment creation logic here
    }

    async handleQuoteAccepted(data) {
        // Update quote status and trigger next steps
        console.log(`💰 Quote accepted in SmartMoving: ${data.id}`);
        // Implement your quote acceptance logic here
    }

    async handleLeadConverted(data) {
        // Handle lead conversion
        console.log(`🎉 Lead converted in SmartMoving: ${data.id}`);
        // Implement your lead conversion logic here
    }

    // Health check
    async checkConnection() {
        try {
            const response = await this.client.get('/health');
            return {
                status: 'connected',
                timestamp: new Date().toISOString(),
                response: response.data
            };
        } catch (error) {
            return {
                status: 'disconnected',
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }
}

module.exports = SmartMovingIntegration; 