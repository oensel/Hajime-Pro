// Seite kontakt.html: Kontaktformular an die Super-Admins (POST /api/kontakt). Wer angemeldet ist, schreibt stattdessen
// aus dem Postfach (nachrichten.html), dort sind Antworten direkt zu sehen.
(function () {
    const meldung = document.getElementById('kMeldung');
    const form = document.getElementById('kontaktForm');

    try {
        if (localStorage.getItem('dokume_token')) { window.location.replace('/nachrichten.html?neu=super'); return; }
    } catch { /* ohne Speicher: Formular bleibt */ }
    fetch('/api/kontakt/aktiv').then((r) => {
        if (!r.ok) { meldung.className = 'meldung fehler'; meldung.textContent = 'Das Kontaktformular gibt es nur auf dem Cloud-Server.'; document.getElementById('kSenden').disabled = true; }
    }).catch(() => { /* Netzfehler: beim Senden sichtbar */ });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const senden = document.getElementById('kSenden');
        senden.disabled = true;
        meldung.className = 'meldung';
        meldung.textContent = '';
        try {
            const r = await fetch('/api/kontakt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    art: 'kontakt',
                    name: document.getElementById('kName').value,
                    email: document.getElementById('kEmail').value,
                    betreff: document.getElementById('kBetreff').value,
                    text: document.getElementById('kText').value
                })
            });
            const daten = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(daten.error || 'Die Nachricht konnte nicht gesendet werden.');
            form.reset();
            meldung.textContent = 'Danke! Deine Nachricht ist angekommen, wir melden uns per E-Mail.';
        } catch (err) {
            meldung.className = 'meldung fehler';
            meldung.textContent = err.message;
        } finally {
            senden.disabled = false;
        }
    });
})();
