"""
BALENISA API workflow diagram engine.

Reusable template for every diagram in docs/api-workflows. Diagram scripts
describe *what* the workflow is; this module owns *how* it looks, so the whole
documentation set stays visually identical.

Usage:
    from workflow_diagram import Diagram, load_tokens
    d = Diagram(load_tokens(), title="...", subtitle="...")
    r = d.region("BACKEND API", x=600, w=264, accent="backend")
    c = d.card(r.card_x, 114, kind="auth", icon="shield", kicker="MIDDLEWARE",
               stage="Token Validation", impl="verifyToken()",
               purpose="Verifies the JWT and attaches the user id.")
    d.arrow_down(c, next_card)
    open("out.svg", "w").write(d.render())
"""

import json
import os

TOKENS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "diagram-tokens.json")


def load_tokens(path=TOKENS_PATH):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------
# text helpers
# --------------------------------------------------------------------------

_NARROW = set("iljtfrI.,;:'|!()[]-` ")
_WIDE = set("MWmw@%")


def text_width(s, size, mono=False, ls=0.0):
    """Conservative advance-width estimate so text fits in Inter and in the
    Liberation/DejaVu fallbacks used by the CI rasteriser."""
    if mono:
        return len(s) * size * 0.602 + ls * len(s)
    total = 0.0
    for ch in s:
        if ch in _NARROW:
            total += 0.315
        elif ch in _WIDE:
            total += 0.86
        elif ch.isupper() or ch.isdigit():
            total += 0.605
        else:
            total += 0.535
    return total * size + ls * len(s)


def wrap(s, max_px, size, mono=False, max_lines=2):
    words, lines, cur = s.split(), [], ""
    for w in words:
        trial = w if not cur else cur + " " + w
        if text_width(trial, size, mono) <= max_px or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
            if len(lines) == max_lines:
                break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    if len(lines) == max_lines and words:
        consumed = len(" ".join(lines).split())
        if consumed < len(words):
            while lines[-1] and text_width(lines[-1] + "…", size, mono) > max_px:
                lines[-1] = lines[-1][:-1]
            lines[-1] += "…"
    return lines


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


# --------------------------------------------------------------------------
# 18x18 stroke icon set (no emoji, single consistent visual language)
# --------------------------------------------------------------------------

