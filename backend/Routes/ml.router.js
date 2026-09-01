const express = require("express");
const axios = require("axios");

const router = express.Router();

const verifyToken = require("../Middlewares/Auth");
// Remediation Workstream C -- shared ML_ROUTE validation + operations-token
const { buildMlServiceUrl, mlOperationsHeaders, requestSpendingForecast } = require("../utils/mlServiceClient");

// Bounded timeout for the ML service call -- previously unset, meaning a
const PREDICT_TIMEOUT_MS = 5000;

router.post("/predict-category", verifyToken, async (req, res) => {
    try {

        const { expenseName } = req.body;

        if (!expenseName) {
            return res.status(400).json({
                success: false,
                message: "expenseName is required"
            });
        }

        const response = await axios.post(
            buildMlServiceUrl("/predict-category"),
            {
                expenseName
            },
            {
                timeout: PREDICT_TIMEOUT_MS,
                headers: mlOperationsHeaders()
            }
        );

        // Preserve the existing successful response contract unchanged --
        return res.status(200).json(
            response.data
        );

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

// New endpoint to proxy spending forecast requests
router.post('/predict-spending-forecast', verifyToken, async (req, res) => {
  try {
    const result = await requestSpendingForecast(req.body);
    if (result.success) {
      return res.json({ success: true, data: { success: true, ...result.data } });
    }
    // Forward any error from the ML service
    return res.status(502).json({ success: false, reason: result.reason || 'ML service error' });
  } catch (err) {
    console.error('Spending forecast proxy error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
