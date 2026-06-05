const Tesseract = require("tesseract.js");

const extractTextFromImage = async (imagePath) => {
  try {

    const result = await Tesseract.recognize(
      imagePath,
      "eng",
    );

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