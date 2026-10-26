"""
Rebuild the HR MAX walkthrough GIF as a polished, branded product tour.

Improves on the raw screenshot strip by adding:
  * a dark brand header (logo mark, product name, step counter + progress dots)
  * rounded, bordered screen frames
  * a per-step caption so the viewer knows what they are looking at
  * cross-faded transitions, which read like video rather than a slide jump

Frames are still real screenshots of the running application.

Usage: python build-walkthrough-gif.py
"""
import os
import sys
from PIL import Image, ImageDraw, ImageSequence, ImageFont

FRAMES = [
    ("Dashboard",   "Overview at a glance",      r"C:\Users\azayy\AppData\Local\Temp\opencode-browser-AvbEjJ\0\screenshot.png"),
    ("Companies",   "Multi-company structure",   r"C:\Users\azayy\AppData\Local\Temp\opencode-browser-lSsKnb\0\screenshot.png"),
    ("Departments", "Departments and teams",     r"C:\Users\azayy\AppData\Local\Temp\opencode-browser-3eBkxB\0\screenshot.png"),
    ("Employees",   "Records, filters, export",  r"C:\Users\azayy\AppData\Local\Temp\opencode-browser-xLg83k\0\screenshot.png"),
    ("Attendance",  "Daily attendance tracking", r"C:\Users\azayy\AppData\Local\Temp\opencode-browser-v4UEXc\0\screenshot.png"),
]

OUT = r"C:\Users\azayy\Documents\HRM-AWS\HRMAX\frontend\public\hrmax-walkthrough.gif"

# ── Tunables (tuned to land under ~1.2 MB) ────────────────────────────────
SCREEN_W = 680          # screenshot display width
PAD = 16                # gutter around the screen
HEADER_H = 64           # brand bar height
CAPTION_H = 56          # caption strip height
BG = (255, 255, 255)
INK = (15, 23, 42)
ORANGE = (249, 115, 22)
MUTED = (107, 114, 128)
RADIUS = 14
COLORS = 40
HOLD_MS = 1250          # dwell on each screen
FADE_FRAMES = 4         # cross-fade steps between screens
FADE_MS = 80

FONT_DIR = r"C:\Windows\Fonts"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(os.path.join(FONT_DIR, name), size)
    except OSError:
        return ImageFont.load_default()


F_BOLD = font("segoeuib.ttf", 22)
F_SEMI = font("segoeuib.ttf", 17)
F_REG = font("segoeui.ttf", 15)
F_DOT = None


