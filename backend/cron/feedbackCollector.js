const cron = require("node-cron");
const axios = require("axios");

const { MlFeedbackModel } = require("../config/Schemas");
// Remediation Workstream C -- shared ML_ROUTE validation + operations-token
const { buildMlServiceUrl, mlOperationsHeaders } = require("../utils/mlServiceClient");

// Runs every day at 20:30 server time.
cron.schedule("30 20 * * *", async () => {
    console.log("ML RETRAIN CHECK STARTED");
    try {

        // Count corrections not yet reserved/consumed by a retraining run.
        const correctedCount = await MlFeedbackModel.countDocuments({
                status: "pending"
            });

        console.log(`Pending feedback count: ${correctedCount}`);

        if (correctedCount < 100) {
            console.log("Not enough corrections for retraining");
            return;
        }

        console.log("Retraining threshold reached");

        // Threshold met — trigger a model retrain on the ML service.
        const response = await axios.post(
            buildMlServiceUrl("/retrain-model"),
            undefined,
            { headers: mlOperationsHeaders() }
        );

        // Phase G item 11: {"existingRun": true, "runId": "..."} is a
        if (response.data && response.data.existingRun) {
            console.log(
                `Retraining already in progress (runId=${response.data.runId}, ` +
                `status=${response.data.status}) -- no new run triggered.`
            );
        } else {
            console.log(
                `Retraining run queued (runId=${response.data && response.data.runId}).`
            );
        }

    } catch (err) {
        // Phase G item 11: an ML-service 503 (the service being
        if (err.response && err.response.status === 503) {
            console.log(
                "ML retrain trigger skipped: prediction/retraining service " +
                "is temporarily unavailable (503) -- will retry on the next " +
                "scheduled run."
            );
        } else {
            console.log("Cron job error:");
            console.log(
                err.response?.data ||
                err.message
            );
        }
    }
});