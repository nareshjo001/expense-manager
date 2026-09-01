"""
Level 1 overviews for the Bills module — one file, two outputs.

The module has exactly one endpoint and one combined Bills-Expense flow, so this file
holds two specs rather than a generic factory. Both use shapes already approved in the
expense, budget, income and charts sets; nothing new was added to the design system.

Run:  python3 build_bills_overviews.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Overview, load_tokens   # noqa: E402


def new(title, subtitle):
    return Overview(load_tokens(), title=title, subtitle=subtitle)


def error_card(o, x, y, w, title, lines):
    d, ep = o.d, o.d.pal("error")
    body = "".join(d._text(x + 13, y + 44 + i * 13, ln, 9.8, d.n["inkMuted"], 400)
                   for i, ln in enumerate(lines))
    d.mid.append('<g><rect x="%d" y="%d" width="%d" height="%d" rx="10" fill="%s" '
                 'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s</g>'
                 % (x, y, w, 34 + len(lines) * 13 + 12, ep["fill"], ep["border"],
                    d._icon("alert", x + 13, y + 12, ep["line"], 0.78),
                    d._text(x + 34, y + 25, title, 10.8, ep["ink"], 700), body))


def save(o, svg, name):
    folder = "upload-extract" if name.startswith("bills-api-01") else "flow"
    open(os.path.join(HERE, folder, name), "w", encoding="utf-8").write(svg)
    print("wrote", name, len(svg))


# ===========================================================================
# BILLS-01 — POST /bills/bill-upload
# Write-shape layout: the request runs across row 1 to the upload middleware,
# drops into the server-side processing lane in row 2, then the response rises
# back into row 1. No backward connectors.
#
#     row 1   01  02  03  04  05  06      10  11
#     row 2                       07  08  09
# ===========================================================================
o = new("POST /bills/bill-upload — scanning a receipt into form fields",
        "Quick overview · follow 01 → 11 · full detail in "
        "bills-api-01-upload-and-extract-detailed.svg")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.group_box(882, 276, 704, 180, "Server-side processing", "backend",
            note="every artefact is deleted before responding",
            label_x=996, note_x=1180)

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /bills/bill-upload",              "response"),
    ("Body",       "multipart/form-data, field \"bill\"",  "backend"),
    ("Accepted",   "JPG, PNG, PDF · 5 MB limit",           "auth"),
    ("Extraction", "sharp → tesseract.js → regex parser",  "insights"),
    ("Persistence","None — nothing is saved by this route", "error"),
])

s1 = o.card(0, R1, "ui", "layout", "01", "Bill Upload Screen", "BillUpload",
            "Opened from the Add Expense form.")
s2 = o.card(1, R1, "ui", "cursor", "02", "File Selected", "Local State",
            "Blob preview; accept is image/* only.")
s3 = o.card(2, R1, "frontend", "refresh", "03", "Upload Mutation", "TanStack Mutation",
            "Button disabled while pending.")
s4 = o.card(3, R1, "auth", "key", "04", "Multipart Request", "Axios + FormData",
            "One field named bill, plus the JWT.")
s5 = o.card(4, R1, "auth", "shield", "05", "API Security", "Limiter + JWT",
            "IP rate limit, then JWT validation.")
s6 = o.card(5, R1, "auth", "gauge", "06", "Upload Middleware", "Multer",
            "MIME filter and a 5 MB cap.")
s10 = o.card(7, R1, "response", "send", "10", "Respond and Clean Up", "200 OK",
             "Both temp files unlinked in finally.")
s11 = o.card(8, R1, "ui", "layout", "11", "Form Prefill", "AddExpense",
             "Three fields land in the form.")

s7 = o.card(5, R2, "backend", "layers", "07", "Image Preprocessing", "sharp",
            "Resize, grayscale, normalize, sharpen.")
s8 = o.card(6, R2, "insights", "chart", "08", "Text Extraction", "tesseract.js",
            "Local OCR, English, no cloud call.")
s9 = o.card(7, R2, "backend", "sigma", "09", "Receipt Parsing", "Regex Parser",
            "Merchant, amount and date guesses.")

o.chain([s1, s2, s3, s4, s5, s6], o.R1_CY)
o.chain([s7, s8, s9], o.R2_CY)
d.path([(s6.cx, s6.bottom), (s6.cx, s7.y)], "backend", width=2.8,
       label="FILE ACCEPTED", label_at=(s6.cx, o.LABEL_Y))
d.path([(s9.cx, s9.y), (s9.cx, s10.bottom)], "response", width=3.0,
       label="200 OK", label_at=(s9.cx, o.LABEL_Y))
d.path([(s10.right, o.R1_CY), (s11.x, o.R1_CY)], "ui", width=2.8)

error_card(o, o.COL[8], 460, o.CW, "One failure code",
           ["Anything after the upload —", "sharp, OCR or parsing — returns", "a generic 500."])
d.path([(s11.right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["Extraction and saving are separate. This endpoint only reads the image; "
                  "creating the expense is a second, explicit user action."], "BILLS-01"),
     "bills-api-01-upload-and-extract-overview.svg")


# ===========================================================================
# BILLS-FLOW-01 — scan to saved expense
# Read-shape layout: ten stages straight across, consumer below the last one.
# ===========================================================================
o = new("Bill scan to saved expense — the combined workflow",
        "Quick overview · follow 01 → 10 · two separate APIs, one explicit save")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Step 1",     "POST /bills/bill-upload — extraction",  "backend"),
    ("Step 2",     "POST /expense/add-expense — persistence", "database"),
    ("Atomic",     "No — two requests, no transaction",     "error"),
    ("Editable",   "Every prefilled field is editable",     "ui"),
    ("Saves when", "The user submits, never automatically", "response"),
])

d.note_box(882, 276, 516, 168, "Where the boundary sits", [
    "Bills never writes to the database. The scan ends when three form fields are "
    "filled in.",
    "Persistence is the ordinary Add Expense path, reached only if the user submits.",
], "error")

t = [
    o.card(0, R1, "ui", "layout", "01", "Add Expense Form", "AddExpense",
           "Offers an optional bill upload."),
    o.card(1, R1, "ui", "cursor", "02", "Bill Screen Opens", "BillUpload",
           "Replaces the form while open."),
    o.card(2, R1, "frontend", "send", "03", "Extraction Call", "BILLS-01",
           "One multipart request, no retry."),
    o.card(3, R1, "insights", "chart", "04", "Parsed Fields", "OCR Result",
           "Name, amount and date, or nulls."),
    o.card(4, R1, "ui", "key", "05", "Date Reformat", "Client Side",
           "DD/MM/YYYY assumed for the input."),
    o.card(5, R1, "ui", "layout", "06", "Form Prefill", "setBillData",
           "Three of five fields are filled."),
    o.card(6, R1, "ui", "cursor", "07", "User Review", "Manual Edit",
           "Every field stays editable."),
    o.card(7, R1, "frontend", "refresh", "08", "Explicit Save", "TanStack Mutation",
           "Only on submit — never automatic."),
    o.card(8, R1, "database", "save", "09", "Expense Persisted", "MongoDB",
           "The record is an Expense, not a Bill."),
]
s10 = o.card(8, R2, "frontend", "key", "10", "Cache Invalidation", "TanStack Query",
             "Expenses, budgets, reports, charts.")
o.chain(t, o.R1_CY)
d.path([(t[8].cx, t[8].bottom), (t[8].cx, s10.y)], "frontend", width=2.8,
       label="ON SUCCESS", label_at=(t[8].cx, o.LABEL_Y))

error_card(o, o.COL[8], 460, o.CW, "Abandonment is silent",
           ["Leaving the form after a scan", "discards everything — no bill", "record is ever created."])
d.path([(s10.right, o.R2_CY), (1584, o.R2_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["Stages 01–06 are the Bills module. Stages 08–10 are the pre-existing Add "
                  "Expense path, reused unchanged and cross-referenced rather than duplicated."],
                 "BILLS-FLOW-01"),
     "bills-flow-01-scan-to-expense-overview.svg")
