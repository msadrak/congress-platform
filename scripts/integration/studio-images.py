"""Synthetic artwork for the Page Studio lifecycle run (no third-party photos in the repository).

    python studio-images.py <out_dir>   ->  cover.jpg (2400x1350), logo.png (transparent), venue.jpg
"""
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


def gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    base = Image.new("RGB", size)
    draw = ImageDraw.Draw(base)
    for y in range(h):
        t = y / (h - 1)
        draw.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    return base


def bokeh(base: Image.Image, seed: int, palette: list[tuple[int, int, int]], count: int, radius: tuple[int, int]) -> Image.Image:
    rng = random.Random(seed)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    w, h = base.size
    for _ in range(count):
        r = rng.randint(*radius)
        x, y = rng.randint(0, w), rng.randint(0, int(h * 0.75))
        colour = rng.choice(palette)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(*colour, rng.randint(40, 120)))
    layer = layer.filter(ImageFilter.GaussianBlur(18))
    return Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB")


def stage_lines(img: Image.Image) -> Image.Image:
    """A suggestion of an auditorium: curved rows of seats in perspective."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    w, h = img.size
    for i in range(14):
        y = int(h * 0.58 + i * i * 2.4 + i * 18)
        draw.arc([-w * 0.3, y - 300, w * 1.3, y + 300], 200, 340, fill=(255, 255, 255, 34 + i * 3), width=3)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([w * 0.2, h * 0.3, w * 0.8, h * 0.62], fill=(255, 214, 236, 90))
    img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(120)))
    return Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(1.2))).convert("RGB")


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    cover = gradient((2400, 1350), (34, 18, 120), (196, 64, 150))
    cover = bokeh(cover, 7, [(255, 210, 160), (255, 151, 255), (135, 112, 255), (255, 255, 255)], 140, (12, 70))
    stage_lines(cover).save(out / "cover.jpg", quality=90)

    venue = gradient((1600, 1200), (16, 40, 96), (40, 150, 170))
    venue = bokeh(venue, 11, [(255, 255, 255), (170, 230, 255), (255, 220, 170)], 90, (10, 50))
    stage_lines(venue).save(out / "venue.jpg", quality=90)

    logo = Image.new("RGBA", (820, 220), (0, 0, 0, 0))
    draw = ImageDraw.Draw(logo)
    draw.ellipse([10, 20, 190, 200], outline=(32, 0, 205, 255), width=22)
    draw.ellipse([80, 20, 260, 200], outline=(184, 1, 122, 255), width=22)
    try:
        font = ImageFont.load_default(size=80)
    except TypeError:
        font = ImageFont.load_default()
    draw.text((290, 52), "MedSummit", fill=(14, 12, 43, 255), font=font)
    logo.save(out / "logo.png")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
