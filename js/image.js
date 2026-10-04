// 画像の読みこみ・縮小・JPEG化。
//
// 写真の向き(EXIF Orientation)について:
// いまの iOS Safari(13.4〜)/ Chrome / Firefox は、<img> で読みこむときに EXIF の向きを
// 自動で反映し、canvas に drawImage したときも その向きのまま描かれる。
// ここで自分で回転させると「二重に回る」ので、あえて何もしない(<img> にまかせる)。

export const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.85;

/** File / Blob を <img> として読みこむ(向きはブラウザが補正) */
export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.naturalWidth || !img.naturalHeight) reject(new Error('decode'));
      else resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };
    img.src = url;
  });
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, quality);
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// iOS はキャンバスのメモリがきびしいので、使いおわったら すぐ小さくして解放する
function release(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * 長辺を MAX_SIDE 以下にして JPEG にする。
 * いっきに小さくすると線がギザギザになりやすいので、2段階で縮める。
 */
export async function resizeToJpeg(img, maxSide = MAX_SIDE) {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const ratio = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * ratio));
  const h = Math.max(1, Math.round(h0 * ratio));

  let source = img;
  let mid = null;
  if (ratio < 0.5) {
    mid = makeCanvas(w * 2, h * 2);
    const mctx = mid.getContext('2d');
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(img, 0, 0, mid.width, mid.height);
    source = mid;
  }

  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff'; // とうめいな部分は白に(JPEG は とうめいにできない)
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  if (mid) release(mid);

  const blob = await canvasToBlob(out);
  release(out);
  return blob;
}