ICONS = {
    "cursor":     '<path d="M3.5 2 L3.5 15 L7 11.5 L9.4 16.2 L11.3 15.3 L9 10.8 L14.2 10.3 Z"/>',
    "window":     '<rect x="2" y="3.2" width="14" height="11.6" rx="1.8"/><path d="M2 7.2 H16"/><circle cx="4.6" cy="5.2" r="0.6"/><circle cx="6.8" cy="5.2" r="0.6"/>',
    "layout":     '<rect x="2" y="3.2" width="14" height="11.6" rx="1.8"/><path d="M2 7.2 H16"/><path d="M7.2 7.2 V14.8"/>',
    "refresh":    '<path d="M15.4 9a6.4 6.4 0 1 1-1.9-4.5"/><path d="M15.6 2.4 V5.6 H12.4"/>',
    "key":        '<circle cx="5.8" cy="12.1" r="3.1"/><path d="M8.1 9.9 L15.4 2.6"/><path d="M12.4 5.6 L14.5 7.7"/>',
    "send":       '<path d="M16.2 2 L2 8.6 L8.1 10.4 L9.9 16.4 Z"/><path d="M16.2 2 L8.1 10.4"/>',
    "shield":     '<path d="M9 1.9 L15.1 4.4 V8.9 c0 4-3.1 6.3-6.1 7.2 -3-0.9-6.1-3.2-6.1-7.2 V4.4 Z"/><path d="M6.4 8.9 L8.3 10.8 L11.8 7.2"/>',
    "gauge":      '<path d="M2.6 13.2 a6.6 6.6 0 1 1 12.8 0"/><path d="M9 13.2 L12.4 7.6"/><circle cx="9" cy="13.2" r="0.9"/>',
    "server":     '<rect x="2" y="2.8" width="14" height="5" rx="1.3"/><rect x="2" y="10.2" width="14" height="5" rx="1.3"/><circle cx="5" cy="5.3" r="0.85"/><circle cx="5" cy="12.7" r="0.85"/>',
    "gears":      '<circle cx="9" cy="9" r="3.1"/><path d="M9 1.6 V3.4 M9 14.6 V16.4 M1.6 9 H3.4 M14.6 9 H16.4 M3.8 3.8 L5 5 M13 13 L14.2 14.2 M14.2 3.8 L13 5 M5 13 L3.8 14.2"/>',
    "bolt":       '<path d="M10.6 1.4 L3.9 9.9 H8.4 L7.4 16.6 L14.1 8.1 H9.6 Z"/>',
    "user-check": '<circle cx="6.8" cy="5.4" r="3.1"/><path d="M1.4 15.6 c0-3.1 2.4-5.2 5.4-5.2 1.1 0 2.1 0.3 3 0.8"/><path d="M11.2 12.6 L13.4 14.8 L16.8 10.6"/>',
    "database":   '<ellipse cx="9" cy="4.1" rx="6" ry="2.4"/><path d="M3 4.1 V13.9 c0 1.3 2.7 2.4 6 2.4 s6-1.1 6-2.4 V4.1"/><path d="M3 9 c0 1.3 2.7 2.4 6 2.4 s6-1.1 6-2.4"/>',
    "layers":     '<path d="M9 1.6 L16.4 5.5 L9 9.4 L1.6 5.5 Z"/><path d="M1.6 9.4 L9 13.3 L16.4 9.4"/><path d="M1.6 12.9 L9 16.8 L16.4 12.9"/>',
    "save":       '<rect x="2.2" y="2.4" width="13.6" height="13.2" rx="1.8"/><path d="M5.6 2.4 V7.4 H12.4 V2.4"/><rect x="5.6" y="10" width="6.8" height="5.6" rx="0.8"/>',
    "chart":      '<path d="M2 15.8 H16.2"/><path d="M2.6 12.6 L6.6 8.2 L10 11.2 L15.8 3.6"/><path d="M12.6 3.4 H16 V6.8"/>',
    "sigma":      '<path d="M13.4 3.2 H4.8 L9.4 9 L4.8 14.8 H13.4"/>',
    "alert":      '<path d="M9 2.2 L16.6 15.6 H1.4 Z"/><path d="M9 6.9 V10.9"/><circle cx="9" cy="13.2" r="0.85"/>',
    "file-text":  '<path d="M4 1.6 H10.2 L14.2 5.6 V16.4 H4 Z"/><path d="M10.2 1.6 V5.6 H14.2"/><path d="M6.4 9.4 H11.8 M6.4 12.4 H11.8"/>',
    "monitor":    '<rect x="2" y="2.8" width="14" height="9.8" rx="1.8"/><path d="M6.2 16.2 H11.8"/><path d="M9 12.6 V16.2"/>',
    "list":       '<path d="M6.2 4.4 H16 M6.2 9 H16 M6.2 13.6 H16"/><circle cx="2.9" cy="4.4" r="0.95"/><circle cx="2.9" cy="9" r="0.95"/><circle cx="2.9" cy="13.6" r="0.95"/>',
}


# --------------------------------------------------------------------------
# geometry containers
# --------------------------------------------------------------------------

class Box:
    def __init__(self, x, y, w, h, kind=None):
        self.x, self.y, self.w, self.h, self.kind = x, y, w, h, kind

    @property
    def cx(self): return self.x + self.w / 2

    @property
    def cy(self): return self.y + self.h / 2

    @property
    def right(self): return self.x + self.w

    @property
    def bottom(self): return self.y + self.h


class Region(Box):
    def __init__(self, x, y, w, h, pad):
        super().__init__(x, y, w, h)
        self.pad = pad

    @property
    def card_x(self): return self.x + self.pad

    def rail_left(self, inset): return self.x + inset

    def rail_right(self, inset): return self.right - inset


def rounded_path(points, r):
    """Orthogonal polyline with rounded corners."""
    if len(points) < 2:
        return ""
    d = ["M %.1f %.1f" % points[0]]
    for i in range(1, len(points) - 1):
        p0, p1, p2 = points[i - 1], points[i], points[i + 1]
        v0 = (p1[0] - p0[0], p1[1] - p0[1])
        v1 = (p2[0] - p1[0], p2[1] - p1[1])
        l0 = max((v0[0] ** 2 + v0[1] ** 2) ** 0.5, 0.001)
        l1 = max((v1[0] ** 2 + v1[1] ** 2) ** 0.5, 0.001)
        rr = min(r, l0 / 2, l1 / 2)
        a = (p1[0] - v0[0] / l0 * rr, p1[1] - v0[1] / l0 * rr)
        b = (p1[0] + v1[0] / l1 * rr, p1[1] + v1[1] / l1 * rr)
        d.append("L %.1f %.1f" % a)
        d.append("Q %.1f %.1f %.1f %.1f" % (p1[0], p1[1], b[0], b[1]))
    d.append("L %.1f %.1f" % points[-1])
    return " ".join(d)


