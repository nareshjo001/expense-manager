const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

// Extension is derived from the already fileFilter-validated mimetype, not
// from the client-supplied filename, so the saved file's name never depends
// on user-controlled input.
const MIME_EXTENSIONS = {
  "image/jpg": ".jpg",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Absolute, __dirname-anchored path — matches the strategy already used
    // by Services/BillServices/imageProcessor.js for billProcessed/, so
    // both temp directories resolve the same way regardless of the Node
    // process's working directory at launch. Resolves to the same physical
    // location ("<backend>/billUploads") as the previous relative path did
    // under the app's normal launch (npm start / nodemon from backend/).
    cb(null, path.join(__dirname, "../billUploads"));
  },

  filename: (req, file, cb) => {
    // Server-generated name only — never derived from file.originalname,
    // so a crafted client filename can't influence the name (or extension)
    // of the file written to disk.
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
    // Tagged with a code so the route's error wrapper can identify this
    // specific rejection precisely, rather than treating every non-Multer
    // error as a client input error (which would incorrectly convert a
    // genuine failure, e.g. a disk write error, into a 400).
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