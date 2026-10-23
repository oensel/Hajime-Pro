// Seite live-aushang.html (Hallen-Server): druckbarer Aushang mit dem QR-Code der Teilnehmer-App. Den Zugangscode liefert
// GET /api/live-app/zugang (Cloud, mit dem Token des Turniers); der QR-Code enthält die Adresse `<Cloud>/live/#z=<Code>`.
(function () {
    const $ = (id) => document.getElementById(id);
    const turnierId = new URLSearchParams(location.search).get('turnierId');
    const fehler = $('fehler');

    function meldeFehler(text) {
        fehler.textContent = text;
        fehler.hidden = !text;
    }

    async function hole(pfad) {
        const antwort = await fetch(pfad, { cache: 'no-store' });
        const daten = await antwort.json().catch(() => ({}));
        if (!antwort.ok) throw new Error(daten.error || `Fehler ${antwort.status}`);
        return daten;
    }

    async function lade() {
        meldeFehler('');
        $('drucken').disabled = true;
        $('blatt').classList.add('leer');
        if (!/^\d+$/.test(String(turnierId))) { meldeFehler('Es ist kein Turnier ausgewählt (Adresse mit ?turnierId=…).'); return; }
        try {
            const [zugang, turnier] = await Promise.all([
                hole(`/api/live-app/zugang?turnierId=${encodeURIComponent(turnierId)}`),
                hole(`/api/turniere/${encodeURIComponent(turnierId)}`).catch(() => null)
            ]);
            if (zugang.gesperrt) { meldeFehler('Der Zugang ist gesperrt. Geben Sie ihn im Fenster „Teilnehmer-App“ frei, bevor Sie drucken.'); return; }
            const t = turnier && (turnier.turnier || turnier);
            $('turnierName').textContent = (t && (t.bezeichnung || t.name)) || '';
            $('turnierDatum').textContent = t && t.datum ? new Date(t.datum).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '';
            const qr = window.qrcode(0, 'M');
            qr.addData(zugang.url);
            qr.make();
            $('qr').src = qr.createDataURL(14, 0);
            const bis = zugang.gueltigBis ? new Date(zugang.gueltigBis).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : null;
            let datenschutz = '';
            try { datenschutz = `${new URL(zugang.url).origin}/datenschutz.html`; } catch { /* ohne Adresse */ }
            $('fuss').textContent = [
                bis ? `Gültig bis ${bis} Uhr.` : '',
                'Zeigt Namen, Vereine und Ergebnisse der Teilnehmenden dieses Turniers.',
                datenschutz ? `Datenschutz: ${datenschutz}` : ''
            ].filter(Boolean).join(' ');
            $('blatt').classList.remove('leer');
            $('drucken').disabled = false;
        } catch (e) {
            meldeFehler(e.message);
        }
    }

    $('drucken').addEventListener('click', () => window.print());
    $('neuLaden').addEventListener('click', lade);
    lade();
})();
