// Seite protokoll.html: das Aktionsprotokoll (GET /api/protokoll, src/routes/protokollRoutes.js). Super-Admins sehen alle Einträge,
// Admins die ihrer Vereine. Filter: Zeitraum, Benutzer, Aktion/Stichwort, Verein; 50 Einträge je Seite.
(function () {
    const liste = document.getElementById('protokollListe');
    const meldung = document.getElementById('protokollMeldung');
    const info = document.getElementById('seiteInfo');
    const zurueck = document.getElementById('seiteZurueck');
    const weiter = document.getElementById('seiteWeiter');
    const felder = { von: 'fVon', bis: 'fBis', benutzer: 'fBenutzer', suche: 'fSuche', vereinId: 'fVerein' };
    let seite = 1;
    let seiten = 1;

    function parameter() {
        const p = new URLSearchParams({ seite: String(seite) });
        for (const [name, id] of Object.entries(felder)) {
            const wert = document.getElementById(id).value.trim();
            if (wert) p.set(name, wert);
        }
        return p;
    }

    const zelle = (tr, ...inhalt) => { const td = tr.insertCell(); td.append(...inhalt); return td; };
    const klein = (text) => { const s = document.createElement('span'); s.className = 'klein'; s.textContent = text; return s; };

    function einzelheiten(e) {
        const teile = [];
        const d = e.details || {};
        if (d.ziel) teile.push(`Ziel: ${d.ziel}`);
        if (e.turnier_id != null) teile.push(`Turnier ${e.turnier_id}`);
        if (e.status && e.status >= 300) teile.push(`Status ${e.status}`);
        if (d.ip) teile.push(d.ip);
        return teile.join(' · ');
    }

    function zeichne(daten) {
        liste.textContent = '';
        if (daten.eintraege.length === 0) {
            const td = liste.insertRow().insertCell();
            td.colSpan = 5;
            td.textContent = 'Keine Einträge gefunden.';
        }
        for (const e of daten.eintraege) {
            const tr = liste.insertRow();
            const zeit = zelle(tr, new Date(e.zeitpunkt).toLocaleString('de-DE'));
            zeit.className = 'zeit';
            const name = zelle(tr, e.benutzer_name || e.benutzer_email || 'unbekannt');
            if (e.benutzer_name && e.benutzer_email) name.append(klein(e.benutzer_email));
            if (e.rolle) {
                const r = document.createElement('span');
                r.className = `rolle rolle-${e.rolle}`;
                r.textContent = daten.rollen[e.rolle] || e.rolle;
                name.append(' ', r);
            }
            zelle(tr, e.verein_name || '–');
            const aktion = zelle(tr, e.beschreibung);
            aktion.append(klein(e.aktion));
            zelle(tr, einzelheiten(e));
        }
        seiten = daten.seiten;
        info.textContent = `Seite ${daten.seite} von ${daten.seiten} · ${daten.gesamt} Einträge`;
        zurueck.disabled = daten.seite <= 1;
        weiter.disabled = daten.seite >= daten.seiten;
    }

    async function lade() {
        meldung.textContent = '';
        try {
            const response = await fetch(`/api/protokoll?${parameter()}`);
            const daten = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(daten.error || 'Das Protokoll konnte nicht geladen werden.');
            zeichne(daten);
        } catch (err) {
            liste.textContent = '';
            meldung.textContent = err.message;
        }
    }

    async function ladeVereine() {
        try {
            const response = await fetch('/api/protokoll/vereine');
            if (!response.ok) return;
            const daten = await response.json();
            const auswahl = document.getElementById('fVerein');
            for (const v of daten.vereine) {
                const option = document.createElement('option');
                option.value = String(v.id);
                option.textContent = v.name;
                auswahl.appendChild(option);
            }
            // Ein Admin mit nur einem Verein braucht die Auswahl nicht
            if (!daten.superAdmin && daten.vereine.length <= 1) document.getElementById('fVereinBox').hidden = true;
            if (!daten.superAdmin) document.getElementById('protokollHinweis').textContent += ' Sie sehen die Einträge Ihrer Vereine.';
        } catch (_) { /* Auswahl bleibt bei „Alle“ */ }
    }

    document.getElementById('protokollFilter').addEventListener('submit', (e) => { e.preventDefault(); seite = 1; lade(); });
    document.getElementById('fZurueck').addEventListener('click', () => {
        for (const id of Object.values(felder)) document.getElementById(id).value = '';
        seite = 1;
        lade();
    });
    zurueck.addEventListener('click', () => { if (seite > 1) { seite -= 1; lade(); } });
    weiter.addEventListener('click', () => { if (seite < seiten) { seite += 1; lade(); } });

    ladeVereine();
    lade();
})();
