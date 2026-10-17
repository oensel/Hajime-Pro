// Seite admin-nutzer.html (nur Super-Admins): Liste aller Konten mit Vereinen/Rollen und Umschalter Super-Admin.
// API: GET /api/nutzer, POST /api/nutzer/:id/super-admin { wert }. Der Authorization-Header kommt aus dem
// globalen fetch-Wrapper in menu.js.
(function () {
    const ROLLEN_NAMEN = { admin: 'Admin', benutzer: 'Benutzer', helfer: 'Helfer' };
    const liste = document.getElementById('nutzerListe');
    const meldung = document.getElementById('nutzerMeldung');
    const filter = document.getElementById('nutzerFilter');
    let konten = [];

    function zeigeMeldung(text) {
        meldung.textContent = text || '';
    }

    function zelle(text) {
        const td = document.createElement('td');
        td.textContent = text;
        return td;
    }

    function vereineZelle(mitgliedschaften) {
        const td = document.createElement('td');
        if (mitgliedschaften.length === 0) {
            td.textContent = '–';
            return td;
        }
        for (const m of mitgliedschaften) {
            const zeile = document.createElement('span');
            zeile.className = 'verein';
            zeile.textContent = m.verein_name + ' ';
            const status = document.createElement('span');
            status.className = 'status';
            status.textContent = m.freigegeben ? `(${ROLLEN_NAMEN[m.rolle] || m.rolle})` : '(wartet auf Freischaltung)';
            zeile.appendChild(status);
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

    function zeichne() {
        const suche = filter.value.trim().toLowerCase();
        liste.textContent = '';
        const sichtbar = konten.filter(k => passt(k, suche));
        if (sichtbar.length === 0) {
            const tr = document.createElement('tr');
            const td = zelle('Keine Konten gefunden.');
            td.colSpan = 4;
            tr.appendChild(td);
            liste.appendChild(tr);
            return;
        }
        for (const k of sichtbar) {
            const tr = document.createElement('tr');
            tr.dataset.id = k.id;
            tr.appendChild(zelle(`${k.vorname} ${k.nachname}`));
            tr.appendChild(zelle(k.email + (k.email_bestaetigt ? '' : ' (unbestätigt)')));
            tr.appendChild(vereineZelle(k.mitgliedschaften));
            tr.appendChild(umschalterZelle(k));
            liste.appendChild(tr);
        }
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
            if (!response.ok) throw new Error(data.error || 'Die Konten konnten nicht geladen werden.');
            konten = data;
            zeichne();
        } catch (err) {
            liste.textContent = '';
            zeigeMeldung(err.message);
        }
    }

    filter.addEventListener('input', zeichne);
    lade();
})();
