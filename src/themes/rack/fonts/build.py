"""Build the Rack theme's faces: RackSeg (drawn here, a seven-segment face) and the OFL faces
fetched from github.com/google/fonts (Barlow Condensed 600 in capitals, Cinzel 600), subset to
Latin as WOFF2. A one-shot helper, NOT shipped in the bundle. Run with a Python that has
fontTools and brotli:  python build.py
"""
import io, sys, urllib.request
from pathlib import Path
from fontTools import subset
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
BASE = "https://github.com/google/fonts/raw/main/ofl/"
UNICODES = "U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+2190-2193,U+25B8,U+2192,U+00D7,U+2212"

# ---- RackSeg: seven segments, 1000 units to the em, slanted 9 degrees ----
T, G = 84, 12                     # segment thickness, gap between segment tips
X0, X1, Y1 = 70, 530, 700         # the digit's box
SLANT = 0.16
ADV = 640

def hbar(xl, xr, y):
    h = T / 2
    return [(xl, y), (xl + h, y + h), (xr - h, y + h), (xr, y), (xr - h, y - h), (xl + h, y - h)]

def vbar(x, yb, yt):
    h = T / 2
    return [(x, yb), (x + h, yb + h), (x + h, yt - h), (x, yt), (x - h, yt - h), (x - h, yb + h)]

xl, xr = X0 + T / 2, X1 - T / 2
yb, yt = T / 2, Y1 - T / 2
ym = (yb + yt) / 2
g2 = T / 2 + G
SEG = {
    "a": hbar(xl + g2 - T / 2, xr - g2 + T / 2, yt),
    "g": hbar(xl + g2 - T / 2, xr - g2 + T / 2, ym),
    "d": hbar(xl + g2 - T / 2, xr - g2 + T / 2, yb),
    "f": vbar(xl, ym + g2 - T / 2 + 4, yt - g2 + T / 2 - 4),
    "b": vbar(xr, ym + g2 - T / 2 + 4, yt - g2 + T / 2 - 4),
    "e": vbar(xl, yb + g2 - T / 2 + 4, ym - g2 + T / 2 - 4),
    "c": vbar(xr, yb + g2 - T / 2 + 4, ym - g2 + T / 2 - 4),
}
DIG = {
    "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg", "5": "acdfg", "6": "acdefg", "7": "abc",
    "8": "abcdefg", "9": "abcdfg", "-": "g", "_": "d", " ": "", "=": "dg",
    "A": "abcefg", "b": "cdefg", "C": "adef", "c": "deg", "d": "bcdeg", "E": "adefg", "F": "aefg", "G": "acdef",
    "H": "bcefg", "h": "cefg", "I": "ef", "J": "bcde", "L": "def", "n": "ceg", "o": "cdeg", "P": "abefg",
    "q": "abcfg", "r": "eg", "S": "acdfg", "t": "defg", "U": "bcdef", "u": "cde", "Y": "bcdfg", "Z": "abdeg",
    "?": "abeg", "'": "f", '"': "bf", "[": "adef", "]": "abcd",
}
ALIAS = {"B": "8", "D": "d", "K": "H", "M": "n", "N": "n", "O": "0", "Q": "0", "R": "r", "T": "t", "V": "u", "W": "u",
         "X": "H", "a": "A", "e": "E", "f": "F", "g": "9", "i": "I", "j": "J", "k": "H", "l": "L", "m": "n", "p": "P",
         "s": "5", "v": "u", "w": "u", "x": "H", "y": "Y", "z": "2", "–": "-", "—": "-", "−": "-",
         "/": "-", "%": "-", "+": "-", "*": "-", "(": "[", ")": "]", "<": "[", ">": "]"}

def sk(pts):
    return [(x + y * SLANT, y) for x, y in pts]

def poly_glyph(polys):
    pen = TTGlyphPen(None)
    for pts in polys:
        pts = sk(pts)
        pen.moveTo((round(pts[0][0]), round(pts[0][1])))
        for p in pts[1:]:
            pen.lineTo((round(p[0]), round(p[1])))
        pen.closePath()
    return pen.glyph()

def square(x, y, s):
    return [(x, y), (x, y + s), (x + s, y + s), (x + s, y)]

def build_seg():
    order = [".notdef", "space"]
    glyphs = {".notdef": poly_glyph([]), "space": poly_glyph([])}
    cmap = {32: "space"}
    adv = {".notdef": ADV, "space": ADV}
    def name_of(ch):
        return "uni%04X" % ord(ch)
    for ch, segs in DIG.items():
        if ch == " ":
            continue
        n = name_of(ch)
        order.append(n)
        glyphs[n] = poly_glyph([SEG[s] for s in segs])
        cmap[ord(ch)] = n
        adv[n] = ADV
    for ch, to in ALIAS.items():
        cmap[ord(ch)] = name_of(to) if to in DIG and to != " " else name_of(to)
    # the point and the colon take a narrow cell, so a reading keeps its rhythm
    pt = square(X1 + 40, 0, T + 8)
    for ch, polys, w in (
        (".", [pt], 230),
        (",", [pt, [(X1 + 40, -80), (X1 + 40 + T, -80), (X1 + 40 + T + 8, 0), (X1 + 40, 0)]], 230),
        (":", [square(X1 + 40 - 160, 190, 82), square(X1 + 40 - 160, 440, 82)], 230),
    ):
        n = name_of(ch)
        order.append(n)
        glyphs[n] = poly_glyph(polys)
        cmap[ord(ch)] = n
        adv[n] = w
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({k: (adv[k], 0) for k in order})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "RackSeg", "styleName": "Regular", "copyright": "Drawn for Phosphor"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=900, usWinDescent=250)
    fb.setupPost()
    return fb.font

def woff2(font, out):
    font.flavor = "woff2"
    font.save(str(HERE / out))
    print(out, (HERE / out).stat().st_size)

def get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as r:
        return r.read()

CAPS = "U+0020-0040,U+0041-005A,U+005B-0060,U+007B-007E,U+00A0,U+2013,U+2014,U+2022,U+2026,U+25B8,U+00D7"

def sub(font, unicodes=UNICODES):
    opts = subset.Options()
    opts.layout_features = ["kern", "liga", "ccmp", "locl", "mark", "mkmk"]
    opts.unicodes = subset.parse_unicodes(unicodes)
    s = subset.Subsetter(opts)
    s.populate(unicodes=opts.unicodes)
    s.subset(font)
    return font

def main():
    woff2(build_seg(), "RackSeg.woff2")
    f = sub(TTFont(io.BytesIO(get("barlowcondensed/BarlowCondensed-SemiBold.ttf"))), CAPS)
    woff2(f, "BarlowCondensed-600.woff2")
    f = TTFont(io.BytesIO(get("cinzel/Cinzel%5Bwght%5D.ttf")))
    f = instancer.instantiateVariableFont(f, {"wght": 600})
    woff2(sub(f), "Cinzel-600.woff2")
    for lic in ("barlowcondensed", "cinzel"):
        (HERE / ("OFL-" + lic + ".txt")).write_bytes(get(lic + "/OFL.txt"))
    return 0

if __name__ == "__main__":
    sys.exit(main())
