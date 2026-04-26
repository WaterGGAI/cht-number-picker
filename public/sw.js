const SHELL_CACHE = "cht-shell-v1";
const RUNTIME_CACHE = "cht-runtime-v1";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/app-logic.js",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/api/config") {
    event.respondWith(staleWhileRevalidate(event.request, RUNTIME_CACHE, event));
    return;
  }

  if (event.request.mode === "navigate" && !url.pathname.startsWith("/official/")) {
    event.respondWith(networkFirst(event.request, "/", SHELL_CACHE));
    return;
  }

  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event.request, SHELL_CACHE, event));
  }
});

async function networkFirst(request, fallbackPath, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(fallbackPath, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return (await cache.match(fallbackPath)) || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkPromise);
    return cached;
  }

  return networkPromise.then((response) => response || Response.error());
}
