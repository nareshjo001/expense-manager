"""
API-09 Level 1 — GET /expense/expense-edit-data

Created during the repository-wide API coverage gate — this endpoint previously had no
API document of its own, only a cross-link from FLOW-02. Nine stages: no Redis (this
route has no server cache at all), and the hydration effect is imperative
(queryClient.fetchQuery), not a mounted useQuery hook, so it's drawn as a direct trigger
rather than a query-hook state machine.

    row 1   01  02  03  04  05  06  07  08  09

Run:  python3 build_api09_overview.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Overview, load_tokens   # noqa: E402

o = Overview(load_tokens(),
             title="GET /expense/expense-edit-data — edit-form hydration",
             subtitle="Quick overview · follow 01 → 09 · full detail in "
                      "api-09-edit-data-detailed.svg")
d = o.d
C, R1, R2 = o.COL, o.ROW1, o.ROW2

# ---------------------------------------------------------------------------
d.facts_panel(34, o.BAND_Y, 836, o.BAND_H, "At a glance", [
    ("Endpoint",     "GET /expense/expense-edit-data?expenseId=",  "response"),
    ("Auth",         "Bearer JWT, checked every request",          "auth"),
    ("Server cache", "None — no getCache, no setCache",            "database"),
    ("Access",       "Imperative queryClient.fetchQuery, not useQuery", "frontend"),
    ("Written by this request", "programmaticNameRef.current — suppresses ML prediction", "ui"),
])

d.note_box(882, o.BAND_Y, 516, 130, "Not a mounted query hook", [
    "AddExpense.js calls queryClient.fetchQuery directly inside a useEffect, so a repeat "
    "open within staleTime skips the network round trip but the call is not auto-cancelled "
    "on unmount the way a useQuery hook would be.",
], "frontend")

# ---------------------------------------------------------------------------
s1 = o.card(0, R1, "ui", "cursor", "01", "Edit Triggered", "isEdit.enableEdit",
            "User opens an existing expense to edit.")
s2 = o.card(1, R1, "frontend", "refresh", "02", "fetchQuery Call", "queryClient.fetchQuery",
            "Imperative — checks cache before requesting.")
s3 = o.card(2, R1, "auth", "key", "03", "Authorized Request", "Axios Client",
            "Attaches the JWT, sends expenseId.")
s4 = o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
            "IP rate limit, then JWT validation.")
s5 = o.card(4, R1, "backend", "user-check", "05", "User Validation", "geteditexpense",
            "UserModel.findById before anything else.")
s6 = o.card(5, R1, "backend", "gauge", "06", "ObjectId Guard", "isValid(expenseId)",
            "Malformed IDs rejected before any query.")
s7 = o.card(6, R1, "database", "database", "07", "Scoped Read", "MongoDB",
            "findOne({userId, _id}) — ownership enforced.")
s8 = o.card(7, R1, "response", "send", "08", "Respond", "200 / 400 / 404",
            "Raw document returned, no field filtering.")
s9 = o.card(8, R1, "ui", "layout", "09", "Form Hydration", "AddExpense.js",
            "Five fields set + programmaticNameRef written.")

o.chain([s1, s2, s3, s4, s5, s6, s7, s8, s9], o.R1_CY)

d.top.append(d._text(894, 452, "ONE SCOPED READ -> ONE DOCUMENT", 9.6,
                     d.pal("database")["ink"], 700, ls=0.9))
d.dataset_chip(894, 462, 500, 26, "data", "the full expense document, unfiltered")

# ---------------------------------------------------------------------------
ep = d.pal("error")
d.path([(s9.cx, s9.bottom), (s9.cx, 458)], "error", dashed=True)
d.mid.append('<g><rect x="%d" y="458" width="%d" height="98" rx="10" fill="%s" '
             'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s%s%s</g>'
             % (C[8], o.CW, ep["fill"], ep["border"],
                d._icon("alert", C[8] + 13, 470, ep["line"], 0.78),
                d._text(C[8] + 34, 483, "Silent failure", 10.8, ep["ink"], 700),
                d._text(C[8] + 13, 506, "Current limitation:", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 519, "Every error path is", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 532, "console.error only.", 9.8, d.n["inkMuted"], 400)))

svg = o.render(["Nine stages — no Redis layer exists on this route, and the hydration call is "
                "an imperative fetchQuery, not a mounted useQuery hook."], "API-09")
open(os.path.join(HERE, "api-09-edit-data-overview.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote api-09-edit-data-overview.svg", len(svg), "bytes")
