import React, { useState } from 'react';
import './LeadForm.css';

const LeadForm = ({ onSubmit, onCancel }) => {
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        originAddress: '',
        destinationAddress: '',
        moveDate: '',
        serviceType: 'full-service'
    });
    
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errors, setErrors] = useState({});

    const serviceTypes = [
        { value: 'full-service', label: 'Full Service Moving' },
        { value: 'pack-and-move', label: 'Pack and Move' },
        { value: 'labor-and-truck', label: 'Labor and Truck' },
        { value: 'labor-only', label: 'Labor Only' },
        { value: 'specialty', label: 'Specialty Items' }
    ];

    const validateForm = () => {
        const newErrors = {};
        
        if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
        if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
        if (!formData.email.trim()) newErrors.email = 'Email is required';
        else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = 'Email is invalid';
        if (!formData.phone.trim()) newErrors.phone = 'Phone number is required';
        if (!formData.originAddress.trim()) newErrors.originAddress = 'Origin address is required';
        if (!formData.destinationAddress.trim()) newErrors.destinationAddress = 'Destination address is required';
        if (!formData.moveDate) newErrors.moveDate = 'Move date is required';

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!validateForm()) return;
        
        setIsSubmitting(true);
        
        try {
            await onSubmit(formData);
        } catch (error) {
            console.error('❌ Failed to submit lead form:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    return (
        <div className="lead-form-container">
            <div className="lead-form-header">
                <h3>Get Your Moving Quote</h3>
                <p>Fill out the form below and we'll get back to you within 24 hours</p>
            </div>
            
            <form className="lead-form" onSubmit={handleSubmit}>
                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="firstName">First Name *</label>
                        <input
                            type="text"
                            id="firstName"
                            value={formData.firstName}
                            onChange={(e) => handleInputChange('firstName', e.target.value)}
                            className={errors.firstName ? 'error' : ''}
                        />
                        {errors.firstName && <span className="error-message">{errors.firstName}</span>}
                    </div>
                    
                    <div className="form-group">
                        <label htmlFor="lastName">Last Name *</label>
                        <input
                            type="text"
                            id="lastName"
                            value={formData.lastName}
                            onChange={(e) => handleInputChange('lastName', e.target.value)}
                            className={errors.lastName ? 'error' : ''}
                        />
                        {errors.lastName && <span className="error-message">{errors.lastName}</span>}
                    </div>
                </div>
                
                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="email">Email *</label>
                        <input
                            type="email"
                            id="email"
                            value={formData.email}
                            onChange={(e) => handleInputChange('email', e.target.value)}
                            className={errors.email ? 'error' : ''}
                        />
                        {errors.email && <span className="error-message">{errors.email}</span>}
                    </div>
                    
                    <div className="form-group">
                        <label htmlFor="phone">Phone *</label>
                        <input
                            type="tel"
                            id="phone"
                            value={formData.phone}
                            onChange={(e) => handleInputChange('phone', e.target.value)}
                            className={errors.phone ? 'error' : ''}
                        />
                        {errors.phone && <span className="error-message">{errors.phone}</span>}
                    </div>
                </div>
                
                <div className="form-group">
                    <label htmlFor="originAddress">Origin Address *</label>
                    <textarea
                        id="originAddress"
                        value={formData.originAddress}
                        onChange={(e) => handleInputChange('originAddress', e.target.value)}
                        className={errors.originAddress ? 'error' : ''}
                        placeholder="Enter your current address"
                        rows={2}
                    />
                    {errors.originAddress && <span className="error-message">{errors.originAddress}</span>}
                </div>
                
                <div className="form-group">
                    <label htmlFor="destinationAddress">Destination Address *</label>
                    <textarea
                        id="destinationAddress"
                        value={formData.destinationAddress}
                        onChange={(e) => handleInputChange('destinationAddress', e.target.value)}
                        className={errors.destinationAddress ? 'error' : ''}
                        placeholder="Enter your new address"
                        rows={2}
                    />
                    {errors.destinationAddress && <span className="error-message">{errors.destinationAddress}</span>}
                </div>
                
                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="moveDate">Move Date *</label>
                        <input
                            type="date"
                            id="moveDate"
                            value={formData.moveDate}
                            onChange={(e) => handleInputChange('moveDate', e.target.value)}
                            className={errors.moveDate ? 'error' : ''}
                        />
                        {errors.moveDate && <span className="error-message">{errors.moveDate}</span>}
                    </div>
                    
                    <div className="form-group">
                        <label htmlFor="serviceType">Service Type *</label>
                        <select
                            id="serviceType"
                            value={formData.serviceType}
                            onChange={(e) => handleInputChange('serviceType', e.target.value)}
                        >
                            {serviceTypes.map(type => (
                                <option key={type.value} value={type.value}>
                                    {type.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                
                <div className="form-actions">
                    <button
                        type="button"
                        className="cancel-btn"
                        onClick={onCancel}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </button>
                    
                    <button
                        type="submit"
                        className="submit-btn"
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? 'Submitting...' : 'Get Quote'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default LeadForm; 