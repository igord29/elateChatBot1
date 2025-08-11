const OpenAI = require('openai');
const axios = require('axios');

class PropertyTypeDetector {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        this.propertyTypes = {
            'apartment': {
                name: 'Apartment',
                description: 'Multi-unit residential building',
                multiplier: 1.0,
                characteristics: ['elevator', 'stairs', 'parking', 'amenities'],
                challenges: ['elevator scheduling', 'parking restrictions', 'loading zones']
            },
            'house': {
                name: 'Single Family House',
                description: 'Detached residential home',
                multiplier: 1.2,
                characteristics: ['driveway', 'garage', 'yard', 'basement'],
                challenges: ['parking', 'accessibility', 'weather considerations']
            },
            'condo': {
                name: 'Condominium',
                description: 'Individually owned unit in shared building',
                multiplier: 1.1,
                characteristics: ['elevator', 'amenities', 'parking', 'security'],
                challenges: ['elevator scheduling', 'parking restrictions', 'building rules']
            },
            'townhouse': {
                name: 'Townhouse',
                description: 'Multi-level attached home',
                multiplier: 1.15,
                characteristics: ['stairs', 'parking', 'shared walls'],
                challenges: ['stairs', 'parking', 'accessibility']
            },
            'office': {
                name: 'Office Building',
                description: 'Commercial office space',
                multiplier: 1.5,
                characteristics: ['elevator', 'security', 'business hours', 'parking'],
                challenges: ['business hours', 'security clearance', 'parking restrictions']
            },
            'warehouse': {
                name: 'Warehouse/Industrial',
                description: 'Large storage or industrial space',
                multiplier: 2.0,
                characteristics: ['loading dock', 'high ceilings', 'heavy equipment'],
                challenges: ['heavy items', 'specialized equipment', 'scheduling']
            },
            'studio': {
                name: 'Studio Apartment',
                description: 'Single room living space',
                multiplier: 0.9,
                characteristics: ['compact', 'efficient layout', 'minimal furniture'],
                challenges: ['space constraints', 'furniture disassembly']
            },
            'loft': {
                name: 'Loft',
                description: 'Open concept living space',
                multiplier: 1.1,
                characteristics: ['high ceilings', 'open layout', 'industrial features'],
                challenges: ['high ceilings', 'furniture handling']
            },
            'penthouse': {
                name: 'Penthouse',
                description: 'Luxury top-floor residence',
                multiplier: 1.4,
                characteristics: ['elevator', 'luxury amenities', 'views', 'security'],
                challenges: ['elevator scheduling', 'luxury handling', 'security clearance']
            },
            'mobile-home': {
                name: 'Mobile Home',
                description: 'Manufactured or mobile home',
                multiplier: 0.8,
                characteristics: ['compact', 'manufactured', 'park model'],
                challenges: ['size constraints', 'specialized handling']
            }
        };

        this.addressPatterns = {
            'apartment': /(apt|apartment|unit|suite|#)/i,
            'condo': /(condo|condominium)/i,
            'office': /(office|suite|floor|building|plaza|tower)/i,
            'warehouse': /(warehouse|industrial|factory|storage)/i,
            'studio': /(studio)/i,
            'loft': /(loft)/i,
            'penthouse': /(penthouse|ph)/i,
            'mobile-home': /(mobile|manufactured|trailer)/i
        };

        console.log('🏠 Property Type Detector initialized');
    }

    // Main Detection Method
    async detectPropertyType(address, description = '') {
        try {
            console.log(`🔍 Analyzing property: ${address}`);
            
            // Combine address and description for analysis
            const fullText = `${address} ${description}`.trim();
            
            // Use AI for primary detection
            const aiDetection = await this.detectWithAI(fullText);
            
            // Use pattern matching as backup
            const patternDetection = this.detectWithPatterns(fullText);
            
            // Combine results with confidence scoring
            const finalDetection = this.combineDetections(aiDetection, patternDetection);
            
            console.log(`✅ Property type detected: ${finalDetection.type} (confidence: ${finalDetection.confidence}%)`);
            
            return finalDetection;
        } catch (error) {
            console.error('❌ Error detecting property type:', error);
            return {
                type: 'apartment',
                confidence: 50,
                fallback: true,
                reason: 'Detection failed, using default'
            };
        }
    }

