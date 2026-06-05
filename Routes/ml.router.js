const express = require("express");
const axios = require("axios");

const router = express.Router();

router.post("/predict-category", async (req, res) => {
    try {

        const { expenseName } = req.body;

        if (!expenseName) {
            return res.status(400).json({
                error: "expenseName is required"
            });
        }

        const response = await axios.post(
            `${process.env.ML_ROUTE}/predict-category`,
            { 
                expenseName
            }
        );

        return res.status(200).json(
            response.data
        );

    } catch (error) {

        console.error(
            error.response?.data || error.message
        );

        return res.status(500).json({
            error: "Prediction service unavailable"
        });
    }
});

module.exports = router;