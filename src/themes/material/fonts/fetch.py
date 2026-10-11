"""Rebuild RobotoFlex.woff2: Roboto Flex (OFL, github.com/google/fonts, ofl/robotoflex) pinned to
opsz 14 and every axis but wght (400 to 700), subset to Latin. A one-shot helper, NOT shipped.
Run with a Python that has fontTools and brotli; the license is OFL.txt beside it."""
import sys, urllib.request
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
URL = "https://github.com/google/fonts/raw/main/ofl/robotoflex/RobotoFlex%5BGRAD%2CXOPQ%2CXTRA%2CYOPQ%2CYTAS%2CYTDE%2CYTFI%2CYTLC%2CYTUC%2Copsz%2Cslnt%2Cwdth%2Cwght%5D.ttf"
UNICODES = "U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+2190-2193,U+25B8,U+2192,U+00D7,U+2212"

def main() -> int:
    src = HERE / "_src_RobotoFlex.ttf"
    with urllib.request.urlopen(URL, timeout=120) as r:
        src.write_bytes(r.read())
    font = TTFont(str(src))
    # Subset first: instancing the full glyph set trips on a name table entry.
    opts = subset.Options()
    opts.layout_features = ["kern", "liga", "tnum", "lnum"]
    opts.notdef_outline = True
    opts.unicodes = subset.parse_unicodes(UNICODES)
    s = subset.Subsetter(opts)
    s.populate(unicodes=opts.unicodes)
    s.subset(font)
    limits = {a.axisTag: a.defaultValue for a in font["fvar"].axes if a.axisTag != "wght"}
    limits["opsz"] = 14
    limits["wght"] = (400, 700)
    font = instancer.instantiateVariableFont(font, limits)
    font.flavor = "woff2"
    font.save(str(HERE / "RobotoFlex.woff2"))
    src.unlink()
    print("RobotoFlex.woff2", (HERE / "RobotoFlex.woff2").stat().st_size)
    return 0

if __name__ == "__main__":
    sys.exit(main())
