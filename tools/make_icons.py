"""アプリのアイコン(PNG)をつくるスクリプト。

つかいかた(Docker の dev サービスの中で実行):
    docker compose run --rm dev python tools/make_icons.py

ピンク〜ラベンダーの背景に、まるい顔のキャラと キラキラを えがく。
maskable(角がまるく切られる)でも欠けないよう、だいじな絵は 中央 80% の中に入れている。
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
BASE = 1024
SS = 2  # 2倍で描いてから縮めて、ふちを なめらかにする


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def star(draw, cx, cy, r, color):
    """4本の とがった キラキラ"""
    k = r * 0.28
    pts = [
        (cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k),
        (cx, cy + r), (cx - k, cy + k), (cx - r, cy), (cx - k, cy - k),
    ]
    draw.polygon(pts, fill=color)


def draw_icon(size):
    s = size
    top, bottom = (255, 214, 231), (220, 205, 255)
    grad = Image.new("RGB", (1, 256))
    for y in range(256):
        grad.putpixel((0, y), lerp(top, bottom, y / 255))
    img = grad.resize((s, s), Image.BILINEAR)

    d = ImageDraw.Draw(img)
    u = s / 100  # 1% のながさ

    # まるい かお
    cx, cy, r = 50 * u, 53 * u, 30 * u
    d.ellipse((cx - r - 1.6 * u, cy - r - 1.6 * u, cx + r + 1.6 * u, cy + r + 1.6 * u), fill=(255, 143, 184))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 250, 240))

    # かみの毛(まえがみ)
    hair = (255, 143, 184)
    d.chord((cx - r, cy - r, cx + r, cy + r), 180, 360, fill=hair)
    d.ellipse((cx - r * 0.95, cy - r * 0.32, cx + r * 0.95, cy + r * 0.2), fill=(255, 250, 240))
    # リボン
    rb = (201, 182, 255)
    d.polygon([(cx + 14 * u, cy - 27 * u), (cx + 26 * u, cy - 34 * u), (cx + 24 * u, cy - 20 * u)], fill=rb)
    d.polygon([(cx + 14 * u, cy - 27 * u), (cx + 4 * u, cy - 36 * u), (cx + 4 * u, cy - 21 * u)], fill=rb)
    d.ellipse((cx + 11 * u, cy - 30 * u, cx + 17 * u, cy - 24 * u), fill=(170, 145, 240))

    # め
    eye = (90, 70, 96)
    for ex in (cx - 11 * u, cx + 11 * u):
        d.ellipse((ex - 4 * u, cy + 1 * u, ex + 4 * u, cy + 10 * u), fill=eye)
        d.ellipse((ex - 1.2 * u, cy + 2.4 * u, ex + 1.6 * u, cy + 5.4 * u), fill=(255, 255, 255))
    # ほっぺ
    for bx in (cx - 19 * u, cx + 19 * u):
        d.ellipse((bx - 5 * u, cy + 11 * u, bx + 5 * u, cy + 16 * u), fill=(255, 190, 210))
    # くち
    d.arc((cx - 5 * u, cy + 9 * u, cx + 5 * u, cy + 17 * u), 20, 160, fill=eye, width=max(2, round(1.6 * u)))

    # キラキラ
    star(d, 20 * u, 24 * u, 7 * u, (255, 255, 255))
    star(d, 82 * u, 74 * u, 6 * u, (255, 255, 255))
    star(d, 80 * u, 20 * u, 4 * u, (255, 241, 168))
    return img


def main():
    OUT.mkdir(exist_ok=True)
    big = draw_icon(BASE * SS).resize((BASE, BASE), Image.LANCZOS)
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        big.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
