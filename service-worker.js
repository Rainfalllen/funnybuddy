/* ============================================================
 * service-worker.js —— 合集大厅 PWA 离线缓存
 * 注意：仅缓存大厅自身资源；各游戏（games/<id>/）拥有各自的
 * service-worker，作用域互不干扰。
 * 策略：静态资源 cache-first，其它 network-first 回退缓存。
 * 升级 CACHE_VERSION 即可强制刷新。
 * ============================================================ */
const CACHE_VERSION = "funnybuddy-hub-v4";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/hub.css",
  "./js/hub.js",
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
      // 仅清理大厅自身的旧缓存，避免误删各游戏的缓存
      Promise.all(
        keys.filter((k) => k.startsWith("funnybuddy-hub-") && k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 大厅入口(HTML 导航) 与游戏列表脚本 hub.js：network-first。
  // 确保新增 / 调整游戏后，玩家刷新即可看到最新列表，不会被旧缓存卡住。
  const isNavigation = req.mode === "navigate";
  const isHubScript = url.pathname.endsWith("/js/hub.js") || url.pathname.endsWith("/hub.js");
  if (isNavigation || isHubScript) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === "basic") {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
    return;
  }

  // 其它静态资源：cache-first（有缓存先用，后台再更新）。
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
