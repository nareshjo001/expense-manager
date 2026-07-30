"""
BUDGET-03 Level 1 — PUT /api/update-budget

Eleven stages. A write path, so the shape differs from the read routes: the request
drops into a server-side write sequence in row 2, then the response climbs back into
the client. Budget data itself is never cached in Redis; the only Redis traffic here
is the report cache, refreshed as a side effect.

    row 1   01  02  03  04  05  06                        11
    row 2                       07  08  09  10

Run:  python3 build_budget02_overview.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Overview, load_tokens   # noqa: E402

o = Overview(load_tokens(),
             title="PUT /api/update-budget — editing this month's budget",
             subtitle="Quick overview · follow 01 → 11 · full detail in "
                      "budget-api-03-update-budget-detailed.svg")
d = o.d
C, R1, R2 = o.COL, o.ROW1, o.ROW2

# ---------------------------------------------------------------------------
# captions slid clear of the two connectors that pierce the container top
# edge at x=972 (valid-amount drop) and x=1496 (200 OK riser)
d.group_box(882, 276, 704, 180, "Server write sequence", "database",
            note="no transaction spans these writes",
            label_x=996, note_x=1180)

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",     "PUT /api/update-budget",               "response"),
    ("Body",         "{ budget } — amount only, no month",   "backend"),
    ("Target month", "Always the current month, server clock", "backend"),
    ("Writes",       "Budget upsert → spent recalc → report", "database"),
    ("Returns",      "The recalculated budget document",     "response"),
])

d.note_box(1066, R1, 328, 132, "Same effect as POST /setbudget", [
    "This route upserts the same document, recalculates the same spent value and "
    "refreshes the same report.",
    "The only behavioural difference is that it returns the updated document.",
], "backend")

# ---------------------------------------------------------------------------
s1 = o.card(0, R1, "ui", "layout", "01", "Edit Budget Modal", "Header",
            "Opened from the insights header.")
s2 = o.card(1, R1, "frontend", "refresh", "02", "Update Mutation", "TanStack Mutation",
            "useUpdateBudgetMutation fires.")
s3 = o.card(2, R1, "auth", "key", "03", "Authorized Request", "Axios Client",
            "PUT with the JWT and { budget }.")
s4 = o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
            "IP rate limit, then JWT validation.")
s5 = o.card(4, R1, "backend", "user-check", "05", "User Validation", "updatebudget",
            "Confirms the account still exists.")
s6 = o.card(5, R1, "auth", "shield", "06", "Amount Validation", "Inline Guards",
            "Rejects blank, NaN, ∞ and negatives.")
s11 = o.card(8, R1, "frontend", "refresh", "11", "Invalidate and Refetch",
             "TanStack Query", "Budgets, reports and charts refresh.")

s7 = o.card(5, R2, "database", "save", "07", "Budget Upsert", "MongoDB",
            "Creates or overwrites this month's row.")
s8 = o.card(6, R2, "database", "sigma", "08", "Spend Recalculation", "Aggregate",
            "Sums this month's expenses into spent.")
s9 = o.card(7, R2, "database", "bolt", "09", "Report Refresh", "Redis + MongoDB",
            "Drops report:<user>, regenerates, re-caches.")
s10 = o.card(8, R2, "response", "send", "10", "Respond", "200 OK + data",
             "Returns the recalculated document.")

# ---------------------------------------------------------------------------
o.chain([s1, s2, s3, s4, s5, s6], o.R1_CY)
o.chain([s7, s8, s9, s10], o.R2_CY)

d.path([(s6.cx, s6.bottom), (s6.cx, s7.y)], "database", width=2.8,
       label="VALID AMOUNT", label_at=(s6.cx, o.LABEL_Y))
d.path([(s10.cx, s10.y), (s10.cx, s11.bottom)], "response", width=3.0,
       label="200 OK", label_at=(s10.cx, o.LABEL_Y))

# ---------------------------------------------------------------------------
ep = d.pal("error")
# routed down the right margin: a straight drop from 11 would cross card 10
d.path([(s11.right, o.R1_CY), (1584, o.R1_CY), (1584, 515), (C[8] + o.CW, 515)],
       "error", dashed=True)
d.mid.append('<g><rect x="%d" y="474" width="%d" height="82" rx="10" fill="%s" '
             'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s%s</g>'
             % (C[8], o.CW, ep["fill"], ep["border"],
                d._icon("alert", C[8] + 13, 486, ep["line"], 0.78),
                d._text(C[8] + 34, 499, "Partial write", 10.8, ep["ink"], 700),
                d._text(C[8] + 13, 522, "A failure after step 07", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 535, "leaves the budget changed.", 9.8, d.n["inkMuted"], 400)))

svg = o.render(["Functionally near-identical to POST /api/setbudget: same upsert, same "
                "recalculation, same report refresh. Only the response body differs."],
               "BUDGET-03")
open(os.path.join(HERE, "budget-api-03-update-budget-overview.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote budget-api-03-update-budget-overview.svg", len(svg), "bytes")
