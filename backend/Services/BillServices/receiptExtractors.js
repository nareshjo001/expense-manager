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
// OCR-003-T08 -- widened to recognise two real-world total labels found
// against actual receipt photos (OCR-003-T07's evaluation corpus): "Gross
// Amount" and "Bill Amt" are the ONLY labelled payable total on some
// receipts (limbo-premium, khodiyar-dhaba), with the sole "total"-labelled
// line on those receipts being a pre-discount/pre-GST figure that is not
// what the customer actually paid. The selection rule below is unchanged --
// prefer an explicit grand total, else the LAST total-like match -- which
// is why simply recognising these labels is enough: the true payable total
// is printed after any subtotal/pre-tax total line on a normal receipt.
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

// Extract the receipt date in any supported format, along with the matched
// text so its confidence can be looked up against the per-line breakdown.
// Returns the raw matched substring, not a parsed date -- nothing
// downstream parses this into a Date object today (see receiptParser.js),
// so the contract is only that whatever is returned here is itself
// something `new Date(...)` can later make sense of.
//
// OCR-003-T08 -- two real bugs found via OCR-003-T07's real-Tesseract
// evaluation run, both fixed here:
//
// 1. No support for an ISO-formatted date (`2023-08-17`), and no anchor to
//    stop the numeric d/m/y alternative from matching a misleading
//    SUBSTRING of one -- against "2023-08-17" the old regex matched
//    "23-08-17" (starting at the year's 3rd digit) instead of the full
//    date or no match at all, silently producing a wrong date. A dedicated
//    yyyy-mm-dd alternative is tried first; because it can match starting
//    at the year's first digit, the regex engine's normal leftmost-match
//    behaviour picks the whole date before the d/m/y alternative gets a
//    chance to match the tail end of it.
// 2. The worded-date alternative (`\d{1,2} <word> \d{4}`) never checked
//    that the middle word was an actual month name, and its whitespace
//    matched across line breaks (`\s` includes `\n`) -- so on noisy OCR
//    text it could false-positive-match garbage spanning two OCR lines
//    (e.g. "41\nFLOR 4241") as if it were a date, instead of correctly
//    reporting no date found. The month is now matched against an explicit
//    name list (full or abbreviated), and its surrounding whitespace is
//    restricted to spaces/tabs so it can no longer span a line break.
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
