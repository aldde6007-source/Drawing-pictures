import * as db from './db.js';
import { loadImage, resizeToJpeg } from './image.js';
import { Cropper, renderCropCanvas } from './cropper.js';
import { Styler, normalizeStyle } from './styler.js';
import { buildBackupFile, parseBackupFile } from './backup.js';
import { Anime } from './anime.js';
import { PinPad, makePin, matchPin } from './pin.js';

const $ = (id) => document.getElementById(id);

const FIELDS = ['name', 'age', 'personality', 'likes', 'dislikes', 'secret', 'catchphrase'];
const DETAIL_ROWS = [
  ['age', 'ねんれい'],
  ['personality', 'せいかく'],
  ['likes', 'すきなもの'],
  ['dislikes', 'にがてなもの'],
  ['secret', 'ひみつ 🤫'],
];
const DRAFT_DELAY = 400;
const ICONS = ['🐰', '🐻', '🐱', '🐶', '🦄', '🐸', '🐼', '🦊', '🐧', '🐹', '🐨', '🐯'];
const USER_PIN_LENGTH = 4;
const PARENT_PIN_LENGTH = 6;
const LOCK_AFTER = 5 * 60 * 1000; // これより ながく ほかの アプリに いたら、こうたい(ログアウト)する
const MISS_LIMIT = 5;
const MISS_WAIT = 30 * 1000;

let session = null; // ログインちゅうの ひと { id, name, icon }
let gate = 'users'; // ログインまえの がめん:users / user-new / parent / parent-move

const cropper = new Cropper();
const styler = new Styler();
const pinpad = new PinPad();
const anime = new Anime({ toast, owner: () => session && session.id });
const form = $('edit-form');

// =====================================================================
// こまったときの ことば
// =====================================================================
function friendlyError(err) {
  const name = err && err.name;
  if (name === 'QuotaExceededError') return 'きかいの ようりょうが いっぱいみたい… いらない しゃしんを けしてみてね';
  return 'うまくいかなかったみたい。もういちど ためしてね';
}

// =====================================================================
// おしらせ(トースト)・かくにん・まってね
// =====================================================================
let toastTimer = 0;
function toast(message, { actionLabel, onAction, sticky = false } = {}) {
  const el = $('toast');
  clearTimeout(toastTimer);
  el.textContent = message;
  if (actionLabel) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = actionLabel;
    b.addEventListener('click', () => { el.hidden = true; onAction(); });
    el.append(b);
  }
  el.hidden = false;
  if (!sticky) toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

let modalResolve = null;
function confirmDialog(text, { yes = 'はい', no = 'やめる', danger = false } = {}) {
  if (modalResolve) modalResolve(false);
  $('modal-text').textContent = text;
  const yesBtn = $('modal-yes');
  yesBtn.textContent = yes;
  yesBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
  // no: null なら「はい」だけの おしらせ
  $('modal-no').hidden = !no;
  $('modal-no').textContent = no || '';
  $('modal').hidden = false;
  (no ? $('modal-no') : yesBtn).focus();
  return new Promise((res) => { modalResolve = res; });
}
function closeModal(answer) {
  $('modal').hidden = true;
  const res = modalResolve;
  modalResolve = null;
  if (res) res(answer);
}
$('modal-yes').addEventListener('click', () => closeModal(true));
$('modal-no').addEventListener('click', () => closeModal(false));
$('modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(false); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('modal').hidden) closeModal(false);
  else if (pinpad.isOpen) pinpad.close();
  else if (cropper.isOpen) cropper.close();
  else if (styler.isOpen) styler.close();
  else if (anime.pickerOpen) anime.closePicker();
});

let busyCount = 0;
async function withBusy(fn) {
  busyCount++;
  $('busy').hidden = false;
  try {
    return await fn();
  } finally {
    busyCount--;
    if (busyCount === 0) $('busy').hidden = true;
  }
}

