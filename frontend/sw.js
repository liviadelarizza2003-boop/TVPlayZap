// Service Worker — Eva Lite
// Cache shell do PWA para funcionamento offline básico

const CACHE_NAME   = 'eva-lite-v1';
const SHELL_ASSETS = ['/', '/css/style.css', '/js/app.js', '/js/dashboard.js',
  '/js/clients.js', '/js/training.js', '/js/qrcode.js', '/js/config.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Requisições à API sempre vão para a rede
  if (e.request.url.includes('/api/') || e.request.url.includes('/ws/')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
