"""Generate every image the Chrome Web Store listing asks for.

Usage (from the project root):
    python tools/generate-store-assets.py

Requires Pillow:  pip install pillow

Output (all saved without an alpha channel, as the Web Store requires):
    store/screenshot-1..5-*.png      1280x800
    store/promo-small-440x280.png
    store/promo-marquee-1400x560.png
"""

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE_DIR = os.path.join(ROOT, "store")
FONT_DIR = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts")

# Palette ---------------------------------------------------------------------
INK = (15, 23, 42)
MUTED = (100, 116, 139)
SOFT = (148, 163, 184)
LINE = (226, 232, 240)
CARD = (255, 255, 255)
BODY_TEXT = (71, 85, 105)
GREEN = (22, 163, 74)
GREEN_DARK = (21, 128, 61)
GREEN_SOFT = (220, 252, 231)
ORANGE = (234, 140, 0)
ORANGE_SOFT = (255, 247, 237)
ORANGE_TEXT = (154, 52, 18)
RED = (220, 38, 38)

# The exact button colours of the popup, so the mock matches the real UI
# (contrast ratios are checked by `npm run check`).
BUTTON_READ = (21, 128, 61)  # #15803d
BUTTON_PAUSE = (180, 83, 9)  # #b45309
BUTTON_STOP = (185, 28, 28)  # #b91c1c
BLUE = (37, 99, 235)
BLUE_TEXT = (30, 64, 175)
BLUE_SOFT = (219, 234, 254)
BG_TOP = (248, 250, 252)
BG_BOTTOM = (235, 243, 255)

FONT_FILES = {
    ("regular", False): "segoeui.ttf",
    ("regular", True): "segoeuib.ttf",
    ("light", False): "segoeuisl.ttf",
}

_font_cache = {}


def font(size, weight="regular", bold=False):
    key = (size, weight, bold)
    if key not in _font_cache:
        name = FONT_FILES.get((weight, bold), FONT_FILES[(weight, False)])
        try:
            _font_cache[key] = ImageFont.truetype(os.path.join(FONT_DIR, name), size)
        except OSError:
            _font_cache[key] = ImageFont.load_default(size)
    return _font_cache[key]


class Canvas:
    """Thin wrapper around Pillow that keeps the drawing code readable."""

    def __init__(self, width, height, background_image=None):
        self.width = width
        self.height = height
        self.image = Image.new("RGBA", (width, height), (255, 255, 255, 255))
        if background_image is not None:
            self.image.alpha_composite(background_image.convert("RGBA"))
        self.draw = ImageDraw.Draw(self.image)

    def refresh(self):
        self.draw = ImageDraw.Draw(self.image)

    # -- primitives ---------------------------------------------------------

    def rounded(self, box, radius, fill=None, outline=None, width=1):
        self.draw.rounded_rectangle(
            box, radius=radius, fill=fill, outline=outline, width=width
        )
        return box

    def shadow(self, box, radius, blur=28, spread=0, alpha=38, offset=6):
        layer = Image.new("RGBA", self.image.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle(
            [box[0] - spread, box[1] - spread + offset, box[2] + spread, box[3] + spread + offset],
            radius=radius + spread,
            fill=(15, 23, 42, alpha),
        )
        self.image.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))
        self.refresh()

    def text(self, xy, content, size, color=INK, weight="regular", bold=False, anchor="la"):
        self.draw.text(xy, content, font=font(size, weight, bold), fill=color, anchor=anchor)

    def wrap(self, content, size, max_width, weight="regular", bold=False):
        f = font(size, weight, bold)
        lines, current = [], ""
        for word in content.split():
            candidate = (current + " " + word).strip()
            if not current or f.getlength(candidate) <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)
        return lines

    def paragraph(self, xy, content, size, max_width, color=BODY_TEXT, line_height=None,
                  bold=False, highlight=None, max_y=None):
        """Wrapped text. `highlight` marks one word; returns the y after the text."""
        f = font(size, weight="regular", bold=bold)
        line_height = line_height or round(size * 1.65)
        x, y = xy
        index = 0
        highlight_box = None

        for line in self.wrap(content, size, max_width, bold=bold):
            if max_y is not None and y + line_height > max_y:
                break
            cursor = x
            for word in line.split():
                word_width = f.getlength(word)
                if highlight is not None and index == highlight:
                    highlight_box = (cursor - 4, y - 3, cursor + word_width + 5, y + size + 8)
                self.draw.text((cursor, y), word, font=f, fill=color)
                cursor += f.getlength(word + " ")
                index += 1
            y += line_height

        if highlight_box:
            overlay = Image.new("RGBA", self.image.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            draw.rounded_rectangle(highlight_box, radius=6, fill=(59, 130, 246, 70))
            draw.line(
                [(highlight_box[0], highlight_box[3]), (highlight_box[2], highlight_box[3])],
                fill=BLUE + (255,),
                width=3,
            )
            self.image.alpha_composite(overlay)
            self.refresh()

        return y

    def wash(self, box, radius, alpha=168, color=(248, 250, 252)):
        """Paints a translucent layer inside a rounded rectangle."""
        mask = Image.new("L", self.image.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=alpha)
        layer = Image.new("RGBA", self.image.size, color + (255,))
        self.image.paste(layer, (0, 0), mask)
        self.refresh()

    def save(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # The Web Store rejects screenshots that contain an alpha channel.
        self.image.convert("RGB").save(path, "PNG", optimize=True)
        print("wrote", os.path.relpath(path, ROOT))


def background(width, height):
    """Soft vertical gradient with two coloured glows."""
    base = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(base)
    for y in range(height):
        ratio = y / max(1, height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * ratio) for i in range(3)),
        )

    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse([-width * 0.25, height * 0.5, width * 0.5, height * 1.6], fill=(34, 197, 94, 38))
    glow_draw.ellipse([width * 0.7, -height * 0.4, width * 1.2, height * 0.5], fill=(59, 130, 246, 30))
    return Image.alpha_composite(base.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(130)))


