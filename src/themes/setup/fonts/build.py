"""Rebuild SetupCell-400.woff2 and SetupCell-700.woff2: Terminus Font's 8 x 16 bitmaps (SIL OFL 1.1,
Copyright (C) 2020 Dimitar Toshkov Zhekov) turned into pixel outlines, one rectangle per pixel run,
renamed because the license reserves the name "Terminus Font". A one-shot helper, NOT shipped.

Source: terminus-font-4.49.1.tar.gz from sourceforge.net/projects/terminus-font (ter-u16n.bdf, ter-u16b.bdf).
Run with a Python that has fontTools and brotli:
    python build.py <dir holding the .bdf files> <output dir>
The em is 16 pixels (64 units each), so a font-size of 16 px, 32 px, 48 px renders on the pixel grid.
"""
import sys
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

PX = 64
KEEP = (set(range(0x20, 0x7F)) | set(range(0xA0, 0x100)) | {0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026}
        | set(range(0x2190, 0x2196)) | set(range(0x2500, 0x2600)) | {0x2713, 0x2261, 0x2264, 0x2265, 0x221A, 0x2248, 0x2302})


def parse(path):
    glyphs, cur, bits = {}, None, False
    for line in open(path, encoding='latin-1'):
        t = line.split()
        if not t:
            continue
        if t[0] == 'STARTCHAR':
            cur = {'hex': []}
        elif t[0] == 'ENCODING':
            cur['enc'] = int(t[1])
        elif t[0] == 'BBX':
            cur['bbx'] = tuple(int(x) for x in t[1:5])
        elif t[0] == 'BITMAP':
            bits = True
        elif t[0] == 'ENDCHAR':
            bits = False
            if cur['enc'] in KEEP:
                glyphs[cur['enc']] = cur
        elif bits:
            cur['hex'].append(t[0])
    return glyphs


def rects(g):
    w, h, ox, oy = g['bbx']
    rows = []
    for hx in g['hex']:
        v, n = int(hx, 16), len(hx) * 4
        runs = []
        for x in (x for x in range(w) if (v >> (n - 1 - x)) & 1):
            if runs and runs[-1][1] == x:
                runs[-1][1] = x + 1
            else:
                runs.append([x, x + 1])
        rows.append({(a, b) for a, b in runs})
    out, open_ = [], {}
    for y, now in enumerate(rows + [set()]):
        for k in [k for k in open_ if k not in now]:
            out.append((k[0], k[1], open_.pop(k), y))
        for k in now:
            open_.setdefault(k, y)
    top = oy + h
    return [((ox + a) * PX, (top - y1) * PX, (ox + b) * PX, (top - y0) * PX) for a, b, y0, y1 in out]


def build(bdf, style, out):
    gl = parse(bdf)
    order = ['.notdef'] + ['uni%04X' % e for e in sorted(gl)]
    pens = {}
    nd = TTGlyphPen(None)
    for x0, y0, x1, y1 in ((PX, 0, 7 * PX, 12 * PX), (2 * PX, PX, 6 * PX, 11 * PX)):
        nd.moveTo((x0, y1)); nd.lineTo((x1, y1)); nd.lineTo((x1, y0)); nd.lineTo((x0, y0)); nd.closePath()
    pens['.notdef'] = nd.glyph()
    for e, g in gl.items():
        pen = TTGlyphPen(None)
        for x0, y0, x1, y1 in rects(g):
            pen.moveTo((x0, y1)); pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.lineTo((x0, y0)); pen.closePath()
        pens['uni%04X' % e] = pen.glyph()
    fb = FontBuilder(16 * PX, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({e: 'uni%04X' % e for e in gl})
    fb.setupGlyf(pens)
    fb.setupHorizontalMetrics({n: (8 * PX, 0) for n in order})
    fb.setupHorizontalHeader(ascent=12 * PX, descent=-4 * PX)
    fb.setupNameTable({'familyName': 'Setup Cell', 'styleName': style, 'fullName': 'Setup Cell ' + style, 'psName': 'SetupCell-' + style,
                       'copyright': 'Derived from Terminus Font, Copyright (C) 2020 Dimitar Toshkov Zhekov. SIL OFL 1.1.',
                       'licenseDescription': 'SIL Open Font License 1.1'})
    fb.setupOS2(sTypoAscender=12 * PX, sTypoDescender=-4 * PX, usWinAscent=12 * PX, usWinDescent=4 * PX, fsType=0)
    fb.setupPost(isFixedPitch=1)
    f = fb.font
    f.flavor = 'woff2'
    f.save(out)
    print(out, Path(out).stat().st_size)


if __name__ == '__main__':
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    build(src / 'ter-u16n.bdf', 'Regular', dst / 'SetupCell-400.woff2')
    build(src / 'ter-u16b.bdf', 'Bold', dst / 'SetupCell-700.woff2')
