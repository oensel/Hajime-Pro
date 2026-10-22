// Seite admin-nutzer.html („Benutzer“, nur Super-Admins): alle Konten mit Vereinen und Rollen, getrennt in
// Super-Admins (oben, eigener Bereich) und übrige Benutzer; die Rolle je Verein ist änderbar, ebenso Super-Admin.
// API: GET /api/nutzer, PUT /api/nutzer/:id { vorname, nachname, email }, DELETE /api/nutzer/:id,
// POST /api/nutzer/:id/passwort { passwort, aendernErforderlich }, POST /api/nutzer/:id/super-admin { wert },
// POST /api/nutzer/:id/sperren { wert }, POST /api/nutzer/:id/bestaetigen, POST /api/nutzer/:id/bestaetigungs-mail,
// POST /api/nutzer/:id/passwort-mail, DELETE /api/nutzer/unbestaetigte { aelterAlsTage },
// POST /api/vereine/rolle { userId, vereinId, rolle }.
// Der Authorization-Header kommt aus dem globalen fetch-Wrapper in menu.js.
(function () {
    const ROLLEN = [['admin', 'Admin'], ['benutzer', 'Benutzer'], ['helfer', 'Helfer']];
    const superListe = document.getElementById('superListe');
    const liste = document.getElementById('nutzerListe');
    const meldung = document.getElementById('nutzerMeldung');
    const ok = document.getElementById('nutzerOk');
    const filter = document.getElementById('nutzerFilter');
    let konten = [];
    let eigeneId = null;
    let aktuellerKonto = null;
    // Gefiltert auf einen Verein (Link aus der Vereinsübersicht: admin-nutzer.html?vereinId=)
    const vereinFilterId = new URLSearchParams(window.location.search).get('vereinId');
    const vereinFilterBox = document.getElementById('vereinFilterBox');

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

    const nurUnbestaetigt = document.getElementById('nurUnbestaetigt');

    function passt(konto, suche) {
        if (nurUnbestaetigt && nurUnbestaetigt.checked && konto.email_bestaetigt) return false;
        if (vereinFilterId && !konto.mitgliedschaften.some(m => String(m.verein_id) === String(vereinFilterId))) return false;
        if (!suche) return true;
        const text = [konto.vorname, konto.nachname, konto.email, ...konto.mitgliedschaften.map(m => m.verein_name)]
            .join(' ').toLowerCase();
        return text.includes(suche);
    }

    const nachName = (a, b) => (a.nachname || '').localeCompare(b.nachname || '', 'de')
        || (a.vorname || '').localeCompare(b.vorname || '', 'de')
        || (a.email || '').localeCompare(b.email || '', 'de');

    function aktionsZelle(konto) {
        const td = document.createElement('td');
        const knopf = (icon, text, klasse, handler, gesperrt = false) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `aktion ${klasse}`.trim();
            b.title = text;
            b.setAttribute('aria-label', `${text}: ${konto.vorname} ${konto.nachname}`);
            b.disabled = gesperrt;
            const i = document.createElement('span');
            i.className = 'material-icons';
            i.textContent = icon;
            b.appendChild(i);
            b.addEventListener('click', handler);
            return b;
        };
        td.append(
            knopf('edit', 'Bearbeiten', '', () => oeffneBearbeiten(konto)),
            document.createTextNode(' '),
            knopf('key', 'Initialpasswort vergeben', '', () => oeffnePasswort(konto)),
            document.createTextNode(' '),
            knopf('forward_to_inbox', 'Passwort-Zurücksetzen-Mail senden', '', () => sendePasswortMail(konto), konto.gesperrt || !konto.email_bestaetigt),
            document.createTextNode(' ')
        );
        if (!konto.email_bestaetigt) {
            td.append(
                knopf('mark_email_read', 'E-Mail von Hand bestätigen', '', () => bestaetige(konto)),
                document.createTextNode(' '),
                knopf('send', 'Bestätigungsmail erneut senden', '', () => sendeBestaetigungsMail(konto)),
                document.createTextNode(' ')
            );
        }
        const istSelbst = String(konto.id) === String(eigeneId);
        td.append(
            knopf(konto.gesperrt ? 'lock_open' : 'block', konto.gesperrt ? 'Entsperren' : 'Sperren', '', () => setzeGesperrt(konto, !konto.gesperrt), !konto.gesperrt && istSelbst),
            document.createTextNode(' '),
            knopf('delete', 'Löschen', 'gefahr', () => loesche(konto), istSelbst)
        );
        return td;
    }

    function fuelle(tbody, anzahlFeld, eintraege, leerText) {
        tbody.textContent = '';
        anzahlFeld.textContent = `(${eintraege.length})`;
        if (eintraege.length === 0) {
            const tr = document.createElement('tr');
            const td = zelle(leerText);
            td.colSpan = 6;
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }
        for (const k of eintraege) {
            const tr = document.createElement('tr');
            tr.dataset.id = k.id;
            tr.appendChild(zelle(`${k.vorname} ${k.nachname}`));
            tr.appendChild(zelle(k.email + (k.email_bestaetigt ? '' : ' (unbestätigt)') + (k.gesperrt ? ' (gesperrt)' : '')));
            if (k.gesperrt) tr.classList.add('gesperrt');
            tr.appendChild(vereinZelle(k));
            tr.appendChild(rolleZelle(k));
            tr.appendChild(umschalterZelle(k));
            tr.appendChild(aktionsZelle(k));
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

    function zeigeVereinFilter() {
        if (!vereinFilterId || !vereinFilterBox) return;
        const name = konten.flatMap(k => k.mitgliedschaften).find(m => String(m.verein_id) === String(vereinFilterId));
        vereinFilterBox.textContent = '';
        const text = document.createElement('span');
        text.textContent = `Nur Benutzer von: ${name ? name.verein_name : `Verein ${vereinFilterId}`} `;
        const alle = document.createElement('a');
        alle.href = '/admin-nutzer.html';
        alle.textContent = 'Alle Benutzer anzeigen';
        const zurueck = document.createElement('a');
        zurueck.href = '/admin-vereine.html';
        zurueck.textContent = 'Zurück zu den Vereinen';
        vereinFilterBox.append(text, alle, document.createTextNode(' · '), zurueck);
        vereinFilterBox.hidden = false;
    }

    // --- Bearbeiten ---
    const bearbeitenDialog = document.getElementById('bearbeitenDialog');
    const bearbeitenFehler = document.getElementById('bearbeitenFehler');

    function oeffneBearbeiten(konto) {
        aktuellerKonto = konto;
        document.getElementById('bearbeitenVorname').value = konto.vorname || '';
        document.getElementById('bearbeitenNachname').value = konto.nachname || '';
        document.getElementById('bearbeitenEmail').value = konto.email || '';
        bearbeitenFehler.textContent = '';
        bearbeitenDialog.showModal();
    }

    document.getElementById('bearbeitenAbbrechen').addEventListener('click', () => bearbeitenDialog.close());
    document.getElementById('bearbeitenForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!aktuellerKonto) return;
        const speichern = document.getElementById('bearbeitenSpeichern');
        speichern.disabled = true;
        bearbeitenFehler.textContent = '';
        try {
            const response = await fetch(`/api/nutzer/${encodeURIComponent(aktuellerKonto.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vorname: document.getElementById('bearbeitenVorname').value,
                    nachname: document.getElementById('bearbeitenNachname').value,
                    email: document.getElementById('bearbeitenEmail').value
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Das Konto konnte nicht geändert werden.');
            Object.assign(aktuellerKonto, { vorname: data.vorname, nachname: data.nachname, email: data.email });
            bearbeitenDialog.close();
            zeichne();
            zeigeMeldung(`Gespeichert: ${data.vorname} ${data.nachname}`, true);
        } catch (err) {
            bearbeitenFehler.textContent = err.message;
        } finally {
            speichern.disabled = false;
        }
    });

    // --- Initialpasswort ---
    const passwortDialog = document.getElementById('passwortDialog');
    const passwortFehler = document.getElementById('passwortFehler');

    function oeffnePasswort(konto) {
        aktuellerKonto = konto;
        document.getElementById('passwortFuer').textContent = `${konto.vorname} ${konto.nachname} (${konto.email})`;
        document.getElementById('passwortFeld').value = '';
        document.getElementById('passwortAendern').checked = true;
        passwortFehler.textContent = '';
        passwortDialog.showModal();
        document.getElementById('passwortFeld').focus();
    }

    document.getElementById('passwortAbbrechen').addEventListener('click', () => passwortDialog.close());
    document.getElementById('passwortForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!aktuellerKonto) return;
        const speichern = document.getElementById('passwortSpeichern');
        speichern.disabled = true;
        passwortFehler.textContent = '';
        try {
            const response = await fetch(`/api/nutzer/${encodeURIComponent(aktuellerKonto.id)}/passwort`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    passwort: document.getElementById('passwortFeld').value,
                    aendernErforderlich: document.getElementById('passwortAendern').checked
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Das Passwort konnte nicht gesetzt werden.');
            aktuellerKonto.email_bestaetigt = true;
            passwortDialog.close();
            document.getElementById('passwortFeld').value = '';
            zeichne();
            zeigeMeldung(`Passwort für ${aktuellerKonto.vorname} ${aktuellerKonto.nachname} gesetzt${data.aendernErforderlich ? ' (muss beim nächsten Anmelden geändert werden)' : ''}.`, true);
        } catch (err) {
            passwortFehler.textContent = err.message;
        } finally {
            speichern.disabled = false;
        }
    });

    // --- Sperren, Bestätigung, Passwort-Mail ---
    async function kontoAktion(konto, pfad, methode, body) {
        zeigeMeldung('');
        const response = await fetch(`/api/nutzer/${encodeURIComponent(konto.id)}/${pfad}`, {
            method: methode,
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Die Aktion ist fehlgeschlagen.');
        return data;
    }

    const kontoName = (konto) => `${konto.vorname} ${konto.nachname}`.trim() || konto.email;

    async function setzeGesperrt(konto, wert) {
        try {
            if (wert) {
                const text = `Konto „${kontoName(konto)}“ sperren? Die Person kann sich nicht mehr anmelden und bestehende Anmeldungen enden sofort. Alle Daten bleiben erhalten.`;
                const bestaetigt = window.zeigeZentraleBestaetigung
                    ? await window.zeigeZentraleBestaetigung(text, 'Konto sperren', 'block')
                    : window.confirm(text);
                if (!bestaetigt) return;
            }
            await kontoAktion(konto, 'sperren', 'POST', { wert });
            konto.gesperrt = wert;
            zeichne();
            zeigeMeldung(`${kontoName(konto)} ist ${wert ? 'gesperrt' : 'wieder freigegeben'}.`, true);
        } catch (err) {
            zeigeMeldung(err.message);
        }
    }

    async function bestaetige(konto) {
        try {
            await kontoAktion(konto, 'bestaetigen', 'POST');
            konto.email_bestaetigt = true;
            zeichne();
            zeigeMeldung(`E-Mail-Adresse von ${kontoName(konto)} bestätigt.`, true);
        } catch (err) {
            zeigeMeldung(err.message);
        }
    }

    async function sendeBestaetigungsMail(konto) {
        try {
            await kontoAktion(konto, 'bestaetigungs-mail', 'POST');
            zeigeMeldung(`Bestätigungsmail an ${konto.email} gesendet.`, true);
        } catch (err) {
            zeigeMeldung(err.message);
        }
    }

    async function sendePasswortMail(konto) {
        try {
            await kontoAktion(konto, 'passwort-mail', 'POST');
            zeigeMeldung(`Mail zum Zurücksetzen des Passworts an ${konto.email} gesendet.`, true);
        } catch (err) {
            zeigeMeldung(err.message);
        }
    }

    // Nie bestätigte Konten, die älter als 30 Tage sind, aufräumen
    const AUFRAEUM_TAGE = 30;
    const aufraeumKnopf = document.getElementById('aufraeumenKnopf');
    if (aufraeumKnopf) {
        aufraeumKnopf.addEventListener('click', async () => {
            const grenze = Date.now() - AUFRAEUM_TAGE * 24 * 60 * 60 * 1000;
            const betroffen = konten.filter(k => !k.email_bestaetigt && !k.ist_super_admin && k.erstellt_am && Date.parse(k.erstellt_am) < grenze).length;
            if (betroffen === 0) {
                zeigeMeldung(`Keine unbestätigten Konten, die älter als ${AUFRAEUM_TAGE} Tage sind.`, true);
                return;
            }
            const text = `${betroffen} nie bestätigte Konten, die älter als ${AUFRAEUM_TAGE} Tage sind, löschen?`;
            const bestaetigt = window.zeigeZentraleBestaetigung
                ? await window.zeigeZentraleBestaetigung(text, 'Unbestätigte Konten löschen', 'delete')
                : window.confirm(text);
            if (!bestaetigt) return;
            try {
                const response = await fetch('/api/nutzer/unbestaetigte', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ aelterAlsTage: AUFRAEUM_TAGE })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || 'Das Aufräumen ist fehlgeschlagen.');
                await lade();
                zeigeMeldung(`${data.geloescht} unbestätigte Konten gelöscht.`, true);
            } catch (err) {
                zeigeMeldung(err.message);
            }
        });
    }

    // --- Löschen ---
    async function loesche(konto) {
        const name = `${konto.vorname} ${konto.nachname}`.trim() || konto.email;
        const text = `Benutzer „${name}“ (${konto.email}) wirklich löschen? Die Mitgliedschaften in allen Vereinen und eingetragene Helferdienste gehen verloren.`;
        const bestaetigt = window.zeigeZentraleBestaetigung
            ? await window.zeigeZentraleBestaetigung(text, 'Benutzer löschen', 'delete')
            : window.confirm(text);
        if (!bestaetigt) return;
        zeigeMeldung('');
        try {
            const response = await fetch(`/api/nutzer/${encodeURIComponent(konto.id)}`, { method: 'DELETE' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Das Konto konnte nicht gelöscht werden.');
            konten = konten.filter(k => k.id !== konto.id);
            zeichne();
            zeigeMeldung(`Gelöscht: ${name}`, true);
        } catch (err) {
            zeigeMeldung(err.message);
        }
    }

    async function ladeEigeneId() {
        try {
            const response = await fetch('/api/auth/me');
            if (response.ok) eigeneId = (await response.json()).user.id;
        } catch { /* ohne eigene ID bleibt Löschen des eigenen Kontos serverseitig gesperrt */ }
    }

    async function lade() {
        await ladeEigeneId();
        try {
            const response = await fetch('/api/nutzer');
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Die Benutzer konnten nicht geladen werden.');
            konten = data;
            zeigeVereinFilter();
            zeichne();
        } catch (err) {
            superListe.textContent = '';
            liste.textContent = '';
            zeigeMeldung(err.message);
        }
    }

    filter.addEventListener('input', zeichne);
    if (nurUnbestaetigt) nurUnbestaetigt.addEventListener('change', zeichne);
    lade();
})();
