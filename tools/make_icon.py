"""Render the Ultron icon (pixel mascot with a red visor on a dark tile) to build/ultron.ico and build/ultron.png.

Each size is rendered separately and the mascot is scaled from its own bounding box, so it stays
large and legible at taskbar sizes instead of shrinking with the tile padding.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "build"
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
SUPERSAMPLE = 8

BODY, SHADE, INK = (214, 213, 207), (168, 167, 160), (27, 26, 24)
RED, RED_DARK = (255, 77, 77), (190, 40, 32)
TILE = (24, 24, 23)

# Mirrors mascotSVG() in src/renderer/lib/mascots.js with the "visor" accessory: [x, y, w, h, colour].
RECTS = [
    (3, 4, 10, 6, BODY), (1, 6, 2, 2, BODY), (13, 6, 2, 2, BODY),
    (3, 9, 10, 1, SHADE), (4, 10, 1, 2, SHADE), (6, 10, 1, 2, SHADE), (9, 10, 1, 2, SHADE), (11, 10, 1, 2, SHADE),
    (3, 5, 10, 2, INK), (4, 5, 8, 1, RED), (5, 6, 6, 1, RED_DARK),
]
BOX_X, BOX_Y, BOX_W, BOX_H = 1, 4, 14, 8


def render(size: int) -> Image.Image:
    s = size * SUPERSAMPLE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    small = size < 48
    pad = 0 if small else round(s * 0.03)
    radius = round(s * (0.18 if small else 0.22))
    ImageDraw.Draw(img).rounded_rectangle([pad, pad, s - pad - 1, s - pad - 1], radius=radius, fill=TILE + (255,))

    unit = s * (0.86 if small else 0.74) / BOX_W
    ox = (s - unit * BOX_W) / 2 - BOX_X * unit
    oy = (s - unit * BOX_H) / 2 - BOX_Y * unit + unit * 0.3

    if not small:
        glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse([ox + unit * 2, oy + unit * 3.5, ox + unit * 14, oy + unit * 8], fill=(255, 60, 60, 80))
        img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(s * 0.05)))

    draw = ImageDraw.Draw(img)
    for x, y, w, h, colour in RECTS:
        draw.rectangle([round(ox + x * unit), round(oy + y * unit), round(ox + (x + w) * unit) - 1, round(oy + (y + h) * unit) - 1], fill=colour)

    if not small:
        rim = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(rim).rounded_rectangle([pad, pad, s - pad - 1, s - pad - 1], radius=radius, outline=(255, 255, 255, 30), width=max(2, s // 128))
        img.alpha_composite(rim)
    return img.resize((size, size), Image.BOX)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    images = [render(n) for n in SIZES]
    images[-1].save(OUT / "ultron.png")
    images[-1].save(OUT / "ultron.ico", sizes=[(n, n) for n in SIZES], append_images=images[:-1])
    print("wrote", OUT / "ultron.ico")


if __name__ == "__main__":
    main()
