"""Generate public/og-image.png, the 1200x630 link-preview image referenced in index.html.

Usage (from frontend/):  python3 scripts/gen_og.py

Draws the San Francisco Bay service area from src/data/service-areas.json with a sample
trip, writes the card as HTML, and screenshots it with headless Chrome. Needs Python 3,
Google Chrome (set CHROME to its path if it isn't in the default macOS location) and an
internet connection for the Figtree font.

The sample fare is hardcoded: re-price it with estimateFare() in src/pricing.js after
changing rates (currently 19.5 mi, 30 min, weekday 1 pm, "San Francisco Bay").
"""
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent
AREAS = FRONTEND / "src/data/service-areas.json"
OUT = FRONTEND / "public/og-image.png"
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

TRIP_FROM = (-122.401, 37.788)  # downtown SF
TRIP_TO = (-122.325, 37.563)    # San Mateo
TRIP_LABEL = "Downtown SF → San Mateo"
TRIP_FARE = "$48.94"

# Colors match the light theme in src/index.css.
ACCENT, ACCENT_TEXT, ACCENT_SOFT = "#007d6e", "#006e62", "#e0f4f0"
BG, TEXT, TEXT_SECONDARY = "#e9ecf1", "#0e1621", "#5b6472"


def build_html():
    areas = json.loads(AREAS.read_text())["serviceAreas"]
    ring = next(a for a in areas if a["city"].startswith("San Francisco"))["coordinates"]

    # Equirectangular projection scaled by cos(latitude), fitted into the map card.
    k = math.cos(math.radians(sum(p[1] for p in ring) / len(ring)))
    xs = [p[0] * k for p in ring]
    ys = [-p[1] for p in ring]
    W, H, pad = 440, 470, 20
    s = min((W - 2 * pad) / (max(xs) - min(xs)), (H - 2 * pad) / (max(ys) - min(ys)))
    ox = (W - (max(xs) - min(xs)) * s) / 2 - min(xs) * s
    oy = (H - (max(ys) - min(ys)) * s) / 2 - min(ys) * s

    def proj(lng, lat):
        return lng * k * s + ox, -lat * s + oy

    def pin(p, color):  # tip of the pin sits on the point
        return (f'<g transform="translate({p[0]:.1f},{p[1] - 22:.1f})">'
                f'<path d="M0 -14c-7.7 0-14 6.3-14 14 0 10.2 14 22 14 22s14-11.8 14-22c0-7.7-6.3-14-14-14z" fill="{color}"/>'
                f'<circle r="5.2" fill="#fff"/></g>')

    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (proj(*p) for p in ring))
    a, b = proj(*TRIP_FROM), proj(*TRIP_TO)

    return f'''<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@500;600;700;800&display=block" rel="stylesheet">
<style>
*{{margin:0;box-sizing:border-box}}
body{{width:1200px;height:630px;background:{BG};font-family:Figtree,sans-serif;color:{TEXT};display:flex;align-items:center;padding:0 64px 0 80px;gap:48px;overflow:hidden}}
.l{{flex:1}}
.brand{{display:flex;align-items:center;gap:12px;font-size:26px;font-weight:700;color:{ACCENT_TEXT};margin-bottom:28px}}
h1{{font-size:76px;line-height:1.02;letter-spacing:-0.03em;font-weight:800}}
p{{font-size:28px;line-height:1.35;color:{TEXT_SECONDARY};margin-top:24px;max-width:540px}}
.chips{{display:flex;flex-wrap:wrap;gap:10px;margin-top:32px}}
.chip{{background:#fff;border-radius:999px;padding:9px 18px;font-size:20px;font-weight:600}}
.r{{position:relative;width:480px;height:510px;background:#fff;border-radius:28px;box-shadow:0 10px 40px rgba(14,22,33,.12);display:flex;align-items:center;justify-content:center}}
.fare{{position:absolute;left:24px;bottom:24px;background:{ACCENT};color:#fff;border-radius:16px;padding:14px 20px}}
.fare small{{display:block;font-size:17px;font-weight:600;opacity:.85}}
.fare b{{font-size:34px;font-weight:800}}
</style></head><body>
<div class="l">
 <div class="brand"><svg width="40" height="40" viewBox="0 0 32 32"><rect width="32" height="32" rx="16" fill="{ACCENT}"/><path d="M16 7c-3.9 0-7 3.1-7 7 0 5.1 7 11 7 11s7-5.9 7-11c0-3.9-3.1-7-7-7z" fill="#fff"/><circle cx="16" cy="14" r="2.6" fill="{ACCENT}"/></svg>waymofares.org</div>
 <h1>Waymo Fare<br>Calculator</h1>
 <p>Estimate a robotaxi fare and check if an address is in a Waymo service area.</p>
 <div class="chips"><span class="chip">San Francisco</span><span class="chip">Los Angeles</span><span class="chip">San Diego</span><span class="chip">Phoenix</span><span class="chip">Dallas</span></div>
</div>
<div class="r"><svg width="{W}" height="{H}" viewBox="0 0 {W} {H}">
 <polygon points="{pts}" fill="{ACCENT_SOFT}" stroke="{ACCENT}" stroke-width="3" stroke-linejoin="round"/>
 <line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{TEXT}" stroke-width="4" stroke-dasharray="10 8" stroke-linecap="round"/>
 {pin(b, TEXT)}{pin(a, ACCENT)}
</svg><div class="fare"><small>{TRIP_LABEL}</small><b>{TRIP_FARE}</b></div></div>
</body></html>'''


def main():
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "og.html"
        page.write_text(build_html(), encoding="utf-8")
        subprocess.run([
            CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--window-size=1200,630", "--virtual-time-budget=5000",
            f"--screenshot={OUT}", page.as_uri(),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