# --------------------------------------------------------------------------
# diagram
# --------------------------------------------------------------------------

class Diagram:
    def __init__(self, tokens, title, subtitle, width=None, height=None):
        self.t = tokens
        self.c = tokens["canvas"]
        self.l = tokens["layout"]
        self.s = tokens["semantic"]
        self.n = tokens["neutral"]
        self.ty = tokens["typography"]
        self.st = tokens["stroke"]
        self.W = width or self.c["width"]
        self.H = height or self.c["height"]
        self.title = title
        self.subtitle = subtitle
        self._clips = []     # clipPath defs emitted with the other defs
        self.body = []       # region boxes (drawn first)
        self.mid = []        # cards, pills, chips
        self.top = []        # connectors and labels (drawn last)

    # ---- palette -------------------------------------------------------
    def pal(self, kind):
        return self.s[kind]

    # ---- primitives ----------------------------------------------------
    def _text(self, x, y, s, size, fill, weight=400, mono=False,
              ls=0, anchor="start", opacity=1.0):
        fam = self.ty["mono"] if mono else self.ty["sans"]
        return ('<text x="%.1f" y="%.1f" font-family="%s" font-size="%.2f" '
                'font-weight="%s" fill="%s" letter-spacing="%.2f" '
                'text-anchor="%s" opacity="%.2f">%s</text>'
                % (x, y, fam, size, weight, fill, ls, anchor, opacity, esc(s)))

    def _icon(self, name, x, y, color, scale=1.0):
        return ('<g transform="translate(%.1f,%.1f) scale(%.3f)" fill="none" '
                'stroke="%s" stroke-width="%.2f" stroke-linecap="round" '
                'stroke-linejoin="round">%s</g>'
                % (x, y, scale, color, self.st["icon"] / scale, ICONS[name]))

    # ---- structure -----------------------------------------------------
    def region(self, x, w, label, sublabel="", accent="frontend", step=None,
               y=None, h=None):
        y = self.c["regionTop"] if y is None else y
        h = (self.c["regionBottom"] - y) if h is None else h
        p = self.pal(accent)
        r = Region(x, y, w, h, self.l["regionPaddingX"])
        rad = self.l["regionRadius"]
        self.body.append(
            '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%d" '
            'fill="%s" stroke="%s" stroke-width="%d" filter="url(#regionShadow)"/>'
            % (x, y, w, h, rad, self.n["regionFill"],
               self.n["regionBorder"], self.st["regionBorder"]))
        # accent cap + tinted header band, clipped to the container's rounded rect
        cid = "rgnclip%d" % len(self._clips)
        self._clips.append('<clipPath id="%s"><rect x="%.1f" y="%.1f" width="%.1f" '
                           'height="%.1f" rx="%d"/></clipPath>'
                           % (cid, x, y, w, h, rad))
        self.body.append('<rect x="%.1f" y="%.1f" width="%.1f" height="52" fill="%s" '
                         'fill-opacity="0.07" clip-path="url(#%s)"/>'
                         % (x, y, w, p["line"], cid))
        self.body.append('<rect x="%.1f" y="%.1f" width="%.1f" height="4" fill="%s" '
                         'clip-path="url(#%s)"/>' % (x, y, w, p["line"], cid))
        lx = x + self.l["regionPaddingX"]
        if step is not None:
            self.body.append('<rect x="%.1f" y="%.1f" width="19" height="15" rx="4" '
                             'fill="%s"/>' % (lx, y + 15, p["line"]))
            self.body.append(self._text(lx + 9.5, y + 26, "%02d" % step, 9.4,
                                        "#FFFFFF", 700, ls=0.3, anchor="middle"))
            lx += 27
        rl = self.ty["regionLabel"]
        self.body.append(self._text(lx, y + 26, label.upper(), rl["size"],
                                    self.n["regionLabel"], rl["weight"],
                                    ls=rl["letterSpacing"]))
        if sublabel:
            self.body.append(self._text(x + self.l["regionPaddingX"], y + 43,
                                        sublabel, 9.0, self.n["inkFaint"], 400))
        return r

    def sub_region(self, x, y, w, h, label, kind):
        p = self.pal(kind)
        self.body.append(
            '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="12" '
            'fill="%s" fill-opacity="0.55" stroke="%s" stroke-width="1" '
            'stroke-dasharray="3 3"/>' % (x, y, w, h, p["fill"], p["border"]))
        sl = self.ty["subLabel"]
        self.body.append(self._text(x + 14, y + 20, label.upper(), sl["size"],
                                    p["ink"], sl["weight"], ls=sl["letterSpacing"]))

    # ---- cards ---------------------------------------------------------
    def card(self, x, y, kind, icon, kicker, stage, impl, purpose,
             w=None, h=None, branches=None, step=None, tag=None):
        w = w or self.l["cardWidth"]
        h = h or self.l["cardHeight"]
        p = self.pal(kind)
        g = ['<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%d" '
             'fill="%s" stroke="%s" stroke-width="%d" filter="url(#cardShadow)"/>'
             % (x, y, w, h, self.l["cardRadius"], p["fill"], p["border"],
                self.st["cardBorder"])]
        # accent spine
        g.append('<rect x="%.1f" y="%.1f" width="3" height="%.1f" rx="1.5" fill="%s"/>'
                 % (x, y + 10, h - 20, p["line"]))
        g.append(self._icon(icon, x + 13, y + 12, p["line"], 0.86))
        if step is not None:
            bd = self.ty["badge"]
            g.append('<rect x="%.1f" y="%.1f" width="23" height="16" rx="5" fill="%s" '
                     'fill-opacity="0.16" stroke="%s" stroke-width="0.9"/>'
                     % (x + w - 36, y + 10, p["line"], p["line"]))
            g.append(self._text(x + w - 24.5, y + 21.5, step, bd["size"], p["ink"],
                                bd["weight"], ls=bd["letterSpacing"], anchor="middle"))
        if tag is not None:
            ep = self.pal("error")
            tx0 = x + w - (62 if step is not None else 36)
            g.append('<rect x="%.1f" y="%.1f" width="22" height="15" rx="4" fill="%s" '
                     'stroke="%s" stroke-width="0.9" stroke-dasharray="2.5 2"/>'
                     % (tx0, y + 10.5, ep["fill"], ep["line"]))
            g.append(self._text(tx0 + 11, y + 21.5, tag, 8.6, ep["ink"], 700,
                                anchor="middle"))
        tx = x + 34
        k = self.ty["kicker"]
        g.append(self._text(tx, y + 20, kicker, k["size"], p["ink"], k["weight"],
                            ls=k["letterSpacing"]))
        sg = self.ty["stage"]
        g.append(self._text(tx, y + 33.5, stage, sg["size"], self.n["ink"],
                            sg["weight"], ls=sg["letterSpacing"]))
        im = self.ty["impl"]
        inner = w - 26
        impl_line = wrap(impl, inner, im["size"], mono=True, max_lines=1)[0]
        g.append(self._text(x + 13, y + 51, impl_line, im["size"],
                            self.n["inkMono"], im["weight"], mono=True))
        pu = self.ty["purpose"]
        for i, line in enumerate(wrap(purpose, inner, pu["size"],
                                      max_lines=pu["maxLines"])):
            g.append(self._text(x + 13, y + 64 + i * pu["lineHeight"], line,
                                pu["size"], self.n["inkMuted"], pu["weight"]))
        if branches:
            by = y + h - 22
            g.append('<path d="M %.1f %.1f H %.1f" stroke="%s" stroke-width="1"/>'
                     % (x + 10, by, x + w - 10, self.n["divider"]))
            half = (w - 20) / 2
            for i, (btxt, bkind) in enumerate(branches):
                bp = self.pal(bkind)
                bx = x + 10 + i * half
                g.append('<rect x="%.1f" y="%.1f" width="%.1f" height="14" rx="4" '
                         'fill="%s" fill-opacity="0.85"/>'
                         % (bx + 1, by + 4, half - 2, bp["fill"]))
                g.append(self._text(bx + half / 2, by + 14, btxt, 8.2, bp["ink"],
                                    700, ls=0.5, anchor="middle"))
        self.mid.append("<g>%s</g>" % "".join(g))
        return Box(x, y, w, h, kind)

    def pill_group(self, x, y, w, header, pills, kind="database"):
        p = self.pal(kind)
        ph, pp = self.l["pillHeight"], self.l["pillPitch"]
        h = 26 + len(pills) * pp
        g = ['<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="10" '
             'fill="%s" fill-opacity="0.5" stroke="%s" stroke-width="1" '
             'stroke-dasharray="4 3"/>' % (x, y, w, h, p["fill"], p["border"])]
        g.append(self._text(x + w / 2, y + 16, header.upper(), 8.2, p["ink"],
                            700, ls=0.8, anchor="middle"))
        for i, (name, desc) in enumerate(pills):
            py = y + 24 + i * pp
            g.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%d" rx="6" '
                     'fill="#FFFFFF" stroke="%s" stroke-width="1"/>'
                     % (x + 9, py, w - 18, ph, p["border"]))
            g.append('<circle cx="%.1f" cy="%.1f" r="2.6" fill="%s"/>'
                     % (x + 20, py + ph / 2, p["line"]))
            g.append(self._text(x + 28, py + ph / 2 + 1.2, name, 9.3,
                                self.n["inkMono"], 700, mono=True))
            nx = x + 28 + text_width(name, 9.3, mono=True) + 6
            g.append(self._text(nx, py + ph / 2 + 1.2, desc, 8.8,
                                self.n["inkFaint"], 400))
        self.mid.append("<g>%s</g>" % "".join(g))
        return Box(x, y, w, h)

    def chip(self, x, y, w, code, source, note, h=None):
        h = h or self.l["chipHeight"]
        p = self.pal("error")
        g = ['<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%d" '
             'fill="%s" stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>'
             % (x, y, w, h, self.l["chipRadius"], p["fill"], p["border"])]
        g.append(self._icon("alert", x + 11, y + 10, p["line"], 0.66))
        g.append(self._text(x + 28, y + 20, code, 10.2, p["ink"], 700))
        g.append(self._text(x + 11, y + 35, source, 9.2, self.n["inkMono"],
                            400, mono=True))
        for i, line in enumerate(wrap(note, w - 22, 8.9, max_lines=3)):
            g.append(self._text(x + 11, y + 47 + i * 10.6, line, 8.9,
                                self.n["inkMuted"], 400))
        self.mid.append("<g>%s</g>" % "".join(g))
        return Box(x, y, w, h)

    # ---- connectors ----------------------------------------------------
    def path(self, points, kind, dashed=False, width=None, label=None,
             label_at=None, label_rotate=False, marker=True, chevron=None,
             opacity=1.0):
        p = self.pal(kind)
        sw = width or (self.st["errorPath"] if dashed else self.st["internalPath"])
        dash = ' stroke-dasharray="%s"' % self.st["errorDash"] if dashed else ""
        mk = ' marker-end="url(#arrow-%s)"' % kind if marker else ""
        op = self.st["errorOpacity"] if dashed else opacity
        self.top.append('<path d="%s" fill="none" stroke="%s" stroke-width="%.2f"%s%s '
                        'stroke-linecap="round" opacity="%.2f"/>'
                        % (rounded_path(points, self.st["cornerRadius"]),
                           p["line"], sw, dash, mk, op))
        if chevron:
            cx, cy = chevron
            self.top.append('<path d="M %.1f %.1f L %.1f %.1f L %.1f %.1f Z" fill="%s"/>'
                            % (cx - 3.4, cy - 4.6, cx + 4.6, cy, cx - 3.4, cy + 4.6,
                               p["line"]))
        if label:
            lx, ly = label_at
            rl = self.ty["railLabel"]
            tw = text_width(label, rl["size"], ls=rl["letterSpacing"]) + 20
            rot = ' transform="rotate(-90 %.1f %.1f)"' % (lx, ly) if label_rotate else ""
            self.top.append('<g%s><rect x="%.1f" y="%.1f" width="%.1f" height="15" '
                            'rx="4" fill="%s" stroke="%s" stroke-width="0.9"/>%s</g>'
                            % (rot, lx - tw / 2, ly - 7.5, tw, p["fill"], p["border"],
                               self._text(lx, ly + 3.4, label, rl["size"], p["ink"],
                                          rl["weight"], ls=rl["letterSpacing"],
                                          anchor="middle")))

    def flow_down(self, a, b, kind=None, width=None):
        self.path([(a.cx, a.bottom), (b.cx, b.y)], kind or b.kind,
                  width=width or self.st["internalPath"])

    def handoff(self, a, b, gap_x, entry_x=None, kind=None, width=None,
                label=None):
        """Region -> region: out of a's right edge, up through the handoff lane above
        the containers, then down into b's top edge. The entry point is offset toward
        b's right corner so the connector never crosses the region title."""
        lane = self.c["handoffLaneY"]
        ex = entry_x if entry_x is not None else b.right - 26
        self.path([(a.right, a.cy), (gap_x, a.cy), (gap_x, lane),
                   (ex, lane), (ex, b.y)], kind or b.kind,
                  width=width or self.st["primaryPath"],
                  chevron=(gap_x + (ex - gap_x) * 0.22, lane), label=label,
                  label_at=(gap_x + (ex - gap_x) * 0.68, lane) if label else None)

    # ---- level 2: exceptions band --------------------------------------
    def exception_band(self, x, y, w, h, title, subtitle=""):
        ep = self.pal("error")
        self.body.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="14" '
                         'fill="%s" fill-opacity="0.45" stroke="%s" stroke-width="1" '
                         'stroke-dasharray="6 4"/>' % (x, y, w, h, ep["fill"], ep["border"]))
        self.body.append(self._icon("alert", x + 22, y + 15, ep["line"], 0.88))
        self.body.append(self._text(x + 48, y + 28, title.upper(), 11.0, ep["ink"],
                                    700, ls=1.1))
        if subtitle:
            self.body.append(self._text(x + 48 + text_width(title.upper(), 11.0, ls=1.1) + 16,
                                        y + 28, subtitle, 9.6, self.n["inkFaint"], 400))
        return Box(x, y, w, h)

    def exception_card(self, x, y, w, h, tag, code, origin, note):
        ep = self.pal("error")
        g = ['<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="10" fill="#FFFFFF" '
             'stroke="%s" stroke-width="1"/>' % (x, y, w, h, ep["border"]),
             '<rect x="%.1f" y="%.1f" width="3" height="%.1f" rx="1.5" fill="%s"/>'
             % (x, y + 10, h - 20, ep["line"]),
             '<rect x="%.1f" y="%.1f" width="24" height="16" rx="5" fill="%s" '
             'stroke="%s" stroke-width="0.9"/>' % (x + 13, y + 12, ep["fill"], ep["line"]),
             self._text(x + 25, y + 23.5, tag, 9.6, ep["ink"], 700, anchor="middle"),
             self._text(x + 45, y + 24, code, 11.4, ep["ink"], 700)]
        g.append(self._text(x + 13, y + 44, "from  " + origin, 10.0,
                            self.n["inkMono"], 400, mono=True))
        for i, line in enumerate(wrap(note, w - 26, 10.0, max_lines=4)):
            g.append(self._text(x + 13, y + 60 + i * 12.2, line, 10.0,
                                self.n["inkMuted"], 400))
        self.mid.append("<g>%s</g>" % "".join(g))
        return Box(x, y, w, h)

    def error_ref(self, origin_pt, rail_x, gutter_y, target):
        """Thin red dashed reference: origin -> region rail -> gutter -> band card."""
        self.path([origin_pt, (rail_x, origin_pt[1]), (rail_x, gutter_y),
                   (target.cx, gutter_y), (target.cx, target.y)],
                  "error", dashed=True)

    # ---- level 1: overview primitives -----------------------------------
    def ocard(self, x, y, w, h, kind, icon, step, title, label, desc):
        p, o = self.pal(kind), self.t["overview"]["typography"]
        g = ['<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="12" fill="%s" '
             'stroke="%s" stroke-width="1.2" filter="url(#cardShadow)"/>'
             % (x, y, w, h, p["fill"], p["border"]),
             '<rect x="%.1f" y="%.1f" width="4" height="%.1f" rx="2" fill="%s"/>'
             % (x, y + 12, h - 24, p["line"]),
             '<rect x="%.1f" y="%.1f" width="27" height="19" rx="6" fill="%s"/>'
             % (x + 14, y + 13, p["line"]),
             self._text(x + 27.5, y + 26.5, step, o["badge"]["size"], "#FFFFFF",
                        o["badge"]["weight"], anchor="middle"),
             self._icon(icon, x + w - 32, y + 13, p["line"], 1.0)]
        tt, inner = o["title"], w - 28
        lines = wrap(title, inner, tt["size"], max_lines=tt["maxLines"])
        base = y + 56 if len(lines) > 1 else y + 62
        for i, ln in enumerate(lines):
            g.append(self._text(x + 14, base + i * tt["lineHeight"], ln, tt["size"],
                                self.n["ink"], tt["weight"]))
        lb = o["label"]
        g.append(self._text(x + 14, y + 96, label, lb["size"], p["ink"], lb["weight"],
                            ls=lb["letterSpacing"]))
        ds = o["desc"]
        for i, ln in enumerate(wrap(desc, inner, ds["size"], max_lines=ds["maxLines"])):
            g.append(self._text(x + 14, y + 112 + i * ds["lineHeight"], ln, ds["size"],
                                self.n["inkMuted"], ds["weight"]))
        self.mid.append("<g>%s</g>" % "".join(g))
        return Box(x, y, w, h, kind)

    def group_box(self, x, y, w, h, label, kind, note="", label_x=None, note_x=None):
        """label_x / note_x let a caller slide the captions clear of any connector
        that drops through the container's top edge."""
        p = self.pal(kind)
        self.body.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="14" '
                         'fill="%s" fill-opacity="0.4" stroke="%s" stroke-width="1.2" '
                         'stroke-dasharray="6 4"/>' % (x, y, w, h, p["fill"], p["border"]))
        self.body.append(self._text(label_x if label_x is not None else x + 16,
                                    y + 22, label.upper(), 10.0, p["ink"], 700, ls=1.0))
        if note:
            self.body.append(self._text(note_x if note_x is not None else x + w - 16,
                                        y + 22, note, 9.6, self.n["inkFaint"], 400,
                                        anchor="start" if note_x is not None else "end"))
        return Box(x, y, w, h)

    def dataset_chip(self, x, y, w, h, name, desc, kind="database"):
        p = self.pal(kind)
        g = ['<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="8" fill="#FFFFFF" '
             'stroke="%s" stroke-width="1"/>' % (x, y, w, h, p["border"]),
             '<circle cx="%.1f" cy="%.1f" r="3.2" fill="%s"/>' % (x + 15, y + h / 2, p["line"]),
             self._text(x + 25, y + h / 2 + 4, name, 11.0, self.n["inkMono"], 700, mono=True)]
        nx = x + 25 + text_width(name, 11.0, mono=True) + 8
        g.append(self._text(nx, y + h / 2 + 4, desc, 10.2, self.n["inkFaint"], 400))
        self.mid.append("<g>%s</g>" % "".join(g))
        return Box(x, y, w, h)

    def facts_panel(self, x, y, w, h, title, rows):
        o = self.t["overview"]["typography"]
        g = ['<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="14" fill="#FFFFFF" '
             'stroke="%s" stroke-width="1"/>' % (x, y, w, h, self.n["regionBorder"]),
             self._text(x + 22, y + 30, title.upper(), 10.5, self.n["regionLabel"],
                        700, ls=1.1),
             '<path d="M %.1f %.1f H %.1f" stroke="%s" stroke-width="1"/>'
             % (x + 22, y + 44, x + w - 22, self.n["divider"])]
        for i, (k, v, kind) in enumerate(rows):
            ry = y + 70 + i * 32
            p = self.pal(kind)
            g.append('<rect x="%.1f" y="%.1f" width="7" height="7" rx="2" fill="%s"/>'
                     % (x + 22, ry - 7, p["line"]))
            g.append(self._text(x + 38, ry, k, o["panelKey"]["size"],
                                self.n["inkMuted"], o["panelKey"]["weight"]))
            g.append(self._text(x + 168, ry, v, o["panelVal"]["size"],
                                self.n["ink"], o["panelVal"]["weight"], mono=True))
        self.mid.append("<g>%s</g>" % "".join(g))
        return Box(x, y, w, h)

    def note_box(self, x, y, w, h, title, lines, kind):
        """Muted panel for 'this layer is deliberately absent' statements."""
        p = self.pal(kind)
        g = ['<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="12" fill="%s" '
             'fill-opacity="0.35" stroke="%s" stroke-width="1" stroke-dasharray="5 4"/>'
             % (x, y, w, h, p["fill"], p["border"]),
             self._text(x + 15, y + 24, title.upper(), 9.4, p["ink"], 700, ls=0.9)]
        yy = y + 44
        for line in lines:
            for w_ in wrap(line, w - 30, 10.0, max_lines=3):
                g.append(self._text(x + 15, yy, w_, 10.0, self.n["inkMuted"], 400))
                yy += 12.6
            yy += 4
        self.mid.append("<g>%s</g>" % "".join(g))
        return Box(x, y, w, h)

    # ---- chrome --------------------------------------------------------
    def _defs(self):
        d = ['<filter id="cardShadow" x="-20%" y="-20%" width="140%" height="150%">'
             '<feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#0F172A" '
             'flood-opacity="0.07"/></filter>',
             '<filter id="regionShadow" x="-10%" y="-10%" width="120%" height="120%">'
             '<feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#0F172A" '
             'flood-opacity="0.04"/></filter>']
        for k, v in self.s.items():
            d.append('<marker id="arrow-%s" viewBox="0 0 10 10" refX="8.2" refY="5" '
                     'markerWidth="5.4" markerHeight="5.4" orient="auto-start-reverse">'
                     '<path d="M 0 1.2 L 8.6 5 L 0 8.8 z" fill="%s"/></marker>'
                     % (k, v["line"]))
        return "<defs>%s%s</defs>" % ("".join(d), "".join(self._clips))

    def _header(self, meta_left, meta_right):
        g = ['<rect x="0" y="0" width="%d" height="%d" fill="#FFFFFF"/>'
             % (self.W, self.c["titleBandHeight"]),
             '<path d="M 0 %d H %d" stroke="%s" stroke-width="1"/>'
             % (self.c["titleBandHeight"], self.W, self.n["regionBorder"])]
        m = self.c["margin"]
        t = self.ty["title"]
        g.append(self._text(m, 28, self.title, t["size"], self.n["ink"],
                            t["weight"], ls=t["letterSpacing"]))
        sb = self.ty["subtitle"]
        g.append(self._text(m, 46, self.subtitle, sb["size"], self.n["inkMuted"],
                            sb["weight"]))
        if meta_right:
            g.append(self._text(self.W - m, 28, meta_right, 10.5,
                                self.n["inkFaint"], 500, anchor="end"))
        if meta_left:
            g.append(self._text(self.W - m, 46, meta_left, 9.5,
                                self.n["inkFaint"], 400, anchor="end"))
        return "".join(g)

    def _footer(self, extra_lines):
        y = self.c["footerTop"]
        m = self.c["margin"]
        g = ['<path d="M %d %d H %d" stroke="%s" stroke-width="1"/>'
             % (m, y, self.W - m, self.n["divider"])]
        x = m
        for k, v in self.s.items():
            g.append('<rect x="%.1f" y="%.1f" width="11" height="11" rx="3" '
                     'fill="%s" stroke="%s" stroke-width="1"/>' % (x, y + 15, v["fill"], v["line"]))
            g.append(self._text(x + 16, y + 24, v["role"], self.ty["legend"]["size"],
                                self.n["inkMuted"], 400))
            x += 16 + text_width(v["role"], self.ty["legend"]["size"]) + 22
        for i, line in enumerate(extra_lines):
            g.append(self._text(m, y + 42 + i * 12, line, 8.8, self.n["inkFaint"], 400))
        return "".join(g)

    def render(self, meta_left="", meta_right="", footer_notes=()):
        return ('<svg xmlns="http://www.w3.org/2000/svg" '
                'xmlns:xlink="http://www.w3.org/1999/xlink" width="%d" height="%d" '
                'viewBox="0 0 %d %d" role="img">'
                '<title>%s</title><desc>%s</desc>%s'
                '<rect width="%d" height="%d" fill="%s"/>%s%s%s%s%s</svg>'
                % (self.W, self.H, self.W, self.H, esc(self.title), esc(self.subtitle),
                   self._defs(), self.W, self.H, self.c["background"],
                   self._header(meta_left, meta_right),
                   "".join(self.body), "".join(self.mid), "".join(self.top),
                   self._footer(list(footer_notes))))


