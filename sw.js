// Service Worker:アプリのファイルをキャッシュして、オフラインでも うごくようにする。
//
// ★ アプリのファイルを かえたら、かならず VERSION の数字を 1つ ふやすこと。
//   (sw.js の中身が かわると、ブラウザが あたらしい版を みつけて きりかえる)

const VERSION = 2;
const CACHE = `chara-zukan-v${VERSION}`;

const FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/app.js',
  './js/db.js',
  './js/image.js',
  './js/cropper.js',
  './js/backup.js',
  './js/styler.js',
  './js/manga-worker.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' で、ブラウザの HTTP キャッシュではなく サーバーから さいしんを とる
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('chara-zukan-') && k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

// アプリの画面で「あたらしくする」が おされたら、すぐに きりかえる
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // ページを ひらくときは、いつも キャッシュの index.html を つかう(?や# がついていても)
    event.respondWith(
      caches.match('./index.html', { cacheName: CACHE }).then((res) => res || fetch(req)),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((res) => res || fetch(req)),
  );
});
