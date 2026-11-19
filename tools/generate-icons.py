"""Generate the Read Aloud icon set (16, 32, 48 and 128 px).

Usage (from the project root):
    python tools/generate-icons.py

Requires Pillow:  pip install pillow

Every icon is drawn at 8x and downsampled, which keeps the small sizes sharp.
"""

import argparse
import os

from PIL import Image, ImageDraw

SUPERSAMPLE = 8

GREEN_TOP = (34, 197, 94)
GREEN_BOTTOM = (21, 128, 61)
WHITE = (255, 255, 255, 255)


def gradient(size, top, bottom):
    """Vertical gradient, drawn once and scaled by the caller."""
    image = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        ratio = y / max(1, size - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
        draw.line([(0, y), (size, y)], fill=color)
    return image


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=radius, fill=255
    )
    return mask


def draw_speaker(size, simplified):
    """White speaker with sound waves, drawn on a transparent layer."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    s = lambda value: value * size  # noqa: E731 - short helper for readability

    # Speaker body + cone as a single polygon
    draw.polygon(
        [
            (s(0.20), s(0.43)),
            (s(0.29), s(0.43)),
            (s(0.43), s(0.29)),
            (s(0.43), s(0.71)),
            (s(0.29), s(0.57)),
            (s(0.20), s(0.57)),
        ],
        fill=WHITE,
    )

    # Sound waves
    if simplified:
        center_x, center_y = s(0.47), s(0.50)
        radius, width = s(0.20), max(1, round(s(0.11)))
        draw.arc(
            [center_x - radius, center_y - radius, center_x + radius, center_y + radius],
            -50,
            50,
            fill=WHITE,
            width=width,
        )
    else:
        for radius, width in ((0.15, 0.075), (0.26, 0.065)):
            center_x, center_y = s(0.47), s(0.50)
            r = s(radius)
            draw.arc(
                [center_x - r, center_y - r, center_x + r, center_y + r],
                -48,
                48,
                fill=WHITE,
                width=max(1, round(s(width))),
            )

    return layer


def build_icon(size):
    big = size * SUPERSAMPLE
    background = gradient(big, GREEN_TOP, GREEN_BOTTOM).convert("RGBA")
    background.putalpha(rounded_mask(big, round(big * 0.22)))

    speaker = draw_speaker(big, simplified=size <= 20)
    icon = Image.alpha_composite(background, speaker)

    return icon.resize((size, size), Image.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons"),
        help="Directory that receives the PNG files (default: ./icons)",
    )
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)

    for size in (16, 32, 48, 128):
        path = os.path.join(args.out, "icon%d.png" % size)
        build_icon(size).save(path, "PNG", optimize=True)
        print("wrote", path)


if __name__ == "__main__":
    main()
