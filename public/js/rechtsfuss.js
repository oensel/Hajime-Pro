// Kleine Fußzeile „Impressum · Datenschutz · Kontakt“ auf jeder Seite der Cloud (Impressum und Datenschutzerklärung müssen von jeder Seite aus leicht erreichbar sein).
// Eingebunden von menu.js und von den Seiten ohne Menü (Anmeldung, Einladung, Passwort, …). Gibt es die Seiten nicht (Hallen-Server), erscheint nichts:
// der Server meldet das über /api/rechtliches/aktiv, das Ergebnis wird je Sitzung gemerkt.
(function () {
    if (window.__rechtsfuss) return;
    window.__rechtsfuss = true;
    const MERKER = 'hajime-rechtliches';

    function zeige() {
        if (document.getElementById('rechtsfuss')) return;
        const stil = document.createElement('style');
        stil.textContent = '#rechtsfuss{position:fixed;right:8px;bottom:6px;z-index:40;font:11px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:2px 10px;border-radius:10px;background:rgba(255,255,255,.88);border:1px solid rgba(100,116,139,.35);color:#475569}#rechtsfuss a{color:#1e3a8a;text-decoration:none}#rechtsfuss a:hover{text-decoration:underline}[data-theme="dark"] #rechtsfuss{background:rgba(17,24,39,.9);color:#9ca3af;border-color:#374151}[data-theme="dark"] #rechtsfuss a{color:#93c5fd}@media print{#rechtsfuss{display:none}}';
        const fuss = document.createElement('footer');
        fuss.id = 'rechtsfuss';
        const link = (text, href) => { const a = document.createElement('a'); a.href = href; a.textContent = text; a.rel = 'noopener'; return a; };
        fuss.append(link('Impressum', '/impressum.html'), ' · ', link('Datenschutz', '/datenschutz.html'), ' · ', link('Kontakt', '/kontakt.html'));
        document.head.appendChild(stil);
        document.body.appendChild(fuss);
    }

    async function pruefe() {
        let gemerkt = null;
        try { gemerkt = sessionStorage.getItem(MERKER); } catch { /* ohne Speicher */ }
        if (gemerkt === '1') return zeige();
        if (gemerkt === '0') return;
        try {
            const antwort = await fetch('/api/rechtliches/aktiv');
            const aktiv = antwort.ok && (await antwort.json()).aktiv === true;
            try { sessionStorage.setItem(MERKER, aktiv ? '1' : '0'); } catch { /* ohne Speicher */ }
            if (aktiv) zeige();
        } catch { /* kein Netz: keine Fußzeile */ }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pruefe); else pruefe();
})();
