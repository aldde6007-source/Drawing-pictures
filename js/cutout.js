// キャラの えの まわりの白を とうめいにして、シールのような 白い ふちを つける。
//
// ずかんの画像は「まるく きりぬいた正方形」(まるの外も白)。
// まるの外を はじまりにして、つながっている 白っぽいところを とうめいにする(ぬりつぶしと同じ考え方)。
// 線で かこまれた 白(目の中など)は のこる。
// removeBackground は ImageData だけで うごく(DOM は makeSprite だけ)。

const SPRITE_SIZE = 360;   // シールにするときの 大きさ(px)
const WHITE_MIN = 200;     // RGB が ぜんぶ これ以上なら「白っぽい」
const GRAY_RANGE = 48;     // RGB の ばらつきが これ以下なら「色が うすい」
const SPECK_RATIO = 0.002; // これより小さい かたまり(紙の よごれ など)は けす

/**
 * まわりの白を とうめいにする(imageData を そのまま かきかえる)。
 * @returns {{top:number, bottom:number}} のこった絵の 上はし・下はし(0〜1)
 */
export function removeBackground(imageData) {
  const { data, width: w, height: h } = imageData;
  const n = w * h;
  const bg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;

  const isLight = (i) => {
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const mn = Math.min(r, g, b);
    return mn >= WHITE_MIN && Math.max(r, g, b) - mn <= GRAY_RANGE;
  };
  const forNeighbors = (i, fn) => {
    const x = i % w;
    if (x > 0) fn(i - 1);
    if (x < w - 1) fn(i + 1);
    if (i >= w) fn(i - w);
    if (i < n - w) fn(i + w);
  };

  // 1. まるの外は はいけい
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const r2 = Math.pow(Math.min(w, h) / 2 - 1, 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) {
        const i = y * w + x;
        bg[i] = 1;
        stack[sp++] = i;
      }
    }
  }

  // 2. そこから つながっている 白っぽいところも はいけい
  const spreadLight = (j) => {
    if (!bg[j] && isLight(j)) { bg[j] = 1; stack[sp++] = j; }
  };
  while (sp) forNeighbors(stack[--sp], spreadLight);

  // 3. ちいさな かたまりは けす
  const minArea = Math.max(1, Math.round(n * SPECK_RATIO));
  const seen = new Uint8Array(n);
  const comp = new Int32Array(n);
  let len = 0;
  const spreadInk = (j) => {
    if (!bg[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
  };
  for (let s = 0; s < n; s++) {
    if (bg[s] || seen[s]) continue;
    len = 0;
    seen[s] = 1;
    stack[sp++] = s;
    while (sp) {
      const i = stack[--sp];
      comp[len++] = i;
      forNeighbors(i, spreadInk);
    }
    if (len < minArea) for (let k = 0; k < len; k++) bg[comp[k]] = 1;
  }

  // 4. とうめいにして、のこった絵の 上下を はかる
  let top = h;
  let bottom = -1;
  for (let i = 0; i < n; i++) {
    if (bg[i]) {
      data[i * 4 + 3] = 0;
    } else {
      const y = (i / w) | 0;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (bottom < 0) return { top: 0, bottom: 1 };
  return { top: top / h, bottom: (bottom + 1) / h };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * <img> から シール(まわりが とうめい+白い ふち)を つくる。
 * @returns {{canvas:HTMLCanvasElement, top:number, bottom:number}} top/bottom は canvas の中での 絵の 上はし・下はし(0〜1)
 */
export function makeSprite(img) {
  const size = SPRITE_SIZE;
  const pad = Math.round(size * 0.035);
  const full = size + pad * 2;

  const src = makeCanvas(size, size);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(img, 0, 0, size, size);
  const imageData = sctx.getImageData(0, 0, size, size);
  const bounds = removeBackground(imageData);
  sctx.putImageData(imageData, 0, 0);

  const out = makeCanvas(full, full);
  const octx = out.getContext('2d');
  // 白い ふち:絵を まわりに ずらして かさね、白で ぬる
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    octx.drawImage(src, pad + Math.cos(a) * pad, pad + Math.sin(a) * pad);
  }
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, full, full);
  octx.globalCompositeOperation = 'source-over';
  octx.drawImage(src, pad, pad);

  src.width = 0;
  src.height = 0;
  return {
    canvas: out,
    top: (bounds.top * size) / full,
    bottom: (bounds.bottom * size + pad * 2) / full,
  };
}

/** えが ないキャラ用の シール */
export function makePlaceholderSprite() {
  const size = 240;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efe8ff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `${size * 0.4}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🖍', size / 2, size / 2);
  return { canvas: c, top: 0.08, bottom: 0.92 };
}
