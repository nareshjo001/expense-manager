const { UserModel } = require('../../config/Schemas');

// Password utility function for comparing
const { comparePassword } = require('../../Services/AuthServices/password.service');
// Remediation Workstream E -- centralized, bounded-expiration token issuance.
// See Services/AuthServices/token.service.js's own doc comment for why this
// replaced a direct `jwt.sign(...)` call with no `expiresIn`.
const { issueAccessToken } = require('../../Services/AuthServices/token.service');

const login = async (req, res) => {
    try {
        // Extract login credentials from request body
        const { email, password } = req.body;
        
        // Validate user existence
        const user = await UserModel.findOne({ email });
        if(!user) {
            return res.status(404).json({ message: 'User not found', success: false });
        }

        // Compare provided password with stored hashed password
        const isMatch = await comparePassword(password, user.password);
        if(!isMatch) {
            return res.status(401).json({ message: 'Invalid Password', success: false });
        }

        // Prevent login for unverified accounts
        if(!user.isVerified) {
            return res.status(403).json({ message: 'Account not verified. Sign Up Again', success: false});
        }

        // Generate JWT for authenticated session -- now issued with a bounded
        // expiration (JWT_EXPIRES_IN, see token.service.js) instead of never
        // expiring.
        const token = issueAccessToken({ email: user.email, _id: user._id });

        // Successful login response with auth token and user data
        res.status(200).json({ message: 'Login Successful', success: true, token, email: user.email, firstname: user.fullName });
    
    } catch (err) {
        // Handle unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
};

module.exports = { login };