def round_rect(draw: ImageDraw.ImageDraw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def compose(step_title: str, step_note: str, index: int, total: int, screen: Image.Image) -> Image.Image:
    """Brand header + rounded screenshot + caption, on one canvas."""
    w = SCREEN_W + PAD * 2
    h = HEADER_H + PAD + screen.height + PAD + CAPTION_H
    canvas = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(canvas)

    # ── header bar ───────────────────────────────────────────
    d.rectangle([0, 0, w, HEADER_H], fill=INK)

    # logo mark: orange rounded square with "HR"
    round_rect(d, [22, 14, 62, 54], 10, fill=ORANGE)
    hr = "HR"
    bbox = d.textbbox((0, 0), hr, font=F_SEMI)
    d.text((42 - (bbox[2] - bbox[0]) / 2, 34 - (bbox[3] - bbox[1]) / 2 - 2), hr, font=F_SEMI, fill=(255, 255, 255))

    d.text((76, 31), "HR MAX", font=F_BOLD, fill=(255, 255, 255))
    d.text((168, 35), "Product walkthrough", font=F_REG, fill=(148, 163, 184))

    # progress dots (right aligned)
    gap, r = 14, 6
    total_w = total * (r * 2) + (total - 1) * (gap - r * 2)
    x0 = w - 24 - total_w
    for i in range(total):
        cx = x0 + i * gap + r
        colour = ORANGE if i <= index else (71, 85, 105)
        d.ellipse([cx - r, 32 - r, cx + r, 32 + r], fill=colour)

    # ── screen ───────────────────────────────────────────────
    sx, sy = PAD, HEADER_H + PAD
    frame = [sx, sy, sx + SCREEN_W, sy + screen.height]
    # soft drop shadow
    sh = Image.new("RGB", canvas.size, BG)
    sd = ImageDraw.Draw(sh)
    round_rect(sd, [frame[0] + 3, frame[1] + 5, frame[2] + 3, frame[3] + 5], RADIUS, fill=(226, 232, 240))
    canvas = Image.blend(canvas, sh, 0.45)
    d = ImageDraw.Draw(canvas)
    # re-draw header (blend above may have lightened it)
    d.rectangle([0, 0, w, HEADER_H], fill=INK)
    round_rect(d, [22, 14, 62, 54], 10, fill=ORANGE)
    bbox = d.textbbox((0, 0), hr, font=F_SEMI)
    d.text((42 - (bbox[2] - bbox[0]) / 2, 34 - (bbox[3] - bbox[1]) / 2 - 2), hr, font=F_SEMI, fill=(255, 255, 255))
    d.text((76, 31), "HR MAX", font=F_BOLD, fill=(255, 255, 255))
    d.text((168, 35), "Product walkthrough", font=F_REG, fill=(148, 163, 184))
    for i in range(total):
        cx = x0 + i * gap + r
        colour = ORANGE if i <= index else (71, 85, 105)
        d.ellipse([cx - r, 32 - r, cx + r, 32 + r], fill=colour)

    # rounded mask for the screenshot
    mask = Image.new("L", screen.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, screen.width, screen.height], radius=RADIUS, fill=255)
    canvas.paste(screen, (sx, sy), mask)
    d.rounded_rectangle(frame, radius=RADIUS, outline=(226, 232, 240), width=2)

    # ── caption ──────────────────────────────────────────────
    cy = sy + screen.height + 14
    num = f"{index + 1:02d}"
    d.text((PAD, cy), num, font=F_BOLD, fill=ORANGE)
    nb = d.textbbox((0, 0), num, font=F_BOLD)
    tx = PAD + (nb[2] - nb[0]) + 12
    d.text((tx, cy), step_title, font=F_SEMI, fill=INK)
    tb = d.textbbox((0, 0), step_title, font=F_SEMI)
    d.text((tx, cy + 24), step_note, font=F_REG, fill=MUTED)

    return canvas


def main() -> int:
    print("loading frames…")
    screens = []
    for title, note, path in FRAMES:
        if not os.path.exists(path):
            print(f"MISSING: {path}")
            return 1
        im = Image.open(path).convert("RGB")
        nh = round(im.height * SCREEN_W / im.width)
        screens.append((title, note, im.resize((SCREEN_W, nh), Image.LANCZOS)))
        print(f"  {title:<12} {im.size[0]}x{im.size[1]} -> {SCREEN_W}x{nh}")

    print("compositing…")
    comps = [compose(t, n, i, len(screens), im) for i, (t, n, im) in enumerate(screens)]

    # unify canvas size
    cw, ch = comps[0].size
    comps = [c if c.size == (cw, ch) else c.crop((0, 0, cw, ch)) for c in comps]
    print(f"canvas: {cw}x{ch}")

    print("building sequence (hold + cross-fade)…")
    seq, durs = [], []
    for i, comp in enumerate(comps):
        seq.append(comp)
        durs.append(HOLD_MS)
        if i < len(comps) - 1:
            nxt = comps[i + 1]
            for k in range(1, FADE_FRAMES + 1):
                seq.append(Image.blend(comp, nxt, k / FADE_FRAMES))
                durs.append(FADE_MS)
    # hold the last frame a beat longer so the loop feels settled
    durs[-1] = HOLD_MS + 900

    print("quantizing…")
    quant = [f.quantize(colors=COLORS, method=Image.MEDIANCUT) for f in seq]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    quant[0].save(
        OUT,
        save_all=True,
        append_images=quant[1:],
        duration=durs,
        loop=0,
        optimize=True,
        disposal=2,
    )

    size = os.path.getsize(OUT)
    print(f"\nwrote {OUT}")
    print(f"frames: {len(quant)}  duration: {sum(durs)/1000:.1f}s  size: {size/1024:.0f} KB ({size/1024/1024:.2f} MB)")

    with Image.open(OUT) as chk:
        n = sum(1 for _ in ImageSequence.Iterator(chk))
        print(f"verified: format={chk.format} frames={n} animated={getattr(chk, 'is_animated', False)}")
        if n < 2:
            print("ERROR: not animated")
            return 1
    if size > 1_500_000:
        print(f"WARNING: {size/1024/1024:.2f} MB exceeds the 1.5 MB budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
