// IndexedDB まわり。
// 画像は Safari の古い不具合を避けるため、Blob ではなく { type, data: ArrayBuffer } で保存する。
//
// キャラは ownerId で「だれの キャラか」を もつ。ひとり用だった ころ(v1)の キャラには ownerId が なく、
// さいしょに つくった ひとが ひきつぐ(createUser)。
// 下書きの キー:'new:<ひとの id>'(とうろく)/'edit:<キャラの id>'(なおす)/'anime:<ひとの id>'(うごかして あそぶ)

const DB_NAME = 'chara-zukan';
const DB_VERSION = 2;
const CHARAS = 'characters';
const DRAFTS = 'drafts';
const USERS = 'users';
const META = 'meta';
const BY_OWNER = 'ownerId';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const charas = db.objectStoreNames.contains(CHARAS)
        ? req.transaction.objectStore(CHARAS)
        : db.createObjectStore(CHARAS, { keyPath: 'id' });
      if (!charas.indexNames.contains(BY_OWNER)) charas.createIndex(BY_OWNER, 'ownerId');
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(USERS)) db.createObjectStore(USERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
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
/** ownerId の ひとの キャラ(あたらしい じゅん) */
export async function getAllCharacters(ownerId) {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readonly');
  const list = await result(tx.objectStore(CHARAS).index(BY_OWNER).getAll(ownerId));
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** みんなの キャラ(おうちの ひとの メニューで、もちぬしを かえるとき だけ つかう) */
export async function getEveryCharacter() {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readonly');
  const list = await result(tx.objectStore(CHARAS).getAll());
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** キャラの もちぬしを かえる(なおしかけの 下書きも キャラと いっしょに うつる) */
export async function moveCharacter(id, ownerId) {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readwrite');
  const store = tx.objectStore(CHARAS);
  const req = store.get(id);
  req.onsuccess = () => {
    if (req.result) store.put({ ...req.result, ownerId });
  };
  await done(tx);
}

export async function countCharacters(ownerId) {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readonly');
  return result(tx.objectStore(CHARAS).index(BY_OWNER).count(ownerId));
}

/** ひとり用だった ころの(まだ だれの ものでもない)キャラの かず */
export async function countOrphans() {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readonly');
  const store = tx.objectStore(CHARAS);
  const [all, owned] = await Promise.all([result(store.count()), result(store.index(BY_OWNER).count())]);
  return all - owned;
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

/**
 * ownerId の ひとの キャラを ぜんぶ消して、list にいれかえる。ほかの ひとの キャラは さわらない。
 * (1つのトランザクションで行うので、とちゅうで失敗したら元のまま)
 * ほかの ひとの キャラと id が かぶったら、あたらしい id にする(うわがき しないように)。
 */
export async function replaceCharactersOf(ownerId, list) {
  const db = await open();
  const tx = db.transaction(CHARAS, 'readwrite');
  const store = tx.objectStore(CHARAS);
  const allReq = store.getAllKeys();
  const mineReq = store.index(BY_OWNER).getAllKeys(ownerId);
  // リクエストは じゅんばんに おわるので、ここでは allReq も おわっている
  mineReq.onsuccess = () => {
    const mine = new Set(mineReq.result);
    const others = new Set(allReq.result.filter((k) => !mine.has(k)));
    for (const k of mine) store.delete(k);
    for (const c of list) store.put({ ...c, id: others.has(c.id) ? newId() : c.id, ownerId });
  };
  await done(tx);
}

// ---- ひと(ユーザー) ----
/** つくった じゅん */
export async function getUsers() {
  const db = await open();
  const tx = db.transaction(USERS, 'readonly');
  const list = await result(tx.objectStore(USERS).getAll());
  return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function getUser(id) {
  const db = await open();
  const tx = db.transaction(USERS, 'readonly');
  return result(tx.objectStore(USERS).get(id));
}

export async function putUser(user) {
  const db = await open();
  const tx = db.transaction(USERS, 'readwrite');
  tx.objectStore(USERS).put(user);
  await done(tx);
}

/**
 * ひとを ふやす。さいしょの ひとなら、ひとり用だった ころの キャラと 下書きを ひきつぐ。
 * ひきついだ キャラの かずを かえす。
 */
export async function createUser(user) {
  const db = await open();
  const tx = db.transaction([USERS, CHARAS, DRAFTS], 'readwrite');
  const users = tx.objectStore(USERS);
  let adopted = 0;
  const countReq = users.count();
  countReq.onsuccess = () => {
    users.put(user);
    if (countReq.result > 0) return;
    tx.objectStore(CHARAS).openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return;
      if (!cur.value.ownerId) {
        cur.update({ ...cur.value, ownerId: user.id });
        adopted++;
      }
      cur.continue();
    };
    const drafts = tx.objectStore(DRAFTS);
    for (const [from, to] of [['new', `new:${user.id}`], ['anime', `anime:${user.id}`]]) {
      drafts.get(from).onsuccess = (e) => {
        const d = e.target.result;
        if (!d) return;
        drafts.put({ ...d, key: to });
        drafts.delete(from);
      };
    }
  };
  await done(tx);
  return adopted;
}

/** ひとと、その ひとの キャラ・下書きを ぜんぶ けす */
export async function deleteUser(id) {
  const db = await open();
  const tx = db.transaction([USERS, CHARAS, DRAFTS], 'readwrite');
  const charas = tx.objectStore(CHARAS);
  const drafts = tx.objectStore(DRAFTS);
  tx.objectStore(USERS).delete(id);
  const req = charas.index(BY_OWNER).getAllKeys(id);
  req.onsuccess = () => {
    for (const k of req.result) {
      charas.delete(k);
      drafts.delete(`edit:${k}`);
    }
  };
  drafts.delete(`new:${id}`);
  drafts.delete(`anime:${id}`);
  await done(tx);
}

// ---- そのほか(おうちの ひとの あいことば など) ----
export async function getMeta(key) {
  const db = await open();
  const tx = db.transaction(META, 'readonly');
  return result(tx.objectStore(META).get(key));
}

export async function putMeta(obj) {
  const db = await open();
  const tx = db.transaction(META, 'readwrite');
  tx.objectStore(META).put(obj);
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
