"""Rebuild Pixelify Sans (OFL, fonts/OFL.txt) for the Boing theme: Latin subset, two static weights,
and every digit given the width of the zero so live numerals never shift their neighbors.
A one-shot helper, NOT shipped. Needs fontTools and brotli. Source: github.com/google/fonts, ofl/pixelifysans."""
import urllib.request
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
SRC = "https://github.com/google/fonts/raw/main/ofl/pixelifysans/PixelifySans%5Bwght%5D.ttf"
UNICODES = "U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+2190-2193,U+25B8,U+2192,U+00D7,U+2713,U+25BE,U+25B4,U+2212,U+00B0,U+00B5"

def build(ttf: Path, wght: int, out: Path) -> None:
    f = instancer.instantiateVariableFont(TTFont(str(ttf)), {"wght": wght})
    cmap, glyf, hmtx = f.getBestCmap(), f["glyf"], f["hmtx"]
    w0 = hmtx[cmap[ord("0")]][0]
    for ch in "123456789":
        name = cmap[ord(ch)]
        adv, lsb = hmtx[name]
        if adv != w0 and not glyf[name].isComposite():
            dx = (w0 - adv) // 2
            glyf[name].coordinates.translate((dx, 0))
            glyf[name].recalcBounds(glyf)
            hmtx[name] = (w0, lsb + dx)
    opts = subset.Options()
    opts.flavor, opts.layout_features, opts.unicodes = "woff2", ["kern"], subset.parse_unicodes(UNICODES)
    s = subset.Subsetter(opts)
    s.populate(unicodes=opts.unicodes)
    s.subset(f)
    f.flavor = "woff2"
    f.save(str(out))

if __name__ == "__main__":
    ttf = HERE / "_src.ttf"
    ttf.write_bytes(urllib.request.urlopen(SRC, timeout=60).read())
    for w in (400, 700):
        build(ttf, w, HERE / f"PixelifySans-{w}.woff2")
    ttf.unlink()
