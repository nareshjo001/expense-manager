const Joi = require('joi');

// Signup request validation middleware
const signupValidation = (req, res, next) => {
    
    // Define Joi validation rules for signup data
    const schema = Joi.object({
        fullName: Joi.string().min(4).max(15).required(),
        email: Joi.string().email().required(),
        password: Joi.string().min(8).max(25).required()
    }).unknown(true); // Allow extra fields in request body

    // Validate incoming request body
    const { error } = schema.validate(req.body, { abortEarly: true });

    if (error) {
        // Capitalize the first letter of the error message
        const rawMessage = error.details[0].message.replace(/"/g, '');
        const message = rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1);

        // Send validation error response
        return res.status(400).json({
            success: false,
            message
        });
    }

    // Validation passed → move to next middleware/controller
    next();
};

// Login request validation middleware
const loginValidation = (req, res, next) => {
    
    // Define Joi validation rules for login data
    const schema = Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(8).max(25).required()
    }).unknown(true); // Allow extra fields in request body
    
    // Validate incoming request body
    const { error } = schema.validate(req.body, { abortEarly: true });
    
    if (error) {
        // Capitalize the first letter of the error message
        const rawMessage = error.details[0].message.replace(/"/g, '');
        const message = rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1);

        // Send validation error response
        return res.status(400).json({
            success: false,
            message
        });
    }

    // Validation passed → move to next middleware/controller
    next();
}

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

module.exports = { signupValidation, loginValidation, expenseValidation };