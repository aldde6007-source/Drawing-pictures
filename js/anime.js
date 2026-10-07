// 「うごかして あそぶ」がめん。
// ずかんの えを 1まい つかって、アプリが ぴょんぴょん・てくてく などの うごきを つける。
//
// シーン(はいけい・キャラの ばしょ・うごき・ふきだし)は 下書きストアに 1つだけ ほぞんする。
// ぶたいは 論理座標 W×H(4:3)で かき、画面の 大きさに あわせて のばす。

import * as db from './db.js';
import { loadImage } from './image.js';
import { makeSprite, makePlaceholderSprite } from './cutout.js';
import { BACKGROUNDS, paintBackground } from './scenery.js';

const W = 800;
const H = 600;
const SCENE_KEY = 'anime';
const MAX_ACTORS = 4;
const SAVE_DELAY = 400;
const SAY_MAX = 30;
const TAU = Math.PI * 2;

const MOTIONS = ['jump', 'walk', 'float', 'shake', 'spin', 'stretch', 'dance', 'heart', 'stop'];
const START_MOTIONS = ['jump', 'float', 'dance', 'shake'];
const SPOTS = [[0.5, 0.6], [0.24, 0.62], [0.76, 0.62], [0.5, 0.38]];

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

// =====================================================================
// うごき:じかん t(びょう)と 大きさ S から、ずらし・かいてん・のびちぢみ を きめる
// =====================================================================
const STILL = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, face: 1 };
const P = (o) => ({ ...STILL, ...o });

function pose(motion, t, S) {
  switch (motion) {
    case 'jump': { // ぴょんぴょん(ちゃくちで ちょっと つぶれる)
      const s = Math.abs(Math.sin((Math.PI * t) / 0.8));
      const q = Math.pow(1 - s, 6) * 0.14;
      return P({ dy: -s * S * 0.28, sx: 1 + q, sy: 1 - q });
    }
    case 'walk': { // てくてく(左右に いったり きたり)
      const u = (((t / 5) % 1) + 1) % 1;
      const tri = u < 0.5 ? 4 * u - 1 : 3 - 4 * u;
      const step = Math.sin(TAU * t * 2.2);
      return P({ dx: tri * W * 0.28, dy: -Math.abs(step) * S * 0.06, rot: step * 0.07, face: u < 0.5 ? 1 : -1 });
    }
    case 'float': // ふわふわ
      return P({ dy: Math.sin((TAU * t) / 2.4) * S * 0.08 - S * 0.06, rot: Math.sin((TAU * t) / 3.1) * 0.06 });
    case 'shake': // ぷるぷる
      return P({ dx: Math.sin(TAU * t * 9) * S * 0.02, rot: Math.sin(TAU * t * 6) * 0.07 });
    case 'spin': // くるくる
      return P({ rot: (TAU * t) / 1.4 });
    case 'stretch': { // のびのび
      const v = Math.sin((TAU * t) / 1.1);
      return P({ sx: 1 - 0.1 * v, sy: 1 + 0.16 * v });
    }
    case 'dance': { // のりのり
      const v = Math.sin((TAU * t) / 0.9);
      return P({ dx: v * S * 0.12, dy: -Math.abs(Math.cos((TAU * t) / 0.9)) * S * 0.08, rot: v * 0.2 });
    }
    case 'heart': { // どきどき(とくん、とくん)
      const p = (t % 0.9) / 0.9;
      const b = Math.exp(-(((p - 0.1) / 0.05) ** 2)) * 0.12 + Math.exp(-(((p - 0.3) / 0.05) ** 2)) * 0.08;
      return P({ sx: 1 + b, sy: 1 + b });
    }
    default:
      return STILL;
  }
}

