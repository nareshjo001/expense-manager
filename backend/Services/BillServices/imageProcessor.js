const sharp = require("sharp");
const { MAX_RECEIPT_PIXELS } = require("./receiptSecurity.service");

async function preprocessImage(inputBuffer) {
  return sharp(inputBuffer, { limitInputPixels: MAX_RECEIPT_PIXELS, pages: 1 })
    .rotate()
    .resize({
      width: 1500,
      height: 1500,
      fit: "inside",
      withoutEnlargement: true,
    })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

module.exports = {
  preprocessImage,
};
