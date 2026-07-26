const fs = require("fs/promises");
const { preprocessImage } = require("../../Services/BillServices/imageProcessor");
const { extractTextFromImage } = require("../../Services/BillServices/ocrService");
const { parseReceipt } = require("../../Services/BillServices/receiptParser");

const uploadBill = async (req, res) => {
  let originalImagePath;
  let processedImagePath;

  try {

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    originalImagePath = req.file.path;
    processedImagePath = await preprocessImage(originalImagePath);
    const extractedText = await extractTextFromImage(processedImagePath);
    const parsedReceipt = parseReceipt(extractedText);

    return res.status(200).json({
      success: true,
      message: "Bill uploaded and processed successfully",
      parsedReceipt: parsedReceipt,
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to process bill",
    });

  } finally {

    // Remove temporary upload and processed files.
    if (originalImagePath) {
      try {
        await fs.unlink(originalImagePath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          console.error("Failed to remove uploaded file:", cleanupError);
        }
      }
    }

    if (processedImagePath) {
      try {
        await fs.unlink(processedImagePath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          console.error("Failed to remove processed file:", cleanupError);
        }
      }
    }
  }
};

module.exports = {
  uploadBill,
};
