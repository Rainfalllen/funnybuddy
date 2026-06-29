/* ============================================================
 * service-worker.js —— PWA 离线缓存
 * 策略：
 *   - 静态资源（HTML/CSS/JS/图标/manifest）走 cache-first；
 *   - 其它请求走 network-first，失败回退缓存（兜底）。
 *   - 升级 CACHE_VERSION 即可强制刷新。
 * ============================================================ */
const CACHE_VERSION = "balatro-v15";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/sfx.js",
  "./js/cards.js",
  "./js/jokers.js",
  "./js/planets.js",
  "./js/tarots.js",
  "./js/spectrals.js",
  "./js/core.js",
  "./js/view.js",
  "./js/app.js",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // 仅清理本游戏自身的旧缓存，避免误删大厅或其它游戏的缓存
      Promise.all(
        keys.filter((k) => k.startsWith("balatro-") && k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // 只处理 GET
  if (req.method !== "GET") return;
  // 跨域请求直接放行
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((resp) => {
          // 只缓存成功的同源资源
          if (resp && resp.status === 200 && resp.type === "basic") {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => cached);
      // cache-first：有缓存就先用，后台再更新
      return cached || networkFetch;
    })
  );
});
