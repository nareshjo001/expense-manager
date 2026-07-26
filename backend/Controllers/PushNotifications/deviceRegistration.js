const DeviceToken = require('../../models/DeviceToken');

const deviceRegistration = async (req, res) => {
    try {
        // Extract token (FCM device token) and platform (android / ios / web)
        const { token, platform } = req.body;

        // Extract userid
        const userId = req.userId;

        // Validate device token and platform.
        if (!token || typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ message: "Device token is required", success: false });
        }

        if (platform !== 'web' && platform !== 'mobile') {
            return res.status(400).json({ message: "Platform must be 'web' or 'mobile'", success: false });
        }

        // Update this user's existing registration for the token.
        const claimed = await DeviceToken.findOneAndUpdate(
            { token, userId },
            { userId, platform },
            { new: true }
        );

        // Register the token, rejecting one owned by another account.
        if (!claimed) {
            try {
                await DeviceToken.create({ token, userId, platform });
            } catch (err) {
                if (err.code === 11000) {
                    return res.status(409).json({
                        message: "Device token already registered to another account",
                        success: false
                    });
                }
                throw err;
            }
        }

        // Respond with success message
        res.status(200).json({ message: "Device registered successfully" });

    } catch (error) {
        // Handle server errors
        console.error('Error in deviceRegistration:', error);
        res.status(500).json({ message: "Internal Server Error", success: false });
    }
};

module.exports = { deviceRegistration };