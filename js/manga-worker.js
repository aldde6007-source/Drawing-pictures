// まんがふう フィルター(Web Worker)。画面が かたまらないよう、べつのスレッドで計算する。
//
// 0. かみの かげ・いろムラを なおして、はいけいを 白くする(スキャナーのように)
// 1. いろを すこし あざやかにする
// 2. Kuwahara フィルター:りんかくを のこしたまま、いろを なめらかに ならす
// 3. k-means:いろの かずを へらして「ベタぬり」にする
// 4. XDoG:くろい りんかく線を ひく
//
// 入力:{ id, width, height, buffer(RGBA), level(1〜3) } / 出力:{ id, buffer(RGBA) }

const LEVELS = {
  1: { sat: 1.15, radius: 2, colors: 16, sigma: 0.9, phi: 60 },
  2: { sat: 1.25, radius: 3, colors: 10, sigma: 1.2, phi: 90 },
  3: { sat: 1.35, radius: 4, colors: 8, sigma: 1.6, phi: 130 },
};
const INK = [45, 35, 50];

self.onmessage = (e) => {
  const { id, width, height, buffer, level } = e.data;
  try {
    const out = mangaFilter(new Uint8ClampedArray(buffer), width, height, LEVELS[level] || LEVELS[2]);
    self.postMessage({ id, buffer: out.buffer }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};

function mangaFilter(src, w, h, p) {
  const n = w * h;
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  const paper = paperModel(src, w, h);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    let r = src[j], g = src[j + 1], b = src[j + 2];
    if (paper) {
      const x = i % w, y = (i - x) / w;
      [r, g, b] = paper(x, y, r, g, b);
    }
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    R[i] = clamp255(l + (r - l) * p.sat);
    G[i] = clamp255(l + (g - l) * p.sat);
    B[i] = clamp255(l + (b - l) * p.sat);
  }

  const s = kuwahara(R, G, B, w, h, p.radius);

  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (0.299 * s.R[i] + 0.587 * s.G[i] + 0.114 * s.B[i]) / 255;
  const ink = xdog(L, w, h, p.sigma, p.phi);

  const centers = kmeans(s.R, s.G, s.B, w, h, p.colors);
  const k = centers.length / 3;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = s.R[i], g = s.G[i], b = s.B[i];
    let best = 0, bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const dr = r - centers[c * 3], dg = g - centers[c * 3 + 1], db = b - centers[c * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = c; }
    }
    const a = ink[i];
    out[j] = centers[best * 3] * (1 - a) + INK[0] * a;
    out[j + 1] = centers[best * 3 + 1] * (1 - a) + INK[1] * a;
    out[j + 2] = centers[best * 3 + 2] * (1 - a) + INK[2] * a;
    out[j + 3] = 255;
  }
  return out;
}

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// ---- かみの はいけい ----
// 絵を こまかい マスに わけ、マスごとに「いちばん あかるい いろ」を しらべて、かみの あかるさの 地図を つくる。
// その あかるさで わりざんすると、かげや いろムラが きえて、かみが 白になる。
//
// - いろの うすい(=かみ っぽい)マスだけを 信じる
// - まず 全体の ゆるやかな あかるさを 2次式で あらわし、それより ずっと くらいマス
//   (えんぴつで ぬった ところ など)は かみと みなさない(かげは ふつう 3わり くらいまでしか くらくならない)
// - かみが みえないマス(いろを ぬった ところ)は、まわりの マスから うめる
// かみ っぽい マスが すくない(紙の絵ではない)ときは null を かえして なにもしない。
function paperModel(src, w, h) {
  const CELL = 40;
  const gw = Math.ceil(w / CELL);
  const gh = Math.ceil(h / CELL);
  const cells = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const ls = [];
      for (let y = gy * CELL; y < Math.min(h, (gy + 1) * CELL); y += 2) {
        for (let x = gx * CELL; x < Math.min(w, (gx + 1) * CELL); x += 2) {
          const j = (y * w + x) * 4;
          ls.push([0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2], j]);
        }
      }
      ls.sort((a, b) => a[0] - b[0]);
      const top = ls.slice(Math.floor(ls.length * 0.9));
      let r = 0, g = 0, b = 0;
      for (const [, j] of top) { r += src[j]; g += src[j + 1]; b += src[j + 2]; }
      r /= top.length; g /= top.length; b /= top.length;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      cells.push({
        u: ((gx + 0.5) * CELL) / w - 0.5,
        v: ((gy + 0.5) * CELL) / h - 0.5,
        c: [r, g, b],
        paper: mx > 90 && (mx - mn) / mx < 0.18,
      });
    }
  }
  const paperCells = cells.filter((c) => c.paper);
  if (paperCells.length < 8) return null;

  const coef = [0, 1, 2].map((ch) => fitQuadratic(paperCells, ch));
  if (coef.some((c) => !c)) return null;
  const quad = (u, v, ch) => {
    const k = coef[ch];
    return k[0] + k[1] * u + k[2] * v + k[3] * u * u + k[4] * u * v + k[5] * v * v;
  };

  // あかるさの 地図(マスごと)
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const grid = cells.map((c) => {
    const pred = [0, 1, 2].map((ch) => quad(c.u, c.v, ch));
    const fixed = c.paper && lum(c.c) >= 0.65 * lum(pred);
    return { fixed, c: fixed ? c.c.slice() : pred };
  });
  // かみが みえないマスを、まわりから うめる
  for (let iter = 0; iter < 30; iter++) {
    for (let i = 0; i < grid.length; i++) {
      if (grid[i].fixed) continue;
      const gx = i % gw, gy = (i - gx) / gw;
      const acc = [0, 0, 0];
      let cnt = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
        const n = grid[y * gw + x].c;
        acc[0] += n[0]; acc[1] += n[1]; acc[2] += n[2];
        cnt++;
      }
      grid[i].c = acc.map((v) => v / cnt);
    }
  }
  // すこし ぼかして、マスの さかいめを めだたなくする
  const bg = new Float32Array(gw * gh * 3);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const acc = [0, 0, 0];
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = gx + dx, y = gy + dy;
          if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
          const n = grid[y * gw + x].c;
          acc[0] += n[0]; acc[1] += n[1]; acc[2] += n[2];
          cnt++;
        }
      }
      for (let ch = 0; ch < 3; ch++) bg[(gy * gw + gx) * 3 + ch] = Math.min(255, Math.max(90, acc[ch] / cnt));
    }
  }

  return (x, y, r, g, b) => {
    // マスの まんなかどうしを なめらかに つなぐ(バイリニア補間)
    const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / CELL - 0.5));
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / CELL - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const out = [r, g, b];
    for (let ch = 0; ch < 3; ch++) {
      const a = bg[(y0 * gw + x0) * 3 + ch] * (1 - tx) + bg[(y0 * gw + x1) * 3 + ch] * tx;
      const c = bg[(y1 * gw + x0) * 3 + ch] * (1 - tx) + bg[(y1 * gw + x1) * 3 + ch] * tx;
      out[ch] = clamp255(out[ch] * (255 / (a * (1 - ty) + c * ty)));
    }
    // ほぼ白で いろが うすいところは、まっ白に する(かみの ざらざらを けす)
    const mn = Math.min(out[0], out[1], out[2]), mx = Math.max(out[0], out[1], out[2]);
    if (mn > 210 && mx - mn < 22) {
      const t = Math.min(1, (mn - 210) / 30);
      for (let ch = 0; ch < 3; ch++) out[ch] += (255 - out[ch]) * t;
    }
    return out;
  };
}