// =====================================================================
// 画像の表示用 URL(つかいおわったら かたづける)
// =====================================================================
const viewUrls = { list: [], detail: [], edit: [], move: [] };
function urlFor(view, packed) {
  const blob = db.unpackBlob(packed);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  viewUrls[view].push(url);
  return url;
}
function revokeUrls(view) {
  for (const u of viewUrls[view]) URL.revokeObjectURL(u);
  viewUrls[view] = [];
}

// =====================================================================
// がめんの きりかえ
// =====================================================================
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  if (name === 'new') return { view: 'edit', id: null };
  if (name === 'edit' && id) return { view: 'edit', id: decodeURIComponent(id) };
  if (name === 'c' && id) return { view: 'detail', id: decodeURIComponent(id) };
  if (name === 'anime') return { view: 'anime', id: id ? decodeURIComponent(id) : null };
  if (name === 'settings') return { view: 'settings' };
  return { view: 'list' };
}

function parentHash(route) {
  if (route.view === 'anime' && route.id) return `#/c/${encodeURIComponent(route.id)}`;
  if (route.view === 'edit' && route.id) return `#/c/${encodeURIComponent(route.id)}`;
  return '#/';
}

let currentRoute = null;
let renderSeq = 0;

const VIEWS = ['users', 'welcome', 'user-new', 'parent', 'parent-move', 'list', 'detail', 'edit', 'settings', 'anime'];
function showView(name) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
}

async function render() {
  cropper.close();
  styler.close();
  pinpad.close();
  if (modalResolve) closeModal(false);
  await leaveEdit();
  await anime.leave();
  revokeUrls('move');

  // ログインまえは、どの アドレスでも ログインの がめんを だす
  const route = session ? parseRoute() : { view: gate };
  currentRoute = route;
  const seq = ++renderSeq;

  showView(route.view);
  $('back-btn').classList.toggle('is-hidden', !session || route.view === 'list');
  $('settings-btn').classList.toggle('is-hidden', !session || route.view === 'settings' || route.view === 'edit');
  $('title-who').textContent = session ? `${session.name}の` : 'わたしの';
  window.scrollTo(0, 0);

  try {
    if (route.view === 'users') await renderUsers(seq);
    else if (route.view === 'user-new') enterUserNew();
    else if (route.view === 'parent') await renderParent(seq);
    else if (route.view === 'parent-move') await renderParentMove(seq);
    else if (route.view === 'list') await renderList(seq);
    else if (route.view === 'detail') await renderDetail(route.id, seq);
    else if (route.view === 'edit') await enterEdit(route.id, seq);
    else if (route.view === 'settings') await renderSettings(seq);
    else if (route.view === 'anime') await anime.enter(route.id, () => seq === renderSeq);
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
  }
}

window.addEventListener('hashchange', render);
$('back-btn').addEventListener('click', () => {
  if (currentRoute && currentRoute.view === 'edit') cancelEdit();
  else location.replace(parentHash(currentRoute || { view: 'list' }));
});

// =====================================================================
// 0. だれが つかう?(ログイン・あたらしく つくる・おうちの ひとの メニュー)
// =====================================================================
const misses = new Map(); // まちがえた かず { count, until }

/** あいことばを たしかめる。あっていたら true、ちがったら いれなおしの ことば */
function checkPin(key, rec, pin) {
  const m = misses.get(key) || { count: 0, until: 0 };
  const wait = m.until - Date.now();
  if (wait > 0) return `すこし まってから ためしてね(あと ${Math.ceil(wait / 1000)} びょう)`;
  if (matchPin(rec, pin)) {
    misses.delete(key);
    return true;
  }
  m.count++;
  if (m.count >= MISS_LIMIT) {
    m.count = 0;
    m.until = Date.now() + MISS_WAIT;
    misses.set(key, m);
    return `${MISS_WAIT / 1000} びょう まってから、もういちど ためしてね`;
  }
  misses.set(key, m);
  return 'あれれ? ちがうみたい。もういちど いれてね';
}

/** あたらしい あいことばを 2かい いれて もらう(やめたら null) */
async function askNewPin({ who, title, sub = '', length = USER_PIN_LENGTH }) {
  const first = await pinpad.ask({ who, title, sub, length });
  if (!first) return null;
  return pinpad.ask({
    who,
    title: 'たしかめるよ。もういちど いれてね',
    length,
    check: (p) => p === first || 'さっきと ちがうみたい。もういちど いれてね',
  });
}

