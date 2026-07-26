const Tesseract = require("tesseract.js");

// Run OCR over a preprocessed receipt image and return normalized text.
const extractTextFromImage = async (imagePath) => {
  try {

    const result = await Tesseract.recognize(
      imagePath,
      "eng",
    );

    // Collapse OCR line breaks and runs of whitespace into single spaces.
    const rawText = result.data.text
      .replace(/\n+/g, "\n")
      .replace(/\s+/g, " ")
      .trim();

    return rawText;

  } catch (error) {

    console.error("OCR extraction error:", error);

    throw error;
  }
};

module.exports = {
  extractTextFromImage,
};