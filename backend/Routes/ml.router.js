const express = require("express");
const axios = require("axios");

const router = express.Router();

const verifyToken = require("../Middlewares/Auth");
// Remediation Workstream C -- shared ML_ROUTE validation + operations-token
// header attachment (ml-service's /predict-category now requires the same
// shared-secret token /ml-status has always required).
const { buildMlServiceUrl, mlOperationsHeaders } = require("../utils/mlServiceClient");

// Bounded timeout for the ML service call -- previously unset, meaning a
// hung ML service could block this request indefinitely (found during the
// Phase G backend contract audit; see PHASE_G_FINAL_REPORT.md). 5s is
// generous for a single in-memory prediction (see the ML service's own
// Phase G performance notes: activation/orchestration overhead is
// single-digit milliseconds; a real prediction is even cheaper) while
// still failing well within a normal HTTP request's own patience.
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
        // the ML service's own response body (expenseName, cleanedText,
        // predictedCategory, confidence) is forwarded as-is.
        return res.status(200).json(
            response.data
        );

    } catch (error) {

        // Distinguish three cases (Phase G item 11 -- previously every
        // failure mode collapsed into the same generic 500):
        //   1. Timeout or no connection at all (error.response is absent) --
        //      the ML service is unavailable/unreachable/too slow. Reported
        //      as 503, not a backend bug.
        //   2. The ML service responded with an ordinary 4xx validation
        //      error (e.g. a malformed request) -- forwarded with its own
        //      status and body, not masked as a backend failure.
        //   3. Anything else unexpected -- a genuine backend-side problem,
        //      reported as 500.
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

module.exports = router;