def headline(canvas, x, y, title, subtitle=None, size=40, wrap_width=470):
    lines = canvas.wrap(title, size, wrap_width, bold=True)
    for i, line in enumerate(lines):
        canvas.text((x, y + i * round(size * 1.2)), line, size, INK, bold=True)
    y += len(lines) * round(size * 1.2) + 10

    if subtitle:
        subtitle_lines = canvas.wrap(subtitle, 17, wrap_width)
        for i, line in enumerate(subtitle_lines):
            canvas.text((x, y + i * 27), line, 17, MUTED)
        y += len(subtitle_lines) * 27

    return y


def bullet_list(canvas, x, y, items, size=17, gap=14, max_width=430):
    for item in items:
        canvas.draw.ellipse([x, y + size // 2 - 4, x + 8, y + size // 2 + 4], fill=GREEN)
        lines = canvas.wrap(item, size, max_width - 28)
        for i, line in enumerate(lines):
            canvas.text((x + 22, y + i * round(size * 1.5)), line, size, INK)
        y += len(lines) * round(size * 1.5) + gap
    return y


ARTICLE_TITLE = "Why reading aloud still matters"
ARTICLE_META = "Priya Sharma  ·  6 min read"
ARTICLE_PARAGRAPHS = [
    "Reading silently is fast, but reading aloud is how we learn to hear the rhythm of a "
    "sentence. When words are spoken, meaning arrives through pace as much as through "
    "vocabulary. Studies of early readers show that listening to a text while following it "
    "on the page improves both retention and pronunciation.",
    "That is why a simple reading tool is useful far beyond the classroom. Long reports, "
    "dense documentation and unfamiliar languages all become easier when something else "
    "does the talking and the page keeps your place for you.",
    "The extension reads the paragraph you selected, or the article itself when nothing is "
    "selected, and highlights each word as it is spoken.",
]


def image_band(canvas, box):
    """Placeholder for a photo, so the mock page looks like a real article."""
    x0, y0, x1, y1 = box
    canvas.rounded(box, 12, fill=(226, 232, 240))

    strip = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    draw = ImageDraw.Draw(strip)
    for y in range(y1 - y0):
        ratio = y / max(1, y1 - y0 - 1)
        draw.line(
            [(0, y), (x1 - x0, y)],
            fill=(round(203 + 20 * ratio), round(222 + 12 * ratio), round(242 + 6 * ratio), 255),
        )
    mask = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, x1 - x0 - 1, y1 - y0 - 1], radius=12, fill=255)
    canvas.image.paste(strip, (x0, y0), mask)
    canvas.refresh()

    width, height = x1 - x0, y1 - y0
    canvas.draw.ellipse(
        [x0 + width * 0.16, y0 + height * 0.2, x0 + width * 0.16 + height * 0.26,
         y0 + height * 0.2 + height * 0.26],
        fill=(241, 245, 249),
    )
    canvas.draw.polygon(
        [
            (x0 + width * 0.1, y1 - 8),
            (x0 + width * 0.36, y0 + height * 0.38),
            (x0 + width * 0.56, y1 - 8),
        ],
        fill=(226, 232, 240),
    )
    canvas.draw.polygon(
        [
            (x0 + width * 0.38, y1 - 8),
            (x0 + width * 0.62, y0 + height * 0.5),
            (x0 + width * 0.88, y1 - 8),
        ],
        fill=(203, 213, 225),
    )


