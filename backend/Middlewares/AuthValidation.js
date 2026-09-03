const Joi = require('joi');
const { authSchemas, validateAuthRequest } = require('../Services/AuthServices/validation.service');

// Signup request validation middleware
const signupValidation = validateAuthRequest(authSchemas.signup);

// Login request validation middleware
const loginValidation = validateAuthRequest(authSchemas.login);
const emailOnlyValidation = validateAuthRequest(authSchemas.emailOnly);
const verifyOtpValidation = validateAuthRequest(authSchemas.verifyOtp);
const resetPasswordValidation = validateAuthRequest(authSchemas.resetPassword);

// Add Expense request validation middleware
const expenseValidation = (req, res, next) => {
    
    // Define Joi validation rules for expense data
    const schema = Joi.object({
        id: Joi.string().required(),
        expenseName: Joi.string().required(),
        expenseCategory: Joi.string().required(),
        expenseAmount: Joi.number().positive().required(),
        expenseDate: Joi.date().required(),
        expenseDescription: Joi.string().allow('').optional(),
    }).unknown(true); // Allow extra fields in request body

    // Validate incoming request body
    const { error } = schema.validate(req.body, { abortEarly: true });
     
    if(error)  {
        // Capitalize the first letter of the error message
        const rawMessage = error.details[0].message.replace(/"/g, '');
        const message = rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1);
        
        return res.status(400).json({ 
            success: false,
            message
        });
    }

    // Validation passed → move to next middleware/controller
    next();
}

// Add Income request validation middleware
const addIncomeValidation = (req, res, next) => {

    const schema = Joi.object({
        // Remediation Workstream B -- required client-generated idempotency
        id: Joi.string().required(),
        incomeSource: Joi.string().trim().min(1).required(),
        incomeAmount: Joi.number().positive().required(),
        incomeDate: Joi.date().required(),
    }).unknown(true); // Allow extra fields in request body

    const { error } = schema.validate(req.body, { abortEarly: true });

    if (error) {
        // Capitalize the first letter of the error message
        const rawMessage = error.details[0].message.replace(/"/g, '');
        const message = rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1);

        return res.status(400).json({
            success: false,
            message
        });
    }

    next();
};

// Edit Income request validation middleware
const editIncomeValidation = (req, res, next) => {

    const schema = Joi.object({
        incomeId: Joi.string().required(),
        newAmount: Joi.number().positive().required(),
    }).unknown(true); // Allow extra fields in request body

    const { error } = schema.validate(req.body, { abortEarly: true });

    if (error) {
        // Capitalize the first letter of the error message
        const rawMessage = error.details[0].message.replace(/"/g, '');
        const message = rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1);

        return res.status(400).json({
            success: false,
            message
        });
    }

    next();
};

module.exports = {
    signupValidation,
    loginValidation,
    emailOnlyValidation,
    verifyOtpValidation,
    resetPasswordValidation,
    expenseValidation,
    addIncomeValidation,
    editIncomeValidation
};
