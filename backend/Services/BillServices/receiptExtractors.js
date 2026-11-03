"use strict";

// Js and exported. They were private to that module, so the only way to test merchant, date or total extraction was through parseReceipt(): ev.
const { parseAmountInput } = require("../../utils/money");

// Approximate the merchant name from the first words of the receipt.
const extractMerchant = (text) => {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ");
};

// Headings that a positional merchant guess commonly lands on.
const MERCHANT_HEADING_HINTS = [
  "tax invoice",
  "invoice",
  "receipt",
  "cash receipt",
  "bill",
  "customer copy",
  "duplicate",
];

const looksLikeHeading = (merchant) => {
  const normalized = String(merchant ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return MERCHANT_HEADING_HINTS.some((hint) => normalized === hint || normalized.startsWith(`${hint} `));
};

// Extract the receipt total, along with the matched text (so its confidence can be looked up against the per-line breakdown) and every candidate the pattern found.
const extractAmount = (text) => {
  const source = String(text ?? "");
  const matches = [...source.matchAll(/(grand total|gross amount|bill amt|total)[^\d]*([\d,.]+)/gi)];

  if (!matches.length) {
    return { value: null, matchedText: null, candidates: [], ambiguous: false };
  }

  const candidates = matches.map((match) => ({
    label: match[1],
    matchedText: match[0],
    value: parseAmountInput(match[2]),
  }));

  const grandTotal = matches.find((match) => match[1].toLowerCase().includes("grand"));
  const finalMatch = grandTotal || matches[matches.length - 1];

  const distinctValues = new Set(
    candidates.map((c) => c.value).filter((v) => typeof v === "number" && Number.isFinite(v))
  );

  return {
    value: parseAmountInput(finalMatch[2]),
    matchedText: finalMatch[0],
    candidates,
    ambiguous: distinctValues.size > 1,
  };
};

// Extract the receipt date in any supported format, along with the matched text so its confidence can be looked up against the per-line breakdown.
const extractDate = (text) => {
  const dateRegex =
    /(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})|(\d{1,2}(?:st|nd|rd|th)?[ \t]+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[ \t]+\d{4})/i;

  const match = String(text ?? "").match(dateRegex);

  if (!match) {
    return { value: null, matchedText: null };
  }

  return { value: match[0], matchedText: match[0] };
};

// Extract the line-item section of the receipt.
const extractItemsBlock = (text) => {
  const source = String(text ?? "");
  let itemSection = source;

  const itemStart = source.search(/item/i);
  if (itemStart !== -1) {
    itemSection = source.substring(itemStart);
  }

  // Cut off at the totals or payment section.
  const stopMatch = itemSection.match(/(subtotal|gst|grand total|total|payment|thank you)/i);
  if (stopMatch) {
    itemSection = itemSection.substring(0, stopMatch.index);
  }

  return itemSection.trim();
};

module.exports = {
  extractMerchant,
  extractAmount,
  extractDate,
  extractItemsBlock,
  looksLikeHeading,
  MERCHANT_HEADING_HINTS,
};
