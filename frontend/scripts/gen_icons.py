"""Generate PNG/ICO favicons from public/favicon.svg, for Google results and home screens.

Usage (from frontend/):  python3 scripts/gen_icons.py

Writes to public/:
  favicon.ico           16/32/48 px (the fallback browsers and Google request by default)
  favicon-96x96.png     Google wants a square favicon that is a multiple of 48 px
  icon-192.png          Android / large favicon
  apple-touch-icon.png  180 px, square with no transparency (iOS rounds the corners itself)

Renders with headless Chrome (set CHROME if it isn't in the default macOS location) and
downscales with macOS `sips`.
"""
import os
import re
import struct
import subprocess
import tempfile
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent
PUBLIC = FRONTEND / "public"
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
RENDER = 512  # render once large, then downscale


def render(svg, out, tmp):
    page = Path(tmp) / "icon.html"
    page.write_text(
        "<!doctype html><style>*{margin:0}html,body{background:transparent}"
        f"svg{{display:block;width:{RENDER}px;height:{RENDER}px}}</style>{svg}",
        encoding="utf-8",
    )
    subprocess.run([
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        f"--window-size={RENDER},{RENDER}", "--default-background-color=00000000",
        f"--screenshot={out}", page.as_uri(),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def resize(src, size, out):
    subprocess.run(["sips", "-z", str(size), str(size), str(src), "--out", str(out)],
                   check=True, stdout=subprocess.DEVNULL)


def write_ico(pngs, out):
    """Pack PNG files into an .ico (PNG-compressed entries, supported everywhere current)."""
    data = [(size, Path(p).read_bytes()) for size, p in pngs]
    header = struct.pack("<HHH", 0, 1, len(data))
    offset = 6 + 16 * len(data)
    entries, blobs = b"", b""
    for size, blob in data:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
        blobs += blob
    Path(out).write_bytes(header + entries + blobs)


def main():
    svg = (PUBLIC / "favicon.svg").read_text()
    # iOS wants a full-bleed square: drop the circle's rounding.
    square = re.sub(r'\s*rx="[^"]*"', "", svg, count=1)

    with tempfile.TemporaryDirectory() as tmp:
        round_png, square_png = Path(tmp) / "round.png", Path(tmp) / "square.png"
        render(svg, round_png, tmp)
        render(square, square_png, tmp)

        resize(round_png, 96, PUBLIC / "favicon-96x96.png")
        resize(round_png, 192, PUBLIC / "icon-192.png")
        resize(square_png, 180, PUBLIC / "apple-touch-icon.png")

        ico_parts = []
        for size in (16, 32, 48):
            p = Path(tmp) / f"{size}.png"
            resize(round_png, size, p)
            ico_parts.append((size, p))
        write_ico(ico_parts, PUBLIC / "favicon.ico")

    print("wrote favicon.ico, favicon-96x96.png, icon-192.png, apple-touch-icon.png")


if __name__ == "__main__":
    main()
