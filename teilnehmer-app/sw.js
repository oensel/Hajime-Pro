// Service Worker der Teilnehmer-App: hält nur die App-Hülle vor. Die API wird nie zwischengespeichert (veraltete
// Kampfstände wären schlimmer als keine); die App merkt sich den letzten Stand selbst.
const CACHE = 'hajime-live-v28';
const HUELLE = ['./', './index.html', './css/app.css', './js/app.js', './js/api.js', './js/anzeige.js', './js/speicher.js', './js/zugang.js', './js/ui.js',
    './js/ansicht-start.js', './js/ansicht-pool.js', './js/ansicht-pools.js', './js/ansicht-turnier.js', './js/uebersicht.js', './js/baum.js', '/js/shared/poolRunden.js', '/js/shared/koRepechage.js', './js/ansicht-verein.js', './js/ansicht-uebersicht.js', './js/ansicht-mannschaft.js', './js/push.js',
    './manifest.webmanifest', './icons/icon-192.png', './icons/zeichen.png'];

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

// Push-Nachrichten (Phase 3): die Cloud sendet { titel, text, url, tag }.
self.addEventListener('push', (e) => {
    let daten = {};
    try { daten = e.data ? e.data.json() : {}; } catch { daten = { titel: 'Hajime Pro', text: e.data ? e.data.text() : '' }; }
    e.waitUntil(self.registration.showNotification(daten.titel || 'Hajime Pro', {
        body: daten.text || '', tag: daten.tag || 'hajime-live', renotify: true,
        icon: './icons/icon-192.png', data: { url: daten.url || '/live/' }
    }));
});
self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const ziel = (e.notification.data && e.notification.data.url) || '/live/';
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
        for (const f of fenster) {
            if (f.url.includes('/live/') && 'focus' in f) {
                if ('navigate' in f) f.navigate(ziel).catch(() => {});
                return f.focus();
            }
        }
        return self.clients.openWindow(ziel);
    }));
});
