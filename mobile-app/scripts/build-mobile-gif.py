"""
Generate the HR MAX **mobile app** walkthrough GIF entirely in code.

No emulator, no device and no running app are required: each screen is drawn
with PIL using the mobile app's own visual language (orange #f97316 accent,
navy chrome, rounded cards, RN-style list rows), then composited into a phone
frame and cross-faded together.

Honesty: this is an ILLUSTRATIVE product preview, not a recording of the
running app — the GIF caption says so on the page.

Usage: python build-mobile-gif.py
"""
import os
import sys
from PIL import Image, ImageDraw, ImageSequence, ImageFont

OUT = r"C:\Users\azayy\Documents\HRM-AWS\HRMAX\frontend\public\hrmax-mobile-walkthrough.gif"

# ── palette (matches the mobile app theme) ────────────────────────────────
WHITE = (255, 255, 255)
INK = (15, 23, 42)
TEXT = (17, 24, 39)
MUTED = (107, 114, 128)
LINE = (229, 231, 235)
SOFT = (243, 244, 246)
ORANGE = (249, 115, 22)
ORANGE_DK = (234, 88, 12)
GREEN = (16, 185, 129)
AMBER = (245, 158, 11)
RED = (239, 68, 68)
BLUE = (59, 130, 246)
PURPLE = (139, 92, 246)

# ── geometry ──────────────────────────────────────────────────────────────
PHONE_W, PHONE_H = 340, 690
PAD = 26
HEADER_H = 64
CAPTION_H = 60
R = 30                    # phone corner radius

FONT_DIR = r"C:\Windows\Fonts"


def f(name, size):
    try:
        return ImageFont.truetype(os.path.join(FONT_DIR, name), size)
    except OSError:
        return ImageFont.load_default()


F_BOLD = f("segoeuib.ttf", 20)
F_SEMI = f("segoeuib.ttf", 15)
F_BODY = f("segoeui.ttf", 14)
F_SM = f("segoeui.ttf", 12)
F_XS = f("segoeui.ttf", 11)
F_TITLE = f("segoeuib.ttf", 19)