def browser_window(canvas, box, title, paragraphs, highlight=None, meta=ARTICLE_META,
                   dim=False, with_image=False, title_size=22):
    """Stylised Chrome window containing a simplified article."""
    x0, y0, x1, y1 = box
    radius = 14
    bar_height = 44

    canvas.shadow(box, radius, blur=30, spread=2, alpha=42)
    canvas.rounded(box, radius, fill=CARD)

    # Toolbar
    canvas.draw.rounded_rectangle(
        [x0, y0, x1, y0 + bar_height + radius], radius=radius, fill=(241, 245, 249)
    )
    # Square off the bottom of the toolbar so the rounded corners do not show.
    canvas.draw.rectangle([x0, y0 + bar_height, x1, y0 + bar_height + radius], fill=CARD)
    canvas.draw.rectangle([x0, y0 + bar_height - 2, x1, y0 + bar_height], fill=LINE)
    for i, color in enumerate([(248, 113, 113), (251, 191, 36), (52, 211, 153)]):
        cx = x0 + 22 + i * 18
        canvas.draw.ellipse([cx - 5, y0 + 17, cx + 5, y0 + 27], fill=color)

    omnibox = [x0 + 92, y0 + 10, x1 - 20, y0 + 34]
    canvas.rounded(omnibox, 12, fill=CARD, outline=LINE, width=1)
    canvas.text((omnibox[0] + 14, omnibox[1] + 6), "example.com/reading-is-fun", 11, SOFT)

    # Article
    pad = 34
    content_x = x0 + pad
    content_width = (x1 - x0) - pad * 2
    y = y0 + bar_height + 28
    bottom_limit = y1 - pad

    canvas.text((content_x, y), title, title_size, INK, bold=True)
    y += round(title_size * 1.5)
    canvas.text((content_x, y), meta, 11, SOFT)
    y += round(title_size * 0.9) + 18

    if with_image:
        image_height = min(130, (y1 - y0) * 0.22)
        image_band(canvas, (content_x, y, x1 - pad, y + image_height))
        y += image_height + 26

    highlighted_word = highlight if isinstance(highlight, int) else None

    for index, paragraph in enumerate(paragraphs):
        if y + 60 > bottom_limit:
            break
        y = canvas.paragraph(
            (content_x, y),
            paragraph,
            13,
            content_width,
            color=BODY_TEXT,
            line_height=24,
            highlight=highlighted_word if index == 0 else None,
            max_y=bottom_limit,
        ) + 16

    if dim:
        canvas.wash(box, radius, alpha=118)

    return box


def slider(canvas, x, y, width, ratio):
    canvas.draw.rounded_rectangle([x, y - 2, x + width, y + 2], radius=2, fill=(226, 232, 240))
    canvas.draw.rounded_rectangle([x, y - 2, x + width * ratio, y + 2], radius=2, fill=BLUE)
    knob_x = x + width * ratio
    canvas.draw.ellipse([knob_x - 7, y - 7, knob_x + 7, y + 7], fill=CARD, outline=BLUE, width=3)


