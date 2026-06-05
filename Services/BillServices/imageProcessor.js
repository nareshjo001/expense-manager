const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

async function preprocessImage(inputPath) {
  try {
    // Ensure processed folder exists
    const processedDir = path.join(__dirname, "../billProcessed");

    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir);
    }

    // Output filename
    const outputPath = path.join(
      processedDir,
      `processed-${Date.now()}.png`
    );

    await sharp(inputPath)

      // 1. Resize image
      .resize({
        width: 1500, // improve OCR readability
        withoutEnlargement: true,
      })

      // 2. Convert to grayscale
      .grayscale()

      // 3. Normalize brightness/contrast
      .normalize()

      // 4. Sharpen text edges
      .sharpen()

      // 5. Save as PNG
      .png()

      .toFile(outputPath);

    return outputPath;

  } catch (error) {
    console.error("Image preprocessing failed:", error);
    throw error;
  }
}

module.exports = {
  preprocessImage,
};