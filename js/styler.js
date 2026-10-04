// 「えの かんじを えらぶ」がめん。
// きりぬいた キャンバスを うけとり、「そのまま」か「まんがふう(つよさ 1〜3)」を えらんでもらう。
// まんがふうの計算は Web Worker(manga-worker.js)で行う。

import { canvasToBlob } from './image.js';

export const DEFAULT_STYLE = { type: 'manga', level: 2 };

let worker = null;
let jobSeq = 0;
const jobs = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./manga-worker.js', import.meta.url));
  worker.onmessage = (e) => {
    const job = jobs.get(e.data.id);
    if (!job) return;
    jobs.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else job.resolve(e.data.buffer);
  };
  worker.onerror = (e) => {
    for (const job of jobs.values()) job.reject(e.error || new Error('worker'));
    jobs.clear();
    worker.terminate();
    worker = null;
  };
  return worker;
}

/** ImageData に まんがふうフィルターを かけて、あたらしい ImageData を かえす */
export function mangaFilter(imageData, level) {
  const id = ++jobSeq;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    jobs.set(id, {
      resolve: (buffer) => resolve(new ImageData(new Uint8ClampedArray(buffer), imageData.width, imageData.height)),
      reject,
    });
    // もとの ImageData は「よわい/ふつう/つよい」を えらびなおすときに また使うので、コピーして おくる
    w.postMessage({ id, width: imageData.width, height: imageData.height, buffer: imageData.data.buffer.slice(0), level });
  });
}

export function normalizeStyle(style) {
  if (style && style.type === 'none') return { type: 'none' };
  if (style && style.type === 'manga' && [1, 2, 3].includes(style.level)) return { type: 'manga', level: style.level };
  return null;
}

export class Styler {
  constructor() {
    this.overlay = document.getElementById('styler');
    this.canvas = document.getElementById('style-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.spinner = document.getElementById('style-spinner');
    this.okBtn = document.getElementById('style-ok');
    this.levels = document.getElementById('style-levels');
    this.resolve = null;
    this.seq = 0;

    for (const b of this.overlay.querySelectorAll('[data-type]')) {
      b.addEventListener('click', () => {
        const type = b.dataset.type;
        this.select(type === 'none' ? { type } : { type, level: this.lastLevel });
      });
    }
    for (const b of this.overlay.querySelectorAll('[data-level]')) {
      b.addEventListener('click', () => this.select({ type: 'manga', level: Number(b.dataset.level) }));
    }
    document.getElementById('style-back').addEventListener('click', () => this.finish('back'));
    this.okBtn.addEventListener('click', () => this.finish('ok'));
  }

  get isOpen() { return !this.overlay.hidden; }

  /**
   * @param {HTMLCanvasElement} source きりぬいた正方形
   * @returns {Promise<{action:'ok', style, blob} | {action:'back', style} | null>}
   */
  open(source, style) {
    this.close();
    this.source = source.getContext('2d').getImageData(0, 0, source.width, source.height);
    this.cache = new Map();
    this.canvas.width = source.width;
    this.canvas.height = source.height;
    const s = normalizeStyle(style) || DEFAULT_STYLE;
    this.lastLevel = s.level || DEFAULT_STYLE.level;
    this.overlay.hidden = false;
    document.body.classList.add('no-scroll');
    this.select(s);
    return new Promise((res) => { this.resolve = res; });
  }

  close() {
    if (this.resolve) this.finish(null);
  }

  async select(style) {
    this.style = style;
    if (style.level) this.lastLevel = style.level;
    for (const b of this.overlay.querySelectorAll('[data-type]')) {
      b.setAttribute('aria-pressed', String(b.dataset.type === style.type));
    }
    for (const b of this.overlay.querySelectorAll('[data-level]')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.level) === style.level));
    }
    this.levels.hidden = style.type !== 'manga';

    const seq = ++this.seq;
    if (style.type === 'none') {
      this.show(this.source, seq);
      return;
    }
    const key = style.level;
    if (this.cache.has(key)) {
      this.show(this.cache.get(key), seq);
      return;
    }
    this.setWorking(true);
    try {
      const result = await mangaFilter(this.source, key);
      if (!this.resolve) return;
      this.cache.set(key, result);
      this.show(result, seq);
    } catch (err) {
      console.error(err);
      if (!this.resolve || seq !== this.seq) return;
      // うまくいかなかったら「そのまま」に もどす
      this.select({ type: 'none' });
    }
  }

  show(imageData, seq) {
    if (seq !== this.seq) return; // あとから えらんだほうを 優先する
    this.ctx.putImageData(imageData, 0, 0);
    this.setWorking(false);
  }

  setWorking(on) {
    this.spinner.hidden = !on;
    this.okBtn.disabled = on;
  }

  async finish(action) {
    const res = this.resolve;
    this.resolve = null;
    let value = null;
    if (action === 'back') value = { action, style: this.style };
    if (action === 'ok') value = { action, style: this.style, blob: await canvasToBlob(this.canvas) };
    this.overlay.hidden = true;
    document.body.classList.remove('no-scroll');
    this.seq++;
    this.setWorking(false);
    this.source = null;
    this.cache = null;
    if (res) res(value);
  }
}