// =====================================================================
// ふきだし
// =====================================================================
function wrapText(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const ch of Array.from(text)) {
    if (line && ctx.measureText(line + ch).width > maxW) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBubble(ctx, text, x, anchorY, font) {
  ctx.font = `bold 28px ${font}`;
  const lines = wrapText(ctx, text, 300).slice(0, 3);
  const lh = 36;
  const padX = 18;
  const padY = 12;
  const tail = 18;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const bw = tw + padX * 2;
  const bh = lines.length * lh + padY * 2;
  const bx = clamp(x - bw / 2, 8, W - bw - 8);
  const by = Math.max(8, anchorY - tail - bh);
  const tx = clamp(x, bx + 26, bx + bw - 26);

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#5a4660';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  roundRectPath(ctx, bx, by, bw, bh, 22);
  ctx.fill();
  ctx.stroke();
  // しっぽ(つなぎめの 線が みえないように、さきに ぬってから ふちを かく)
  ctx.beginPath();
  ctx.moveTo(tx - 12, by + bh - 2);
  ctx.lineTo(tx, by + bh + tail);
  ctx.lineTo(tx + 12, by + bh - 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tx - 12, by + bh);
  ctx.lineTo(tx, by + bh + tail);
  ctx.lineTo(tx + 12, by + bh);
  ctx.stroke();

  ctx.fillStyle = '#5a4660';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, bx + bw / 2, by + padY + lh * i + lh / 2));
}

// =====================================================================
// シーンの よみこみ(こわれた データでも うごくように ととのえる)
// =====================================================================
function normalizeScene(raw) {
  const bg = raw && BACKGROUNDS.includes(raw.bg) ? raw.bg : 'sky';
  const list = raw && Array.isArray(raw.actors) ? raw.actors : [];
  const actors = list
    .filter((a) => a && typeof a.id === 'string')
    .slice(0, MAX_ACTORS)
    .map((a) => makeActor({
      id: a.id,
      x: clamp(num(a.x, 0.5), 0.04, 0.96),
      y: clamp(num(a.y, 0.6), 0.1, 0.95),
      size: clamp(num(a.size, 0.42), 0.2, 0.8),
      motion: MOTIONS.includes(a.motion) ? a.motion : 'jump',
      flip: !!a.flip,
      say: typeof a.say === 'string' ? a.say.slice(0, SAY_MAX) : '',
    }));
  return { bg, actors };
}

/** t はキャラごとの とけい(ずらして はじめると、みんなが そろって うごかない) */
function makeActor(fields) {
  return { ...fields, t: Math.random() * 10, dragging: false, hit: null };
}

