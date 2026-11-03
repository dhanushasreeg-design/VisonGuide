/**
 * VisionGuide AI — Production Service Worker
 * Provides offline shell caching, instant load times, and installable PWA support.
 * Complies with strict security rules: never caches private auth tokens, emergency SOS data, or sensitive API payloads.
 */

const CACHE_NAME = "visionguideai-v1";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("PWA: Pre-caching partial assets:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Never cache non-GET requests (e.g. POST /api/sos, PUT, DELETE)
  if (req.method !== "GET") {
    return;
  }

  // 2. Never cache private/sensitive API endpoints or third-party auth/databases
  if (
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("supabase.co") ||
    url.pathname.includes("/sos") ||
    url.pathname.includes("/emergency")
  ) {
    // Network-only for live API, auth, and emergency data
    return;
  }

  // 3. For navigation requests (HTML pages), try network first, fall back to cached index.html
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => {
        return caches.match("./index.html") || caches.match("./");
      })
    );
    return;
  }

  // 4. For static assets (JS, CSS, images, icons, fonts), use Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
