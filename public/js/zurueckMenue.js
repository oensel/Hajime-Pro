// "Menü"-Button für Seiten ohne eigenes Menü (Scoreboard, Dashboard, Übersicht), damit man im Desktop-Modus
// (Windows-Server, Client) wie in der Android-App zurückkommt. Ziel ist "/" (Client-Gerät: client.html,
// sonst die Turnierauswahl). Wurde die Seite per window.open als eigenes Fenster geöffnet (Mattenleitung ->
// Scoreboard), schließt der Button stattdessen dieses Fenster und das Menü darunter bleibt stehen.
(function () {
    function erzeuge() {
        if (document.getElementById('zurueckMenue')) return;
        const a = document.createElement('a');
        a.id = 'zurueckMenue';
        a.href = '/';
        a.innerHTML = '&#9664; Menü';
        a.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:10000;display:flex;align-items:center;gap:6px;' +
            'padding:10px 16px;border-radius:22px;background:#1f2937;color:#fff;font:700 14px/1 system-ui,sans-serif;' +
            'text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:.85;';
        a.addEventListener('click', (e) => {
            if (window.opener && !window.opener.closed) {
                e.preventDefault();
                window.close();
            }
        });
        document.body.appendChild(a);
    }
    if (document.body) erzeuge();
    else document.addEventListener('DOMContentLoaded', erzeuge);
})();
