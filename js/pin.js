// あいことば(すうじの ひみつ)の にゅうりょく と たしかめ。
//
// きょうだいで かってに ひらかない ための かぎ で、しっかりした セキュリティ では ない
// (きかいの データを しらべれば キャラは みられる)。
// それでも すうじは そのまま ほぞんせず、salt を まぜた ハッシュに しておく。
// LAN の http では crypto.subtle が つかえないので、JS だけで けいさんする。

import { newId } from './db.js';

const $ = (id) => document.getElementById(id);

// cyrb53(53bit の かんたんな ハッシュ)
function hash53(str, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function hashPin(pin, salt) {
  return hash53(`${salt}:${pin}`, 1).toString(36) + hash53(`${pin}:${salt}`, 2).toString(36);
}

/** ほぞん用の { salt, hash } をつくる */
export function makePin(pin) {
  const salt = newId();
  return { salt, hash: hashPin(pin, salt) };
}

export function matchPin(rec, pin) {
  return !!(rec && rec.salt && rec.hash === hashPin(pin, rec.salt));
}

/**
 * すうじボタンの がめん。
 * ask() は、いれた すうじ(やめたら null)を かえす。
 * check(pin) が true 以外を かえしたら、とじずに その ことばを だして いれなおして もらう。
 */
export class PinPad {
  constructor() {
    this.el = $('pinpad');
    this.dots = $('pin-dots');
    this.note = $('pin-note');
    this.value = '';
    this.opts = null;
    this.resolve = null;
    this.checking = false;

    for (const b of this.el.querySelectorAll('[data-key]')) {
      b.addEventListener('click', () => this.press(b.dataset.key));
    }
    $('pin-extra').addEventListener('click', () => {
      const fn = this.opts && this.opts.onExtra;
      this.close();
      if (fn) fn();
    });
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.isComposing) return;
      if (/^[0-9]$/.test(e.key)) this.press(e.key);
      else if (e.key === 'Backspace') this.press('back');
      else return;
      e.preventDefault();
    });
  }

  get isOpen() { return !this.el.hidden; }

  ask({ who = '🔒', title, sub = '', length = 4, check = null, extraLabel = '', onExtra = null }) {
    this.close();
    this.opts = { length, check, onExtra };
    this.value = '';
    $('pin-who').textContent = who;
    $('pin-title').textContent = title;
    $('pin-sub').textContent = sub;
    $('pin-sub').hidden = !sub;
    $('pin-extra').textContent = extraLabel;
    $('pin-extra').hidden = !extraLabel;
    this.note.textContent = '';
    this.drawDots();
    this.el.hidden = false;
    document.body.classList.add('no-scroll');
    if (document.activeElement) document.activeElement.blur();
    return new Promise((res) => { this.resolve = res; });
  }

  close(value = null) {
    this.el.hidden = true;
    document.body.classList.remove('no-scroll');
    const res = this.resolve;
    this.resolve = null;
    this.opts = null;
    this.value = '';
    this.checking = false;
    if (res) res(value);
  }

  press(key) {
    if (!this.opts || this.checking) return;
    if (key === 'cancel') { this.close(); return; }
    if (key === 'back') {
      this.value = this.value.slice(0, -1);
      this.drawDots();
      return;
    }
    if (this.value.length >= this.opts.length) return;
    this.value += key;
    this.note.textContent = '';
    this.drawDots();
    if (this.value.length === this.opts.length) this.submit();
  }

  async submit() {
    const opts = this.opts;
    const pin = this.value;
    this.checking = true;
    let ok = true;
    try {
      if (opts.check) ok = await opts.check(pin);
    } catch (err) {
      console.error(err);
      ok = 'うまくいかなかったみたい。もういちど ためしてね';
    }
    if (opts !== this.opts) return; // とちゅうで とじられた
    this.checking = false;
    if (ok === true) {
      this.close(pin);
      return;
    }
    this.value = '';
    this.note.textContent = typeof ok === 'string' ? ok : '';
    this.drawDots();
    this.dots.classList.remove('shake');
    void this.dots.offsetWidth; // アニメーションを はじめから
    this.dots.classList.add('shake');
  }

  drawDots() {
    const n = this.opts ? this.opts.length : 0;
    this.dots.textContent = '';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      d.className = i < this.value.length ? 'pin-dot on' : 'pin-dot';
      this.dots.append(d);
    }
    this.dots.setAttribute('aria-label', `${n} こ のうち ${this.value.length} こ いれたよ`);
  }
}