    // AI-Powered Detection
    async detectWithAI(text) {
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: `You are a property classification expert for a moving company. 
                        Analyze the given text and classify the property type into one of these categories:
                        - apartment: Multi-unit residential building
                        - house: Single family detached home
                        - condo: Individually owned unit in shared building
                        - townhouse: Multi-level attached home
                        - office: Commercial office space
                        - warehouse: Industrial or storage facility
                        - studio: Single room living space
                        - loft: Open concept living space
                        - penthouse: Luxury top-floor residence
                        - mobile-home: Manufactured or mobile home
                        
                        Respond with only the property type and confidence score (0-100) in this format:
                        type:confidence
                        Example: apartment:85`
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                temperature: 0.1,
                max_tokens: 20
            });

            const result = response.choices[0].message.content.trim();
            const [type, confidence] = result.split(':');
            
            return {
                type: type || 'apartment',
                confidence: parseInt(confidence) || 50
            };
        } catch (error) {
            console.error('❌ AI detection failed:', error);
            return {
                type: 'apartment',
                confidence: 30
            };
        }
    }

    // Pattern-Based Detection
    detectWithPatterns(text) {
        const textLower = text.toLowerCase();
        const matches = [];

        for (const [type, pattern] of Object.entries(this.addressPatterns)) {
            if (pattern.test(textLower)) {
                matches.push({
                    type,
                    confidence: 70,
                    method: 'pattern'
                });
            }
        }

        // Additional heuristics
        if (textLower.includes('floor') && textLower.includes('building')) {
            matches.push({
                type: 'office',
                confidence: 80,
                method: 'heuristic'
            });
        }

        if (textLower.includes('driveway') || textLower.includes('garage')) {
            matches.push({
                type: 'house',
                confidence: 75,
                method: 'heuristic'
            });
        }

        if (textLower.includes('elevator') && textLower.includes('amenities')) {
            matches.push({
                type: 'condo',
                confidence: 80,
                method: 'heuristic'
            });
        }

        return matches.length > 0 ? matches[0] : {
            type: 'apartment',
            confidence: 40,
            method: 'default'
        };
    }

    // Combine Detection Results
    combineDetections(aiDetection, patternDetection) {
        let finalType = aiDetection.type;
        let finalConfidence = aiDetection.confidence;

        // If AI confidence is low, consider pattern detection
        if (aiDetection.confidence < 60 && patternDetection.confidence > 60) {
            finalType = patternDetection.type;
            finalConfidence = patternDetection.confidence;
        }

        // Validate the detected type exists in our mapping
        if (!this.propertyTypes[finalType]) {
            finalType = 'apartment';
            finalConfidence = 50;
        }

        return {
            type: finalType,
            confidence: finalConfidence,
            propertyInfo: this.propertyTypes[finalType],
            detectionMethod: aiDetection.confidence > patternDetection.confidence ? 'ai' : 'pattern'
        };
    }

    // Get Property Information
    getPropertyInfo(propertyType) {
        return this.propertyTypes[propertyType] || this.propertyTypes['apartment'];
    }

    // Calculate Property-Specific Pricing
    calculatePropertyPricing(baseCost, propertyType, additionalFactors = {}) {
        const propertyInfo = this.getPropertyInfo(propertyType);
        let adjustedCost = baseCost * propertyInfo.multiplier;

        // Apply additional factors
        if (additionalFactors.elevator) {
            adjustedCost += 100; // Elevator fee
        }

        if (additionalFactors.parking) {
            adjustedCost += 50; // Parking coordination fee
        }

        if (additionalFactors.security) {
            adjustedCost += 75; // Security clearance fee
        }

        if (additionalFactors.stairs) {
            adjustedCost += 25 * additionalFactors.stairs; // Per flight of stairs
        }

        if (additionalFactors.loadingDock) {
            adjustedCost -= 50; // Discount for loading dock access
        }

        return {
            baseCost,
            propertyMultiplier: propertyInfo.multiplier,
            adjustedCost,
            additionalFees: adjustedCost - baseCost,
            propertyType: propertyInfo.name,
            challenges: propertyInfo.challenges
        };
    }

    // Analyze Moving Challenges
    analyzeMovingChallenges(propertyType, address, description) {
        const propertyInfo = this.getPropertyInfo(propertyType);
        const challenges = [];

        // Address-based challenges
        if (address.toLowerCase().includes('floor') && !address.toLowerCase().includes('1st')) {
            challenges.push({
                type: 'stairs',
                description: 'Multiple floors to navigate',
                impact: 'medium',
                additionalCost: 25
            });
        }

        if (address.toLowerCase().includes('elevator')) {
            challenges.push({
                type: 'elevator',
                description: 'Elevator scheduling required',
                impact: 'low',
                additionalCost: 100
            });
        }

        if (address.toLowerCase().includes('parking')) {
            challenges.push({
                type: 'parking',
                description: 'Parking coordination needed',
                impact: 'medium',
                additionalCost: 50
            });
        }

        // Property type specific challenges
        propertyInfo.challenges.forEach(challenge => {
            challenges.push({
                type: challenge,
                description: this.getChallengeDescription(challenge),
                impact: this.getChallengeImpact(challenge),
                additionalCost: this.getChallengeCost(challenge)
            });
        });

        return challenges;
    }

    // Get Challenge Descriptions
    getChallengeDescription(challenge) {
        const descriptions = {
            'elevator scheduling': 'Need to coordinate elevator access',
            'parking restrictions': 'Limited parking availability',
            'loading zones': 'Restricted loading zone access',
            'stairs': 'Multiple flights of stairs',
            'accessibility': 'Limited accessibility options',
            'weather considerations': 'Weather-dependent operations',
            'building rules': 'Building-specific regulations',
            'security': 'Security clearance required',
            'business hours': 'Limited to business hours',
            'heavy items': 'Heavy item handling required',
            'specialized equipment': 'Specialized moving equipment needed',
            'scheduling': 'Complex scheduling requirements',
            'space constraints': 'Limited space for operations',
            'furniture disassembly': 'Furniture disassembly required',
            'high ceilings': 'High ceiling considerations',
            'furniture handling': 'Specialized furniture handling',
            'luxury handling': 'Luxury item handling required',
            'security clearance': 'Security clearance process',
            'size constraints': 'Limited space for operations',
            'specialized handling': 'Specialized item handling'
        };

        return descriptions[challenge] || challenge;
    }

    // Get Challenge Impact Levels
    getChallengeImpact(challenge) {
        const impacts = {
            'elevator scheduling': 'low',
            'parking restrictions': 'medium',
            'loading zones': 'medium',
            'stairs': 'medium',
            'accessibility': 'high',
            'weather considerations': 'medium',
            'building rules': 'low',
            'security': 'medium',
            'business hours': 'high',
            'heavy items': 'high',
            'specialized equipment': 'high',
            'scheduling': 'medium',
            'space constraints': 'medium',
            'furniture disassembly': 'low',
            'high ceilings': 'medium',
            'furniture handling': 'medium',
            'luxury handling': 'high',
            'security clearance': 'high',
            'size constraints': 'medium',
            'specialized handling': 'high'
        };

        return impacts[challenge] || 'medium';
    }

    // Get Challenge Costs
    getChallengeCost(challenge) {
        const costs = {
            'elevator scheduling': 100,
            'parking restrictions': 50,
            'loading zones': 75,
            'stairs': 25,
            'accessibility': 150,
            'weather considerations': 50,
            'building rules': 25,
            'security': 75,
            'business hours': 200,
            'heavy items': 300,
            'specialized equipment': 400,
            'scheduling': 100,
            'space constraints': 75,
            'furniture disassembly': 50,
            'high ceilings': 100,
            'furniture handling': 150,
            'luxury handling': 500,
            'security clearance': 200,
            'size constraints': 75,
            'specialized handling': 300
        };

        return costs[challenge] || 50;
    }

    // Validate Property Type
    validatePropertyType(propertyType) {
        return this.propertyTypes.hasOwnProperty(propertyType);
    }

    // Get All Property Types
    getAllPropertyTypes() {
        return Object.keys(this.propertyTypes).map(key => ({
            key,
            ...this.propertyTypes[key]
        }));
    }

    // Get Property Type Statistics
    getPropertyTypeStats() {
        const stats = {};
        
        for (const [key, info] of Object.entries(this.propertyTypes)) {
            stats[key] = {
                name: info.name,
                multiplier: info.multiplier,
                challengeCount: info.challenges.length,
                avgChallengeCost: info.challenges.reduce((sum, challenge) => 
                    sum + this.getChallengeCost(challenge), 0) / info.challenges.length
            };
        }

        return stats;
    }

    // Batch Property Analysis
    async analyzeMultipleProperties(properties) {
        const results = [];

        for (const property of properties) {
            try {
                const detection = await this.detectPropertyType(property.address, property.description);
                const challenges = this.analyzeMovingChallenges(detection.type, property.address, property.description);
                
                results.push({
                    address: property.address,
                    description: property.description,
                    detectedType: detection.type,
                    confidence: detection.confidence,
                    challenges,
                    propertyInfo: detection.propertyInfo
                });
            } catch (error) {
                console.error(`❌ Error analyzing property ${property.address}:`, error);
                results.push({
                    address: property.address,
                    description: property.description,
                    detectedType: 'apartment',
                    confidence: 0,
                    challenges: [],
                    propertyInfo: this.propertyTypes['apartment'],
                    error: error.message
                });
            }
        }

        return results;
    }

    // Update Property Type Mapping
    updatePropertyTypeMapping(newMapping) {
        for (const [key, info] of Object.entries(newMapping)) {
            this.propertyTypes[key] = {
                ...this.propertyTypes[key],
                ...info
            };
        }

        console.log('✅ Property type mapping updated');
    }

    // Export Property Type Data
    exportPropertyTypeData() {
        return {
            propertyTypes: this.propertyTypes,
            addressPatterns: Object.fromEntries(
                Object.entries(this.addressPatterns).map(([key, pattern]) => [key, pattern.source])
            ),
            stats: this.getPropertyTypeStats()
        };
    }
}

module.exports = PropertyTypeDetector; 