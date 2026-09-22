const Joi = require('joi');
const { authSchemas, validateAuthRequest } = require('../Services/AuthServices/validation.service');
// EXP-002-T02 -- see this module's own header comment for why this is a
// VALUE-level reuse (366) rather than an import from sia/financialQueryService.js.
const { MAX_PERIOD_SPAN_DAYS } = require('../utils/dateRangeLimits');

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


// PRV-001-T03 -- account-deletion request validation. Just a required,
// non-empty password string; the controller itself re-verifies it against
// the stored hash (this middleware only rejects an obviously-malformed
// request before that DB round trip, same division of labor
// expenseValidation/addIncomeValidation already use).
const requestDeletionValidation = (req, res, next) => {
    const schema = Joi.object({
        password: Joi.string().min(1).required(),
    }).unknown(true);

    const { error } = schema.validate(req.body, { abortEarly: true });

    if (error) {
        const rawMessage = error.details[0].message.replace(/"/g, '');
        const message = rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1);

        return res.status(400).json({
            success: false,
            message
        });
    }

    next();
};


// EXP-002-T02 -- GET /expense/search query validation (route boundary, per
// this feature's own "Technical design" section: "Put validation at the
// route boundary"). Validates the four new optional filters EXP-002-T01
// defined (nameContains/category/minAmount+maxAmount/isRecurring) AND
// closes T01's flagged gap: the existing startDate/endDate pair had no
// ordering check and no maximum span, so a client could request an
// unbounded multi-year range. getbycustom.js's own defensive
// required/valid-date checks are left in place, not removed -- this
// middleware adds strictness for the real HTTP route without weakening the
// controller's own behaviour when called directly (existing tests in
// tests/getByCustom.pagination.test.js call the controller directly,
// bypassing Express middleware entirely, and are unaffected by this file).
const expenseSearchValidation = (req, res, next) => {
    const schema = Joi.object({
        startDate: Joi.date().required(),
        endDate: Joi.date().required(),
        nameContains: Joi.string().trim().min(1).max(200).optional(),
        category: Joi.string().trim().min(1).max(100).optional(),
        minAmount: Joi.number().min(0).optional(),
        maxAmount: Joi.number().min(0).optional(),
        isRecurring: Joi.boolean().optional(),
    })
        .unknown(true) // limit/cursor remain utils/pagination.js's own responsibility
        .custom((value, helpers) => {
            if (value.endDate < value.startDate) {
                return helpers.error('dateRange.order');
            }
            const spanDays = (value.endDate.getTime() - value.startDate.getTime()) / (24 * 60 * 60 * 1000);
            if (spanDays > MAX_PERIOD_SPAN_DAYS) {
                return helpers.error('dateRange.span');
            }
            if (value.minAmount !== undefined && value.maxAmount !== undefined && value.maxAmount < value.minAmount) {
                return helpers.error('amountRange.order');
            }
            return value;
        })
        .messages({
            'dateRange.order': 'endDate must not be before startDate',
            'dateRange.span': `startDate and endDate must not span more than ${MAX_PERIOD_SPAN_DAYS} days`,
            'amountRange.order': 'maxAmount must not be less than minAmount',
        });

    const { error, value } = schema.validate(req.query, { abortEarly: true, convert: true });

    if (error) {
        const rawMessage = error.details[0].message.replace(/"/g, '');
        const message = rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1);

        return res.status(400).json({
            success: false,
            message
        });
    }

    // Joi's `convert` coerces query-string values into real Date/Number/
    // Boolean instances -- the controller reads req.query as Joi validated
    // it, not the raw strings, so it never re-parses what already passed.
    req.query = { ...req.query, ...value };
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
    editIncomeValidation,
    requestDeletionValidation,
    expenseSearchValidation
};
