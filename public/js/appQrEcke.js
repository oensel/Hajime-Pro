// QR-Code der Teilnehmer-App unten rechts auf den öffentlichen Anzeigen (Übersicht, Dashboard). Den Zugangscode liefert der Hallen-Server
// (GET /api/live-app/zugang, Token des Turniers); ohne Teilnehmer-App-Zugang (kein Token, gesperrt, Cloud nicht erreichbar) bleibt die Ecke leer.
(function () {
    const params = new URLSearchParams(location.search);
    const turnierId = params.get('turnierId') || params.get('id') || localStorage.getItem('aktiveTurnierId');
    if (!turnierId || !/^\d+$/.test(String(turnierId)) || typeof window.qrcode !== 'function') return;

    const ecke = document.createElement('div');
    ecke.className = 'app-qr-ecke';
    ecke.hidden = true;
    ecke.innerHTML = '<img alt="QR-Code der Teilnehmer-App"><div><strong>Live-Ergebnisse</strong><span>QR-Code mit der Handy-Kamera scannen</span></div>';
    const stil = document.createElement('style');
    stil.textContent = `.app-qr-ecke{position:fixed;right:16px;bottom:16px;z-index:50;display:flex;align-items:center;gap:12px;max-width:340px;padding:10px 14px 10px 10px;background:#fff;color:#111827;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.35);font-family:inherit}
.app-qr-ecke[hidden]{display:none}.app-qr-ecke img{width:120px;height:120px;image-rendering:pixelated;flex:none}
.app-qr-ecke div{display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:1.3}.app-qr-ecke strong{font-size:16px}
@media print{.app-qr-ecke{box-shadow:none;border:1px solid #111827}}`;
    document.head.appendChild(stil);
    document.body.appendChild(ecke);

    let letzte = '';
    async function aktualisiere() {
        try {
            const antwort = await fetch(`/api/live-app/zugang?turnierId=${encodeURIComponent(turnierId)}`, { cache: 'no-store' });
            const zugang = antwort.ok ? await antwort.json() : null;
            if (!zugang || zugang.gesperrt || !zugang.url) { ecke.hidden = true; return; }
            if (zugang.url !== letzte) {
                const qr = window.qrcode(0, 'M');
                qr.addData(zugang.url);
                qr.make();
                ecke.querySelector('img').src = qr.createDataURL(6, 2);
                letzte = zugang.url;
            }
            ecke.hidden = false;
        } catch { ecke.hidden = true; }
    }
    aktualisiere();
    setInterval(aktualisiere, 60000); // Erneuern oder Sperren am Hallen-Server wirkt so nach spätestens einer Minute
})();
