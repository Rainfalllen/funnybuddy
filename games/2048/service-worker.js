/* ============================================================
 * service-worker.js —— 2048 PWA 离线缓存
 * 使用独立缓存名前缀（game2048-），与大厅及其它游戏互不干扰。
 * 策略：静态资源 cache-first，其它 network-first 回退缓存。
 * 升级 CACHE_VERSION 即可强制刷新。
 * ============================================================ */
const CACHE_VERSION = "game2048-v1";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
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
        keys.filter((k) => k.startsWith("game2048-") && k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === "basic") {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
