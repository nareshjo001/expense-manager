const { preprocessImage } = require("../../Services/BillServices/imageProcessor");
const { extractTextFromImage } = require("../../Services/BillServices/ocrService");
const { parseReceipt } = require("../../Services/BillServices/receiptParser");

const uploadBill = async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const originalImagePath = req.file.path;
    const processedImagePath = await preprocessImage(originalImagePath);
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
  }
};

module.exports = {
  uploadBill,
};