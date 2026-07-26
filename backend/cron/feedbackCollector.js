const cron = require("node-cron");
const axios = require("axios");

const { MlFeedbackModel } = require("../config/Schemas");

// Runs every day at 20:30 server time.
cron.schedule("30 20 * * *", async () => {
    console.log("ML RETRAIN CHECK STARTED");
    try {

        // Count user corrections accumulated since the last retrain check.
        const correctedCount = await MlFeedbackModel.countDocuments({
                corrected: true
            });

        console.log(`Corrected feedback count: ${correctedCount}`);

        if (correctedCount < 100) {
            console.log("Not enough corrections for retraining");
            return;
        }

        console.log("Retraining threshold reached");

        // Threshold met — trigger a model retrain on the ML service.
        const response = await axios.post(`${process.env.ML_ROUTE}/retrain-model`);

        console.log(response.data);

    } catch (err) {
        console.log("Cron job error:");
        console.log(
            err.response?.data ||
            err.message
        );
    }
});