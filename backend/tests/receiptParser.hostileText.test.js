// TST-001-T04 -- backend/Services/BillServices/receiptParser.js: the OCR
// *parser*, not the upload boundary. receiptUpload.security.test.js
// already covers hostile file bytes at the HTTP upload boundary
// (signature spoofing, corrupted bytes, size/pixel limits, etc); this
// file targets the next stage, what happens once an OCR engine has
// already turned an image into text and that text -- attacker-influenced
// (a crafted receipt image, a QR code decoded as "text", plain OCR
// garbage) -- is handed to the parser for amount/date/merchant
// extraction. The security property under test throughout: every
// hostile input must produce a sensible parsed result or a clean null,
// never an uncaught exception, a hang, or a crash.
//
// Only `parseReceipt` is exported from receiptParser.js -- extractAmount,
// extractMerchant and extractDate are internal and reached only through
// it, so every test below drives the real call path via parseReceipt(),
// matching how billController.js actually calls it. (extractItemsBlock
// is defined in the module but is dead code: parseReceipt never calls
// it and it is not exported -- not exercised here for that reason.)
"use strict";

const { parseReceipt } = require("../Services/BillServices/receiptParser");

describe("parseReceipt - length and backtracking safety", () => {
  test("a multi-megabyte run of non-keyword garbage completes fast and returns a well-formed result", () => {
    const text = "x".repeat(2_000_000);
    const start = Date.now();
    const result = parseReceipt(text);
    const elapsed = Date.now() - start;

    expect(elapsed < 5000).toBe(true);
    expect(typeof result.expenseName).toBe("string");
    expect(result.expenseAmount).toBeNull();
    expect(result.expenseDate).toBeNull();
  });

  test("a single huge space-free token (no delimiters at all) does not hang extractMerchant's split", () => {
    const text = "a".repeat(3_000_000);
    const start = Date.now();
    const result = parseReceipt(text);
    const elapsed = Date.now() - start;

    expect(elapsed < 5000).toBe(true);
    expect(result.expenseName.length).toBeGreaterThan(0);
    expect(result.expenseAmount).toBeNull();
  });

  test("a long run of digits with no 'total' keyword completes fast and finds no amount", () => {
    const text = "9".repeat(1_000_000);
    const start = Date.now();
    const result = parseReceipt(text);
    const elapsed = Date.now() - start;

    expect(elapsed < 5000).toBe(true);
    expect(result.expenseAmount).toBeNull();
  });

  // KNOWN FINDING (documented, not fixed by this task -- see report):
  // extractAmount's regex is /(grand total|total)[^\d]*([\d,.]+)/gi. When
  // "total"/"grand total" occurs many times in the text and no digit ever
  // follows any occurrence, matchAll must, for every occurrence, scan
  // [^\d]* forward to the end of the remaining string before failing --
  // this is O(n) per occurrence, so O(n^2) overall as occurrence count
  // grows with input length. Measured directly against this parser
  // (Node 22, this sandbox): ~135ms at 2,000 repetitions (114KB), ~551ms
  // at 4,000 (228KB), ~2.2s at 8,000 (456KB) -- a clean quadratic curve,
  // not exponential/catastrophic, so it always terminates, but a large
  // adversarial OCR transcript (multi-megabyte, plausible under the
  // existing 20-megapixel/5MB upload limits if an attacker crafts an
  // image dense with repeated "TOTAL" text) could tie up the Node event
  // loop for many seconds synchronously inside a single request handler.
  // These two tests use small-enough inputs to stay fast and reliable in
  // CI while still proving termination; they intentionally do NOT assert
  // a tight latency bound, since asserting a fix's performance here would
  // be asserting behavior this task did not change.
  test("many 'total' occurrences with no digits anywhere after them still terminate without throwing", () => {
    const text = ("total " + "!".repeat(50) + " ").repeat(2500); // ~142KB
    const start = Date.now();
    let result, threw = null;
    try {
      result = parseReceipt(text);
    } catch (e) {
      threw = e;
    }
    const elapsed = Date.now() - start;

    expect(threw).toBeNull();
    expect(elapsed < 5000).toBe(true);
    expect(result.expenseAmount).toBeNull();
  }, 15000);

  test("many 'grand total' occurrences with no digits anywhere after them still terminate without throwing", () => {
    const text = ("grand total " + "!".repeat(50) + " ").repeat(1200); // ~76KB
    const start = Date.now();
    let result, threw = null;
    try {
      result = parseReceipt(text);
    } catch (e) {
      threw = e;
    }
    const elapsed = Date.now() - start;

    expect(threw).toBeNull();
    expect(elapsed < 5000).toBe(true);
    expect(result.expenseAmount).toBeNull();
  }, 15000);

  test("a long run of ambiguous date-shaped fragments does not hang the (non-global) date regex", () => {
    const text = "12/34/".repeat(200000); // 1.2M chars
    const start = Date.now();
    const result = parseReceipt(text);
    const elapsed = Date.now() - start;

    expect(elapsed < 5000).toBe(true);
    expect(typeof result.expenseDate === "string" || result.expenseDate === null).toBe(true);
  });
});

