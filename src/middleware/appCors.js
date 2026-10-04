// CORS-Freigabe für die Android-App (Capacitor-WebView, Herkunft http://localhost bzw.
// https://localhost): Die App lädt ihre Seiten lokal und spricht den Hallen-Server von dort aus an
// — Replikation (/db), Server-Status, Kopplung und Versionsabfrage. Für /db gilt weiterhin das
// SYNC_SECRET (x-hajime-sync-secret); die Freigabe betrifft nur die Browser-Herkunft, nicht den Zugriff.
const ERLAUBT = /^(https?|capacitor):\/\/localhost(:\d+)?$/;

export function appCors(req, res, next) {
    const herkunft = req.headers.origin;
    if (!herkunft || !ERLAUBT.test(herkunft)) return next();
    res.setHeader('Access-Control-Allow-Origin', herkunft);
    // PouchDB sendet Anfragen mit credentials: 'include' — der Browser verlangt dann dieses Flag.
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', 'Date, ETag, Content-Type');
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'content-type, x-hajime-sync-secret');
        res.setHeader('Access-Control-Max-Age', '600');
        return res.status(204).end();
    }
    next();
}