function startSession(user) {
  session = { id: user.id, name: user.name, icon: user.icon };
  gate = 'users';
  history.replaceState(null, '', '#/');
  render();
}

function logout() {
  if (!session) return;
  session = null;
  gate = 'users';
  history.replaceState(null, '', '#/');
  render();
}
$('logout-btn').addEventListener('click', logout);
$('settings-logout').addEventListener('click', logout);

function showGate(name) {
  gate = name;
  render();
}

async function renderUsers(seq) {
  const [users, parent] = await Promise.all([db.getUsers(), db.getMeta('parent')]);
  if (seq !== renderSeq) return;
  if (!parent) {
    // はじめて:おうちの ひとに じゅんびして もらう
    const orphans = await db.countOrphans();
    if (seq !== renderSeq) return;
    showView('welcome');
    $('welcome-orphans').hidden = !orphans;
    $('welcome-orphans').textContent =
      `いま ずかんに いる ${orphans} にんの キャラは、いったん さいしょに つくった ひとの キャラに なります。` +
      'あとで「🔑 おうちの ひとへ」→「🏠 キャラの もちぬしを かえる」から、ひとりずつ わけられます。';
    return;
  }

  const ul = $('user-list');
  ul.textContent = '';
  $('users-empty').hidden = users.length > 0;
  for (const u of users) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'user-btn';
    const icon = document.createElement('span');
    icon.className = 'user-icon';
    icon.textContent = u.icon;
    const name = document.createElement('span');
    name.textContent = u.name;
    b.append(icon, name);
    b.addEventListener('click', () => login(u));
    li.append(b);
    ul.append(li);
  }
}

async function login(user) {
  const pin = await pinpad.ask({
    who: user.icon,
    title: `${user.name} さんの あいことばを いれてね`,
    length: USER_PIN_LENGTH,
    check: (p) => checkPin(`user:${user.id}`, user.pin, p),
    extraLabel: '🤔 わすれちゃった',
    onExtra: () => confirmDialog(
      'おうちの ひとに、あいことばを つくりなおして もらってね',
      { yes: 'わかった', no: null },
    ),
  });
  if (pin) startSession(user);
}

$('user-add').addEventListener('click', () => showGate('user-new'));

$('welcome-start').addEventListener('click', async () => {
  const pin = await askNewPin({
    who: '🔑',
    title: 'おうちの ひとの あいことばを きめてください',
    sub: `すうじ ${PARENT_PIN_LENGTH} けた`,
    length: PARENT_PIN_LENGTH,
  });
  if (!pin) return;
  try {
    await withBusy(() => db.putMeta({ key: 'parent', ...makePin(pin) }));
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  toast('じゅんび できました。つぎは こどもの ばんです');
  showGate('user-new');
});

// ---- あたらしく つくる ----
const userForm = $('user-form');
let newIcon = ICONS[0];

for (const icon of ICONS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.icon = icon;
  b.textContent = icon;
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => {
    newIcon = icon;
    syncIcons();
  });
  $('icon-chips').append(b);
}

function syncIcons() {
  for (const b of $('icon-chips').children) b.setAttribute('aria-pressed', String(b.dataset.icon === newIcon));
}

function enterUserNew() {
  userForm.elements.uname.value = '';
  userForm.elements.uname.closest('.field').classList.remove('error');
  $('user-note').textContent = '';
  newIcon = ICONS[Math.floor(Math.random() * ICONS.length)];
  syncIcons();
}

userForm.elements.uname.addEventListener('input', () => {
  userForm.elements.uname.closest('.field').classList.remove('error');
  $('user-note').textContent = '';
});

userForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = userForm.elements.uname.value.trim();
  if (!name) {
    $('user-note').textContent = 'なまえを いれてね';
    userForm.elements.uname.closest('.field').classList.add('error');
    userForm.elements.uname.focus();
    return;
  }
  const icon = newIcon;
  const pin = await askNewPin({
    who: icon,
    title: 'あいことばを きめてね',
    sub: `すうじ ${USER_PIN_LENGTH} けた。じぶんだけの ひみつだよ 🤫`,
  });
  if (!pin) return;
  const user = { id: db.newId(), name, icon, pin: makePin(pin), createdAt: Date.now() };
  let adopted;
  try {
    adopted = await withBusy(() => db.createUser(user));
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  toast(adopted
    ? `ようこそ、${name} さん! いままでの キャラ ${adopted} にんも いっしょだよ`
    : `ようこそ、${name} さん! 🎉`);
  startSession(user);
});

$('user-cancel').addEventListener('click', () => showGate('users'));

// ---- おうちの ひとの メニュー ----
$('parent-open').addEventListener('click', async () => {
  let parent;
  try {
    parent = await db.getMeta('parent');
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  const pin = await pinpad.ask({
    who: '🔑',
    title: 'おうちの ひとの あいことば',
    length: PARENT_PIN_LENGTH,
    check: (p) => checkPin('parent', parent, p),
  });
  if (pin) showGate('parent');
});

async function renderParent(seq) {
  const users = await db.getUsers();
  const counts = await Promise.all(users.map((u) => db.countCharacters(u.id)));
  if (seq !== renderSeq) return;
  const ul = $('parent-users');
  ul.textContent = '';
  $('parent-empty').hidden = users.length > 0;
  users.forEach((u, i) => {
    const li = document.createElement('li');
    li.className = 'parent-user';
    const name = document.createElement('div');
    name.className = 'parent-user-name';
    name.textContent = `${u.icon} ${u.name}(キャラ ${counts[i]} にん)`;
    const row = document.createElement('div');
    row.className = 'row';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn btn-secondary';
    reset.textContent = '🔢 あいことばを つくりなおす';
    reset.addEventListener('click', () => resetUserPin(u));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-danger';
    del.textContent = '🗑 けす';
    del.addEventListener('click', () => removeUser(u, counts[i]));
    row.append(reset, del);
    li.append(name, row);
    ul.append(li);
  });
}

async function resetUserPin(user) {
  const pin = await askNewPin({ who: user.icon, title: `${user.name} さんの あたらしい あいことば` });
  if (!pin) return;
  try {
    const latest = await db.getUser(user.id);
    if (latest) await db.putUser({ ...latest, pin: makePin(pin) });
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  misses.delete(`user:${user.id}`);
  toast('あいことばを つくりなおしました');
}

async function removeUser(user, count) {
  const ok = await confirmDialog(
    `「${user.name}」さんと、その キャラ ${count} にんを ぜんぶ けしますか?\nもとに もどせません`,
    { yes: 'けす', danger: true },
  );
  if (!ok) return;
  try {
    await withBusy(() => db.deleteUser(user.id));
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  toast('けしました');
  render();
}

$('parent-pin-change').addEventListener('click', async () => {
  const pin = await askNewPin({
    who: '🔑',
    title: 'おうちの ひとの あたらしい あいことば',
    sub: `すうじ ${PARENT_PIN_LENGTH} けた`,
    length: PARENT_PIN_LENGTH,
  });
  if (!pin) return;
  try {
    await db.putMeta({ key: 'parent', ...makePin(pin) });
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  toast('おうちの ひとの あいことばを かえました');
});

$('parent-close').addEventListener('click', () => showGate('users'));

// ---- キャラの もちぬしを かえる ----
async function renderParentMove(seq) {
  const [users, list] = await Promise.all([db.getUsers(), db.getEveryCharacter()]);
  if (seq !== renderSeq) return;
  const ul = $('move-list');
  ul.textContent = '';
  $('move-empty').hidden = list.length > 0;
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  for (const c of list) {
    const li = document.createElement('li');
    li.className = 'move-item';
    const photo = document.createElement('div');
    photo.className = 'card-photo';
    const url = urlFor('move', c.image);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      photo.append(img);
    } else {
      photo.textContent = '🖍';
    }
    const name = document.createElement('div');
    name.className = 'move-name';
    name.textContent = c.name || 'なまえなし';

    const select = document.createElement('select');
    select.className = 'move-select';
    select.setAttribute('aria-label', `${c.name || 'なまえなし'} の もちぬし`);
    if (!nameOf.has(c.ownerId)) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '(だれの でもない)';
      select.append(none);
    }
    for (const u of users) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.icon} ${u.name}`;
      select.append(opt);
    }
    select.value = nameOf.has(c.ownerId) ? c.ownerId : '';
    let current = select.value;
    select.addEventListener('change', async () => {
      const to = select.value;
      if (!to) { select.value = current; return; }
      try {
        await db.moveCharacter(c.id, to);
      } catch (err) {
        console.error(err);
        select.value = current;
        toast(friendlyError(err));
        return;
      }
      current = to;
      // 「だれの でもない」は もう えらべないので けす
      select.querySelector('option[value=""]')?.remove();
      toast(`「${c.name || 'なまえなし'}」を ${nameOf.get(to)} さんの ずかんに うつしました`);
    });

    const body = document.createElement('div');
    body.className = 'move-body';
    body.append(name, select);
    li.append(photo, body);
    ul.append(li);
  }
}

$('parent-move-open').addEventListener('click', () => showGate('parent-move'));
$('parent-move-close').addEventListener('click', () => showGate('parent'));

// =====================================================================
// 1. ずかん(いちらん)
// =====================================================================
async function renderList(seq) {
  const list = await db.getAllCharacters(session.id);
  if (seq !== renderSeq) return;
  revokeUrls('list');
  $('userbar-who').textContent = `${session.icon} ${session.name} さん`;

  const cards = $('cards');
  cards.textContent = '';
  const empty = list.length === 0;
  $('empty').hidden = !empty;
  $('fab').hidden = empty;
  $('count').hidden = empty;
  $('list-anime').hidden = empty;
  $('count').textContent = `ぜんぶで ${list.length} にんの キャラが いるよ`;

  for (const c of list) {
    const li = document.createElement('li');
    li.className = 'card';
    const a = document.createElement('a');
    a.href = `#/c/${encodeURIComponent(c.id)}`;
    const photo = document.createElement('div');
    photo.className = 'card-photo';
    const url = urlFor('list', c.image);
    if (url) {
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
    a.append(photo, name);
    li.append(a);
    cards.append(li);
  }
}

// =====================================================================
// 2. しょうさい
// =====================================================================
async function renderDetail(id, seq) {
  const c = await db.getCharacter(id);
  if (seq !== renderSeq) return;
  if (!c || c.ownerId !== session.id) {
    toast('そのキャラは みつからなかったよ');
    location.replace('#/');
    return;
  }
  revokeUrls('detail');
  const img = $('detail-img');
  const url = urlFor('detail', c.image);
  if (url) img.src = url;
  else img.removeAttribute('src');

  $('detail-name').textContent = c.name || 'なまえなし';
  const catchEl = $('detail-catch');
  catchEl.hidden = !c.catchphrase;
  catchEl.textContent = c.catchphrase ? `「${c.catchphrase}」` : '';

  const dl = $('detail-list');
  dl.textContent = '';
  for (const [key, label] of DETAIL_ROWS) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-item';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    let value = c[key] || '';
    if (key === 'age' && value) value = `${value} さい`;
    if (value) dd.textContent = value;
    else { dd.textContent = 'まだ かいてないよ'; dd.className = 'blank'; }
    wrap.append(dt, dd);
    dl.append(wrap);
  }

  $('detail-edit').href = `#/edit/${encodeURIComponent(c.id)}`;
  $('detail-anime').href = `#/anime/${encodeURIComponent(c.id)}`;
  $('detail-delete').onclick = async () => {
    const ok = await confirmDialog(`ほんとうに けす?\n「${c.name || 'なまえなし'}」は もとに もどせないよ`, { yes: 'けす', danger: true });
    if (!ok) return;
    try {
      await db.deleteCharacter(c.id);
      await db.deleteDraft(`edit:${c.id}`);
      toast('けしたよ');
      location.replace('#/');
    } catch (err) {
      console.error(err);
      toast(friendlyError(err));
    }
  };
}

// =====================================================================
// 3. とうろく / なおす(下書きの自動保存つき)
// =====================================================================
let editing = null; // { key, id, owner, base, original, image, crop, style, dirty, timer, writing, closed }

function emptyEditing(id) {
  return { key: id ? `edit:${id}` : `new:${session.id}`, id, owner: session.id, base: null, original: null, image: null, crop: null, style: null, dirty: false, timer: 0, writing: Promise.resolve(), closed: false };
}

async function enterEdit(id, seq) {
  const state = emptyEditing(id);
  let source = null;

  if (id) {
    state.base = await db.getCharacter(id);
    if (!state.base || state.base.ownerId !== state.owner) {
      toast('そのキャラは みつからなかったよ');
      location.replace('#/');
      return;
    }
    source = state.base;
  }
  const draft = await db.getDraft(state.key);
  if (seq !== renderSeq) return;

  // なおすとちゅうの下書きは、元のキャラが そのあと かわっていなければ つかう
  const draftUsable = draft && (!id || draft.baseUpdatedAt === state.base.updatedAt);
  if (draftUsable) {
    source = { ...draft.fields, original: draft.original, image: draft.image, crop: draft.crop, style: draft.style };
    state.dirty = true;
  }

  editing = state;
  $('edit-title').textContent = id ? 'キャラを なおす' : 'キャラを とうろくする';
  $('form-note').textContent = '';
  form.querySelector('.field.error')?.classList.remove('error');
  for (const k of FIELDS) form.elements[k].value = (source && source[k]) || '';
  state.original = source ? source.original || null : null;
  state.image = source ? source.image || null : null;
  state.crop = source ? source.crop || null : null;
  state.style = source ? normalizeStyle(source.style) : null;
  showEditPhoto();

  if (draftUsable) toast('とちゅうから つづきが かけるよ ✏️');
}

function showEditPhoto() {
  revokeUrls('edit');
  const url = editing && urlFor('edit', editing.image);
  const img = $('photo-img');
  $('photo-preview').classList.toggle('has-photo', !!url);
  $('photo-placeholder').hidden = !!url;
  img.hidden = !url;
  if (url) img.src = url;
  else img.removeAttribute('src');
  $('recrop-btn').hidden = !(editing && editing.original);
}

function readFields() {
  const f = {};
  for (const k of FIELDS) f[k] = form.elements[k].value;
  f.age = normalizeAge(f.age);
  return f;
}

function normalizeAge(v) {
  return String(v)
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, '')
    .replace(/^0+(?=\d)/, '');
}

