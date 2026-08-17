// Service Worker — Eva Lite
// Cache shell do PWA para funcionamento offline básico

const CACHE_NAME   = 'eva-lite-v2';
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
  // Rede primeiro (pega sempre a versão mais nova quando online) — cache só
  // como reserva pra funcionar offline. Sem isso, uma atualização de código
  // podia nunca chegar a quem já tinha o PWA aberto/instalado antes.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
