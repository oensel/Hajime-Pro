// Seite admin-nutzer.html („Benutzer“, nur Super-Admins): alle Konten mit Vereinen und Rollen, getrennt in
// Super-Admins (oben, eigener Bereich) und übrige Benutzer; die Rolle je Verein ist änderbar, ebenso Super-Admin.
// API: GET /api/nutzer, POST /api/nutzer/:id/super-admin { wert }, POST /api/vereine/rolle { userId, vereinId, rolle }.
// Der Authorization-Header kommt aus dem globalen fetch-Wrapper in menu.js.
(function () {
    const ROLLEN = [['admin', 'Admin'], ['benutzer', 'Benutzer'], ['helfer', 'Helfer']];
    const superListe = document.getElementById('superListe');
    const liste = document.getElementById('nutzerListe');
    const meldung = document.getElementById('nutzerMeldung');
    const ok = document.getElementById('nutzerOk');
    const filter = document.getElementById('nutzerFilter');
    let konten = [];

    function zeigeMeldung(text, erfolg = false) {
        meldung.textContent = erfolg ? '' : (text || '');
        ok.textContent = erfolg ? (text || '') : '';
    }

    function zelle(text) {
        const td = document.createElement('td');
        td.textContent = text;
        return td;
    }

    async function aendereRolle(konto, mitgliedschaft, auswahl, vorher) {
        zeigeMeldung('');
        auswahl.disabled = true;
        try {
            const response = await fetch('/api/vereine/rolle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: konto.id, vereinId: mitgliedschaft.verein_id, rolle: auswahl.value })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Die Rolle konnte nicht geändert werden.');
            mitgliedschaft.rolle = auswahl.value;
            const rollenName = (ROLLEN.find(r => r[0] === auswahl.value) || [])[1] || auswahl.value;
            zeigeMeldung(`${konto.vorname} ${konto.nachname}: Rolle in ${mitgliedschaft.verein_name} ist jetzt ${rollenName}.`, true);
        } catch (err) {
            auswahl.value = vorher;
            zeigeMeldung(err.message);
        } finally {
            auswahl.disabled = false;
        }
    }

    function rollenAuswahl(konto, m) {
        const auswahl = document.createElement('select');
        auswahl.setAttribute('aria-label', `Rolle von ${konto.vorname} ${konto.nachname} in ${m.verein_name}`);
        for (const [wert, name] of ROLLEN) {
            const option = document.createElement('option');
            option.value = wert;
            option.textContent = name;
            auswahl.appendChild(option);
        }
        auswahl.value = m.rolle;
        let vorher = m.rolle;
        auswahl.addEventListener('change', async () => {
            const neu = auswahl.value;
            await aendereRolle(konto, m, auswahl, vorher);
            if (m.rolle === neu) vorher = neu;
        });
        return auswahl;
    }

    // Spalte Verein: je Mitgliedschaft eine Zeile (gleiche Höhe wie in der Spalte Rolle, damit beide untereinander passen)
    function vereinZelle(konto) {
        const td = document.createElement('td');
        if (konto.mitgliedschaften.length === 0) {
            td.textContent = '–';
            return td;
        }
        for (const m of konto.mitgliedschaften) {
            const zeile = document.createElement('div');
            zeile.className = 'zeile';
            zeile.textContent = m.verein_name;
            zeile.title = m.verein_name;
            td.appendChild(zeile);
        }
        return td;
    }

    // Spalte Rolle: Auswahl je Mitgliedschaft (oder der Hinweis, solange sie nicht freigegeben ist)
    function rolleZelle(konto) {
        const td = document.createElement('td');
        if (konto.mitgliedschaften.length === 0) {
            td.textContent = '–';
            return td;
        }
        for (const m of konto.mitgliedschaften) {
            const zeile = document.createElement('div');
            zeile.className = 'zeile';
            if (m.freigegeben && m.rolle) {
                zeile.appendChild(rollenAuswahl(konto, m));
            } else {
                const status = document.createElement('span');
                status.className = 'status';
                status.textContent = 'wartet auf Freischaltung';
                zeile.appendChild(status);
            }
            td.appendChild(zeile);
        }
        return td;
    }

    function umschalterZelle(konto) {
        const td = document.createElement('td');
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = konto.ist_super_admin;
        box.setAttribute('aria-label', `Super-Admin: ${konto.vorname} ${konto.nachname}`);
        box.addEventListener('change', () => setzeSuperAdmin(konto, box));
        label.appendChild(box);
        td.appendChild(label);
        return td;
    }

    function passt(konto, suche) {
        if (!suche) return true;
        const text = [konto.vorname, konto.nachname, konto.email, ...konto.mitgliedschaften.map(m => m.verein_name)]
            .join(' ').toLowerCase();
        return text.includes(suche);
    }

    const nachName = (a, b) => (a.nachname || '').localeCompare(b.nachname || '', 'de')
        || (a.vorname || '').localeCompare(b.vorname || '', 'de')
        || (a.email || '').localeCompare(b.email || '', 'de');

    function fuelle(tbody, anzahlFeld, eintraege, leerText) {
        tbody.textContent = '';
        anzahlFeld.textContent = `(${eintraege.length})`;
        if (eintraege.length === 0) {
            const tr = document.createElement('tr');
            const td = zelle(leerText);
            td.colSpan = 5;
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }
        for (const k of eintraege) {
            const tr = document.createElement('tr');
            tr.dataset.id = k.id;
            tr.appendChild(zelle(`${k.vorname} ${k.nachname}`));
            tr.appendChild(zelle(k.email + (k.email_bestaetigt ? '' : ' (unbestätigt)')));
            tr.appendChild(vereinZelle(k));
            tr.appendChild(rolleZelle(k));
            tr.appendChild(umschalterZelle(k));
            tbody.appendChild(tr);
        }
    }

    function zeichne() {
        const suche = filter.value.trim().toLowerCase();
        const sichtbar = konten.filter(k => passt(k, suche)).sort(nachName);
        fuelle(superListe, document.getElementById('superAnzahl'), sichtbar.filter(k => k.ist_super_admin), 'Keine Super-Admins gefunden.');
        fuelle(liste, document.getElementById('nutzerAnzahl'), sichtbar.filter(k => !k.ist_super_admin), 'Keine Benutzer gefunden.');
    }

    async function setzeSuperAdmin(konto, box) {
        const wert = box.checked;
        zeigeMeldung('');
        box.disabled = true;
        try {
            const response = await fetch(`/api/nutzer/${encodeURIComponent(konto.id)}/super-admin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wert })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Ändern fehlgeschlagen.');
            konto.ist_super_admin = wert;
            zeichne(); // wechselt den Bereich (Super-Admins stehen oben, getrennt)
        } catch (err) {
            box.checked = !wert;
            zeigeMeldung(err.message);
        } finally {
            box.disabled = false;
        }
    }

    async function lade() {
        try {
            const response = await fetch('/api/nutzer');
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Die Benutzer konnten nicht geladen werden.');
            konten = data;
            zeichne();
        } catch (err) {
            superListe.textContent = '';
            liste.textContent = '';
            zeigeMeldung(err.message);
        }
    }

    filter.addEventListener('input', zeichne);
    lade();
})();
