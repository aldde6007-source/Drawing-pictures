// バックアップ(JSON 1ファイル。画像は Base64 の data URL)

import { newId } from './db.js';

const APP = 'chara-zukan';
const FORMAT = 1;
export const TEXT_FIELDS = ['name', 'age', 'personality', 'likes', 'dislikes', 'secret', 'catchphrase'];

// ---- かきだし ----
function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function packedToDataUrl(packed) {
  if (!packed) return null;
  return `data:${packed.type};base64,${bufferToBase64(packed.data)}`;
}

/** キャラの配列から、バックアップ用の File をつくる */
export function buildBackupFile(characters) {
  const data = {
    app: APP,
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    characters: characters.map((c) => ({
      id: c.id,
      ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, c[k] || ''])),
      crop: c.crop || null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      image: packedToDataUrl(c.image),
      original: packedToDataUrl(c.original),
    })),
  };
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const name = `chara-zukan-${ymd}.json`;
  return new File([JSON.stringify(data)], name, { type: 'application/json' });
}

// ---- よみこみ ----
function dataUrlToPacked(url) {
  if (typeof url !== 'string') return null;
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]*)$/i.exec(url);
  if (!m) return null;
  const bin = atob(m[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1].toLowerCase(), data: bytes.buffer };
}

function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * バックアップファイルを読んで、保存できる形のキャラ配列にする。
 * このアプリのファイルでなければ Error('not-backup') をなげる。
 */
export async function parseBackupFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('not-backup');
  }
  if (!data || data.app !== APP || !Array.isArray(data.characters)) throw new Error('not-backup');

  const now = Date.now();
  const seen = new Set();
  return data.characters
    .filter((c) => c && typeof c === 'object')
    .map((c, i) => {
      let id = typeof c.id === 'string' && c.id ? c.id : newId();
      if (seen.has(id)) id = newId();
      seen.add(id);
      const chara = { id };
      for (const k of TEXT_FIELDS) chara[k] = typeof c[k] === 'string' ? c[k] : (c[k] == null ? '' : String(c[k]));
      chara.age = chara.age.replace(/[^0-9]/g, '');
      const crop = c.crop;
      chara.crop = crop && [crop.cx, crop.cy, crop.d].every((v) => typeof v === 'number' && Number.isFinite(v))
        ? { cx: crop.cx, cy: crop.cy, d: crop.d }
        : null;
      chara.createdAt = num(c.createdAt, now - i);
      chara.updatedAt = num(c.updatedAt, chara.createdAt);
      chara.image = dataUrlToPacked(c.image);
      chara.original = dataUrlToPacked(c.original);
      return chara;
    });
}
