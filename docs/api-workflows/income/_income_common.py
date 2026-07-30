"""Shared Level 1 scaffolding for the income module.

Every income route sits behind the same mount, the same middleware pair and the same
axios client, and none of them touches Redis. That common material is expressed once
here so each spec file only describes what is genuinely different about its endpoint.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Overview, load_tokens   # noqa: E402,F401

# Column slots used by the read shape (single row) and the write shape
# (row 1 up to the controller, row 2 for the database step, then back up).
READ_ROW = list(range(9))          # 01..09 straight across
WRITE_TOP = [0, 1, 2, 3, 4, 5]     # 01..06
WRITE_BOTTOM = [5, 6]              # 07, 08 sit under the controller
WRITE_RETURN = [6, 7]              # 09 rises above 08, then 10


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


def no_redis_box(o, x, y, w, h=150):
    """Every income route shares this absence, so it is stated the same way each time."""
    return o.d.note_box(x, y, w, h, "No Redis anywhere in this module", [
        "None of the six income routes calls getCache or setCache, so there is no "
        "server cache, no key and no TTL.",
        "The only cache in an income flow is TanStack Query in the browser.",
    ], "database")
