// Service worker: l'app si apre anche senza rete (con gli ultimi dati visti).
const CACHE = 'torresina-v3';
const SHELL = [
  '/', '/index.html', '/privacy.html', '/css/app.css',
  '/js/app.js', '/js/config.js', '/js/condividi.js',
  '/vendor/supabase.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/fonts/atkinson-hyperlegible-latin-400-normal.woff2', '/fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  '/fonts/bricolage-grotesque-latin-600-normal.woff2', '/fonts/bricolage-grotesque-latin-800-normal.woff2',
  '/manifest.webmanifest', '/icons/icon-192.png', '/img/torresina-hero.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(u.pathname === '/privacy.html' ? '/privacy.html' : '/index.html')));
    return;
  }
  // Font e librerie non cambiano: prima la copia salvata
  if (u.pathname.startsWith('/fonts/') || u.pathname.startsWith('/vendor/')) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
    return;
  }
  // Tutto il resto: prima la rete, poi la copia salvata
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request)),
  );
});
