const DeviceToken = require('../../models/DeviceToken');

const deviceRegistration = async (req, res) => {
    try {
        // Extract token (FCM device token) and platform (android / ios / web)
        const { token, platform } = req.body;

        // Extract userid
        const userId = req.userId;

        // Update existing token or create a new one if it doesn't exist 
        await DeviceToken.findOneAndUpdate(
            { token },
            { userId, platform },
            { upsert: true, new: true }
        );

        // Respond with success message
        res.status(200).json({ message: "Device registered successfully" });

    } catch (error) {
        // Handle server errors 
        res.status(500).json({ error: error.message });
    }
};

module.exports = { deviceRegistration };