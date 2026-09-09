"use strict";

// OCR-003-T03 -- the field extractors, lifted out of receiptParser.js and
// exported.
//
// They were private to that module, so the only way to test merchant, date
// or total extraction was through parseReceipt(): every case had to be
// expressed as a whole receipt, and a failure told you "parsing was wrong"
// rather than which extractor was wrong. Receipt text is exactly the kind of
// hostile input that deserves per-extractor cases -- ambiguous totals,
// unusual date formats, merchant names that collide with headings -- and
// that is impractical when the smallest testable unit is the entire parse.
//
// parseReceipt() keeps composing them and its behaviour is unchanged, with
// one deliberate addition described under extractAmount.
const { parseAmountInput } = require("../../utils/money");

// Approximate the merchant name from the first words of the receipt.
//
// Known limitation, stated rather than hidden: this is positional, not
// semantic. A receipt whose first line is "TAX INVOICE" yields "TAX INVOICE"
// as the merchant. That is why parseReceipt reports a review reason when the
// result looks like a document heading instead of pretending to be sure.
const extractMerchant = (text) => {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ");
};

// Headings that a positional merchant guess commonly lands on. Used only to
// FLAG uncertainty -- never to rewrite the value, because a shop really can
// be called "Total Tools" and silently blanking it would be worse than
// showing it with a caution.
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

// Extract the receipt total, along with the matched text (so its confidence
// can be looked up against the per-line breakdown) and every candidate the
// pattern found.
//
// OCR-003-T04 -- `candidates` and `ambiguous` are new. The selection rule is
// unchanged: prefer an explicit "grand total", else take the LAST total-like
// match, which is right for the usual receipt where subtotal precedes total.
// What changed is that the rule no longer applies itself silently. When two
// or more total-like lines carry DIFFERENT amounts, the choice is a guess,
// and a guess about the amount of money to record is exactly the thing a
// user should be asked to confirm. Reporting it costs one boolean; not
// reporting it means a wrong total is indistinguishable from a right one.
//
// Candidates with equal values are NOT ambiguous -- "Total 45.00" repeated
// on a customer copy is agreement, not conflict, and flagging it would train
// people to dismiss the warning.
const extractAmount = (text) => {
  const source = String(text ?? "");
  const matches = [...source.matchAll(/(grand total|total)[^\d]*([\d,.]+)/gi)];

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

// Extract the receipt date in any supported format, along with the matched
// text so its confidence can be looked up against the per-line breakdown.
const extractDate = (text) => {
  const dateRegex =
    /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})|(\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})/i;

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
