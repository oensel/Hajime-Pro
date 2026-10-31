// Karte "Neues Gerät koppeln" auf client-konfig.html (nur Hallen-Server): zeigt den Kopplungscode, den
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
        // Der Server liefert die Adressen nach Eignung sortiert (VIP, dann die Adresse dieser Seite, dann
        // der Rest), und zwar bei jedem Aufruf frisch — die erste gilt.
        const adresse = urls[0];
        const ipLink = document.getElementById('kopplungDownloadIpLink');
        if (ipLink) { // Rückfall, wenn turnier.local im Netz nicht aufgelöst wird
            ipLink.href = `${adresse}/download`;
            ipLink.firstChild.textContent = `${adresse.replace(/^https?:\/\//, '')}/download`;
            document.getElementById('kopplungDownloadIp').style.display = '';
        }
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

// Karte "Schreibpasswort setzen": am Hallen-Server jederzeit möglich, ohne das bisherige Passwort (POST /api/client/steuerung-passwort).
document.addEventListener('DOMContentLoaded', async () => {
    const karte = document.getElementById('passwortKarte');
    if (!karte) return;
    const status = await fetch('/api/sync/status', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!status || status.rolle !== 'server') return;
    karte.style.display = '';

    const meldung = document.getElementById('passwortMeldung');
    const zeigeMeldung = (text, gut) => {
        meldung.textContent = text;
        meldung.style.color = gut ? '#2e7d32' : '#c62828';
        meldung.style.display = '';
    };
    document.getElementById('passwortForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const neu = document.getElementById('passwortNeu').value;
        if (neu !== document.getElementById('passwortWiederholung').value) return zeigeMeldung('Die beiden Eingaben sind nicht gleich.', false);
        try {
            const r = await fetch('/api/client/steuerung-passwort', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ neuesPasswort: neu })
            });
            const daten = await r.json().catch(() => ({}));
            if (!r.ok) return zeigeMeldung(daten.error || 'Das Passwort konnte nicht gespeichert werden.', false);
            try { localStorage.setItem('steuerung_password', neu); } catch (err) { /* localStorage gesperrt */ }
            e.target.reset();
            zeigeMeldung('Das neue Schreibpasswort gilt jetzt.', true);
        } catch (err) {
            zeigeMeldung('Netzwerkfehler beim Speichern.', false);
        }
    });
});
