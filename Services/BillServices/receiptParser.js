const extractMerchant = (text) => {
  const words = text.split(" ");
  return words.slice(0, 2).join(" ");
};

const extractAmount = (text) => {

  // Match:
  // GRAND TOTAL 3967.43
  // Total: 1449
  // Grand Total Rs 899

  const matches = [
    ...text.matchAll(
      /(grand total|total)[^\d]*([\d,.]+)/gi
    ),
  ];

  if (!matches.length) {
    return null;
  }

  // Prefer GRAND TOTAL if exists
  const grandTotal = matches.find(match =>
    match[1].toLowerCase().includes("grand")
  );

  const finalMatch =
    grandTotal || matches[matches.length - 1];

  return parseFloat(
    finalMatch[2].replace(/,/g, "")
  );
};

const extractDate = (text) => {

  // Supports:
  // 23/05/2026
  // 23-05-2026
  // 21st May 2026
  // 12 May 2026

  const dateRegex =
    /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})|(\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})/i;

  const match = text.match(dateRegex);

  if (!match) {
    return null;
  }

  return match[0];
};

const extractItemsBlock = (text) => {

  // Remove everything before ITEM
  let itemSection = text;

  const itemStart =
    text.search(/item/i);

  if (itemStart !== -1) {
    itemSection =
      text.substring(itemStart);
  }

  // Stop at subtotal/gst/total/payment
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

const parseReceipt = (text) => {

  return {
    expenseName: extractMerchant(text),
    expenseAmount: extractAmount(text),
    expenseDate: extractDate(text),
    extractedText: text,
  };
};

module.exports = {
  parseReceipt,
};