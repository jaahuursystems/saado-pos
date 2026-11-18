/* Saado POS — service worker: keeps the app working offline.
   IMPORTANT: change VERSION on every release so phones download the new files. */
const VERSION = 'saado-v1.2.1';
const SHELL = ['./', 'index.html', 'app.css?v=1.2.1', 'config.js?v=1.2.1', 'i18n.js?v=1.2.1', 'guide.js?v=1.2.1', 'app.js?v=1.2.1', 'screens.js?v=1.2.1',
  'manifest.json', 'icons/logo.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'saado-cdn').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // server calls (POST) always go to the network
  const url = new URL(req.url);
  if (url.hostname === 'cdn.jsdelivr.net' || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {   // scanner library + Inter font: keep a copy for offline use
    e.respondWith(caches.open('saado-cdn').then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })
      .catch(() => new Response('', { status: 200, headers: { 'Content-Type': /fonts\.googleapis/.test(url.hostname) ? 'text/css' : 'text/plain' } })))));   // offline: fall back to the phone's own font quietly
    return;
  }
  if (url.origin !== location.origin) return;
  if (/config\.js/.test(url.pathname)) {                 // config: network first so a new script address applies at once
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); return r; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => hit || fetch(req).then(r => {
    if (r.ok && url.pathname.indexOf('/apps-script/') < 0) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); }
    return r;
  }).catch(() => req.mode === 'navigate' ? caches.match('index.html') : undefined)));
});
