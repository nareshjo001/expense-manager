const cron = require("node-cron");
const axios = require("axios");

const { MlFeedbackModel } = require("../config/Schemas");

// Runs every day at 20:30 server time.
cron.schedule("30 20 * * *", async () => {
    console.log("ML RETRAIN CHECK STARTED");
    try {

        // Count corrections not yet reserved/consumed by a retraining run.
        // Phase C: the ML service now atomically reserves "pending"
        // feedback (status transitions to "reserved", then eventually
        // "trained") instead of using the `corrected` boolean as its
        // consumption marker. Counting `corrected: true` here would keep
        // matching documents the ML service has already reserved or
        // trained on (that flag is kept only temporarily for backward
        // compatibility / analytics, per Phase A -- it is no longer reset
        // on consumption), so the cron would keep re-triggering retraining
        // against feedback that is no longer actually pending. Counting
        // `status: "pending"` instead keeps this threshold meaningful.
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
        const response = await axios.post(`${process.env.ML_ROUTE}/retrain-model`);

        // Phase G item 11: {"existingRun": true, "runId": "..."} is a
        // NORMAL, expected result -- it means a retrain was already in
        // progress when this cron fired (e.g. a manual trigger, or a
        // previous cron run still training), not an error. Logged plainly,
        // distinctly from a genuinely new run being queued, so an operator
        // reading these logs can tell the two apart at a glance.
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
        // temporarily unavailable, e.g. mid-restart) is an expected,
        // transient condition -- the cron will simply try again at its
        // next scheduled run, since the pending-feedback count that
        // triggered this attempt is still there. It is logged distinctly
        // from a genuinely unexpected failure so it is never mistaken for
        // an internal backend bug.
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