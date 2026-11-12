"""
Draws Shibal's icon set from geometry, so it can be tweaked and regenerated.

The mark: a bookmark ribbon (you saved it) with a notification dot on its
corner (it will nudge you), the dot cut out of the ribbon like an app badge.

    python scripts/make-icons.py            # writes assets/ and docs/icon.png
    python scripts/make-icons.py --preview  # also writes a side-by-side preview

Needs Pillow. Everything is drawn 4x and scaled down for clean edges.
"""
import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")
DOCS = os.path.join(ROOT, "docs")

SS = 4  # supersampling factor
TERRA_TOP = (214, 146, 108)  # lighter terracotta, top-left
TERRA_BOTTOM = (176, 104, 72)  # deeper terracotta, bottom-right
PAPER = (248, 242, 233)
INK = (20, 18, 16)


def gradient(size, top, bottom):
    """Diagonal gradient, top-left to bottom-right."""
    w, h = size
    g = Image.new("RGB", (w, h))
    px = g.load()
    for y in range(h):
        for x in range(w):
            t = (x / w + y / h) / 2
            px[x, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return g


GEOMETRY = {
    # name: ribbon width, height, notch depth, corner radius, dot radius, gap, lean (degrees)
    "straight": dict(rw=380, rh=500, notch=118, r=64, dr=92, gap=34, lean=0),
    "lean": dict(rw=330, rh=560, notch=132, r=90, dr=82, gap=30, lean=9),
    "slim": dict(rw=336, rh=548, notch=128, r=84, dr=84, gap=30, lean=0),
}
SHAPE = "slim"


def mark_masks(size, scale=1.0, cx=None, cy=None, shape=None):
    """
    Returns (ribbon_mask, dot_mask) as 'L' images at `size` (already supersampled).
    `scale` 1.0 fills a full-bleed icon; smaller values fit adaptive-icon safe zones.
    """
    g = GEOMETRY[shape or SHAPE]
    w, h = size
    s = w / 1024 * scale
    cx = w / 2 if cx is None else cx
    cy = h / 2 if cy is None else cy

    # Ribbon with rounded top and a V notch, nudged left/down so the dot balances it.
    rw, rh, notch, r = g["rw"] * s, g["rh"] * s, g["notch"] * s, g["r"] * s
    left = cx - rw / 2 - 22 * s
    top = cy - rh / 2 + 26 * s
    right, bottom = left + rw, top + rh

    ribbon = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(ribbon)
    d.rounded_rectangle([left, top, right, bottom - notch], radius=r, fill=255)
    # Square off the lower corners of the rounded rect so the tails run straight.
    d.rectangle([left, top + r, right, bottom - notch], fill=255)
    d.polygon([(left, bottom - notch - 1), (right, bottom - notch - 1), (right, bottom), (cx - 22 * s, bottom - notch), (left, bottom)], fill=255)

    # Lean the ribbon forward like the italic wordmark: shear around the centre line.
    k = math.tan(math.radians(g["lean"]))
    if k:
        # Output (x, y) samples input (x + k*(y - cy), y): tops move right, tails move left.
        ribbon = ribbon.transform((w, h), Image.AFFINE, (1, k, -k * cy, 0, 1, 0), resample=Image.BICUBIC)

    # Dot on the top-right corner, with a clear gap cut out of the ribbon around it.
    dr, gap = g["dr"] * s, g["gap"] * s
    dx, dy = right - 6 * s - k * (top - cy), top + 6 * s
    dot = Image.new("L", (w, h), 0)
    ImageDraw.Draw(dot).ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=255)
    cut = Image.new("L", (w, h), 0)
    ImageDraw.Draw(cut).ellipse([dx - dr - gap, dy - dr - gap, dx + dr + gap, dy + dr + gap], fill=255)
    ribbon = ImageChops.subtract(ribbon, cut)
    return ribbon, dot


def down(img, px):
    return img.resize((px, px), Image.LANCZOS)


def full_icon(px=1024, dot_color=INK, ribbon_color=PAPER, shape=None):
    big = px * SS
    bg = gradient((big // 8, big // 8), TERRA_TOP, TERRA_BOTTOM).resize((big, big), Image.BICUBIC)
    ribbon, dot = mark_masks((big, big), shape=shape)
    bg.paste(Image.new("RGB", (big, big), ribbon_color), (0, 0), ribbon)
    bg.paste(Image.new("RGB", (big, big), dot_color), (0, 0), dot)
    return down(bg, px)


def foreground(px=1024, dot_color=INK, ribbon_color=PAPER, scale=0.56):
    """Adaptive-icon foreground: transparent, mark inside the 66% safe zone."""
    big = px * SS
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ribbon, dot = mark_masks((big, big), scale=scale)
    out.paste(Image.new("RGBA", (big, big), ribbon_color + (255,)), (0, 0), ribbon)
    out.paste(Image.new("RGBA", (big, big), dot_color + (255,)), (0, 0), dot)
    return down(out, px)


def silhouette(px, scale, color=(255, 255, 255)):
    """One-colour mark on transparent: notification icon and Android 13 themed icon."""
    big = px * SS
    ribbon, dot = mark_masks((big, big), scale=scale)
    alpha = ImageChops.lighter(ribbon, dot)
    out = Image.new("RGBA", (big, big), color + (0,))
    out.putalpha(alpha)
    return down(out, px)


def tile(px=1024, corner=0.2235):
    """The icon as a rounded tile on transparent, for the splash screen."""
    icon = full_icon(px)
    big = px * SS
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * corner), fill=255)
    out = icon.convert("RGBA")
    out.putalpha(down(mask, px))
    return out


def main():
    os.makedirs(ASSETS, exist_ok=True)
    full_icon().save(os.path.join(ASSETS, "icon.png"))
    foreground().save(os.path.join(ASSETS, "adaptive-icon.png"))
    gradient((1024, 1024), TERRA_TOP, TERRA_BOTTOM).save(os.path.join(ASSETS, "adaptive-icon-background.png"))
    silhouette(1024, scale=0.56).save(os.path.join(ASSETS, "adaptive-icon-monochrome.png"))
    silhouette(96, scale=1.15).save(os.path.join(ASSETS, "notification-icon.png"))
    tile().save(os.path.join(ASSETS, "splash-icon.png"))
    os.makedirs(DOCS, exist_ok=True)
    full_icon(512).save(os.path.join(DOCS, "icon.png"))

    if "--preview" in sys.argv:
        out = sys.argv[sys.argv.index("--preview") + 1] if len(sys.argv) > sys.argv.index("--preview") + 1 else "icon-preview.png"
        variants = [
            full_icon(320, shape="straight", dot_color=PAPER),
            full_icon(320, shape="slim", dot_color=PAPER),
            full_icon(320, shape="slim", dot_color=INK),
        ]
        sheet = Image.new("RGB", (320 * 3 + 80, 320 + 40 + 120), (236, 228, 215))
        for i, v in enumerate(variants):
            sheet.paste(v, (20 + i * 340, 20))
        # Small sizes, as on a launcher and in the status bar.
        for i, sz in enumerate([96, 48, 24]):
            sheet.paste(full_icon(sz), (20 + i * 120, 360 + (96 - sz) // 2))
        n = silhouette(96, 1.15, color=(20, 18, 16))
        sheet.paste(n, (380, 372), n)
        sheet.save(out)
        print("preview:", out)
    print("icons written")


if __name__ == "__main__":
    main()