/** 最小二乗法で c = a0 + a1 u + a2 v + a3 u² + a4 uv + a5 v² を もとめる */
function fitQuadratic(pts, ch) {
  const M = Array.from({ length: 6 }, () => new Array(7).fill(0));
  for (const p of pts) {
    const f = [1, p.u, p.v, p.u * p.u, p.u * p.v, p.v * p.v];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) M[i][j] += f[i] * f[j];
      M[i][6] += f[i] * p.c[ch];
    }
  }
  for (let i = 0; i < 6; i++) M[i][i] += 1e-6; // すこしだけ 安定させる
  for (let col = 0; col < 6; col++) {
    let piv = col;
    for (let r = col + 1; r < 6; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 6; r++) {
      if (r === col) continue;
      const k = M[r][col] / M[col][col];
      for (let c = col; c < 7; c++) M[r][c] -= k * M[col][c];
    }
  }
  return M.map((row, i) => row[6] / row[i]);
}

// ---- Kuwahara(積分画像で高速化)----
function kuwahara(R, G, B, w, h, r) {
  const W = w + 1;
  const size = W * (h + 1);
  const sR = new Float64Array(size), sG = new Float64Array(size), sB = new Float64Array(size);
  const sL = new Float64Array(size), sLL = new Float64Array(size);
  for (let y = 0; y < h; y++) {
    let aR = 0, aG = 0, aB = 0, aL = 0, aLL = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
      aR += R[i]; aG += G[i]; aB += B[i]; aL += l; aLL += l * l;
      const j = (y + 1) * W + x + 1, up = y * W + x + 1;
      sR[j] = sR[up] + aR; sG[j] = sG[up] + aG; sB[j] = sB[up] + aB;
      sL[j] = sL[up] + aL; sLL[j] = sLL[up] + aLL;
    }
  }

  const n = w * h;
  const oR = new Float32Array(n), oG = new Float32Array(n), oB = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity, mR = 0, mG = 0, mB = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = q & 1 ? x : Math.max(0, x - r);
        const x1 = q & 1 ? Math.min(w - 1, x + r) : x;
        const y0 = q & 2 ? y : Math.max(0, y - r);
        const y1 = q & 2 ? Math.min(h - 1, y + r) : y;
        const A = y0 * W + x0, Bi = y0 * W + x1 + 1, C = (y1 + 1) * W + x0, D = (y1 + 1) * W + x1 + 1;
        const c = (x1 - x0 + 1) * (y1 - y0 + 1);
        const mL = (sL[D] - sL[Bi] - sL[C] + sL[A]) / c;
        const v = (sLL[D] - sLL[Bi] - sLL[C] + sLL[A]) / c - mL * mL;
        if (v < best) {
          best = v;
          mR = (sR[D] - sR[Bi] - sR[C] + sR[A]) / c;
          mG = (sG[D] - sG[Bi] - sG[C] + sG[A]) / c;
          mB = (sB[D] - sB[Bi] - sB[C] + sB[A]) / c;
        }
      }
      const i = y * w + x;
      oR[i] = mR; oG[i] = mG; oB[i] = mB;
    }
  }
  return { R: oR, G: oG, B: oB };
}

