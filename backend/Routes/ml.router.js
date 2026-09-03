const express = require("express");
const axios = require("axios");

const router = express.Router();

const verifyToken = require("../Middlewares/Auth");
// Remediation Workstream C -- shared ML_ROUTE validation + operations-token
const { buildMlServiceUrl, mlOperationsHeaders } = require("../utils/mlServiceClient");
// CAT-001 -- user-scoped merchant rules take precedence over the ML model.
const {
    findRuleForMerchant,
    upsertRule,
    listRules,
    deleteRule,
    MerchantRuleValidationError,
} = require("../Services/CategorizationServices/merchantRule.service");

// Bounded timeout for the ML service call -- previously unset, meaning a
const PREDICT_TIMEOUT_MS = 5000;

const MERCHANT_RULE_ID_PATTERN = /^[a-f0-9]{24}$/i;

router.post("/predict-category", verifyToken, async (req, res) => {
    try {

        const { expenseName } = req.body;

        if (!expenseName) {
            return res.status(400).json({
                success: false,
                message: "expenseName is required"
            });
        }

        // CAT-001 -- a durable, user-saved rule for this exact merchant
        // always wins: it skips the ML inference call entirely (avoiding
        // its cost) and can never repeat a mistake the ML model made for
        // this same merchant before, since it's applied deterministically.
        const rule = await findRuleForMerchant(req.userId, expenseName);
        if (rule) {
            return res.status(200).json({
                success: true,
                predictedCategory: rule.category,
                confidence: 1,
                source: "rule",
            });
        }

        const response = await axios.post(
            buildMlServiceUrl("/predict-category"),
            {
                expenseName
            },
            {
                timeout: PREDICT_TIMEOUT_MS,
                headers: mlOperationsHeaders(req.requestId)
            }
        );

        // Preserve the existing successful response contract, only adding
        // `source` (additive, never removes/renames an existing field).
        return res.status(200).json({
            ...response.data,
            source: "model",
        });

    } catch (error) {

        // Distinguish three cases (Phase G item 11 -- previously every
        if (!error.response) {
            console.error(
                "Prediction service unavailable:",
                error.code || error.message
            );
            return res.status(503).json({
                success: false,
                message: "Prediction service unavailable"
            });
        }

        const status = error.response.status;

        if (status >= 400 && status < 500) {
            console.error(
                "Prediction request rejected by ML service:",
                error.response.data
            );
            return res.status(status).json(
                error.response.data || {
                    success: false,
                    message: "Invalid prediction request"
                }
            );
        }

        console.error(
            "Unexpected error calling prediction service:",
            error.response.data || error.message
        );
        return res.status(500).json({
            success: false,
            message: "Prediction service unavailable"
        });
    }
});

// CAT-001 -- list this user's merchant category rules, newest first.
router.get("/merchant-rules", verifyToken, async (req, res) => {
    try {
        const rules = await listRules(req.userId);
        res.status(200).json({ success: true, data: rules });
    } catch (err) {
        console.error("Merchant rule list failed.");
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// CAT-001 -- create or update (upsert by merchant) the current user's rule.
router.post("/merchant-rules", verifyToken, async (req, res) => {
    try {
        const { merchantName, category } = req.body || {};
        const rule = await upsertRule(req.userId, merchantName, category);
        res.status(200).json({ success: true, data: rule });
    } catch (err) {
        if (err instanceof MerchantRuleValidationError) {
            return res.status(err.statusCode).json({ success: false, message: err.message, errorCode: err.code });
        }
        console.error("Merchant rule save failed.");
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// CAT-001 -- delete one of the current user's rules; ownership is enforced
// inside deleteRule's own query, never by trusting this route alone.
router.delete("/merchant-rules/:ruleId", verifyToken, async (req, res) => {
    try {
        const { ruleId } = req.params;
        if (!MERCHANT_RULE_ID_PATTERN.test(ruleId || "")) {
            return res.status(400).json({ success: false, message: "ruleId is malformed.", errorCode: "INVALID_RULE_ID" });
        }

        const deleted = await deleteRule(req.userId, ruleId);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Rule not found." });
        }
        res.status(200).json({ success: true });
    } catch (err) {
        console.error("Merchant rule delete failed.");
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

module.exports = router;
