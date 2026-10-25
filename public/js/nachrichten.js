// Seite nachrichten.html: Postfach (GET/POST /api/nachrichten, src/routes/nachrichtenRoutes.js).
// Alle Texte kommen über textContent in die Seite (Nachrichten sind fremde Eingaben).
(function () {
    const $ = (id) => document.getElementById(id);
    const meldung = $('meldung');
    let aktuelleId = null;
    let auswahl = { darfAnKonten: false, eigeneVereine: [], vereine: [] };
    const gewaehlt = new Map();

    const zeigeFehler = (text) => { meldung.textContent = text || ''; };

    async function api(pfad, optionen) {
        const antwort = await fetch(`/api/nachrichten${pfad}`, optionen);
        const daten = await antwort.json().catch(() => ({}));
        if (!antwort.ok || daten.success === false) throw new Error(daten.error || 'Die Anfrage ist fehlgeschlagen.');
        return daten;
    }
    const sende = (pfad, body) => api(pfad, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const zeitText = (t) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    const option = (wert, text) => { const o = document.createElement('option'); o.value = wert; o.textContent = text; return o; };

    function zeigeRechts(was) {
        $('rechtsLeer').hidden = was !== 'leer';
        $('ansicht').hidden = was !== 'ansicht';
        $('neuForm').hidden = was !== 'neu';
        zeigeFehler('');
    }

    async function ladeListe() {
        const { threads } = await api('');
        const ul = $('liste');
        ul.replaceChildren();
        $('listeLeer').hidden = threads.length > 0;
        for (const t of threads) {
            const li = document.createElement('li');
            li.className = `${t.ungelesen ? 'ungelesen' : ''} ${t.id === aktuelleId ? 'aktiv' : ''}`.trim();
            const betreff = document.createElement('div'); betreff.className = 'betreff'; betreff.textContent = t.betreff;
            const wer = document.createElement('div'); wer.className = 'wer'; wer.textContent = `${t.letzteVon || t.absender} · ${zeitText(t.aktualisiertAm)}`;
            const vorschau = document.createElement('div'); vorschau.className = 'vorschau'; vorschau.textContent = t.vorschau;
            li.append(betreff, wer, vorschau);
            li.addEventListener('click', () => oeffne(t.id));
            ul.appendChild(li);
        }
        return threads;
    }

    function zeigeThread(thread) {
        aktuelleId = thread.id;
        $('ansichtBetreff').textContent = thread.betreff;
        const mit = thread.teilnehmer.map((t) => t.name).join(', ');
        $('ansichtInfo').textContent = thread.anSuperAdmins ? `Von ${thread.absender}${thread.absenderEmail ? ` (${thread.absenderEmail})` : ''} an die Super-Admins` : `Teilnehmer: ${mit}`;
        const anfrage = $('ansichtAnfrage');
        anfrage.hidden = !thread.anfrageVerein;
        if (thread.anfrageVerein) {
            anfrage.replaceChildren(`Vereinsanfrage für „${thread.anfrageVerein}“. `);
            const a = document.createElement('a'); a.href = '/admin-vereine.html'; a.textContent = 'Zur Vereinsverwaltung';
            anfrage.appendChild(a);
        }
        const verlauf = $('verlauf');
        verlauf.replaceChildren();
        for (const n of thread.nachrichten) {
            const b = document.createElement('div'); b.className = `blase${n.eigene ? ' eigene' : ''}`;
            const kopf = document.createElement('div'); kopf.className = 'kopf'; kopf.textContent = `${n.von} · ${zeitText(n.erstelltAm)}`;
            const text = document.createElement('div'); text.textContent = n.text;
            b.append(kopf, text);
            verlauf.appendChild(b);
        }
        $('antwortText').value = '';
        zeigeRechts('ansicht');
    }

    async function oeffne(id) {
        try {
            const { thread } = await api(`/${id}`);
            if (!thread) return;
            zeigeThread(thread);
            await ladeListe();
            window.hajimeAktualisiereNachrichten?.();
        } catch (e) { zeigeFehler(e.message); }
    }

    // --- Neue Nachricht ---
    function aktualisiereZiel() {
        const art = $('neuZiel').value;
        $('neuVereinBox').hidden = !(art === 'eigener-verein' || art === 'fremder-verein');
        $('neuPersonenBox').hidden = art !== 'personen';
        const select = $('neuVerein');
        select.replaceChildren();
        const eigeneIds = new Set(auswahl.eigeneVereine.map((v) => v.id));
        const liste = art === 'eigener-verein' ? auswahl.eigeneVereine : auswahl.vereine.filter((v) => !eigeneIds.has(v.id));
        for (const v of liste) select.appendChild(option(v.id, v.name));
    }

    function zeichneChips() {
        const chips = $('neuChips');
        chips.replaceChildren();
        for (const [id, name] of gewaehlt) {
            const s = document.createElement('span'); s.textContent = `${name} ✕`;
            s.addEventListener('click', () => { gewaehlt.delete(id); zeichneChips(); });
            chips.appendChild(s);
        }
    }

    async function ladeFremdeAdmins() {
        const vereinId = $('neuFremderVerein').value;
        const select = $('neuFremd');
        select.replaceChildren(option('', '– Person wählen –'));
        $('neuFremdBox').hidden = !vereinId;
        if (!vereinId) return;
        try {
            const { admins } = await api(`/empfaenger/admins?vereinId=${encodeURIComponent(vereinId)}`);
            for (const a of admins) select.appendChild(option(a.id, a.name));
            if (admins.length === 0) select.replaceChildren(option('', 'Dieser Verein hat keine Admins'));
        } catch (e) { zeigeFehler(e.message); }
    }

    function oeffneNeu(ziel) {
        const zielSelect = $('neuZiel');
        zielSelect.replaceChildren(option('super_admins', 'Super-Admins (Kontakt, Fragen)'));
        if (auswahl.darfAnKonten) {
            if (auswahl.eigeneVereine.length) zielSelect.appendChild(option('eigener-verein', 'Alle Mitglieder meines Vereins'));
            zielSelect.appendChild(option('fremder-verein', 'Alle Admins eines anderen Vereins'));
            zielSelect.appendChild(option('personen', 'Einzelne Personen'));
            const eigene = $('neuEigene');
            eigene.replaceChildren(option('', '– Person wählen –'));
            for (const v of auswahl.eigeneVereine) for (const m of v.mitglieder) eigene.appendChild(option(m.id, `${m.name} (${v.name})`));
            $('neuEigeneBox').hidden = auswahl.eigeneVereine.length === 0;
            const fremd = $('neuFremderVerein');
            const eigeneIds = new Set(auswahl.eigeneVereine.map((v) => v.id));
            fremd.replaceChildren(option('', '– Verein wählen –'));
            for (const v of auswahl.vereine.filter((x) => !eigeneIds.has(x.id))) fremd.appendChild(option(v.id, v.name));
        }
        zielSelect.value = ziel || 'super_admins';
        zielSelect.disabled = !auswahl.darfAnKonten;
        gewaehlt.clear();
        zeichneChips();
        $('neuFremdBox').hidden = true;
        $('neuBetreff').value = '';
        $('neuText').value = '';
        aktualisiereZiel();
        aktuelleId = null;
        zeigeRechts('neu');
        ladeListe();
    }

    $('neuZiel').addEventListener('change', aktualisiereZiel);
    $('neuFremderVerein').addEventListener('change', ladeFremdeAdmins);
    $('neuEigene').addEventListener('change', (e) => {
        const o = e.target.selectedOptions[0];
        if (o && o.value) { gewaehlt.set(o.value, o.textContent.replace(/ \(.*\)$/, '')); zeichneChips(); }
        e.target.value = '';
    });
    $('neuFremd').addEventListener('change', (e) => {
        const o = e.target.selectedOptions[0];
        if (o && o.value) { gewaehlt.set(o.value, o.textContent); zeichneChips(); }
        e.target.value = '';
    });
    $('neuKnopf').addEventListener('click', () => oeffneNeu());

    $('neuForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const art = $('neuZiel').value;
        let ziel;
        if (art === 'super_admins') ziel = { art: 'super_admins' };
        else if (art === 'personen') ziel = { art: 'personen', benutzerIds: [...gewaehlt.keys()] };
        else ziel = { art: 'verein', vereinId: Number($('neuVerein').value) };
        try {
            const { id } = await sende('', { betreff: $('neuBetreff').value, text: $('neuText').value, ziel });
            await oeffne(id);
        } catch (err) { zeigeFehler(err.message); }
    });

    $('antwortForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const { thread } = await sende(`/${aktuelleId}/antworten`, { text: $('antwortText').value });
            zeigeThread(thread);
            await ladeListe();
        } catch (err) { zeigeFehler(err.message); }
    });

    async function start() {
        try {
            auswahl = await api('/empfaenger');
            const threads = await ladeListe();
            const suche = new URLSearchParams(window.location.search);
            if (suche.get('neu')) return oeffneNeu(suche.get('neu') === 'super' ? 'super_admins' : undefined);
            const id = Number(suche.get('id'));
            if (id) return oeffne(id);
            if (threads[0] && window.matchMedia('(min-width: 801px)').matches) await oeffne(threads[0].id);
        } catch (e) { zeigeFehler(e.message); }
    }
    start();
})();
