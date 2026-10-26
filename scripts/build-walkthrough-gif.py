"""
Assemble the HR MAX dashboard walkthrough GIF from captured browser frames.

Frames are real screenshots of the running application (captured via browser
automation), not redrawn artwork. Output is written straight into the Vite
public/ directory so the landing page picks it up on the next build.

Usage: python build-walkthrough-gif.py
"""
import os
import sys
from PIL import Image, ImageSequence

# (label, source path) in playback order. The Reports frame was excluded: it
# captured a transient "Unable to load employee data" error banner.
FRAMES = [
    ("dashboard",   r"C:\Users\azayy\AppData\Local\Temp\opencode-browser-AvbEjJ\0\screenshot.png"),
    ("companies",   r"C:\Users\azayy\AppData\Local\Temp\opencode-browser-lSsKnb\0\screenshot.png"),
    ("departments", r"C:\Users\azayy\AppData\Local\Temp\opencode-browser-3eBkxB\0\screenshot.png"),
    ("employees",   r"C:\Users\azayy\AppData\Local\Temp\opencode-browser-xLg83k\0\screenshot.png"),
    ("attendance",  r"C:\Users\azayy\AppData\Local\Temp\opencode-browser-v4UEXc\0\screenshot.png"),
]

OUT = r"C:\Users\azayy\Documents\HRM-AWS\HRMAX\frontend\public\hrmax-walkthrough.gif"
TARGET_W = 900          # readable on desktop, light enough for the page
PALETTE_COLORS = 128    # enough for UI chrome, halves the file vs 256
DURATION_MS = 1400      # ~0.7 fps per screen — readable pace
EXIT_FRAMES = 8         # hold the final frame before looping


def main() -> int:
    imgs = []
    for label, path in FRAMES:
        if not os.path.exists(path):
            print(f"MISSING frame '{label}': {path}")
            return 1
        im = Image.open(path).convert("RGB")
        w, h = im.size
        nh = round(h * TARGET_W / w)
        imgs.append((label, im.resize((TARGET_W, nh), Image.LANCZOS)))
        print(f"  {label:<12} {w}x{h} -> {TARGET_W}x{nh}")

    # Every frame must share one canvas size or the GIF jumps.
    min_h = min(im.size[1] for _, im in imgs)
    norm = []
    for label, im in imgs:
        if im.size[1] != min_h:
            im = im.crop((0, 0, TARGET_W, min_h))
        # quantise with an adaptive palette derived from the frame itself
        norm.append(im.quantize(colors=PALETTE_COLORS, method=Image.MEDIANCUT))

    frames = list(norm)
    durations = [DURATION_MS] * (len(frames) - 1) + [DURATION_MS * EXIT_FRAMES]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    norm[0].save(
        OUT,
        save_all=True,
        append_images=norm[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )

    size = os.path.getsize(OUT)
    print(f"\nwrote {OUT}")
    print(f"frames: {len(norm)}  size: {size/1024:.0f} KB ({size/1024/1024:.2f} MB)")

    # Verify it really is an animated GIF (not a renamed static image).
    with Image.open(OUT) as chk:
        n = 0
        for _ in ImageSequence.Iterator(chk):
            n += 1
        print(f"verified: format={chk.format} frames={n} is_animated={getattr(chk, 'is_animated', False)}")
        if n < 2:
            print("ERROR: output is not animated")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
