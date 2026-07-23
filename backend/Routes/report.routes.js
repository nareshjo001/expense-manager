const router = require("express").Router();

const reportController = require("../Controllers/report.controller");
const verifyToken = require("../Middlewares/Auth");

router.get("/", verifyToken, reportController.getReport);

module.exports = router;