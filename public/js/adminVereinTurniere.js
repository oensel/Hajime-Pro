// Seite admin-turniere.html (nur Super-Admins): die gespeicherten Turniere eines Vereins (?vereinId=), Wettkampftag
// absteigend. API: GET /api/nutzer/vereine/:id/turniere.
(function () {
    const liste = document.getElementById('vtListe');
    const meldung = document.getElementById('vtMeldung');
    const titel = document.getElementById('vtTitel');
    const vereinId = new URLSearchParams(window.location.search).get('vereinId');

    const STATUS = {
        entwurf: 'Entwurf', veroeffentlicht: 'Veröffentlicht', anmeldung_geschlossen: 'Anmeldung geschlossen',
        in_durchfuehrung: 'In Durchführung', abgeschlossen: 'Abgeschlossen', abgesagt: 'Abgesagt'
    };

    function datumDeutsch(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
        return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || '');
    }

    function zelle(text) {
        const td = document.createElement('td');
        td.textContent = text;
        return td;
    }

    function zeigeLeer(text) {
        liste.textContent = '';
        const tr = document.createElement('tr');
        const td = zelle(text);
        td.colSpan = 6;
        tr.appendChild(td);
        liste.appendChild(tr);
    }

    async function lade() {
        if (!vereinId) {
            zeigeLeer('Kein Verein gewählt.');
            return;
        }
        try {
            const response = await fetch(`/api/nutzer/vereine/${encodeURIComponent(vereinId)}/turniere`);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Die Turniere konnten nicht geladen werden.');
            titel.textContent = `Turniere: ${data.verein.name}`;
            document.title = `Hajime Pro - Turniere ${data.verein.name}`;
            if (data.turniere.length === 0) {
                zeigeLeer('Dieser Verein hat noch keine gespeicherten Turniere.');
                return;
            }
            liste.textContent = '';
            for (const t of data.turniere) {
                const tr = document.createElement('tr');
                tr.dataset.id = t.id;
                tr.appendChild(zelle(datumDeutsch(t.datum)));
                tr.appendChild(zelle(t.bezeichnung));
                tr.appendChild(zelle(t.ort || ''));
                tr.appendChild(zelle(t.bundesland || '–'));
                tr.appendChild(zelle(STATUS[t.status] || t.status || ''));
                tr.appendChild(zelle(String(t.teilnehmer_anzahl)));
                liste.appendChild(tr);
            }
        } catch (err) {
            liste.textContent = '';
            meldung.textContent = err.message;
        }
    }

    lade();
})();