def rr(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def center_text(d, cx, cy, s, font, fill):
    b = d.textbbox((0, 0), s, font=font)
    d.text((cx - (b[2] - b[0]) / 2, cy - (b[3] - b[1]) / 2 - 2), s, font=font, fill=fill)


def status_bar(d, w):
    """Fake iOS/Android status bar."""
    d.text((18, 12), "9:41", font=F_XS, fill=TEXT)
    # signal / wifi / battery glyphs
    x = w - 58
    for i, hgt in enumerate((4, 7, 10, 13)):
        d.rectangle([x + i * 5, 24 - hgt, x + i * 5 + 3, 24], fill=TEXT)
    rr(d, [w - 32, 14, w - 16, 24], 3, outline=TEXT)
    d.rectangle([w - 30, 16, w - 20, 22], fill=TEXT)


def app_header(d, w, title, sub=None):
    """Dark app bar used across the mobile screens."""
    d.rectangle([0, 30, w, 92], fill=INK)
    d.text((18, 44), title, font=F_TITLE, fill=WHITE)
    if sub:
        d.text((18, 68), sub, font=F_XS, fill=(148, 163, 184))


def card(d, box, r=14, fill=WHITE, outline=LINE):
    rr(d, box, r, fill=fill, outline=outline, width=2)


def stat_tile(d, box, label, value, color):
    card(d, box)
    x0, y0, x1, y1 = box
    rr(d, [x0 + 14, y0 + 14, x0 + 44, y0 + 44], 9, fill=(color[0], color[1], color[2], 255) if False else tuple(min(255, c + 175) for c in color))
    d.text((x0 + 16, y0 + 56), label, font=F_XS, fill=MUTED)
    d.text((x0 + 16, y0 + 74), value, font=F_BOLD, fill=TEXT)


def person_row(d, box, name, role, chip_text, chip_color):
    card(d, box, r=12)
    x0, y0, x1, y1 = box
    cy = (y0 + y1) // 2
    d.ellipse([x0 + 14, cy - 16, x0 + 46, cy + 16], fill=ORANGE)
    center_text(d, x0 + 30, cy, name[0].upper(), F_SEMI, WHITE)
    d.text((x0 + 58, cy - 16), name, font=F_SEMI, fill=TEXT)
    d.text((x0 + 58, cy + 3), role, font=F_XS, fill=MUTED)
    # chip
    cw = d.textbbox((0, 0), chip_text, font=F_XS)[2] + 18
    rr(d, [x1 - 14 - cw, cy - 12, x1 - 14, cy + 12], 11, fill=tuple(min(255, c + 200) for c in chip_color))
    center_text(d, x1 - 14 - cw / 2, cy, chip_text, F_XS, chip_color)


# ── screens ──────────────────────────────────────────────────────────────
def screen_login(w, h):
    im = Image.new("RGB", (w, h), WHITE)
    d = ImageDraw.Draw(im)
    status_bar(d, w)
    rr(d, [w // 2 - 26, 68, w // 2 + 26, 120], 13, fill=ORANGE)
    center_text(d, w // 2, 94, "HR", F_BOLD, WHITE)
    d.text((w // 2 - 62, 132), "HR MAX", font=F_TITLE, fill=TEXT)
    center_text(d, w // 2, 186, "Sign in to your account", F_BODY, MUTED)

    for i, (lbl, val, hidden) in enumerate((("Email", "admin@company.com", False),
                                            ("Password", "••••••••••", True))):
        y = 232 + i * 84
        d.text((24, y), lbl, font=F_XS, fill=MUTED)
        rr(d, [24, y + 20, w - 24, y + 66], 12, fill=WHITE, outline=LINE, width=2)
        d.text((38, y + 33), val, font=F_BODY, fill=TEXT if not hidden else MUTED)
        if hidden:
            d.ellipse([w - 54, y + 34, w - 36, y + 52], outline=MUTED, width=2)

    rr(d, [24, 424, w - 24, 476], 14, fill=ORANGE)
    center_text(d, w // 2, 450, "Sign In", F_SEMI, WHITE)
    center_text(d, w // 2, 512, "Forgot password?", F_SM, ORANGE_DK)
    return im


def screen_dashboard(w, h):
    im = Image.new("RGB", (w, h), WHITE)
    d = ImageDraw.Draw(im)
    status_bar(d, w)
    app_header(d, w, "Dashboard", "Sunday, 26 October")
    d.text((18, 108), "Welcome back,", font=F_XS, fill=MUTED)
    d.text((18, 126), "HR MAX Admin", font=F_TITLE, fill=TEXT)

    cols, rows = 2, 2
    tw, th, gap = (w - 48 - 14) // cols, 96, 14
    tiles = [("Present today", "112", GREEN), ("Absent", "7", RED),
             ("On leave", "9", AMBER), ("Pending tasks", "23", ORANGE)]
    for i, (lbl, val, col) in enumerate(tiles):
        x = 18 + (i % cols) * (tw + gap)
        y = 168 + (i // cols) * (th + gap)
        stat_tile(d, [x, y, x + tw, y + th], lbl, val, col)

    d.text((18, 396), "TODAY", font=F_XS, fill=MUTED)
    for i, (n, r, s, c) in enumerate((("Aarav Sharma", "Engineering", "Present", GREEN),
                                       ("Meera Patel", "Finance", "On leave", AMBER),
                                       ("Rahul Verma", "Operations", "Present", GREEN))):
        person_row(d, [18, 418 + i * 70, w - 18, 418 + i * 70 + 60], n, r, s, c)
    return im


def screen_employees(w, h):
    im = Image.new("RGB", (w, h), WHITE)
    d = ImageDraw.Draw(im)
    status_bar(d, w)
    app_header(d, w, "Employees", "128 active records")
    rr(d, [18, 108, w - 18, 152], 12, fill=SOFT, outline=LINE, width=2)
    d.text((58, 122), "Search employees…", font=F_BODY, fill=MUTED)
    d.ellipse([32, 122, 48, 138], outline=MUTED, width=2)
    d.line([45, 135, 52, 142], fill=MUTED, width=2)

    people = (("Sana Iqbal", "Human Resources", "Active", GREEN),
              ("Vikram Rao", "Finance", "Active", GREEN),
              ("Ananya Das", "Operations", "On leave", AMBER),
              ("Imran Sheikh", "IT", "Active", GREEN),
              ("Priya Nair", "Payroll", "Inactive", RED))
    for i, (n, r, s, c) in enumerate(people):
        person_row(d, [18, 172 + i * 74, w - 18, 172 + i * 74 + 64], n, r, s, c)
    return im


def screen_attendance(w, h):
    im = Image.new("RGB", (w, h), WHITE)
    d = ImageDraw.Draw(im)
    status_bar(d, w)
    app_header(d, w, "Attendance", "Today · check-in / check-out")

    rr(d, [18, 108, w - 18, 186], 14, fill=INK)
    d.text((32, 124), "Checked in", font=F_XS, fill=(148, 163, 184))
    d.text((32, 142), "09:02 AM", font=F_TITLE, fill=WHITE)
    rr(d, [w - 132, 126, w - 32, 170], 12, fill=ORANGE)
    center_text(d, w - 82, 148, "Check out", F_SM, WHITE)

    for i, (lbl, val, col) in enumerate((("Present", "112", GREEN), ("Late", "6", AMBER),
                                          ("Absent", "7", RED), ("Missed punch", "3", PURPLE))):
        x = 18 + (i % 2) * ((w - 50) // 2 + 14)
        y = 202 + (i // 2) * 96
        stat_tile(d, [x, y, x + (w - 50) // 2, y + 84], lbl, val, col)

    d.text((18, 400), "RECENT RECORDS", font=F_XS, fill=MUTED)
    for i, (n, r, s, c) in enumerate((("Aarav Sharma", "09:02 – 18:04", "Present", GREEN),
                                       ("Meera Patel", "—", "On leave", AMBER),
                                       ("Rahul Verma", "09:41 – 18:00", "Late", AMBER),
                                       ("Sana Iqbal", "08:58 – 17:30", "Present", GREEN))):
        person_row(d, [18, 420 + i * 68, w - 18, 420 + i * 68 + 58], n, r, s, c)
    return im


def screen_leave(w, h):
    im = Image.new("RGB", (w, h), WHITE)
    d = ImageDraw.Draw(im)
    status_bar(d, w)
    app_header(d, w, "Leave", "Requests & approvals")

    for i, (lbl, val, col) in enumerate((("Pending", "4", AMBER), ("Approved", "18", GREEN),
                                          ("Rejected", "2", RED), ("Balance", "12", BLUE))):
        x = 18 + (i % 2) * ((w - 50) // 2 + 14)
        y = 110 + (i // 2) * 96
        stat_tile(d, [x, y, x + (w - 50) // 2, y + 84], lbl, val, col)

    d.text((18, 306), "REQUESTS", font=F_XS, fill=MUTED)
    for i, (n, meta, s, c) in enumerate((("Ananya Das", "12–14 Nov · Casual", "Pending", AMBER),
                                         ("Imran Sheikh", "20 Nov · Sick", "Approved", GREEN),
                                         ("Priya Nair", "25–26 Dec · Annual", "Pending", AMBER))):
        box = [18, 328 + i * 78, w - 18, 328 + i * 78 + 68]
        card(d, box, r=12)
        d.text((32, box[1] + 12), n, font=F_SEMI, fill=TEXT)
        d.text((32, box[1] + 34), meta, font=F_XS, fill=MUTED)
        cw = d.textbbox((0, 0), s, font=F_XS)[2] + 18
        rr(d, [box[2] - 14 - cw, box[1] + 14, box[2] - 14, box[1] + 38], 11,
           fill=tuple(min(255, c + 200) for c in c))
        center_text(d, box[2] - 14 - cw / 2, box[1] + 26, s, F_XS, c)
    return im


SCREENS = [
    ("Login", "Password sign-in", screen_login),
    ("Dashboard", "Today at a glance", screen_dashboard),
    ("Employees", "Search & filter records", screen_employees),
    ("Attendance", "Check-in and check-out", screen_attendance),
    ("Leave", "Requests and approvals", screen_leave),
]


def phone_frame(screen: Image.Image) -> Image.Image:
    """Drop a screen into a rounded phone body with a notch."""
    w, h = screen.size
    canvas = Image.new("RGB", (w + 8, h + 8), INK)
    d = ImageDraw.Draw(canvas)
    # body
    rr(d, [0, 0, w + 7, h + 7], R + 4, fill=INK)
    # screen (rounded mask)
    mask = Image.new("L", screen.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w, h], radius=R, fill=255)
    canvas.paste(screen, (4, 4), mask)
    # notch
    d = ImageDraw.Draw(canvas)
    rr(d, [w // 2 - 44, 8, w // 2 + 44, 26], 9, fill=INK)
    return canvas


def compose(title, note, index, total, phone: Image.Image) -> Image.Image:
    w = max(phone.width, 420) + PAD * 2
    h = HEADER_H + PAD + phone.height + CAPTION_H
    im = Image.new("RGB", (w, h), WHITE)
    d = ImageDraw.Draw(im)

    # brand header
    d.rectangle([0, 0, w, HEADER_H], fill=INK)
    rr(d, [20, 13, 58, 51], 10, fill=ORANGE)
    center_text(d, 39, 32, "HR", F_SEMI, WHITE)
    d.text((72, 29), "HR MAX", font=F_BOLD, fill=WHITE)
    d.text((160, 32), "mobile app preview", font=F_SM, fill=(148, 163, 184))
    # progress dots
    gap, r = 15, 6
    total_w = total * r * 2 + (total - 1) * (gap - r * 2)
    x0 = w - 22 - total_w
    for i in range(total):
        cx = x0 + i * gap + r
        d.ellipse([cx - r, 32 - r, cx + r, 32 + r], fill=ORANGE if i <= index else (71, 85, 105))

    # phone centred
    px = (w - phone.width) // 2
    im.paste(phone, (px, HEADER_H + PAD))

    # caption
    cy = HEADER_H + PAD + phone.height + 14
    num = f"{index + 1:02d}"
    d.text((PAD, cy), num, font=F_BOLD, fill=ORANGE)
    nb = d.textbbox((0, 0), num, font=F_BOLD)
    tx = PAD + (nb[2] - nb[0]) + 12
    d.text((tx, cy), title, font=F_SEMI, fill=TEXT)
    d.text((tx, cy + 23), note, font=F_SM, fill=MUTED)
    return im


def main() -> int:
    print("drawing mobile screens…")
    comps = []
    for title, note, fn in SCREENS:
        screen = fn(PHONE_W, PHONE_H)
        phone = phone_frame(screen)
        comps.append(compose(title, note, len(comps), len(SCREENS), phone))
        print(f"  {title:<12} ok")

    cw, ch = comps[0].size
    comps = [c if c.size == (cw, ch) else c.crop((0, 0, cw, ch)) for c in comps]
    print(f"canvas: {cw}x{ch}")

    print("building sequence…")
    HOLD, FADES, FADE_MS = 1300, 4, 85
    seq, durs = [], []
    for i, c in enumerate(comps):
        seq.append(c)
        durs.append(HOLD)
        if i < len(comps) - 1:
            for k in range(1, FADES + 1):
                seq.append(Image.blend(c, comps[i + 1], k / FADES))
                durs.append(FADE_MS)
    durs[-1] = HOLD + 900

    print("quantizing…")
    quant = [f.quantize(colors=48, method=Image.MEDIANCUT) for f in seq]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    quant[0].save(OUT, save_all=True, append_images=quant[1:], duration=durs,
                  loop=0, optimize=True, disposal=2)

    size = os.path.getsize(OUT)
    print(f"\nwrote {OUT}")
    print(f"frames: {len(quant)}  loop: {sum(durs)/1000:.1f}s  size: {size/1024:.0f} KB")
    with Image.open(OUT) as chk:
        n = sum(1 for _ in ImageSequence.Iterator(chk))
        print(f"verified: format={chk.format} frames={n} animated={getattr(chk, 'is_animated', False)}")
        if n < 2:
            print("ERROR: not animated")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
