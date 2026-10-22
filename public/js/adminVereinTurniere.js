// Seite admin-turniere.html (nur Super-Admins): die gespeicherten Turniere eines Vereins (?vereinId=), Wettkampftag
// absteigend. API: GET /api/nutzer/vereine/:id/turniere, POST /api/nutzer/turniere/:id/archivieren { wert },
// DELETE /api/nutzer/turniere/:id.
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
        td.colSpan = 7;
        tr.appendChild(td);
        liste.appendChild(tr);
    }

    function aktionsZelle(t) {
        const td = document.createElement('td');
        const knopf = (icon, text, klasse, handler, gesperrt = false) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `aktion ${klasse}`.trim();
            b.title = text;
            b.setAttribute('aria-label', `${text}: ${t.bezeichnung}`);
            b.disabled = gesperrt;
            const i = document.createElement('span');
            i.className = 'material-icons';
            i.textContent = icon;
            b.appendChild(i);
            b.addEventListener('click', handler);
            return b;
        };
        td.append(
            knopf(t.archiviert ? 'unarchive' : 'archive', t.archiviert ? 'Wiederherstellen' : 'Archivieren', '', () => archiviere(t, !t.archiviert), !t.archiviert && t.aktiv),
            document.createTextNode(' '),
            knopf('delete', 'Endgültig löschen', 'gefahr', () => loesche(t), t.aktiv)
        );
        return td;
    }

    async function archiviere(t, wert) {
        meldung.textContent = '';
        try {
            const response = await fetch(`/api/nutzer/turniere/${encodeURIComponent(t.id)}/archivieren`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wert })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Das Turnier konnte nicht geändert werden.');
            await lade();
        } catch (err) {
            meldung.textContent = err.message;
        }
    }

    async function loesche(t) {
        const text = `Turnier „${t.bezeichnung}“ mit ${t.teilnehmer_anzahl} Teilnehmern und allen Kämpfen endgültig löschen? Das lässt sich nicht rückgängig machen.`;
        const bestaetigt = window.zeigeZentraleBestaetigung
            ? await window.zeigeZentraleBestaetigung(text, 'Turnier löschen', 'delete')
            : window.confirm(text);
        if (!bestaetigt) return;
        meldung.textContent = '';
        try {
            const response = await fetch(`/api/nutzer/turniere/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Das Turnier konnte nicht gelöscht werden.');
            await lade();
        } catch (err) {
            meldung.textContent = err.message;
        }
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
                if (t.archiviert) tr.classList.add('archiviert');
                tr.appendChild(zelle(datumDeutsch(t.datum)));
                tr.appendChild(zelle(t.bezeichnung));
                tr.appendChild(zelle(t.ort || ''));
                tr.appendChild(zelle(t.bundesland || '–'));
                tr.appendChild(zelle((STATUS[t.status] || t.status || '') + (t.archiviert ? ' (archiviert)' : '')));
                tr.appendChild(zelle(String(t.teilnehmer_anzahl)));
                tr.appendChild(aktionsZelle(t));
                liste.appendChild(tr);
            }
        } catch (err) {
            liste.textContent = '';
            meldung.textContent = err.message;
        }
    }

    lade();
})();