describe("parseReceipt - control characters, null bytes and encoding tricks", () => {
  test("an embedded null byte does not crash the parser", () => {
    const text = "Total " + String.fromCharCode(0) + " 125.50";
    const result = parseReceipt(text);
    expect(result.expenseAmount).toBe(125.5);
  });

  test("a run of C0 control characters does not crash the parser", () => {
    const controlRun = String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 11, 12, 14, 15, 31);
    const text = "Total " + controlRun + " 125.50";
    const result = parseReceipt(text);
    expect(result.expenseAmount).toBe(125.5);
    expect(typeof result.expenseName).toBe("string");
  });

  test("zero-width characters splitting the 'total' keyword degrade to a clean null instead of a wrong match", () => {
    // U+200B ZERO WIDTH SPACE, U+200C ZERO WIDTH NON-JOINER, U+FEFF
    // ZERO WIDTH NO-BREAK SPACE (BOM), inserted inside and after the
    // literal word "total" so /total/i can no longer match it.
    const zwsp = String.fromCharCode(0x200b);
    const zwnj = String.fromCharCode(0x200c);
    const zwnbsp = String.fromCharCode(0xfeff);
    const text = "T" + zwsp + "o" + zwnj + "tal" + zwnbsp + " 125.50";

    const result = parseReceipt(text);

    expect(result.expenseAmount).toBeNull();
    expect(typeof result.expenseName).toBe("string");
  });

  test("a right-to-left override around the amount does not crash and yields a finite parsed value", () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE ... U+202C POP DIRECTIONAL FORMATTING.
    // This can make the *displayed* digits look reordered to a human
    // even though the underlying character sequence -- what the parser
    // actually reads -- is unchanged; documented here as a visual-
    // spoofing consideration, not a parser crash.
    const rlo = String.fromCharCode(0x202e);
    const pdf = String.fromCharCode(0x202c);
    const text = "Total " + rlo + "00.521" + pdf;

    const result = parseReceipt(text);

    expect(typeof result.expenseAmount).toBe("number");
    expect(Number.isFinite(result.expenseAmount)).toBe(true);
  });

  test("a lone (unpaired) UTF-16 surrogate does not crash the parser", () => {
    const lone = String.fromCharCode(0xd800);
    const text = "Total " + lone + " 125.50";

    const result = parseReceipt(text);

    expect(result.expenseAmount).toBe(125.5);
  });

  test("mojibake (mis-decoded multi-byte text) does not crash and degrades gracefully", () => {
    // Looks like UTF-8 "\xc3\xb3" ("o" with acute) re-decoded as Latin-1,
    // the classic double-decode artifact -- breaks the literal "total"
    // keyword match, same as the zero-width case above.
    const text = "T" + String.fromCharCode(0xc3, 0xb3) + "tal 125.50";

    const result = parseReceipt(text);

    expect(result.expenseAmount).toBeNull();
  });
});

