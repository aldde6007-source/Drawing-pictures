// IndexedDB まわり。
// 画像は Safari の古い不具合を避けるため、Blob ではなく { type, data: ArrayBuffer } で保存する。

const DB_NAME = 'chara-zukan';
const DB_VERSION = 1;
const CHARAS = 'characters';
const DRAFTS = 'drafts';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHARAS)) db.createObjectStore(CHARAS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // 別のタブで新しい版が開かれたら、こちらは閉じて道をゆずる
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('abort'));
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- Blob <-> 保存用 ----
export async function packBlob(blob) {
  if (!blob) return null;
  return { type: blob.type || 'image/jpeg', data: await blob.arrayBuffer() };
}

export function unpackBlob(packed) {
  if (!packed) return null;
  return new Blob([packed.data], { type: packed.type });
}

// ---- キャラ ----
export async function getAllCharacters() {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readonly');
  const list = await result(tx.objectStore(CHARAS).getAll());
  // あたらしい じゅん
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function getCharacter(id) {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readonly');
  return result(tx.objectStore(CHARAS).get(id));
}

export async function putCharacter(chara) {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readwrite');
  tx.objectStore(CHARAS).put(chara);
  await done(tx);
}

export async function deleteCharacter(id) {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readwrite');
  tx.objectStore(CHARAS).delete(id);
  await done(tx);
}

/** ぜんぶ消して、list にいれかえる(1つのトランザクションで行うので、とちゅうで失敗したら元のまま) */
export async function replaceAllCharacters(list) {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readwrite');
  const store = tx.objectStore(CHARAS);
  store.clear();
  for (const c of list) store.put(c);
  await done(tx);
}

// ---- 下書き ----
export async function getDraft(key) {
  const db = await open();
  const tx = db.transaction(DRAFTS, 'readonly');
  return result(tx.objectStore(DRAFTS).get(key));
}

export async function putDraft(draft) {
  const db = await open();
  const tx = db.transaction(DRAFTS, 'readwrite');
  tx.objectStore(DRAFTS).put(draft);
  await done(tx);
}

export async function deleteDraft(key) {
  const db = await open();
  const tx = db.transaction(DRAFTS, 'readwrite');
  tx.objectStore(DRAFTS).delete(key);
  await done(tx);
}

export function newId() {
  if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
  // http(LAN)で開いたときなど randomUUID が使えない場合
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