function markDirty() {
  if (!editing) return;
  editing.dirty = true;
  clearTimeout(editing.timer);
  editing.timer = setTimeout(() => saveDraftNow(), DRAFT_DELAY);
}

function saveDraftNow() {
  const state = editing;
  if (!state || state.closed || !state.dirty) return Promise.resolve();
  clearTimeout(state.timer);
  const draft = {
    key: state.key,
    baseUpdatedAt: state.base ? state.base.updatedAt : null,
    fields: readFields(),
    original: state.original,
    image: state.image,
    crop: state.crop,
    style: state.style,
    savedAt: Date.now(),
  };
  state.writing = state.writing
    .then(() => (state.closed ? null : db.putDraft(draft)))
    .catch((err) => console.warn('draft', err));
  return state.writing;
}

/** べつの画面にいくとき:下書きは のこしておく */
async function leaveEdit() {
  if (!editing) return;
  const state = editing;
  await saveDraftNow();
  state.closed = true;
  editing = null;
  revokeUrls('edit');
}

/** ほぞん/やめる のあと:下書きを けす */
async function finishEdit() {
  const state = editing;
  if (!state) return;
  clearTimeout(state.timer);
  state.closed = true;
  await state.writing;
  await db.deleteDraft(state.key);
}

const ageInput = form.elements.age;
ageInput.addEventListener('input', (e) => {
  if (e.isComposing) return; // にほんごの にゅうりょく中は さわらない
  const v = normalizeAge(ageInput.value);
  if (v !== ageInput.value) ageInput.value = v;
});
for (const t of ['compositionend', 'change', 'blur']) {
  ageInput.addEventListener(t, () => { ageInput.value = normalizeAge(ageInput.value); });
}

