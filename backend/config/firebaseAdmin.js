const admin = require("firebase-admin");
const serviceAccount = require("./serviceAcount.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

module.exports = admin;