// ---- ガウスぼかし(よこ → たて)----
function gauss(src, w, h, sigma) {
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(rad * 2 + 1);
  let sum = 0;
  for (let i = -rad; i <= rad; i++) { kernel[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += kernel[i + rad]; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -rad; k <= rad; k++) {
        const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
        acc += src[row + xx] * kernel[k + rad];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -rad; k <= rad; k++) {
        const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
        acc += tmp[yy * w + x] * kernel[k + rad];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

// ---- XDoG:りんかく線の こさ(0〜1)----
function xdog(L, w, h, sigma, phi) {
  const TAU = 0.98;
  const EPS = -0.01; // これより よわい へんかは 線にしない(紙の ざらざら対策)
  const g1 = gauss(L, w, h, sigma);
  const g2 = gauss(L, w, h, sigma * 1.6);
  const ink = new Float32Array(w * h);
  for (let i = 0; i < ink.length; i++) {
    const d = g1[i] - TAU * g2[i];
    ink[i] = d < EPS ? -Math.tanh(phi * (d - EPS)) : 0;
  }
  return ink;
}

// ---- k-means(おなじ絵なら いつも おなじ結果になるよう、乱数は固定)----
function kmeans(R, G, B, w, h, k) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 6000)));
  const sx = [], sy = [], sz = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = y * w + x;
      sx.push(R[i]); sy.push(G[i]); sz.push(B[i]);
    }
  }
  const m = sx.length;
  k = Math.min(k, m);
  const rand = mulberry32(12345);

  // k-means++ で はじめの中心を えらぶ
  const centers = new Float32Array(k * 3);
  let first = Math.floor(rand() * m);
  centers[0] = sx[first]; centers[1] = sy[first]; centers[2] = sz[first];
  const dist = new Float32Array(m).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < m; i++) {
      const dr = sx[i] - centers[(c - 1) * 3], dg = sy[i] - centers[(c - 1) * 3 + 1], db = sz[i] - centers[(c - 1) * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < dist[i]) dist[i] = d;
      total += dist[i];
    }
    let target = rand() * total;
    let pick = m - 1;
    for (let i = 0; i < m; i++) { target -= dist[i]; if (target <= 0) { pick = i; break; } }
    centers[c * 3] = sx[pick]; centers[c * 3 + 1] = sy[pick]; centers[c * 3 + 2] = sz[pick];
  }

  const assign = new Int32Array(m);
  for (let iter = 0; iter < 8; iter++) {
    for (let i = 0; i < m; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = sx[i] - centers[c * 3], dg = sy[i] - centers[c * 3 + 1], db = sz[i] - centers[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[i] = best;
    }
    const acc = new Float64Array(k * 4);
    for (let i = 0; i < m; i++) {
      const c = assign[i];
      acc[c * 4] += sx[i]; acc[c * 4 + 1] += sy[i]; acc[c * 4 + 2] += sz[i]; acc[c * 4 + 3]++;
    }
    for (let c = 0; c < k; c++) {
      const cnt = acc[c * 4 + 3];
      if (!cnt) continue; // からっぽの グループは まえの いろのまま
      centers[c * 3] = acc[c * 4] / cnt;
      centers[c * 3 + 1] = acc[c * 4 + 1] / cnt;
      centers[c * 3 + 2] = acc[c * 4 + 2] / cnt;
    }
  }
  return centers;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