form.addEventListener('input', (e) => {
  if (e.target.name === 'name') form.elements.name.closest('.field').classList.remove('error');
  markDirty();
});

// ページをとじる/ほかのアプリにいくとき、すぐ下書きを保存。
// ながく はなれていたら、もどったときに こうたい(ログインの がめん)にする
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    saveDraftNow();
    anime.saveNow();
    return;
  }
  if (!hiddenAt || Date.now() - hiddenAt < LOCK_AFTER) return;
  hiddenAt = 0;
  if (session) logout();
  else if (gate === 'parent' || gate === 'parent-move') showGate('users');
});
window.addEventListener('pagehide', () => { saveDraftNow(); anime.saveNow(); });

/**
 * きりぬき → えの かんじ の じゅんに えらんでもらう。
 * 「きりなおす」で きりぬきに もどれる。やめたときは null。
 */
async function pickPicture(img, crop, style) {
  for (;;) {
    const c = await cropper.open(img, crop);
    if (!c) return null;
    crop = c.crop;
    const canvas = renderCropCanvas(img, crop);
    let s;
    try {
      s = await styler.open(canvas, style);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
    if (!s) return null;
    style = s.style;
    if (s.action === 'ok') return { crop, style, blob: s.blob };
  }
}

$('photo-input').addEventListener('change', async (e) => {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = ''; // おなじ しゃしんを もういちど えらべるように
  if (!file || !editing) return;
  const state = editing;
  let img;
  let originalBlob;
  try {
    await withBusy(async () => {
      const raw = await loadImage(file);
      originalBlob = await resizeToJpeg(raw);
      img = await loadImage(originalBlob);
    });
  } catch (err) {
    console.error(err);
    toast(err && err.message === 'decode'
      ? 'この しゃしんは ひらけなかったよ。ほかの しゃしんで ためしてね'
      : friendlyError(err));
    return;
  }
  const result = await pickPicture(img, null, null);
  if (!result || state !== editing) return;
  state.original = await db.packBlob(originalBlob);
  state.image = await db.packBlob(result.blob);
  state.crop = result.crop;
  state.style = result.style;
  showEditPhoto();
  markDirty();
  saveDraftNow();
});

$('recrop-btn').addEventListener('click', async () => {
  if (!editing || !editing.original) return;
  const state = editing;
  let img;
  try {
    img = await loadImage(db.unpackBlob(state.original));
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  const result = await pickPicture(img, state.crop, state.style);
  if (!result || state !== editing) return;
  state.image = await db.packBlob(result.blob);
  state.crop = result.crop;
  state.style = result.style;
  showEditPhoto();
  markDirty();
  saveDraftNow();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editing) return;
  const state = editing;
  const fields = readFields();
  fields.name = fields.name.trim();
  if (!fields.name) {
    $('form-note').textContent = 'なまえを いれてね';
    const field = form.elements.name.closest('.field');
    field.classList.add('error');
    form.elements.name.focus();
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  $('form-note').textContent = '';

  const now = Date.now();
  const chara = {
    ...fields,
    id: state.id || db.newId(),
    ownerId: state.owner,
    original: state.original,
    image: state.image,
    crop: state.crop,
    style: state.style,
    createdAt: state.base ? state.base.createdAt : now,
    updatedAt: now,
  };
  try {
    await withBusy(async () => {
      await db.putCharacter(chara);
      await finishEdit();
    });
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  editing = null;
  toast(state.id ? 'なおしたよ!' : 'ずかんに とうろくしたよ! 🎉');
  location.replace(`#/c/${encodeURIComponent(chara.id)}`);
});

async function cancelEdit() {
  if (!editing) return;
  const state = editing;
  if (state.dirty) {
    const ok = await confirmDialog(
      state.id ? 'なおしたところを けして もどる?' : 'かいたことを けして もどる?',
      { yes: 'けして もどる', no: 'つづける', danger: true },
    );
    if (!ok || state !== editing) return;
  }
  await finishEdit();
  editing = null;
  location.replace(parentHash(currentRoute));
}
$('edit-cancel').addEventListener('click', cancelEdit);

// =====================================================================
// 4. せってい(バックアップ・あいことば)
//    バックアップは ログインちゅうの ひとの キャラだけを かきだす/いれかえる
// =====================================================================
async function renderSettings(seq) {
  const count = await db.countCharacters(session.id);
  let persisted = false;
  try { persisted = !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); } catch { /* なにもしない */ }
  if (seq !== renderSeq) return;
  $('storage-info').textContent =
    `いま ずかんに いるキャラ:${count} にん` +
    (persisted ? '(この きかいに しっかり ほぞんされているよ)' : '');
}

$('pin-change').addEventListener('click', async () => {
  if (!session) return;
  const me = session;
  const pin = await askNewPin({ who: me.icon, title: 'あたらしい あいことばを きめてね', sub: `すうじ ${USER_PIN_LENGTH} けた` });
  if (!pin) return;
  try {
    const user = await db.getUser(me.id);
    if (user) await db.putUser({ ...user, pin: makePin(pin) });
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  toast('あいことばを かえたよ!');
});

function saveFile(file) {
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
    // iPhone など:きょうゆうメニューから「ファイルに保存」できる
    return navigator.share({ files: [file], title: file.name })
      .then(() => true)
      .catch((err) => {
        if (err && err.name === 'AbortError') return false;
        download(file);
        return true;
      });
  }
  download(file);
  return Promise.resolve(true);
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

$('export-btn').addEventListener('click', async () => {
  let file;
  let count = 0;
  try {
    await withBusy(async () => {
      const list = await db.getAllCharacters(session.id);
      count = list.length;
      if (count) file = buildBackupFile(list, session.name);
    });
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  if (!count) {
    toast('まだ キャラが いないよ');
    return;
  }
  // ファイルづくりに じかんが かかるので、ほぞんは もういちど タップしてもらう
  // (iPhone は「タップした すぐあと」でないと ほぞんメニューを ひらけないため)
  const ok = await confirmDialog(`${count} にんぶんの バックアップが できたよ!\nほぞんしよう`, { yes: '💾 ほぞんする' });
  if (!ok) return;
  const saved = await saveFile(file);
  if (saved) toast('バックアップを かきだしたよ!');
});

$('import-input').addEventListener('change', async (e) => {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file || !session) return;
  const owner = session.id;
  let list;
  try {
    list = await withBusy(() => parseBackupFile(file));
  } catch (err) {
    console.error(err);
    toast('この ファイルは よみこめなかったよ。キャラずかんの バックアップを えらんでね');
    return;
  }
  const now = await db.countCharacters(owner);
  const msg = now
    ? `いまの ${now} にんの キャラが きえて、\nファイルの ${list.length} にんに いれかわるよ。\nよみこんでいい?`
    : `ファイルの ${list.length} にんの キャラを よみこむよ。いい?`;
  const ok = await confirmDialog(msg, { yes: 'よみこむ', danger: now > 0 });
  if (!ok || !session || session.id !== owner) return;
  try {
    await withBusy(() => db.replaceCharactersOf(owner, list));
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    return;
  }
  toast('バックアップを よみこんだよ!');
  location.hash = '#/';
});

// =====================================================================
// 5. きどう
// =====================================================================
async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* つかえない ブラウザでは なにもしない */ }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  const offerUpdate = (worker) => {
    toast('あたらしい バージョンが あるよ', {
      actionLabel: 'あたらしくする',
      sticky: true,
      onAction: async () => {
        await Promise.all([saveDraftNow(), anime.saveNow()]);
        worker.postMessage({ type: 'SKIP_WAITING' });
      },
    });
  };

  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      else reg.update().catch(() => {});
    });
  }).catch((err) => console.warn('sw', err));
}

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(friendlyError(e.reason));
});

if (!('indexedDB' in window)) {
  toast('この ブラウザでは つかえないみたい… Safari や Chrome で ひらいてね', { sticky: true });
} else {
  requestPersist();
  render();
}
registerServiceWorker();