describe("parseReceipt - adversarial amount formats", () => {
  test("multiple decimal points fail closed to null instead of taking a wrong prefix", () => {
    const result = parseReceipt("Total 12.34.56.78");
    expect(result.expenseAmount).toBeNull();
  });

  test("multiple currency symbols before the digits do not stop the amount from being found", () => {
    // extractAmount's [^\d]* between the keyword and the digits happily
    // swallows currency symbols; parseAmountInput then validates the
    // captured digit run on its own.
    const result = parseReceipt("Total $$12.34");
    expect(result.expenseAmount).toBe(12.34);
  });

  test("scientific notation is not interpreted as an exponent (the 'e' is outside the digit character class)", () => {
    const result = parseReceipt("Total 1e10");
    expect(result.expenseAmount).toBe(1);
  });

  test("a very large but IEEE-754-finite digit run parses to a finite number, not NaN or a crash", () => {
    const result = parseReceipt("Total " + "9".repeat(28));
    expect(Number.isFinite(result.expenseAmount)).toBe(true);
  });

  test("a digit run large enough to overflow to Infinity fails closed to null, not Infinity", () => {
    const result = parseReceipt("Total " + "9".repeat(400));
    expect(result.expenseAmount).toBeNull();
  });

  test("a leading minus sign is dropped by the non-digit gap, not treated as a negative amount", () => {
    // Documented current behavior, not a crash: '-' is not a digit, so
    // it is consumed by [^\d]* before the digits are captured, and
    // parseAmountInput only ever accepts non-negative strings anyway.
    const result = parseReceipt("Total -50.00");
    expect(result.expenseAmount).toBe(50);
  });

  test("a number embedded inside unrelated surrounding text does not crash and best-effort matches", () => {
    const result = parseReceipt("Please call 1-800-TOTAL for total support hotline: 555.1234 today");
    expect(result.expenseAmount).toBe(555.1234);
  });

  test("an empty string yields clean nulls, not a crash", () => {
    const result = parseReceipt("");
    expect(result.expenseAmount).toBeNull();
    expect(result.expenseDate).toBeNull();
    expect(result.expenseName).toBe("");
  });

  test("a whitespace-only string yields clean nulls, not a crash", () => {
    const result = parseReceipt("   \n\t  ");
    expect(result.expenseAmount).toBeNull();
    expect(result.expenseDate).toBeNull();
  });

  test("spreadsheet-formula-shaped text ('=SUM(...)') is treated as inert text by the amount parser", () => {
    const result = parseReceipt("=SUM(A1:A10) Total 1.00");
    expect(result.expenseAmount).toBe(1);
    // NOTE: expenseName preserves the leading '=' verbatim
    // ("=SUM(A1:A10) Total"). receiptParser.js never evaluates it -- no
    // eval/Function/template interpolation happens here -- but if this
    // field is ever exported to CSV/XLSX in future, a leading '=', '+',
    // '-' or '@' is the classic CSV/Excel formula-injection trigger.
    // Checked as part of this task: no CSV/XLSX export exists anywhere
    // in backend/ today (grepped Controllers/Services/Routes for
    // csv/xlsx/exceljs/papaparse/json2csv, no matches), so there is no
    // live sink for this today -- flagging for whoever adds one later.
    expect(result.expenseName).toBe("=SUM(A1:A10) Total");
  });

  test("formula-shaped arithmetic text ('+1+1') does not crash and does not get evaluated", () => {
    const result = parseReceipt("+1+1 Total 42.00");
    expect(result.expenseAmount).toBe(42);
    expect(result.expenseName).toBe("+1+1 Total");
  });
});

