"""Build the Temple theme's 8 x 8 face and its glyph table from TempleOS Kernel/FontStd.HC.

A one-shot build helper, NOT shipped. FontStd.HC is public domain (TempleOS's Doc/Credits.DD:
taken from FreeDOS, public domain). Run with a Python that has fontTools and brotli:
    python build.py <path to FontStd.HC>
Writes TempleSys.woff2 here and ../glyphs.js (the same bitmaps, for the overlay canvas).
Glyph u64 layout: byte r is row r (top first), bit k is column k (LSB left). Rows 0..6 sit
above the baseline, row 7 below. One pixel is 100 units on a 1200 unit em, so the face
advances 0.667 em and is pixel-exact at 12 px and 24 px.
"""
import re, sys
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

HERE = Path(__file__).resolve().parent
PX, EM = 100, 1200

def main() -> int:
    vals = [int(x, 16) for x in re.findall(r'0x([0-9A-Fa-f]{16})', Path(sys.argv[1]).read_text(encoding='latin-1'))]
    assert len(vals) == 256, len(vals)
    cmap, glyphs, metrics, order = {}, {}, {}, ['.notdef', 'space']
    def draw(g):
        pen = TTGlyphPen(None)
        for r in range(8):
            row = (g >> (8 * r)) & 0xFF
            k = 0
            while k < 8:
                if row >> k & 1:
                    s = k
                    while k < 8 and row >> k & 1: k += 1
                    y0, y1 = (6 - r) * PX, (7 - r) * PX
                    pen.moveTo((s * PX, y0)); pen.lineTo((s * PX, y1)); pen.lineTo((k * PX, y1)); pen.lineTo((k * PX, y0)); pen.closePath()
                else:
                    k += 1
        return pen.glyph()
    empty = TTGlyphPen(None).glyph()
    glyphs['.notdef'] = draw(0x007E424242427E00); metrics['.notdef'] = (8 * PX, 0)
    glyphs['space'] = empty; metrics['space'] = (8 * PX, 0); cmap[0x20] = 'space'
    for i in list(range(0x21, 0x7F)) + list(range(0x80, 0x100)):
        if not vals[i]: continue
        u = ord(bytes([i]).decode('cp437'))
        name = 'uni%04X' % u
        if name in glyphs: continue
        glyphs[name] = draw(vals[i]); metrics[name] = (8 * PX, 0); cmap[u] = name; order.append(name)
    cmap[0xA0] = 'space'
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=1000, descent=-200)
    fb.setupNameTable({'familyName': 'Temple Sys', 'styleName': 'Regular',
                       'copyright': 'Public domain: TempleOS FontStd.HC, from FreeDOS'})
    fb.setupOS2(sTypoAscender=1000, sTypoDescender=-200, sTypoLineGap=0, usWinAscent=1000, usWinDescent=200, xAvgCharWidth=800)
    fb.setupPost(isFixedPitch=1)
    fb.font.flavor = 'woff2'
    fb.save(str(HERE / 'TempleSys.woff2'))
    rows = ',\n'.join("  '" + ','.join('%016X' % v for v in vals[i:i + 8]) + "'" for i in range(0, 256, 8))
    (HERE.parent / 'glyphs.js').write_text(
        '/**\n * glyphs.js -- the 8 x 8 system font as 256 u64 bitmaps (built by fonts/build.py; do not edit).\n'
        ' * Public domain: TempleOS Kernel/FontStd.HC (from FreeDOS). Byte r is row r, bit k column k (LSB left).\n */\n'
        'const ROWS = [\n' + rows + ',\n].join(\',\').split(\',\');\n'
        '/** The 8 row bytes of character code c (0..255). */\n'
        'export const glyph = (c) => { const h = ROWS[c & 255]; const out = []; for (let r = 0; r < 8; r++) out.push(parseInt(h.slice(14 - 2 * r, 16 - 2 * r), 16)); return out; };\n',
        encoding='utf-8', newline='\n')
    print('glyphs', len(order))
    return 0

if __name__ == '__main__':
    sys.exit(main())
