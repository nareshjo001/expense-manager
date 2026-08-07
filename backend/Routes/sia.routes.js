const router = require("express").Router();

const { ask } = require("../Controllers/SiaControllers/ask");
const verifyToken = require("../Middlewares/Auth");

router.post("/ask", verifyToken, ask);

module.exports = router;