function release(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

// =====================================================================
// がめん
// =====================================================================
export class Anime {
  constructor({ toast }) {
    this.toast = toast;
    this.canvas = $('stage');
    this.ctx = this.canvas.getContext('2d');
    this.bgCanvas = document.createElement('canvas');
    this.playBtn = $('anime-play');
    this.sayInput = $('actor-say');
    this.sizeInput = $('actor-size');

    this.active = false;
    this.gen = 0;
    this.scene = null;
    this.charas = new Map();
    this.sprites = new Map();
    this.selected = null;
    this.playing = true;
    this.raf = 0;
    this.last = 0;
    this.drag = null;
    this.k = 1;
    this.dirty = false;
    this.saveTimer = 0;
    this.writing = Promise.resolve();
    this.pickerUrls = [];
    this.font = getComputedStyle(document.body).fontFamily;

    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.canvas.addEventListener(t, (e) => this.onUp(e));
    }
    window.addEventListener('resize', () => { if (this.active) this.measure(); });

    this.playBtn.addEventListener('click', () => {
      this.playing = !this.playing;
      this.syncPlay();
    });
    for (const b of $('bg-chips').querySelectorAll('[data-bg]')) {
      b.addEventListener('click', () => {
        if (!this.scene) return;
        this.scene.bg = b.dataset.bg;
        this.paintBg();
        this.syncPanel();
        this.scheduleSave();
      });
    }
    for (const b of $('motion-chips').querySelectorAll('[data-motion]')) {
      b.addEventListener('click', () => this.editSelected((a) => { a.motion = b.dataset.motion; }));
    }
    this.sizeInput.addEventListener('input', () => {
      this.editSelected((a) => { a.size = clamp(Number(this.sizeInput.value) / 100, 0.2, 0.8); });
    });
    this.sayInput.addEventListener('input', () => {
      this.editSelected((a) => { a.say = this.sayInput.value.slice(0, SAY_MAX); });
    });
    $('actor-flip').addEventListener('click', () => this.editSelected((a) => { a.flip = !a.flip; }));
    $('actor-remove').addEventListener('click', () => {
      const a = this.selected;
      if (!a || !this.scene) return;
      this.scene.actors = this.scene.actors.filter((x) => x !== a);
      this.selected = null;
      this.syncPanel();
      this.scheduleSave();
    });
    $('actor-add').addEventListener('click', () => this.openPicker());
    $('picker-cancel').addEventListener('click', () => this.closePicker());
    $('picker').addEventListener('click', (e) => { if (e.target === e.currentTarget) this.closePicker(); });
  }

  get pickerOpen() { return !$('picker').hidden; }

  /**
   * がめんに はいる。addId があれば、そのキャラを ぶたいに よぶ。
   * isCurrent() が false になったら(とちゅうで べつの がめんに いったら)なにもしない。
   */
  async enter(addId, isCurrent) {
    const [saved, list] = await Promise.all([db.getDraft(SCENE_KEY), db.getAllCharacters()]);
    if (!isCurrent()) return;
    if (!list.length) {
      this.toast('まだ キャラが いないよ。さきに とうろくしてね');
      location.replace('#/');
      return;
    }
    this.charas = new Map(list.map((c) => [c.id, c]));
    const scene = normalizeScene(saved);
    scene.actors = scene.actors.filter((a) => this.charas.has(a.id));
    this.scene = scene;
    this.selected = null;
    this.playing = true;
    this.active = true;
    for (const a of scene.actors) this.loadSprite(a.id);

    if (addId && this.charas.has(addId)) {
      if (!scene.actors.some((a) => a.id === addId)) {
        if (scene.actors.length < MAX_ACTORS) this.addActor(addId);
        else this.toast(`いっしょに あそべるのは ${MAX_ACTORS} にんまでだよ`);
      }
      // よみなおしたときに また よばないように(もどる ボタンの いきさきは そのまま)
      history.replaceState(null, '', '#/anime');
    }

    this.measure();
    this.syncPanel();
    this.syncPlay();
    this.start();
    if (!scene.actors.length) this.openPicker();
  }

  /** がめんを はなれる:シーンを ほぞんして、えを かたづける */
  leave() {
    if (!this.active) return Promise.resolve();
    this.closePicker();
    const saving = this.saveNow();
    this.active = false;
    this.gen++;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.drag = null;
    for (const s of this.sprites.values()) if (s) release(s.canvas);
    this.sprites.clear();
    release(this.bgCanvas);
    this.scene = null;
    this.selected = null;
    return saving;
  }

  // ---- ほぞん ----
  scheduleSave() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DELAY);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    if (!this.scene || !this.dirty) return this.writing;
    this.dirty = false;
    const data = {
      key: SCENE_KEY,
      bg: this.scene.bg,
      actors: this.scene.actors.map(({ id, x, y, size, motion, flip, say }) => ({ id, x, y, size, motion, flip, say })),
      savedAt: Date.now(),
    };
    this.writing = this.writing
      .then(() => db.putDraft(data))
      .catch((err) => console.warn('scene', err));
    return this.writing;
  }

  // ---- キャラ ----
  addActor(id) {
    const n = this.scene.actors.length;
    const c = this.charas.get(id);
    const [x, y] = SPOTS[n % SPOTS.length];
    const a = makeActor({
      id,
      x,
      y,
      size: 0.42,
      motion: START_MOTIONS[n % START_MOTIONS.length],
      flip: false,
      say: ((c && c.catchphrase) || '').slice(0, SAY_MAX),
    });
    this.scene.actors.push(a);
    this.selected = a;
    this.loadSprite(id);
    this.scheduleSave();
    return a;
  }

  async loadSprite(id) {
    if (this.sprites.has(id)) return;
    const gen = this.gen;
    this.sprites.set(id, null);
    const c = this.charas.get(id);
    let sprite;
    try {
      const blob = c && db.unpackBlob(c.image);
      sprite = blob ? makeSprite(await loadImage(blob)) : makePlaceholderSprite();
    } catch (err) {
      console.warn('sprite', err);
      sprite = makePlaceholderSprite();
    }
    if (gen !== this.gen) {
      release(sprite.canvas);
      return;
    }
    this.sprites.set(id, sprite);
  }

  editSelected(fn) {
    if (!this.selected) return;
    fn(this.selected);
    this.syncPanel();
    this.scheduleSave();
  }

  select(a) {
    this.selected = a;
    this.syncPanel();
  }

  // ---- パネルの ひょうじ ----
  syncPanel() {
    const s = this.scene;
    if (!s) return;
    const a = this.selected;
    for (const b of $('bg-chips').querySelectorAll('[data-bg]')) {
      b.setAttribute('aria-pressed', String(b.dataset.bg === s.bg));
    }
    $('actor-add').disabled = s.actors.length >= MAX_ACTORS;
    $('stage-help').textContent = !s.actors.length
      ? '「＋ なかまを よぶ」で キャラを よんでね'
      : a ? 'ゆびで うごかすと、ばしょを かえられるよ'
        : 'キャラを タップすると、うごきを えらべるよ';
    $('actor-panel').hidden = !a;
    if (!a) return;
    const c = this.charas.get(a.id);
    $('actor-title').textContent = `${(c && c.name) || 'なまえなし'} の うごき`;
    for (const b of $('motion-chips').querySelectorAll('[data-motion]')) {
      b.setAttribute('aria-pressed', String(b.dataset.motion === a.motion));
    }
    this.sizeInput.value = String(Math.round(a.size * 100));
    // にゅうりょく中に かきかえると、にほんごの へんかんが きれてしまう
    if (document.activeElement !== this.sayInput) this.sayInput.value = a.say;
  }

  syncPlay() {
    this.playBtn.textContent = this.playing ? '⏸' : '▶';
    this.playBtn.setAttribute('aria-label', this.playing ? 'とめる' : 'うごかす');
  }

  // ---- ゆび / マウス ----
  toStage(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  onDown(e) {
    if (!this.scene || this.drag) return;
    const p = this.toStage(e);
    const actors = this.scene.actors;
    let hit = null;
    for (let i = actors.length - 1; i >= 0; i--) {
      const h = actors[i].hit;
      if (h && Math.hypot(p.x - h.x, p.y - h.y) <= h.r) { hit = actors[i]; break; }
    }
    if (!hit) {
      this.select(null);
      return;
    }
    e.preventDefault();
    // タップした キャラを いちばん まえに
    actors.splice(actors.indexOf(hit), 1);
    actors.push(hit);
    hit.dragging = true;
    this.select(hit);
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, actor: hit, x: p.x, y: p.y, moved: false };
  }

  onMove(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    const p = this.toStage(e);
    d.actor.x = clamp(d.actor.x + (p.x - d.x) / W, 0.04, 0.96);
    d.actor.y = clamp(d.actor.y + (p.y - d.y) / H, 0.1, 0.95);
    d.x = p.x;
    d.y = p.y;
    d.moved = true;
  }

  onUp(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    d.actor.dragging = false;
    this.drag = null;
    if (d.moved) this.scheduleSave();
  }

  // ---- えがく ----
  measure() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round((w * H) / W);
    this.canvas.width = w;
    this.canvas.height = h;
    this.k = w / W;
    this.paintBg();
  }

  paintBg() {
    if (!this.scene || !this.canvas.width) return;
    const c = this.bgCanvas;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext('2d');
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
    paintBackground(ctx, this.scene.bg, W, H);
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now) => {
      if (!this.active) { this.raf = 0; return; }
      this.raf = requestAnimationFrame(tick);
      const dt = clamp((now - this.last) / 1000, 0, 0.1);
      this.last = now;
      if (this.playing) {
        for (const a of this.scene.actors) if (!a.dragging) a.t += dt;
      }
      this.draw();
    };
    this.raf = requestAnimationFrame(tick);
  }

  draw() {
    const { ctx, k } = this;
    if (!this.canvas.width) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bgCanvas.width) ctx.drawImage(this.bgCanvas, 0, 0);
    else ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);

    const bubbles = [];
    for (const a of this.scene.actors) {
      const spr = this.sprites.get(a.id);
      const S = a.size * H;
      const p = pose(a.motion, a.t, S);
      const cx = a.x * W + p.dx;
      const cy = a.y * H + p.dy;
      const top = spr ? spr.top : 0.1;
      const footY = ((spr ? spr.bottom : 0.9) - 0.5) * S;

      // かげ(とびあがると 小さくなる)
      const shrink = 1 - clamp(-p.dy / (S * 0.3), 0, 1) * 0.45;
      ctx.fillStyle = 'rgba(60, 40, 70, 0.16)';
      ctx.beginPath();
      ctx.ellipse(a.x * W + p.dx, a.y * H + footY, S * 0.24 * shrink, S * 0.045 * shrink, 0, 0, TAU);
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(p.rot);
      // のびちぢみは あしもとを きじゅんに
      ctx.translate(0, footY);
      ctx.scale(p.sx * (a.flip !== (p.face < 0) ? -1 : 1), p.sy);
      ctx.translate(0, -footY);
      if (spr) {
        ctx.drawImage(spr.canvas, -S / 2, -S / 2, S, S);
      } else {
        ctx.fillStyle = 'rgba(239, 232, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(0, 0, S * 0.4, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      a.hit = { x: cx, y: cy, r: S * 0.42 };
      if (a.say) bubbles.push([a.say, cx, cy + (top - 0.5) * S]);
    }

    const sel = this.selected;
    if (sel && sel.hit) {
      ctx.strokeStyle = '#ff8fb8';
      ctx.lineWidth = 5;
      ctx.setLineDash([16, 10]);
      ctx.beginPath();
      ctx.arc(sel.hit.x, sel.hit.y, sel.hit.r + 6, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const [text, x, y] of bubbles) drawBubble(ctx, text, x, y, this.font);
  }

  // ---- なかまを よぶ ----
  openPicker() {
    if (!this.scene) return;
    if (this.scene.actors.length >= MAX_ACTORS) {
      this.toast(`いっしょに あそべるのは ${MAX_ACTORS} にんまでだよ`);
      return;
    }
    const ul = $('picker-list');
    ul.textContent = '';
    this.revokePicker();
    for (const c of this.charas.values()) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'picker-item';
      const photo = document.createElement('div');
      photo.className = 'card-photo';
      const blob = db.unpackBlob(c.image);
      if (blob) {
        const url = URL.createObjectURL(blob);
        this.pickerUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        photo.append(img);
      } else {
        photo.textContent = '🖍';
      }
      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = c.name || 'なまえなし';
      b.append(photo, name);
      b.addEventListener('click', () => {
        this.closePicker();
        if (!this.scene || this.scene.actors.length >= MAX_ACTORS) return;
        this.addActor(c.id);
        this.syncPanel();
      });
      li.append(b);
      ul.append(li);
    }
    $('picker').hidden = false;
    document.body.classList.add('no-scroll');
    $('picker-cancel').focus();
  }

  closePicker() {
    if (!this.pickerOpen) return;
    $('picker').hidden = true;
    document.body.classList.remove('no-scroll');
    $('picker-list').textContent = '';
    this.revokePicker();
  }

  revokePicker() {
    for (const u of this.pickerUrls) URL.revokeObjectURL(u);
    this.pickerUrls = [];
  }
}
