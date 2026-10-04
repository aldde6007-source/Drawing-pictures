"""まんがふうフィルターを、手もとの写真で ためすスクリプト。

つかいかた(Docker の dev サービスの中で実行。写真はこのフォルダの中に置く):
    docker compose run --rm dev python tools/try_manga.py photo.jpg

写真の まんなかを正方形に切って 800px にし、
「もと / よわい / ふつう / つよい」を並べた画像を photo-manga.png として保存する。
(EXIF の向きは補正する。アプリでは ブラウザが補正している)
"""

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

SIZE = 800


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python tools/try_manga.py <photo>")
    src = Path(sys.argv[1])
    img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    side = min(img.size)
    left, top = (img.width - side) // 2, (img.height - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.LANCZOS)

    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "in.raw"
        raw.write_bytes(img.convert("RGBA").tobytes())
        runner = Path(__file__).with_name("run_manga.mjs")
        subprocess.run(["node", str(runner), str(raw), str(SIZE), str(SIZE), f"{tmp}/out"], check=True)
        outs = [
            Image.frombytes("RGBA", (SIZE, SIZE), (Path(tmp) / f"out{i}.raw").read_bytes()).convert("RGB")
            for i in (1, 2, 3)
        ]

    grid = Image.new("RGB", (SIZE * 2, SIZE * 2), "white")
    for i, im in enumerate([img, *outs]):
        grid.paste(im, ((i % 2) * SIZE, (i // 2) * SIZE))
    dst = src.with_name(f"{src.stem}-manga.png")
    grid.save(dst)
    print("wrote", dst)


if __name__ == "__main__":
    main()