# Fixed vertical layout of the popup, so the card can be sized before drawing.
POPUP_ROWS = [
    ("title", 24),
    ("subtitle", 22),
    ("buttons", 38),
    ("status", 38),
    ("voice_label", 16),
    ("voice_field", 34),
    ("speed_label", 16),
    ("speed_slider", 26),
    ("pitch_label", 16),
    ("pitch_slider", 26),
    ("presets_label", 14),
    ("presets", 20),
]


def popup_positions(pad=16):
    positions = {}
    y = pad
    for name, height in POPUP_ROWS:
        positions[name] = y
        y += height
    return positions, y + pad


def popup_card(canvas, left, top, width, voice="Microsoft Ravi (en-IN)", speed="0.85",
               pitch="1", status="Reading..."):
    """Draws the extension popup the way users see it. Returns control anchors."""
    pad = 16
    positions, height = popup_positions(pad)
    box = (left, top, left + width, top + height)
    inner = width - pad * 2
    x = left + pad

    canvas.shadow(box, 14, blur=34, spread=3, alpha=55)
    canvas.rounded(box, 14, fill=CARD)

    canvas.text((x, top + positions["title"]), "Read Aloud", 15, INK, bold=True)
    canvas.text((x, top + positions["subtitle"]), "Select text on a page, then press Read.", 9, SOFT)

    # Buttons
    button_width = (inner - 16) / 3
    y = top + positions["buttons"]
    buttons = [("Read", BUTTON_READ), ("Pause", BUTTON_PAUSE), ("Stop", BUTTON_STOP)]
    for i, (label, color) in enumerate(buttons):
        bx = x + i * (button_width + 8)
        canvas.rounded([bx, y, bx + button_width, y + 28], 6, fill=color)
        canvas.text((bx + button_width / 2, y + 14), label, 11, (255, 255, 255), bold=True, anchor="mm")

    # Status pill
    y = top + positions["status"]
    canvas.rounded([x, y, x + inner, y + 24], 5, fill=GREEN_SOFT)
    canvas.text((left + width / 2, y + 12), status, 10, GREEN_DARK, bold=True, anchor="mm")
    canvas.draw.line([x, y + 32, x + inner, y + 32], fill=LINE, width=1)

    # Voice
    y = top + positions["voice_label"]
    canvas.text((x, y), "Voice", 9, MUTED, bold=True)
    y = top + positions["voice_field"]
    canvas.rounded([x, y, x + inner, y + 26], 5, fill=CARD, outline=(203, 213, 225), width=1)
    canvas.text((x + 9, y + 8), voice, 10, INK)
    canvas.draw.polygon([(x + inner - 16, y + 11), (x + inner - 8, y + 11), (x + inner - 12, y + 16)], fill=SOFT)

    # Speed and pitch
    sliders = {}
    for key, label, value, ratio in (
        ("speed", "Speed:", speed, 0.23),
        ("pitch", "Pitch:", pitch, 0.33),
    ):
        label_y = top + positions[key + "_label"]
        canvas.text((x, label_y), label, 9, MUTED, bold=True)
        canvas.text((x + 38, label_y), value, 9, SOFT)
        slider_y = top + positions[key + "_slider"] + 6
        slider(canvas, x + 7, slider_y, inner - 14, ratio)
        sliders[key] = label_y + 5

    # Presets
    y = top + positions["presets_label"]
    canvas.text((x, y), "Presets", 9, MUTED, bold=True)
    y = top + positions["presets"]
    preset_width = (inner - 10) / 3
    for i, label in enumerate(["Slow", "Normal", "Fast"]):
        bx = x + i * (preset_width + 5)
        canvas.rounded([bx, y, bx + preset_width, y + 20], 4, fill=(243, 244, 246), outline=LINE, width=1)
        canvas.text((bx + preset_width / 2, y + 10), label, 9, (55, 65, 81), anchor="mm")

    return {
        "box": box,
        "voice": top + positions["voice_field"] + 13,
        "speed": sliders["speed"],
        "pitch": sliders["pitch"],
    }


def callout(canvas, anchor_y, right_x, label):
    canvas.draw.line([(right_x - 60, anchor_y), (right_x, anchor_y)], fill=GREEN, width=3)
    canvas.text((right_x + 12, anchor_y), label, 15, GREEN_DARK, bold=True, anchor="lm")


