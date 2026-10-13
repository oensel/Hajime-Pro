// Service Worker der Teilnehmer-App: hält nur die App-Hülle vor. Die API wird nie zwischengespeichert (veraltete
// Kampfstände wären schlimmer als keine); die App merkt sich den letzten Stand selbst.
const CACHE = 'hajime-live-v3';
const HUELLE = ['./', './index.html', './css/app.css', './js/app.js', './js/api.js', './js/anzeige.js', './js/speicher.js', './js/ui.js',
    './js/ansicht-start.js', './js/ansicht-pool.js', './js/ansicht-pools.js', './js/ansicht-turnier.js', './js/uebersicht.js', './js/baum.js', '/js/shared/poolRunden.js', './js/ansicht-verein.js', './js/ansicht-uebersicht.js',
    './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(HUELLE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    e.respondWith(
        fetch(e.request).then((antwort) => {
            const kopie = antwort.clone();
            caches.open(CACHE).then(c => c.put(e.request, kopie));
            return antwort;
        }).catch(() => caches.match(e.request))
    );
});
