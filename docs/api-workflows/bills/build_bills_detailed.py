"""
Level 2 detailed diagrams for the Bills module — one file, two outputs.

Regions are chosen from what the implementation actually contains. There is no Bill
model, no storage layer and no external provider, so no region claims one. OCR runs
in-process via tesseract.js, which is drawn as local processing rather than as an
external dependency.

Run:  python3 build_bills_detailed.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Diagram, load_tokens   # noqa: E402

T = load_tokens()
L, C = T["layout"], T["canvas"]
Y0, PITCH, CW = L["firstCardY"], L["cardPitch"], L["cardWidth"]
BW, BH, BY = L["bandCardWidth"], L["bandCardHeight"], 982
BX = [40, 309, 578, 847, 1116, 1385]
GUTTER = (894, 902, 910, 918, 926, 934)
SUB_L, SUB_R, SUB_W = 1172, 1416, 236

FOOT = ("Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows "
        "are steps inside a region. Frontend review is drawn as UI work, never as backend "
        "validation.")


def col(region, i):
    return region.card_x, Y0 + i * PITCH


def stack(d, region, specs):
    made = []
    for i, sp in enumerate(specs):
        kind, icon, kicker, stage, impl, purpose = sp[:6]
        extra = sp[6] if len(sp) > 6 else {}
        made.append(d.card(*col(region, i), kind, icon, kicker, stage, impl, purpose,
                           **extra))
    for a, b in zip(made, made[1:]):
        d.flow_down(a, b)
    return made


def band(d, cards):
    d.exception_band(20, C["bandTop"], 1640, C["bandBottom"] - C["bandTop"],
                     "Exceptions and Current Limitations")
    return [d.exception_card(BX[i], BY, BW, BH, *c) for i, c in enumerate(cards)]


def refs(d, pairs):
    for pt, rail, gi, tgt, enter in pairs:
        y = GUTTER[gi]
        if enter == "left":
            d.path([pt, (rail, pt[1]), (rail, y), (28, y), (28, tgt.cy), (tgt.x, tgt.cy)],
                   "error", dashed=True)
        elif enter == "top-offset":
            d.path([pt, (rail, pt[1]), (rail, y), (400, y), (400, tgt.y)],
                   "error", dashed=True)
        else:
            d.path([pt, (rail, pt[1]), (rail, y), (tgt.cx, y), (tgt.cx, tgt.y)],
                   "error", dashed=True)


def finish(d, out, api_id, tail):
    svg = d.render(meta_right="BALENISA · Personal Finance Platform",
                   meta_left="docs/api-workflows · %s · Level 2 detailed" % api_id,
                   footer_notes=[FOOT, tail])
    open(os.path.join(HERE, out), "w", encoding="utf-8").write(svg)
    print("wrote", out, len(svg))


# ===========================================================================
# BILLS-01 — POST /bills/bill-upload
# ===========================================================================
d = Diagram(T, title="POST /bills/bill-upload — detailed implementation workflow",
            subtitle="Level 2 · real functions, middleware and services · badges map to "
                     "the 11 stages in bills-api-01-upload-and-extract-overview.svg")
r1 = d.region(20, 272, "User & Bill Interface", "File picker, preview, submit",
              accent="ui", step=1)
r2 = d.region(306, 272, "Frontend State & Network", "Local state + multipart client",
              accent="frontend", step=2)
r3 = d.region(592, 272, "API Security & Upload", "Middleware chain, in order",
              accent="backend", step=3)
r4 = d.region(878, 272, "File Processing & Extraction", "Temp file → sharp → OCR → parse",
              accent="insights", step=4)
r5 = d.region(1164, 496, "Response & Form Hand-off", "Where the parsed values go",
              accent="ui", step=5)

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "Add Expense Form", "AddExpense.js",
     "Offers an optional bill upload before the manual fields.", {"step": "01"}),
    ("ui", "window", "SCREEN", "Bill Upload Screen", "BillUpload.js",
     "Replaces the form entirely while open; no modal, no route.", {"step": "01"}),
    ("ui", "cursor", "INPUT", "File Picker", "input accept=\"image/*\"",
     "Single file. PDF is never offered here despite the server allowing it.",
     {"step": "02", "tag": "E5"}),
    ("ui", "monitor", "PREVIEW", "Blob Preview", "URL.createObjectURL",
     "Revoked when replaced and on unmount by a cleanup effect.", {"step": "02"}),
])
b = stack(d, r2, [
    ("frontend", "sigma", "STATE", "Selected File", "useState(selectedFile)",
     "Plain component state — no Context, no query cache.", {"step": "02"}),
    ("frontend", "refresh", "TANSTACK", "Upload Mutation", "useBillUploadMutation()",
     "No onSuccess, no invalidation — nothing is cached to invalidate.",
     {"step": "03", "tag": "E6"}),
    ("frontend", "send", "API CLIENT", "Multipart Builder", "FormData.append(\"bill\")",
     "Content-Type left unset so the browser writes the boundary.", {"step": "04"}),
    ("auth", "key", "AXIOS", "Token Attached", "api.interceptors.request",
     "Adds Authorization: Bearer <token> from localStorage.", {"step": "04"}),
])
c = stack(d, r3, [
    ("auth", "gauge", "MIDDLEWARE", "Rate Limiter", "apiLimiter",
     "150 req / 15 min. Mounted before the router, so keyed by IP.",
     {"step": "05", "tag": "E1"}),
    ("auth", "shield", "MIDDLEWARE", "Token Validation", "verifyToken()",
     "Runs BEFORE multer, so no file is written for an anonymous caller.",
     {"step": "05", "tag": "E2"}),
    ("auth", "file-text", "MIDDLEWARE", "File Filter", "fileFilter + limits",
     "Allows 4 MIME types and caps at 5 MB. MIME is client-declared.",
     {"step": "06", "tag": "E3"}),
    ("backend", "gears", "CONTROLLER", "Request Handler", "uploadBill()",
     "One try/catch/finally around every processing stage.",
     {"step": "06", "tag": "E4"}),
])
e = stack(d, r4, [
    ("database", "save", "TEMP FILE", "Disk Write", "multer.diskStorage",
     "Server-generated name into billUploads/. Client name is discarded.",
     {"step": "06"}),
    ("backend", "layers", "TRANSFORM", "Image Preprocessing", "preprocessImage()",
     "sharp: resize 1500, grayscale, normalize, sharpen, write PNG.",
     {"step": "07", "tag": "E5"}),
    ("insights", "chart", "LOCAL OCR", "Text Extraction", "extractTextFromImage()",
     "tesseract.js, eng. In-process — no external service, no timeout.",
     {"step": "08", "tag": "E6"}),
    ("backend", "sigma", "PARSE", "Receipt Parsing", "parseReceipt(text)",
     "Three regex guesses over the collapsed OCR string.", {"step": "09"}),
])
grp = d.pill_group(r4.card_x, e[-1].bottom + 6, CW, "raw text → three guesses",
                   [("expenseName", "first two words"),
                    ("expenseAmount", "total regex, or null"),
                    ("expenseDate", "date regex, or null")])
e5 = d.card(r4.card_x, grp.bottom + 14, "response", "send", "RESPONSE",
            "200 OK + Cleanup", "finally { unlink × 2 }",
            "Both temp files removed whether the request succeeded or failed.",
            step="10")
d.path([(e[-1].cx, e[-1].bottom), (e[-1].cx, grp.y)], "insights")
d.path([(grp.cx, grp.bottom), (grp.cx, e5.y)], "insights")

d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0 = d.card(1180, Y0, "ui", "layout", "COMPONENT STATE", "Bill Data Handed Up",
            "setBillData(parsedReceipt)",
            "A prop callback into AddExpense. No cache, no Context.",
            w=464, step="11")
d.handoff(e5, f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")
d.sub_region(SUB_L, 232, SUB_W, 342, "Form prefill", "ui")
d.sub_region(SUB_R, 232, SUB_W, 208, "Not persisted", "error")
LY = 264
g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("ui", "key", "REFORMAT", "Date Reformat", "formatDateForInput()",
     "Assumes DD/MM/YYYY; anything else becomes an empty string.",
     {"step": "11"}),
    ("ui", "layout", "FAN-OUT", "Three Fields Filled", "setName / setAmount / setDate",
     "One response fills three of the form's five inputs.", {"step": "11"}),
    ("ui", "cursor", "CHECKPOINT", "User Review", "every field editable",
     "Nothing is saved until the user submits the ordinary form.", {"step": "11"}),
])]
d.flow_down(g[0], g[1]); d.flow_down(g[1], g[2])
h = [d.card(1420, LY, "error", "alert", "ABSENT", "No Bill Record",
            "no model, no collection",
            "Nothing about this scan survives the response.", step="11")]
d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "ui",
       width=T["stroke"]["primaryPath"])
d.path([(h[0].right - 30, f0.bottom), (h[0].right - 30, h[0].y)], "error",
       width=T["stroke"]["primaryPath"])
d.note_box(1420, 456, 224, 232, "Layers that do not exist", [
    "No Bill schema, no upload history, no cloud storage and no retained file.",
    "No external OCR or AI provider: tesseract.js runs inside the Node process.",
    "No Redis and no query cache on this route.",
], "error")

x = band(d, [
    ("E1", "429 Too Many Requests", "apiLimiter",
     "More than 150 requests in 15 minutes from the same IP address. Applied at the "
     "mount, so it is keyed by IP rather than by account."),
    ("E2", "401 Unauthorized", "verifyToken()",
     "Missing Bearer header, malformed payload or expired JWT. Runs before multer, so "
     "no file is written for an unauthenticated caller."),
    ("E3", "400 File rejected", "MulterError / INVALID_FILE_TYPE",
     "Wrong MIME type, or over the 5 MB limit. Both are mapped to 400 — an oversized "
     "upload does not return 413."),
    ("E4", "400 No file uploaded", "if (!req.file)",
     "A request with no bill part reaches the controller and is rejected there."),
    ("E5", "PDF accepted but unprocessable", "fileFilter vs sharp",
     "application/pdf passes the filter, but sharp's PDF input needs a globally "
     "installed libvips; the bundled build has none, so it fails as a 500."),
    ("E6", "500 for every processing failure", "catch (error)",
     "sharp, OCR and parsing errors all return the same generic 500. The client cannot "
     "tell an unreadable image from a server fault."),
])
refs(d, [
    ((c[0].right, c[0].cy), 852, 0, x[0], "left"),
    ((c[1].x, c[1].cy), 604, 1, x[1], "top-offset"),
    ((c[2].right, c[2].cy), 852, 2, x[2], "top"),
    ((c[3].cx, c[3].bottom), c[3].cx, 3, x[3], "top"),
    ((e[1].right, e[1].cy), 1132, 4, x[4], "top"),
    ((e[2].right, e[2].cy), 1143, 5, x[5], "top"),
])
finish(d, "bills-api-01-upload-and-extract-detailed.svg", "BILLS-01",
       "Extraction only. This endpoint writes nothing to MongoDB, keeps no file and "
       "returns values that exist solely to prefill a form.")


# ===========================================================================
# BILLS-FLOW-01 — scan to saved expense
# ===========================================================================
d = Diagram(T, title="Bill scan to saved expense — detailed combined workflow",
            subtitle="Level 2 · two independent requests, one explicit save · badges map "
                     "to the 10 stages in bills-flow-01-scan-to-expense-overview.svg")
r1 = d.region(20, 272, "Bill Interface", "Where the scan begins", accent="ui", step=1)
r2 = d.region(306, 272, "Extraction Request", "BILLS-01, cross-referenced",
              accent="backend", step=2)
r3 = d.region(592, 272, "Normalization & Review", "Client-side only", accent="ui", step=3)
r4 = d.region(878, 272, "Persistence Request", "The Add Expense path, reused",
              accent="database", step=4)
r5 = d.region(1164, 496, "Cache & Final UI", "What refreshes after the save",
              accent="insights", step=5)

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "Add Expense Form", "AddExpense.js",
     "Owns billData and every form field.", {"step": "01"}),
    ("ui", "cursor", "TRIGGER", "Upload a Bill?", "setIsBillUpload(true)",
     "An optional branch; the manual form works without it.", {"step": "02"}),
    ("ui", "window", "SCREEN", "Bill Upload Screen", "BillUpload.js",
     "Early-returns in place of the form while open.", {"step": "02"}),
])
b = stack(d, r2, [
    ("frontend", "send", "CROSS-REF", "Extraction Call", "BILLS-01",
     "POST /bills/bill-upload. Documented separately, not repeated here.",
     {"step": "03", "tag": "E6"}),
    ("insights", "chart", "RESULT", "Parsed Receipt", "{ name, amount, date }",
     "Plus the full OCR text. Amount and date may both be null.",
     {"step": "04", "tag": "E4"}),
    ("error", "alert", "ABSENT", "No Persistence Yet", "nothing written",
     "The extraction response is the end of the Bills module's involvement.",
     {"step": "04"}),
])
c = stack(d, r3, [
    ("ui", "key", "NORMALIZE", "Date Reformat", "formatDateForInput()",
     "DD/MM/YYYY → YYYY-MM-DD. Any other shape becomes empty.",
     {"step": "05", "tag": "E1"}),
    ("ui", "layout", "FAN-OUT", "Form Prefill", "setBillData → useEffect",
     "Fills name, amount and date; category and description stay empty.",
     {"step": "06", "tag": "E2"}),
    ("ui", "cursor", "CHECKPOINT", "User Review", "every field editable",
     "The user can correct any extracted value before saving.", {"step": "07"}),
    ("ui", "monitor", "GUARD", "Manual Submit", "handleSubmit(e)",
     "Saving is explicit. Abandoning the form discards everything.",
     {"step": "07", "tag": "E5"}),
])
e = stack(d, r4, [
    ("frontend", "refresh", "TANSTACK", "Add Expense Mutation", "useAddExpenseMutation()",
     "The ordinary manual-entry mutation, reused unchanged.", {"step": "08"}),
    ("backend", "server", "CROSS-REF", "Expense Route", "POST /expense/add-expense",
     "A separate request with its own middleware and validation.",
     {"step": "08", "tag": "E3"}),
    ("database", "save", "MONGODB · WRITE", "Expense Insert", "ExpenseModel",
     "The stored record is an Expense. No bill provenance is kept.", {"step": "09"}),
    ("response", "send", "RESPONSE", "201 Created", "res.status(201).json({ … })",
     "Only now does anything exist in the database.", {"step": "09"}),
])
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)
d.note_box(r4.card_x, e[-1].bottom + 20, CW, 126, "Two requests, no transaction", [
    "Extraction and persistence are separate calls with nothing spanning them.",
    "A failure at either point leaves the other unaffected.",
], "error")

f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · MUTATION", "Mutation Settled",
            "onSuccess()",
            "The same invalidation the manual form has always used.",
            w=464, step="10")
d.handoff(e[-1], f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")
d.sub_region(SUB_L, 232, SUB_W, 446, "Query invalidation", "frontend")
d.sub_region(SUB_R, 232, SUB_W, 208, "Bills side", "error")
LY = 264
g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("frontend", "key", "INVALIDATE", "Expenses", "queryKeys.expenses.all",
     "The list the new expense belongs to.", {"step": "10"}),
    ("frontend", "key", "INVALIDATE", "Budgets", "queryKeys.budgets.all",
     "spent is recalculated server-side by the same write.", {"step": "10"}),
    ("frontend", "key", "INVALIDATE", "Reports & Charts", "reports.all · charts.all",
     "Both families refetch, so every chart reflects the new expense.",
     {"step": "10"}),
])]
for p, q in zip(g, g[1:]):
    d.flow_down(p, q)
h = [d.card(1420, LY, "error", "alert", "UNCHANGED", "Nothing to Invalidate",
            "no bills query exists",
            "The Bills module has no cache entry of its own.", step="10")]
d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "frontend",
       width=T["stroke"]["primaryPath"])
d.path([(h[0].right - 30, f0.bottom), (h[0].right - 30, h[0].y)], "error",
       width=T["stroke"]["primaryPath"])
d.note_box(1420, 456, 224, 232, "Classification", [
    "Upload → extraction → review → explicit persistence.",
    "The final record is an Expense; no Bill record exists at any point.",
    "Retrying the scan is safe because it writes nothing.",
], "insights")

x = band(d, [
    ("E1", "Date silently dropped", "formatDateForInput()",
     "Only DD/MM/YYYY is handled. A two-digit year yields an invalid string and a "
     "written month name yields \"\" — a successfully extracted date is lost."),
    ("E2", "Two fields never filled", "billData.expenseCategory / Description",
     "AddExpense reads both from billData, but parseReceipt never returns them, so "
     "they are always undefined and reset to empty."),
    ("E3", "Persistence can fail alone", "POST /expense/add-expense",
     "Extraction has already succeeded and the temp files are gone. The user keeps "
     "the filled form and must resubmit."),
    ("E4", "Nulls reach the form", "expenseAmount / expenseDate",
     "When no total or date is matched the parser returns null, which prefills as an "
     "empty input with no message explaining what was missed."),
    ("E5", "Abandonment loses everything", "no bill record",
     "Navigating away after a scan discards the extraction entirely; there is no "
     "history to return to and the file is already deleted."),
    ("E6", "No confidence is surfaced", "tesseract result.data.confidence",
     "OCR confidence is discarded in ocrService, so a low-quality read is presented "
     "exactly like a high-quality one."),
])
refs(d, [
    ((c[0].right, c[0].cy), 852, 0, x[0], "left"),
    ((c[1].x, c[1].cy), 604, 1, x[1], "top-offset"),
    ((e[1].right, e[1].cy), 1132, 2, x[2], "top"),
    ((b[1].x, b[1].cy), 318, 3, x[3], "top"),
    ((c[3].cx, c[3].bottom), c[3].cx, 4, x[4], "top"),
    ((b[0].right, b[0].cy), 566, 5, x[5], "top"),
])
finish(d, "bills-flow-01-scan-to-expense-detailed.svg", "BILLS-FLOW-01",
       "Stages 08–10 are the pre-existing Add Expense path, reused unchanged. It is "
       "cross-referenced rather than re-documented here.")