def screenshot_one():
    canvas = Canvas(1280, 800, background(1280, 800))
    headline(
        canvas,
        70,
        150,
        "Read any article aloud",
        "One click speaks the page you are already reading, and highlights every word as it goes.",
        size=44,
        wrap_width=440,
    )
    bullet_list(
        canvas,
        70,
        480,
        ["Works on any website", "Word-by-word highlighting", "Pauses when you switch tabs"],
        size=17,
        max_width=420,
    )

    browser_window(
        canvas,
        (600, 120, 1215, 750),
        ARTICLE_TITLE,
        ARTICLE_PARAGRAPHS,
        highlight=21,
        with_image=True,
    )

    canvas.save(os.path.join(STORE_DIR, "screenshot-1-read-aloud.png"))


def screenshot_two():
    canvas = Canvas(1280, 800, background(1280, 800))
    headline(
        canvas,
        80,
        110,
        "Follow along, word by word",
        "The highlight moves with the voice, so you never lose your place.",
        size=42,
        wrap_width=1100,
    )

    card = (80, 320, 1200, 700)
    canvas.shadow(card, 18, blur=30, spread=2, alpha=40)
    canvas.rounded(card, 18, fill=CARD)

    canvas.paragraph(
        (140, 380),
        "Reading aloud is how we learn to hear the rhythm of a sentence. When words are "
        "spoken, meaning arrives through pace as much as through vocabulary.",
        30,
        1000,
        color=(51, 65, 85),
        line_height=52,
        highlight=22,
    )

    canvas.rounded([140, 560, 760, 660], 12, fill=BLUE_SOFT)
    canvas.text((170, 588), "The marked word follows the spoken audio", 15, BLUE_TEXT)
    canvas.text((170, 616), "Works with every offline Chrome voice", 13, BLUE)

    canvas.save(os.path.join(STORE_DIR, "screenshot-2-word-highlight.png"))


def screenshot_three():
    canvas = Canvas(1280, 800, background(1280, 800))
    headline(
        canvas,
        80,
        150,
        "Your voice, your speed",
        "Pick any voice installed in Chrome, then fine-tune speed and pitch.",
        size=42,
        wrap_width=520,
    )
    bullet_list(
        canvas,
        80,
        430,
        [
            "Offline voices are private and start instantly",
            "Presets for slow, normal and fast reading",
            "Your choices are remembered next time",
        ],
        size=16,
        max_width=470,
    )

    controls = popup_card(canvas, 640, 190, 380)
    callout(canvas, controls["voice"], 1100, "Voice")
    callout(canvas, controls["speed"], 1100, "Speed")
    callout(canvas, controls["pitch"], 1100, "Pitch")

    banner = (80, 640, 1200, 712)
    canvas.shadow(banner, 14, blur=24, spread=2, alpha=34)
    canvas.rounded(banner, 14, fill=CARD)
    canvas.text(
        (640, 676),
        "Every setting is saved automatically, and reading pauses when you switch tabs.",
        17,
        MUTED,
        anchor="mm",
    )

    canvas.save(os.path.join(STORE_DIR, "screenshot-3-voice-controls.png"))


def screenshot_four():
    canvas = Canvas(1280, 800, background(1280, 800))
    headline(
        canvas,
        80,
        110,
        "Keeps your place",
        "Switch tabs and reading pauses for you, then continues from the same word when you come back.",
        size=40,
        wrap_width=1100,
    )

    browser_window(
        canvas,
        (80, 330, 620, 690),
        ARTICLE_TITLE,
        ARTICLE_PARAGRAPHS[:2],
        highlight=8,
        dim=True,
    )
    browser_window(
        canvas,
        (680, 330, 1220, 690),
        "Notes for later",
        [
            "The reading continues exactly where it stopped, so you never have to search "
            "for your place again.",
            "Close the popup and it keeps reading. Open it again to pause or stop.",
            "Prefer a different voice? Change it in the settings and the next paragraph "
            "uses it right away.",
        ],
        highlight=9,
        meta="Saved yesterday",
    )

    badge = (250, 470, 560, 552)
    canvas.shadow(badge, 16, blur=24, spread=2, alpha=50)
    canvas.rounded(badge, 16, fill=ORANGE_SOFT)
    canvas.draw.rounded_rectangle([272, 498, 288, 526], radius=4, fill=ORANGE)
    canvas.draw.rounded_rectangle([296, 498, 312, 526], radius=4, fill=ORANGE)
    canvas.text((336, 512), "Paused", 20, ORANGE_TEXT, bold=True, anchor="lm")

    canvas.text((80, 720), "Reading resumes automatically when that tab becomes active again.", 17, MUTED)

    canvas.save(os.path.join(STORE_DIR, "screenshot-4-pauses-on-tab-switch.png"))


