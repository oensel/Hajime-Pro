// Seite admin-vereine.html („Vereine“, nur Super-Admins): alle Vereine mit Bundesland (änderbar), Anzahl Benutzer
// (Rolle egal) und Anzahl Turniere. Ein Klick auf die Zahlen öffnet die für den Verein gefilterte Benutzerliste
// (admin-nutzer.html?vereinId=) bzw. Turnierliste (admin-turniere.html?vereinId=, Wettkampftag absteigend).
// API: GET /api/nutzer/vereine, PUT /api/nutzer/vereine/:id { bundesland }.
(function () {
    const BUNDESLAENDER = [
        'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern',
        'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt',
        'Schleswig-Holstein', 'Thüringen'
    ];
    const liste = document.getElementById('vereineListe');
    const meldung = document.getElementById('vereineMeldung');
    const info = document.getElementById('vereineInfo');
    const filter = document.getElementById('vereineFilter');
    let vereine = [];

    const zeigeMeldung = (text) => { meldung.textContent = text || ''; };

    function zahlZelle(anzahl, ziel, beschriftung) {
        const td = document.createElement('td');
        if (anzahl > 0) {
            const a = document.createElement('a');
            a.className = 'zahl';
            a.href = ziel;
            a.textContent = String(anzahl);
            a.setAttribute('aria-label', beschriftung);
            td.appendChild(a);
        } else {
            const s = document.createElement('span');
            s.className = 'zahl-null';
            s.textContent = '0';
            td.appendChild(s);
        }
        return td;
    }

    async function speichereBundesland(verein, auswahl, vorher) {
        zeigeMeldung('');
        auswahl.disabled = true;
        try {
            const response = await fetch(`/api/nutzer/vereine/${encodeURIComponent(verein.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bundesland: auswahl.value })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Das Bundesland konnte nicht gespeichert werden.');
            verein.bundesland = auswahl.value || null;
        } catch (err) {
            auswahl.value = vorher;
            zeigeMeldung(err.message);
        } finally {
            auswahl.disabled = false;
        }
    }

    function bundeslandZelle(verein) {
        const td = document.createElement('td');
        const auswahl = document.createElement('select');
        auswahl.setAttribute('aria-label', `Bundesland von ${verein.name}`);
        const leer = document.createElement('option');
        leer.value = '';
        leer.textContent = '–';
        auswahl.appendChild(leer);
        for (const land of BUNDESLAENDER) {
            const option = document.createElement('option');
            option.value = land;
            option.textContent = land;
            auswahl.appendChild(option);
        }
        auswahl.value = verein.bundesland || '';
        let vorher = auswahl.value;
        auswahl.addEventListener('change', async () => {
            const neu = auswahl.value;
            await speichereBundesland(verein, auswahl, vorher);
            if ((verein.bundesland || '') === neu) vorher = neu;
        });
        td.appendChild(auswahl);
        return td;
    }

    function passt(verein, suche) {
        if (!suche) return true;
        return `${verein.name} ${verein.bundesland || ''}`.toLowerCase().includes(suche);
    }

    function zeichne() {
        const suche = filter.value.trim().toLowerCase();
        const sichtbar = vereine.filter(v => passt(v, suche));
        info.textContent = `${sichtbar.length} von ${vereine.length} Vereinen`;
        liste.textContent = '';
        if (sichtbar.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 4;
            td.textContent = 'Keine Vereine gefunden.';
            tr.appendChild(td);
            liste.appendChild(tr);
            return;
        }
        for (const v of sichtbar) {
            const tr = document.createElement('tr');
            tr.dataset.id = v.id;
            const name = document.createElement('td');
            name.textContent = v.name;
            tr.appendChild(name);
            tr.appendChild(bundeslandZelle(v));
            tr.appendChild(zahlZelle(v.benutzer_anzahl, `/admin-nutzer.html?vereinId=${encodeURIComponent(v.id)}`, `Benutzer von ${v.name} anzeigen`));
            tr.appendChild(zahlZelle(v.turniere_anzahl, `/admin-turniere.html?vereinId=${encodeURIComponent(v.id)}`, `Turniere von ${v.name} anzeigen`));
            liste.appendChild(tr);
        }
    }

    async function lade() {
        try {
            const response = await fetch('/api/nutzer/vereine');
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Die Vereine konnten nicht geladen werden.');
            vereine = data;
            zeichne();
        } catch (err) {
            liste.textContent = '';
            zeigeMeldung(err.message);
        }
    }

    filter.addEventListener('input', zeichne);
    lade();
})();
