// DAT-001-T03 -- the one entry point DAT-001-T02's inventory flagged as
// having no validation boundary: this used to be a bare
// parseFloat(rawText), which silently returns NaN (or a wrong prefix
// value, e.g. "12.34.56" -> 12.34) for a malformed OCR match. Routed
// through the shared parseAmountInput() so a bad match fails closed
// (null, "couldn't extract an amount") instead of quietly writing NaN
// or a bogus value into expenseAmount.
const { parseAmountInput } = require("../../utils/money");

// Approximate the merchant name from the first words of the receipt.
const extractMerchant = (text) => {
  const words = text.split(" ");
  return words.slice(0, 2).join(" ");
};

// Extract the receipt total amount.
const extractAmount = (text) => {
  const matches = [
    ...text.matchAll(
      /(grand total|total)[^\d]*([\d,.]+)/gi
    ),
  ];

  if (!matches.length) {
    return null;
  }

  // Prefer grand total, else use the last match.
  const grandTotal = matches.find(match =>
    match[1].toLowerCase().includes("grand")
  );

  const finalMatch =
    grandTotal || matches[matches.length - 1];

  return parseAmountInput(finalMatch[2]);
};

// Extract the receipt date in any supported format.
const extractDate = (text) => {
  const dateRegex =
    /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})|(\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})/i;

  const match = text.match(dateRegex);

  if (!match) {
    return null;
  }

  return match[0];
};

// Extract the line-item section of the receipt.
const extractItemsBlock = (text) => {
  let itemSection = text;

  const itemStart =
    text.search(/item/i);

  if (itemStart !== -1) {
    itemSection =
      text.substring(itemStart);
  }

  // Cut off at the totals or payment section.
  const stopRegex =
    /(subtotal|gst|grand total|total|payment|thank you)/i;

  const stopMatch =
    itemSection.match(stopRegex);

  if (stopMatch) {
    itemSection =
      itemSection.substring(
        0,
        stopMatch.index
      );
  }

  return itemSection.trim();
};

// Extract the expense fields the client needs from raw OCR text.
const parseReceipt = (text) => {

  return {
    expenseName: extractMerchant(text),
    expenseAmount: extractAmount(text),
    expenseDate: extractDate(text),
  };
};

module.exports = {
  parseReceipt,
};