def screenshot_five():
    canvas = Canvas(1280, 800, background(1280, 800))
    headline(
        canvas,
        80,
        110,
        "Nothing leaves your browser",
        "Read Aloud uses the speech engine already built into Chrome. No account, no server, no analytics.",
        size=40,
        wrap_width=1120,
    )

    cards = [
        ("Works offline", "Voices are generated on your own device."),
        ("No data collected", "The text of a page is never uploaded."),
        ("No account needed", "Install it, pin it and start reading."),
    ]

    card_width = 340
    for i, (title, description) in enumerate(cards):
        x = 80 + i * (card_width + 30)
        box = (x, 360, x + card_width, 566)
        canvas.shadow(box, 16, blur=26, spread=2, alpha=40)
        canvas.rounded(box, 16, fill=CARD)

        canvas.draw.ellipse([x + 30, 396, x + 78, 444], fill=GREEN_SOFT)
        canvas.draw.ellipse([x + 46, 412, x + 62, 428], fill=GREEN)
        canvas.text((x + 30, 474), title, 22, INK, bold=True)
        for line_index, line in enumerate(canvas.wrap(description, 15, card_width - 60)):
            canvas.text((x + 30, 514 + line_index * 24), line, 15, MUTED)

    canvas.rounded([80, 620, 1200, 692], 14, fill=CARD)
    canvas.text(
        (640, 656),
        "Privacy policy: github.com/malikrajat/readLoude/blob/main/PRIVACY.md",
        15,
        MUTED,
        anchor="mm",
    )

    canvas.save(os.path.join(STORE_DIR, "screenshot-5-private-offline.png"))


def promo_small():
    canvas = Canvas(440, 280, background(440, 280))
    icon = Image.open(os.path.join(ROOT, "icons", "icon128.png")).convert("RGBA")
    canvas.image.alpha_composite(icon, (156, 30))
    canvas.text((220, 178), "Read Aloud", 30, INK, bold=True, anchor="mm")
    canvas.text((220, 216), "Word-by-word highlighting", 15, MUTED, anchor="mm")
    canvas.text((220, 246), "Works offline  ·  No data collected", 13, GREEN_DARK, anchor="mm")
    canvas.save(os.path.join(STORE_DIR, "promo-small-440x280.png"))


def promo_marquee():
    canvas = Canvas(1400, 560, background(1400, 560))
    icon = Image.open(os.path.join(ROOT, "icons", "icon128.png")).convert("RGBA")
    canvas.image.alpha_composite(icon, (96, 92))

    canvas.text((96, 236), "Read Aloud", 52, INK, bold=True)
    canvas.text((96, 296), "with Highlight", 52, INK, bold=True)
    canvas.text((98, 372), "Listen to any page with word-by-word highlighting", 24, MUTED)
    canvas.rounded([98, 424, 610, 484], 12, fill=GREEN_SOFT)
    canvas.text(
        (126, 454),
        "Free  ·  Works offline  ·  No data collected",
        20,
        GREEN_DARK,
        bold=True,
        anchor="lm",
    )

    browser_window(
        canvas,
        (690, 96, 1304, 464),
        ARTICLE_TITLE,
        [ARTICLE_PARAGRAPHS[0]],
        highlight=18,
        title_size=20,
    )

    canvas.save(os.path.join(STORE_DIR, "promo-marquee-1400x560.png"))


def main():
    os.makedirs(STORE_DIR, exist_ok=True)
    screenshot_one()
    screenshot_two()
    screenshot_three()
    screenshot_four()
    screenshot_five()
    promo_small()
    promo_marquee()


if __name__ == "__main__":
    main()
