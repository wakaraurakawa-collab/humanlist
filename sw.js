/* オフライン対応 + 常に最新を優先:
   通信できるときはネットワークから取得（HTTPキャッシュも迂回）、失敗・遅いときだけ保存分を使う */
const CACHE = 'humanlist-__BUILD__'; // デプロイ時にコミットIDへ置換（=毎回SWが更新される）
const ASSETS = ['./', './index.html', './style.css', './core.js', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const TIMEOUT_MS = 3000;

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE)
    .then(c => Promise.all(ASSETS.map(u => fetch(u, { cache: 'reload' }).then(r => r.ok && c.put(u, r)).catch(() => {}))))
    .then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // 天気APIなどは素通し
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromNet = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; });
    try {
      return await Promise.race([fromNet, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS))]);
    } catch (err) {
      const hit = await cache.match(e.request, { ignoreSearch: true }) || (e.request.mode === 'navigate' && await cache.match('./index.html'));
      if (hit) return hit;
      return fromNet; // 保存分もなければ通信結果を待つ
    }
  })());
});
