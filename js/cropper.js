// まるい きりぬき(Canvas で自作)。
// きりぬき位置は「元画像の座標での 円の中心(cx, cy)と 直径(d)」で表す。
// 画面の大きさに左右されないので、あとで「きりぬきをなおす」ときに そのまま再現できる。

import { canvasToBlob } from './image.js';

const OUTPUT_SIZE = 800;     // できあがりの正方形の大きさ(px)
const CIRCLE_RATIO = 0.44;   // キャンバスの はば に対する 円の半径
const SLIDER_MAX = 1000;

export class Cropper {
  constructor() {
    this.overlay = document.getElementById('cropper');
    this.canvas = document.getElementById('crop-canvas');
    this.slider = document.getElementById('crop-zoom');
    this.ctx = this.canvas.getContext('2d');
    this.pointers = new Map();
    this.resolve = null;
    this.raf = 0;

    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.canvas.addEventListener(t, (e) => this.pointers.delete(e.pointerId));
    }
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.slider.addEventListener('input', () => {
      const p = this.center();
      this.zoomTo(this.sliderToD(Number(this.slider.value)), p, p);
    });
    document.getElementById('crop-ok').addEventListener('click', () => this.finish(true));
    document.getElementById('crop-cancel').addEventListener('click', () => this.finish(false));
    window.addEventListener('resize', () => { if (this.img) this.measure(); });
  }

  get isOpen() { return !this.overlay.hidden; }

  /**
   * きりぬき画面をひらく。
   * @returns {Promise<{crop:{cx,cy,d}, blob:Blob} | null>} やめたときは null
   */
  open(img, crop) {
    this.close();
    this.img = img;
    this.w = img.naturalWidth || img.width;
    this.h = img.naturalHeight || img.height;
    this.dMin = Math.min(this.w, this.h) / 8;
    this.dMax = Math.max(this.w, this.h) * 1.2;
    if (crop && crop.d > 0) {
      this.cx = crop.cx; this.cy = crop.cy; this.d = this.clampD(crop.d);
    } else {
      this.cx = this.w / 2; this.cy = this.h / 2; this.d = Math.min(this.w, this.h) * 0.9;
    }
    this.clampCenter();
    this.overlay.hidden = false;
    document.body.classList.add('no-scroll');
    this.measure();
    return new Promise((res) => { this.resolve = res; });
  }

  /** 外から(ページ移動など)で とじるとき */
  close() {
    if (this.resolve) this.finish(false);
  }

  async finish(ok) {
    const res = this.resolve;
    this.resolve = null;
    let value = null;
    if (ok && this.img) {
      const crop = { cx: this.cx, cy: this.cy, d: this.d };
      value = { crop, blob: await renderCrop(this.img, crop) };
    }
    this.overlay.hidden = true;
    document.body.classList.remove('no-scroll');
    this.pointers.clear();
    this.img = null;
    if (res) res(value);
  }

  // ---- 大きさ・座標 ----
  measure() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.size = Math.max(1, Math.round(rect.width * dpr));
    this.cssToCanvas = this.size / Math.max(1, rect.width);
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.syncSlider();
    this.draw();
  }

  center() { return { x: this.size / 2, y: this.size / 2 }; }
  radius() { return this.size * CIRCLE_RATIO; }
  scale() { return (2 * this.radius()) / this.d; }

  clampD(d) { return Math.min(this.dMax, Math.max(this.dMin, d)); }

  clampCenter() {
    this.cx = Math.min(this.w, Math.max(0, this.cx));
    this.cy = Math.min(this.h, Math.max(0, this.cy));
  }

  sliderToD(v) {
    return this.dMax * Math.pow(this.dMin / this.dMax, v / SLIDER_MAX);
  }

  syncSlider() {
    const v = (Math.log(this.d / this.dMax) / Math.log(this.dMin / this.dMax)) * SLIDER_MAX;
    this.slider.value = String(Math.round(v));
  }

  /** p0(キャンバス座標)にあった点が、ズーム後に p1 にくるように 大きさを変える */
  zoomTo(newD, p0, p1) {
    const c = this.center();
    const s0 = this.scale();
    const sx = this.cx + (p0.x - c.x) / s0;
    const sy = this.cy + (p0.y - c.y) / s0;
    this.d = this.clampD(newD);
    const s1 = this.scale();
    this.cx = sx - (p1.x - c.x) / s1;
    this.cy = sy - (p1.y - c.y) / s1;
    this.clampCenter();
    this.syncSlider();
    this.requestDraw();
  }

  toCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * this.cssToCanvas, y: (e.clientY - rect.top) * this.cssToCanvas };
  }

  // ---- ゆび / マウス ----
  onDown(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.toCanvas(e));
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    const before = [...this.pointers.values()];
    this.pointers.set(e.pointerId, this.toCanvas(e));
    const after = [...this.pointers.values()];

    if (after.length === 1) {
      // 1本ゆび:うごかす
      const s = this.scale();
      this.cx -= (after[0].x - before[0].x) / s;
      this.cy -= (after[0].y - before[0].y) / s;
      this.clampCenter();
      this.requestDraw();
    } else if (after.length >= 2) {
      // 2本ゆび:ピンチで 大きく/小さく(+ うごかす)
      const m0 = mid(before[0], before[1]);
      const m1 = mid(after[0], after[1]);
      const d0 = dist(before[0], before[1]);
      const d1 = dist(after[0], after[1]);
      if (d0 > 0 && d1 > 0) this.zoomTo(this.d * (d0 / d1), m0, m1);
    }
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.toCanvas(e);
    this.zoomTo(this.d * Math.exp(e.deltaY * 0.0015), p, p);
  }

  // ---- えがく ----
  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    if (!this.img) return;
    const { ctx, size } = this;
    const c = this.center();
    const r = this.radius();
    const s = this.scale();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#3d2f42';
    ctx.fillRect(0, 0, size, size);

    // まるの中は白(できあがりと同じ)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, c.x - this.cx * s, c.y - this.cy * s, this.w * s, this.h * s);

    // まるの外を うすぐらく
    ctx.fillStyle = 'rgba(61, 47, 66, 0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');

    // まるの ふち
    ctx.lineWidth = Math.max(3, size * 0.012);
    ctx.strokeStyle = '#ff8fb8';
    ctx.setLineDash([size * 0.03, size * 0.02]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** 元画像と きりぬき位置から、正方形の JPEG をつくる(まるの外は白) */
export async function renderCrop(img, crop) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const out = document.createElement('canvas');
  out.width = OUTPUT_SIZE;
  out.height = OUTPUT_SIZE;
  const ctx = out.getContext('2d');
  const s = OUTPUT_SIZE / crop.d;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, OUTPUT_SIZE / 2 - crop.cx * s, OUTPUT_SIZE / 2 - crop.cy * s, w * s, h * s);
  const blob = await canvasToBlob(out);
  out.width = 0;
  out.height = 0;
  return blob;
}

function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
