// Meldet Fehler im Browser an das Fehlerprotokoll des Servers (POST /api/fehler/browser, sichtbar in der „Konsole“ der Super-Admins):
// Skriptfehler (window.onerror) und unbehandelte Promise-Fehler. Höchstens fünf verschiedene Meldungen je Seitenaufruf, nur der Pfad
// der Seite (nie Query oder Hash, dort können Zugangsdaten stehen). Eingebunden von menu.js und login.html.
(function () {
    if (window.__fehlerMelder) return;
    window.__fehlerMelder = true;
    let gesendet = 0;
    const gesehen = new Set();
    const IGNORIERT = [/^ResizeObserver loop/i, /^Script error\.?$/i];

    function melde(meldung, stack) {
        if (!meldung || gesendet >= 5 || IGNORIERT.some((m) => m.test(meldung))) return;
        const schluessel = String(meldung).slice(0, 200);
        if (gesehen.has(schluessel)) return;
        gesehen.add(schluessel);
        gesendet += 1;
        try {
            fetch('/api/fehler/browser', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meldung: String(meldung).slice(0, 500), stack: stack ? String(stack).slice(0, 4000) : '', url: location.pathname })
            }).catch(() => {});
        } catch (_) { /* Melden darf nie selbst Fehler auslösen */ }
    }

    window.addEventListener('error', (e) => {
        if (e.target && e.target !== window) return; // fehlende Bilder/Skripte: kein Skriptfehler
        melde(e.message || 'Skriptfehler', (e.error && e.error.stack) || `${e.filename || ''}:${e.lineno || 0}:${e.colno || 0}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
        const grund = e.reason;
        melde(`Unbehandelte Ablehnung: ${(grund && grund.message) || String(grund)}`, grund && grund.stack);
    });
})();
