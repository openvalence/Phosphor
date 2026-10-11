"""Fetch Atkinson Hyperlegible Next and Mono (OFL, Braille Institute) and subset them to WOFF2.

A one-shot build helper, NOT shipped. Sources: github.com/google/fonts, ofl/<family>.
Run with a Python that has fontTools and brotli. The licenses land in OFL.txt.
"""
import sys, urllib.request
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
BASE = "https://github.com/google/fonts/raw/main/ofl/"
FONTS = {  # output name: path under ofl/
    "AtkinsonNext.woff2": "atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext%5Bwght%5D.ttf",
    "AtkinsonMono.woff2": "atkinsonhyperlegiblemono/AtkinsonHyperlegibleMono%5Bwght%5D.ttf",
}
LICENSES = ["atkinsonhyperlegiblenext", "atkinsonhyperlegiblemono"]
UNICODES = "U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+2190-2193,U+25B8,U+2192,U+00D7,U+2713,U+2212"

def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()

def main() -> int:
    for out, src in FONTS.items():
        ttf = HERE / "_src.ttf"
        ttf.write_bytes(get(BASE + src))
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]
        opts.unicodes = subset.parse_unicodes(UNICODES)
        font = TTFont(str(ttf))
        s = subset.Subsetter(opts)
        s.populate(unicodes=opts.unicodes)
        s.subset(font)
        font.flavor = "woff2"
        font.save(str(HERE / out))
        ttf.unlink()
        print(out, (HERE / out).stat().st_size)
    text = "".join("=== " + n + " ===\n" + get(BASE + n + "/OFL.txt").decode("utf-8") + "\n" for n in LICENSES)
    (HERE / "OFL.txt").write_text(text, encoding="utf-8", newline="\n")
    return 0

if __name__ == "__main__":
    sys.exit(main())
