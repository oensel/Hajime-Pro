// Seite admin-vereine.html („Vereine“, nur Super-Admins): alle Vereine mit Bundesland (änderbar), Anzahl Benutzer
// (Rolle egal) und Anzahl Turniere. Ein Klick auf die Zahlen öffnet die für den Verein gefilterte Benutzerliste
// (admin-nutzer.html?vereinId=) bzw. Turnierliste (admin-turniere.html?vereinId=, Wettkampftag absteigend).
// Verwaltung: anlegen (POST /api/nutzer/vereine), umbenennen (PUT /api/nutzer/vereine/:id { name }), zusammenführen
// (POST /api/nutzer/vereine/:id/zusammenfuehren { zielId }) und leere Vereine löschen (DELETE /api/nutzer/vereine/:id).
// Import: POST /api/nutzer/vereine/import { text, vorschau } (Liste „Name;Bundesland“, erst Vorschau, dann Anlegen).
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

    function aktionsZelle(verein) {
        const td = document.createElement('td');
        const knopf = (icon, text, klasse, handler, gesperrt = false) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `aktion ${klasse}`.trim();
            b.title = text;
            b.setAttribute('aria-label', `${text}: ${verein.name}`);
            b.disabled = gesperrt;
            const i = document.createElement('span');
            i.className = 'material-icons';
            i.textContent = icon;
            b.appendChild(i);
            b.addEventListener('click', handler);
            return b;
        };
        const leer = verein.benutzer_anzahl === 0 && verein.turniere_anzahl === 0;
        td.append(
            knopf('edit', 'Umbenennen', '', () => oeffneVereinDialog(verein)),
            document.createTextNode(' '),
            knopf('merge_type', 'Zusammenführen', '', () => oeffneZusammen(verein), vereine.length < 2),
            document.createTextNode(' '),
            knopf('delete', leer ? 'Löschen' : 'Löschen (nur leere Vereine)', 'gefahr', () => loesche(verein), !leer)
        );
        return td;
    }

    // --- Anlegen und Umbenennen ---
    const vereinDialog = document.getElementById('vereinDialog');
    const vereinFehler = document.getElementById('vereinFehler');
    const vereinName = document.getElementById('vereinName');
    const vereinLand = document.getElementById('vereinLand');
    let bearbeiteterVerein = null; // null = neuen Verein anlegen

    const leereOption = document.createElement('option');
    leereOption.value = '';
    leereOption.textContent = '–';
    vereinLand.appendChild(leereOption);
    for (const land of BUNDESLAENDER) {
        const option = document.createElement('option');
        option.value = land;
        option.textContent = land;
        vereinLand.appendChild(option);
    }

    function oeffneVereinDialog(verein) {
        bearbeiteterVerein = verein || null;
        document.getElementById('vereinDialogTitel').textContent = verein ? 'Verein umbenennen' : 'Verein anlegen';
        document.getElementById('vereinLandBox').hidden = !!verein;
        vereinName.value = verein ? verein.name : '';
        vereinLand.value = '';
        vereinFehler.textContent = '';
        vereinDialog.showModal();
        vereinName.focus();
    }

    document.getElementById('vereinNeuKnopf').addEventListener('click', () => oeffneVereinDialog(null));
    document.getElementById('vereinAbbrechen').addEventListener('click', () => vereinDialog.close());
    document.getElementById('vereinForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const speichern = document.getElementById('vereinSpeichern');
        speichern.disabled = true;
        vereinFehler.textContent = '';
        try {
            const response = bearbeiteterVerein
                ? await fetch(`/api/nutzer/vereine/${encodeURIComponent(bearbeiteterVerein.id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: vereinName.value })
                })
                : await fetch('/api/nutzer/vereine', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: vereinName.value, bundesland: vereinLand.value })
                });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Der Verein konnte nicht gespeichert werden.');
            vereinDialog.close();
            await lade();
            zeigeMeldung('');
        } catch (err) {
            vereinFehler.textContent = err.message;
        } finally {
            speichern.disabled = false;
        }
    });

    // --- Zusammenführen ---
    const zusammenDialog = document.getElementById('zusammenDialog');
    const zusammenFehler = document.getElementById('zusammenFehler');
    const zusammenZiel = document.getElementById('zusammenZiel');
    let zusammenQuelle = null;

    function oeffneZusammen(verein) {
        zusammenQuelle = verein;
        document.getElementById('zusammenText').textContent = `„${verein.name}“ in einen anderen Verein überführen.`;
        zusammenZiel.textContent = '';
        for (const v of vereine.filter(x => x.id !== verein.id)) {
            const option = document.createElement('option');
            option.value = v.id;
            option.textContent = v.name;
            zusammenZiel.appendChild(option);
        }
        zusammenFehler.textContent = '';
        zusammenDialog.showModal();
        zusammenZiel.focus();
    }

    document.getElementById('zusammenAbbrechen').addEventListener('click', () => zusammenDialog.close());
    document.getElementById('zusammenForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!zusammenQuelle) return;
        const speichern = document.getElementById('zusammenSpeichern');
        speichern.disabled = true;
        zusammenFehler.textContent = '';
        try {
            const response = await fetch(`/api/nutzer/vereine/${encodeURIComponent(zusammenQuelle.id)}/zusammenfuehren`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ zielId: Number(zusammenZiel.value) })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Das Zusammenführen ist fehlgeschlagen.');
            zusammenDialog.close();
            await lade();
            zeigeMeldung('');
            info.textContent = `${zusammenQuelle.name} zusammengeführt: ${data.mitglieder} Mitgliedschaften, ${data.turniere} Turniere, ${data.vorlagen} Urkunden-Vorlagen übernommen.`;
        } catch (err) {
            zusammenFehler.textContent = err.message;
        } finally {
            speichern.disabled = false;
        }
    });

    // --- Löschen (nur leere Vereine) ---
    async function loesche(verein) {
        const text = `Verein „${verein.name}“ wirklich löschen?`;
        const bestaetigt = window.zeigeZentraleBestaetigung
            ? await window.zeigeZentraleBestaetigung(text, 'Verein löschen', 'delete')
            : window.confirm(text);
        if (!bestaetigt) return;
        zeigeMeldung('');
        try {
            const response = await fetch(`/api/nutzer/vereine/${encodeURIComponent(verein.id)}`, { method: 'DELETE' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Der Verein konnte nicht gelöscht werden.');
            await lade();
        } catch (err) {
            zeigeMeldung(err.message);
        }
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
            td.colSpan = 5;
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
            tr.appendChild(aktionsZelle(v));
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

    // --- Import (POST /api/nutzer/vereine/import) ---
    const importDialog = document.getElementById('importDialog');
    const importText = document.getElementById('importText');
    const importDatei = document.getElementById('importDatei');
    const importVorschau = document.getElementById('importVorschau');
    const importFehler = document.getElementById('importFehler');
    const importZusammenfassung = document.getElementById('importZusammenfassung');
    const importStarten = document.getElementById('importStarten');
    const importPruefen = document.getElementById('importPruefen');
    const STATUS_TEXT = { neu: 'neu', vorhanden: 'vorhanden', doppelt: 'doppelt', ungueltig: 'ungültig' };
    let geprueft = ''; // Text, für den die Vorschau gilt

    function setzeImportZurueck() {
        importVorschau.hidden = true;
        importVorschau.textContent = '';
        importZusammenfassung.textContent = '';
        importFehler.textContent = '';
        importStarten.disabled = true;
        geprueft = '';
    }

    async function postImport(vorschau) {
        const response = await fetch('/api/nutzer/vereine/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: importText.value, vorschau })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Der Import ist fehlgeschlagen.');
        return data;
    }

    function zeichneVorschau(data) {
        const tabelle = document.createElement('table');
        tabelle.className = 'import-tabelle';
        const kopf = tabelle.createTHead().insertRow();
        for (const text of ['Zeile', 'Verein', 'Bundesland', 'Status']) {
            const th = document.createElement('th');
            th.textContent = text;
            kopf.appendChild(th);
        }
        const body = tabelle.createTBody();
        for (const z of data.zeilen) {
            const tr = body.insertRow();
            tr.insertCell().textContent = String(z.zeile);
            tr.insertCell().textContent = z.name || '–';
            tr.insertCell().textContent = z.bundesland || '–';
            const status = tr.insertCell();
            status.className = `status-${z.status}`;
            status.textContent = z.grund && z.status !== 'neu' ? `${STATUS_TEXT[z.status]}: ${z.grund}` : STATUS_TEXT[z.status];
        }
        importVorschau.textContent = '';
        importVorschau.appendChild(tabelle);
        importVorschau.hidden = false;
        const a = data.anzahl;
        importZusammenfassung.textContent = `${a.neu} neu, ${a.vorhanden} vorhanden, ${a.doppelt} doppelt, ${a.ungueltig} ungültig.`;
        importStarten.disabled = a.neu === 0;
    }

    document.getElementById('importKnopf').addEventListener('click', () => {
        importText.value = '';
        importDatei.value = '';
        setzeImportZurueck();
        importDialog.showModal();
        importText.focus();
    });
    document.getElementById('importAbbrechen').addEventListener('click', () => importDialog.close());
    importText.addEventListener('input', () => { if (importText.value !== geprueft) importStarten.disabled = true; });

    importDatei.addEventListener('change', async () => {
        const datei = importDatei.files && importDatei.files[0];
        if (!datei) return;
        const bytes = await datei.arrayBuffer();
        let text;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); // sonst Excel-CSV in Windows-1252
        } catch (_) {
            text = new TextDecoder('windows-1252').decode(bytes);
        }
        importText.value = text;
        setzeImportZurueck();
    });

    importPruefen.addEventListener('click', async () => {
        setzeImportZurueck();
        importPruefen.disabled = true;
        try {
            const data = await postImport(true);
            geprueft = importText.value;
            zeichneVorschau(data);
        } catch (err) {
            importFehler.textContent = err.message;
        } finally {
            importPruefen.disabled = false;
        }
    });

    document.getElementById('importForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (importText.value !== geprueft) { importFehler.textContent = 'Bitte die Liste zuerst prüfen (Vorschau).'; return; }
        importStarten.disabled = true;
        importFehler.textContent = '';
        try {
            const data = await postImport(false);
            importDialog.close();
            await lade();
            zeigeMeldung('');
            info.textContent = `Import abgeschlossen: ${data.angelegt} Vereine angelegt, ${data.uebersprungen} übersprungen.`;
        } catch (err) {
            importFehler.textContent = err.message;
            importStarten.disabled = false;
        }
    });

    filter.addEventListener('input', zeichne);
    lade();
})();
