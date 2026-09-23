import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# MARK: Config

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
ACCENT = (0x10, 0xA3, 0x7F)  # --accent in popup.css, so icon and Export button match
CORNER = 0.22  # corner radius as a fraction of the side, close to macOS/Chrome app tiles
WORK = 256  # working resolution; plenty for ≤128px output and keeps the dilation filter cheap
# Extra stroke weight (in WORK px) per output size: thin strokes blur into the background once
# they drop below ~1.5px, so the toolbar sizes get bolder art than the store-sized icon.
SIZES = {16: 6, 32: 3, 48: 1, 128: 0}

# MARK: Clean
# Generated art has faint colour noise; rebuild it as exact accent + white, using each pixel's
# whiteness as a blend factor so antialiased edges stay smooth.

gray = Image.open(SRC).convert("L").resize((WORK, WORK), Image.LANCZOS)
lo, hi = 150, 235  # green bg ≈ 125 luma, white ≈ 255; stretch the band between into a clean ramp
white = gray.point(lambda v: 0 if v <= lo else 255 if v >= hi else int((v - lo) * 255 / (hi - lo)))

# MARK: Round corners
# Drawn at 4x and downsampled so the rounded edge is antialiased.

big = Image.new("L", (WORK * 4, WORK * 4), 0)
ImageDraw.Draw(big).rounded_rectangle((0, 0, WORK * 4 - 1, WORK * 4 - 1), radius=int(WORK * 4 * CORNER), fill=255)
tile = big.resize((WORK, WORK), Image.LANCZOS)


def render(bold):
    mask = white.filter(ImageFilter.MaxFilter(bold * 2 + 1)) if bold else white
    art = Image.composite(Image.new("RGB", (WORK, WORK), (255, 255, 255)), Image.new("RGB", (WORK, WORK), ACCENT), mask)
    art = art.convert("RGBA")
    art.putalpha(tile)
    return art


# MARK: Export

OUT.mkdir(parents=True, exist_ok=True)
for size, bold in SIZES.items():
    render(bold).resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)
    print(OUT / f"icon-{size}.png")