describe("parseReceipt - injection-shaped content is treated as inert text", () => {
  // receiptParser.js's output (parsedReceipt) is returned straight into
  // res.status(200).json({ parsedReceipt, ... }) in
  // Controllers/BillControllers/billController.js -- JSON-serialized,
  // never interpolated into an HTML template or a string-concatenated
  // Mongo query. Grepped the addExpense/editExpense write paths too:
  // they all build Mongoose queries from object literals off req.body
  // (the client's own follow-up submission), never receive parsedReceipt
  // automatically, and never string-concatenate a query. No unescaped
  // HTML/template/SQL sink for this output was found anywhere in
  // backend/ or frontend/src (no dangerouslySetInnerHTML in the
  // frontend either). These tests confirm the parser itself treats
  // injection-shaped OCR text as inert data, matching that finding.

  test("an HTML script tag in the text is returned as a literal string, not executed", () => {
    const result = parseReceipt("<script>alert(1)</script> Total 10.00");
    expect(result.expenseName).toBe("<script>alert(1)</script> Total");
    expect(result.expenseAmount).toBe(10);
  });

  test("a JS template-literal-shaped string is returned literally, not interpolated", () => {
    const result = parseReceipt("${process.env.SECRET} Total 5.00");
    expect(result.expenseName).toBe("${process.env.SECRET} Total");
    expect(result.expenseAmount).toBe(5);
  });

  test("a mustache-template-shaped string is returned literally, not rendered", () => {
    const result = parseReceipt("{{7*7}} Total 5.00");
    expect(result.expenseName).toBe("{{7*7}} Total");
    expect(result.expenseAmount).toBe(5);
  });

  test("SQL-meta-character-laden text does not crash and is returned as literal text", () => {
    const result = parseReceipt("Robert'); DROP TABLE Students;-- Total 20.00");
    expect(result.expenseName).toBe("Robert'); DROP");
    expect(result.expenseAmount).toBe(20);
  });
});

describe("parseReceipt - multi-language and non-Latin script text", () => {
  test("a Japanese-language receipt with no Latin 'total' keyword degrades to a clean null amount", () => {
    // "GOUKEI" (total) + "1250 YEN"
    const text = String.fromCharCode(0x5408, 0x8a08) + " 1250" + String.fromCharCode(0x5186);
    const result = parseReceipt(text);

    expect(result.expenseAmount).toBeNull();
    expect(typeof result.expenseName).toBe("string");
  });

  test("Arabic text mixed with the Latin 'total' keyword still finds the amount and does not crash", () => {
    // "the total" (Arabic) + "total 125.50"
    const arabicPrefix = String.fromCharCode(0x627, 0x644, 0x645, 0x62c, 0x645, 0x648, 0x639);
    const text = arabicPrefix + " total 125.50";
    const result = parseReceipt(text);

    expect(result.expenseAmount).toBe(125.5);
  });

  test("emoji-heavy text does not crash and still finds an adjacent amount", () => {
    const text = "\u{1F9FE}\u{1F4B0} Total \u{1F4B5}125.50\u{1F525}";
    const result = parseReceipt(text);

    expect(result.expenseAmount).toBe(125.5);
  });
});

describe("parseReceipt - non-string input (defensive edge case, documents current behavior)", () => {
  // Not part of the OCR-text attack surface the task scopes this suite
  // to: ocrService.js's extractTextFromImage always returns a string
  // (result.data.text normalized and trimmed), so parseReceipt is never
  // actually called with a non-string in the real upload -> OCR ->
  // parse call path. Included anyway as a documented finding: called
  // directly with null/undefined/a number, parseReceipt currently
  // throws an uncaught TypeError (extractMerchant's text.split blows up
  // on a non-string) rather than failing closed. Flagged in the task
  // report rather than silently fixed here, since it sits outside this
  // task's stated "hostile OCR text" scope and touching it is a call
  // for whoever owns receiptParser.js next.
  test("null currently throws (documented, not silently patched)", () => {
    expect(() => parseReceipt(null)).toThrow(TypeError);
  });

  test("undefined currently throws (documented, not silently patched)", () => {
    expect(() => parseReceipt(undefined)).toThrow(TypeError);
  });

  test("a non-string number currently throws (documented, not silently patched)", () => {
    expect(() => parseReceipt(12345)).toThrow(TypeError);
  });
});
