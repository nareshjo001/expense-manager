const cron = require("node-cron");
const axios = require("axios");

const { MlFeedbackModel } = require("../config/Schemas");

// 0 2 * * * - every day at 2 AM
cron.schedule("* * * * *", async () => {
    console.log("ML RETRAIN CHECK STARTED");
    try {

        const correctedCount = await MlFeedbackModel.countDocuments({
                corrected: true
            });

        console.log(`Corrected feedback count: ${correctedCount}`);

        if (correctedCount < 2) {
            console.log("Not enough corrections for retraining");
            return;
        }

        console.log("Retraining threshold reached");

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