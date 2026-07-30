"""
SKELETON — copy this file to build the next API workflow diagram.

    cp _template_spec.py build_<endpoint>.py

Rules that keep the documentation set visually identical:
  * Never hardcode a colour, size or spacing value — read it from diagram-tokens.json.
  * Region order is always: User Interface, Frontend Data Layer, Backend API,
    Database & Cache, Frontend Insights & Rendering. Omit a region only if the
    endpoint genuinely has no such layer; never invent one.
  * The region x/width values below are fixed for the 1680x1210 Level 2 canvas. Reuse them
    as-is so every diagram in the set aligns column-for-column.
  * Errors do NOT sit inside the flow. They go in the bottom "Exceptions and
    Current Limitations" band, tagged E1..En on the originating card and linked
    back with a thin red dashed reference routed on its own GUTTER_Y line.
  * Every card carries a `step=` badge holding its Level 1 stage number, so the
    overview and the detailed view cross-reference. Several cards may share one.
  * Only three cache-like elements exist and they must stay distinguishable:
    Redis (database + bolt/save icon), MongoDB (database + database icon),
    TanStack (frontend + refresh icon). Always set the matching kicker.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from workflow_diagram import Diagram, load_tokens   # noqa: E402

T = load_tokens()
L, C = T["layout"], T["canvas"]
Y0, PITCH, INSET = L["firstCardY"], L["cardPitch"], L["railInset"]

# Fixed Level 2 column grid for this documentation set ---------------------
REGION_X = {"ui": 20, "frontend": 306, "backend": 592, "database": 878, "client": 1164}
REGION_W = {"ui": 272, "frontend": 272, "backend": 272, "database": 272, "client": 496}
GAP_X = {"ui->frontend": 299, "frontend->backend": 585,
         "backend->database": 871, "database->client": 1157}
SUB_L_X, SUB_R_X, SUB_W = 1172, 1416, 236      # sub-columns inside region 05
RAILS = {"backend": (604, 852), "database": (890, 1132), "database_alt": 1143}
GUTTER_Y = (894, 902, 910, 918, 926, 934)      # one line per error reference

d = Diagram(T,
            title="GET /expense/<endpoint> — <human readable name>",
            subtitle="<one line describing what the diagram shows>")

r1 = d.region(REGION_X["ui"], REGION_W["ui"], "User Interface",
              "<sublabel>", accent="ui", step=1)
r2 = d.region(REGION_X["frontend"], REGION_W["frontend"], "Frontend Data Layer",
              "<sublabel>", accent="frontend", step=2)
r3 = d.region(REGION_X["backend"], REGION_W["backend"], "Backend API",
              "<sublabel>", accent="backend", step=3)
r4 = d.region(REGION_X["database"], REGION_W["database"], "Database & Cache",
              "<sublabel>", accent="database", step=4)
r5 = d.region(REGION_X["client"], REGION_W["client"], "Frontend Insights & Rendering",
              "<sublabel>", accent="insights", step=5)

# A card's `kind` drives its colour and must match the semantic role:
#   ui | frontend | auth | backend | database | insights | response | error
a1 = d.card(r1.card_x, Y0, "ui", "window", "ROUTE", "<Stage>",
            "<file or function>", "<max two lines, <= 68 chars>", step="01")
a2 = d.card(r1.card_x, Y0 + PITCH, "ui", "layout", "COMPONENT", "<Stage>",
            "<file or function>", "<max two lines>", step="01", tag="E1")
d.flow_down(a1, a2)

b1 = d.card(r2.card_x, Y0, "frontend", "refresh", "TANSTACK", "<Stage>",
            "<hook>", "<one sentence>")
d.handoff(a2, b1, GAP_X["ui->frontend"])       # region -> region

# --- recipes ---------------------------------------------------------------
#
# Decision node with two labelled outcomes (taller card, same width):
#   e1 = d.card(r4.card_x, Y0, "database", "bolt", "REDIS · SERVER CACHE",
#               "Cache Lookup", "getCache(key)", "<one sentence>", h=104,
#               branches=[("HIT → 200 cached", "database"),
#                         ("MISS → continue", "backend")])
#
# One query fanning out into several datasets:
#   grp = d.pill_group(r4.card_x, y, L["cardWidth"], "one query → N datasets",
#                      [("data", "description"), ("previousData", "description")])
#
# Cache short-circuit rail (only where the code actually branches):
#   rail = r4.rail_right(INSET)
#   d.path([(e1.right, y), (rail, y), (rail, y2), (target.cx + 66, y2),
#           (target.cx + 66, target.y)],
#          "database", label="CACHE HIT", label_at=(rail, 470), label_rotate=True)
#
# Exceptions band plus a dashed reference back to the originating card:
#   band = d.exception_band(20, C["bandTop"], 1640,
#                           C["bandBottom"] - C["bandTop"],
#                           "Exceptions and Current Limitations")
#   x1 = d.exception_card(40, 982, L["bandCardWidth"], L["bandCardHeight"],
#                         "E1", "<status>", "<origin fn>", "<note>")
#   d.path([(src.x, src.cy), (RAILS["backend"][0], src.cy),
#           (RAILS["backend"][0], GUTTER_Y[0]), (x1.cx, GUTTER_Y[0]), (x1.cx, x1.y)],
#          "error", dashed=True)
#
# The cyan response hand-off (heaviest connector on the diagram):
#   d.handoff(response_card, client_cache_card, GAP_X["database->client"],
#             kind="response", width=T["stroke"]["responsePath"], label="HTTP RESPONSE")
#
# Parallel consumers of the same response (never chain them):
#   d.path([(consumerA.cx, source.bottom), (consumerA.cx, consumerA.y)], "insights")
#   d.path([(consumerB.cx, source.bottom), (consumerB.cx, consumerB.y)], "ui")
# ---------------------------------------------------------------------------

svg = d.render(
    meta_right="BALENISA · Personal Finance Platform",
    meta_left="docs/api-workflows · API-0N · generated from repository source",
    footer_notes=[
        "Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows are steps inside a region. The green rail is the Redis short-circuit.",
        "Redis (server cache, 300 s) · MongoDB (primary data) · TanStack Query (client cache, 5 min) are deliberately never styled alike. E1-En reference the band below.",
    ])

open(os.path.join(HERE, "<endpoint>.svg"), "w", encoding="utf-8").write(svg)
