const multer = require("multer");
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png"];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    // Tag the rejection so the route can return a safe client error.
    const error = new Error("Only JPEG and PNG receipt images are allowed.");
    error.code = "INVALID_FILE_TYPE";
    cb(error, false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,

  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
    fields: 0,
  },
});

module.exports = { upload };
