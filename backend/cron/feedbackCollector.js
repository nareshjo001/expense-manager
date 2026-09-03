const cron = require("node-cron");
const axios = require("axios");
const crypto = require("crypto");

const { MlFeedbackModel } = require("../config/Schemas");
// Remediation Workstream C -- shared ML_ROUTE validation + operations-token
const { buildMlServiceUrl, mlOperationsHeaders } = require("../utils/mlServiceClient");
// REC-001 -- job-level lease so multiple instances don't all separately
// count feedback and call /retrain-model on the same day (the ML service
// itself already dedupes concurrent triggers via existingRun, but the
// lease avoids the redundant Mongo count + HTTP call across instances too).
const { runWithLease } = require("../utils/jobLease");

const JOB_NAME = "feedbackCollector";
const LEASE_TTL_MS = 5 * 60 * 1000;

// Runs every day at 20:30 server time.
cron.schedule("30 20 * * *", async () => {
    await runWithLease(JOB_NAME, LEASE_TTL_MS, runFeedbackCollectorJob);
});

async function runFeedbackCollectorJob() {
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
        // OBS-001-T02: a fresh per-run correlation ID (no incoming HTTP
        // request exists for a cron job) so this retrain trigger can be
        // traced through the ML service's logs.
        const jobRequestId = crypto.randomUUID();
        const response = await axios.post(
            buildMlServiceUrl("/retrain-model"),
            undefined,
            { headers: mlOperationsHeaders(jobRequestId) }
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
}