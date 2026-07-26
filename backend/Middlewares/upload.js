const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

// Map accepted upload types to their file extension.
const MIME_EXTENSIONS = {
  "image/jpg": ".jpg",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../billUploads"));
  },

  filename: (req, file, cb) => {
    // Generate a server-side filename, ignoring client input.
    const extension = MIME_EXTENSIONS[file.mimetype] || "";
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}${extension}`;

    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpg",
    "image/jpeg",
    "image/png",
    "application/pdf",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    // Tag the rejection so the route can return a 400.
    const error = new Error(
      "Only JPG, PNG, and PDF files are allowed"
    );
    error.code = "INVALID_FILE_TYPE";
    cb(error, false);
  }
};

const upload = multer({
  storage,
  fileFilter,

  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

module.exports = { upload };