# --------------------------------------------------------------------------
# Level 1 helper — every overview in the set uses this exact grid
# --------------------------------------------------------------------------

class Overview:
    """Thin wrapper around Diagram pre-configured for the shared Level 1 grid."""

    def __init__(self, tokens, title, subtitle):
        g, c = tokens["overview"]["grid"], tokens["overview"]["canvas"]
        self.d = Diagram(tokens, title=title, subtitle=subtitle,
                         width=c["width"], height=c["height"])
        self.d.c = dict(self.d.c, titleBandHeight=c["titleBandHeight"],
                        margin=c["margin"], footerTop=c["footerTop"])
        self.d.ty = dict(self.d.ty,
                         railLabel={"size": 9.8, "weight": 700, "letterSpacing": 0.6})
        self.COL = g["columnX"]
        self.CW, self.CH = g["cardWidth"], g["cardHeight"]
        self.ROW1, self.ROW2 = g["rowOneY"], g["rowTwoY"]
        self.R1_CY = self.ROW1 + self.CH / 2
        self.R2_CY = self.ROW2 + self.CH / 2
        self.LABEL_Y = g["labelBandY"]
        self.BAND_Y, self.BAND_H = g["lowerBandY"], g["lowerBandH"]

    def card(self, col, row_y, kind, icon, step, title, label, desc):
        return self.d.ocard(self.COL[col], row_y, self.CW, self.CH,
                            kind, icon, step, title, label, desc)

    def chain(self, cards, cy, width=2.8):
        for a, b in zip(cards, cards[1:]):
            self.d.path([(a.right, cy), (b.x, cy)], b.kind, width=width)

    def render(self, footer_notes, api_id):
        return self.d.render(
            meta_right="BALENISA · Personal Finance Platform",
            meta_left="docs/api-workflows · %s · Level 1 overview" % api_id,
            footer_notes=footer_notes)
