"""Shared Level 1 scaffolding for the charts module.

All nine chart routes sit behind the same mount and the same middleware pair, and
seven of the nine have no server cache at all. That common material is expressed once
here so each spec only states what is genuinely different about its endpoint.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Overview, load_tokens   # noqa: E402,F401


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
    return o.d.note_box(x, y, w, h, "No server cache on this route", [
        "This controller never calls getCache or setCache, so every request reaches "
        "MongoDB and there is no hit/miss branch.",
        "Only the two pie routes cache; the other seven do not.",
    ], "database")


def save(o, svg, name):
    open(os.path.join(HERE, name), "w", encoding="utf-8").write(svg)
    print("wrote", name, len(svg))
