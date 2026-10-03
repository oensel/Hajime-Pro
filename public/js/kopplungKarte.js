// Karte "Neues Gerät koppeln" auf matten.html (nur Hallen-Server): zeigt den Kopplungscode, den
// ein neu installierter Client (Desktop oder Android-App) beim ersten Start abfragt, und einen
// QR-Code für die Android-App (Download-Seite + Code, siehe src/shared/kopplungsQr.js). Erneuern
// macht den alten Code ungültig; bereits gekoppelte Geräte bleiben gekoppelt.
document.addEventListener('DOMContentLoaded', async () => {
    const karte = document.getElementById('kopplungKarte');
    const anzeige = document.getElementById('kopplungCode');
    if (!karte || !anzeige) return;
    const { baueKopplungsUrl } = await import('/js/shared/kopplungsQr.js');

    const zeige = ({ code, urls }) => {
        anzeige.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
        const bereich = document.getElementById('kopplungQrBereich');
        if (!bereich || !window.qrcode || !urls || !urls.length) return;
        // Bevorzugt die Adresse, unter der diese Seite gerade geöffnet ist; sonst die erste LAN-Adresse.
        const adresse = urls.find(u => new URL(u).hostname === location.hostname) || urls[0];
        const qr = window.qrcode(0, 'M');
        qr.addData(baueKopplungsUrl(adresse, code));
        qr.make();
        document.getElementById('kopplungQr').innerHTML = qr.createSvgTag(4, 4);
        document.getElementById('kopplungQrAdresse').textContent = adresse;
        bereich.style.display = '';
    };

    const resp = await fetch('/api/client/kopplungscode').catch(() => null);
    if (!resp || !resp.ok) return; // kein Hallen-Server oder kein Passwort
    zeige(await resp.json());
    karte.style.display = '';

    document.getElementById('kopplungErneuernBtn').addEventListener('click', async () => {
        const r = await fetch('/api/client/kopplungscode/erneuern', { method: 'POST' });
        if (r.ok) zeige(await r.json());
        else if (window.zeigeNotification) window.zeigeNotification('Code konnte nicht erneuert werden.', 'error');
    });
});
