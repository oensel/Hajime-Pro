// Seite konsole.html (nur Super-Admins, nur Cloud): das Fehlerprotokoll (GET/DELETE /api/konsole, src/routes/konsoleRoutes.js) als Terminal mit
// Kennzahlen-Kacheln als Filter, Quelle, Suche, Gruppieren und Live-Ansicht. Live: alle 3 Sekunden werden nur Einträge mit größerer ID als der
// zuletzt gesehenen geholt und oben eingefügt (neue Zeilen blinken kurz); die Kacheln zählen dabei mit.
(function () {
    const $ = (id) => document.getElementById(id);
    const liste = $('kListe');
    const meldung = $('kMeldung');
    const aelterKnopf = $('kAelter');
    const EBENEN = { info: ['Info', 'info'], warn: ['Warnung', 'warning'], error: ['Fehler', 'error'] };
    const QUELLEN = { server: 'Server', prozess: 'Prozess', browser: 'Browser' };
    const zustand = { ebene: 'alle', quelle: '', gruppiert: false, live: true };
    let hoechsteId = 0;
    let niedrigsteId = null;
    let sichtbar = 0;
    let letzterErfolg = 0;
    let fehlerBeimAbruf = false;
    let abrufLaeuft = false;
    let taktTimer = null;
    let suchTimer = null;

    // --- kleine Helfer ---
    const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text != null) e.textContent = text; return e; };
    const symbol = (name) => el('span', 'material-icons', name);

    function relativ(iso) {
        const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
        if (s < 60) return `vor ${s} Sek.`;
        if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
        if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
        const tage = Math.floor(s / 86400);
        return tage === 1 ? 'gestern' : `vor ${tage} Tagen`;
    }

    const uhrzeit = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour12: false });
    const datumZeit = (iso) => new Date(iso).toLocaleString('de-DE');

    /** Meldungstext mit farbigen Teilen: [Marke]:, Zahlen mit Einheit, Dateinamen und Adressen (nur DOM-Knoten, nie HTML). */
    const MUSTER = /(\[[^\]]{1,60}\]:?)|(\b\d+(?:[.,]\d+)?\s?(?:MB|KB|GB|ms|Sek\.|Min\.|s|%)(?![\w])|\b\d+×)|([\w./-]+\.(?:js|mjs|gz|html|json)\b|[\w.-]+\.[a-z]{2,}:\d{2,5}\b)/g;
    function faerbe(text) {
        const fragment = document.createDocumentFragment();
        let ende = 0;
        for (const m of text.matchAll(MUSTER)) {
            if (m.index > ende) fragment.append(text.slice(ende, m.index));
            const klasse = m[1] ? (m.index === 0 ? 'kopf' : 'marke') : m[2] ? 'wert' : 'marke';
            fragment.append(el('span', klasse, m[0]));
            ende = m.index + m[0].length;
        }
        if (ende < text.length) fragment.append(text.slice(ende));
        return fragment;
    }

    function stackAnsicht(text) {
        const box = el('div', 'k-stack');
        text.split('\n').forEach((zeile, i, alle) => {
            let teil;
            if (i === 0 && !/^\s*at /.test(zeile)) teil = el('span', 'hervor', zeile);
            else if (/(^|[ (/\\])src[/\\]/.test(zeile) && !/node_modules/.test(zeile)) teil = el('span', 'eigen', zeile);
            else teil = document.createTextNode(zeile);
            box.append(teil, i < alle.length - 1 ? '\n' : '');
        });
        return box;
    }

    function chip(icon, text) { const c = el('span', 'k-chip'); c.append(symbol(icon), text); return c; }

    function ebeneBadge(ebene) {
        const [text, icon] = EBENEN[ebene] || [ebene, 'info'];
        const b = el('span', `k-ebene ${ebene}`);
        b.append(symbol(icon), text);
        return b;
    }

    async function kopiere(text, knopf) {
        try { await navigator.clipboard.writeText(text); } catch {
            const t = el('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
        }
        const ico = knopf.querySelector('.material-icons');
        ico.textContent = 'check';
        setTimeout(() => { ico.textContent = 'content_copy'; }, 1200);
    }

    // --- Zeilen ---
    function eintragZeile(e, { neu = false, offen = false } = {}) {
        const zeile = el('div', `k-zeile ${e.ebene}${neu ? ' neu' : ''}`);
        const zeit = el('div', 'k-zeit', uhrzeit(e.zeitpunkt));
        zeit.title = datumZeit(e.zeitpunkt);
        const rel = el('small', null, relativ(e.zeitpunkt));
        rel.dataset.zeit = e.zeitpunkt;
        zeit.append(rel);
        const text = el('div', 'k-text');
        text.append(faerbe(e.meldung));
        if (e.pfad || e.benutzer) {
            const chips = el('div', 'k-chips');
            if (e.pfad) chips.append(chip('link', e.pfad));
            if (e.benutzer) chips.append(chip('person', e.benutzer));
            text.append(chips);
        }
        const rechts = el('div', 'k-rechts');
        if (e.details && e.details !== e.meldung) {
            // Die Einzelheiten beginnen mit der Meldung selbst: diese erste Zeile steht schon oben und entfällt hier
            const zeilen = e.details.split('\n');
            const stack = stackAnsicht(zeilen[0].trim() === e.meldung && zeilen.length > 1 ? zeilen.slice(1).join('\n') : e.details);
            stack.hidden = !offen;
            text.append(stack);
            const auf = el('button'); auf.type = 'button';
            auf.append(symbol(offen ? 'expand_less' : 'expand_more'));
            auf.title = offen ? 'Einzelheiten zuklappen' : 'Einzelheiten aufklappen';
            auf.addEventListener('click', () => {
                stack.hidden = !stack.hidden;
                auf.firstChild.textContent = stack.hidden ? 'expand_more' : 'expand_less';
                auf.title = stack.hidden ? 'Einzelheiten aufklappen' : 'Einzelheiten zuklappen';
            });
            rechts.append(auf);
        }
        const kop = el('button'); kop.type = 'button'; kop.title = 'Kopieren';
        kop.append(symbol('content_copy'));
        kop.addEventListener('click', () => kopiere(`${datumZeit(e.zeitpunkt)} ${(EBENEN[e.ebene] || [e.ebene])[0]} ${QUELLEN[e.quelle] || e.quelle}\n${e.details || e.meldung}${e.pfad ? `\n${e.pfad}` : ''}${e.benutzer ? `\n${e.benutzer}` : ''}`, kop));
        rechts.append(kop);
        zeile.append(zeit, ebeneBadge(e.ebene), el('div', 'k-quelle', QUELLEN[e.quelle] || e.quelle), text, rechts);
        return zeile;
    }

    function gruppenZeile(g) {
        const zeile = el('div', `k-zeile ${g.ebene}`);
        const zeit = el('div', 'k-zeit', uhrzeit(g.zuletzt));
        zeit.title = datumZeit(g.zuletzt);
        const rel = el('small', null, relativ(g.zuletzt));
        rel.dataset.zeit = g.zuletzt;
        zeit.append(rel);
        const text = el('div', 'k-text');
        text.append(faerbe(g.meldung));
        const chips = el('div', 'k-chips');
        chips.append(chip('repeat', `${g.anzahl}× · erstmals ${datumZeit(g.erstmals)}`));
        text.append(chips);
        zeile.append(zeit, ebeneBadge(g.ebene), el('div', 'k-quelle', QUELLEN[g.quelle] || g.quelle), text, el('div', 'k-rechts'));
        return zeile;
    }

    function leerHinweis() { liste.replaceChildren(el('div', 'k-leer', 'Keine Einträge. Das ist gut.')); }

    // --- Daten ---
    function parameter(extra = {}) {
        const p = new URLSearchParams();
        if (zustand.ebene !== 'alle') p.set('ebene', zustand.ebene);
        if (zustand.quelle) p.set('quelle', zustand.quelle);
        const suche = $('kSuche').value.trim();
        if (suche) p.set('suche', suche);
        if (zustand.gruppiert) p.set('gruppiert', '1');
        for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
        return p;
    }

    async function hole(p) {
        const response = await fetch(`/api/konsole?${p}`);
        const daten = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(daten.error || 'Die Konsole konnte nicht geladen werden.');
        return daten;
    }

    function zeigeZaehler(z) {
        if (!z) return;
        $('zAlle').textContent = String(z.gesamt);
        $('zInfo').textContent = String(z.info);
        $('zWarn').textContent = String(z.warn);
        $('zError').textContent = String(z.error);
    }

    function zeigeFuss() {
        $('kFuss').textContent = `${sichtbar} ${zustand.gruppiert ? 'verschiedene Meldungen' : 'Einträge'}${zustand.live ? ' · Live aktiv' : ''} · Aufbewahrung 30 Tage`;
    }

    async function ladeNeu() {
        meldung.textContent = '';
        try {
            const daten = await hole(parameter());
            zeigeZaehler(daten.zaehler);
            liste.replaceChildren();
            if (zustand.gruppiert) {
                for (const g of daten.gruppen) liste.append(gruppenZeile(g));
                sichtbar = daten.gruppen.length;
                aelterKnopf.hidden = true;
                if (!sichtbar) leerHinweis();
            } else {
                // der neueste Fehler ist aufgeklappt
                const ersterFehler = daten.eintraege.findIndex((e) => e.ebene === 'error');
                daten.eintraege.forEach((e, i) => liste.append(eintragZeile(e, { offen: i === ersterFehler })));
                sichtbar = daten.eintraege.length;
                hoechsteId = Math.max(Number(daten.neuesteId) || 0, ...daten.eintraege.map((e) => Number(e.id)), 0);
                niedrigsteId = sichtbar ? Math.min(...daten.eintraege.map((e) => Number(e.id))) : null;
                aelterKnopf.hidden = sichtbar < 200;
                if (!sichtbar) leerHinweis();
            }
            fehlerBeimAbruf = false;
            letzterErfolg = Date.now();
            zeigeFuss();
        } catch (err) {
            liste.replaceChildren();
            meldung.textContent = err.message;
            fehlerBeimAbruf = true;
        }
        zeigeLive();
    }

    async function nachladen() {
        if (abrufLaeuft || zustand.gruppiert) return;
        abrufLaeuft = true;
        try {
            const daten = await hole(parameter({ nach: hoechsteId, limit: 200 }));
            zeigeZaehler(daten.zaehler);
            const neu = daten.eintraege.filter((e) => Number(e.id) > hoechsteId);
            if (neu.length) {
                liste.querySelector('.k-leer')?.remove();
                const erste = liste.firstChild;
                for (const e of neu) liste.insertBefore(eintragZeile(e, { neu: true }), erste);
                sichtbar += neu.length;
                hoechsteId = Math.max(hoechsteId, ...neu.map((e) => Number(e.id)));
            }
            hoechsteId = Math.max(hoechsteId, Number(daten.neuesteId) || 0);
            fehlerBeimAbruf = false;
            letzterErfolg = Date.now();
            meldung.textContent = '';
            zeigeFuss();
        } catch (err) {
            fehlerBeimAbruf = true;
            meldung.textContent = err.message;
        } finally {
            abrufLaeuft = false;
            zeigeLive();
        }
    }

    // --- Anzeige oben rechts und Takt ---
    function zeigeLive() {
        const pill = $('kLive');
        const aktiv = zustand.live && !document.hidden;
        pill.className = `k-live${fehlerBeimAbruf ? ' fehler' : !aktiv ? ' pause' : ''}`;
        $('kLiveText').textContent = fehlerBeimAbruf ? 'Keine Verbindung' : aktiv ? 'Live' : 'Pausiert';
        const sek = letzterErfolg ? Math.max(0, Math.round((Date.now() - letzterErfolg) / 1000)) : null;
        $('kLiveZeit').textContent = sek == null ? '' : `· zuletzt vor ${sek} ${sek === 1 ? 'Sekunde' : 'Sekunden'}`;
    }

    function taktSetzen() {
        clearInterval(taktTimer);
        taktTimer = zustand.live && !document.hidden ? setInterval(nachladen, 3000) : null;
        zeigeLive();
    }

    setInterval(() => {
        zeigeLive();
        for (const k of liste.querySelectorAll('small[data-zeit]')) k.textContent = relativ(k.dataset.zeit);
    }, 1000);

    // --- Bedienung ---
    function schalterSetzen(knopf, an) { knopf.classList.toggle('an', an); knopf.setAttribute('aria-checked', String(an)); }

    for (const k of document.querySelectorAll('.k-kachel')) {
        k.addEventListener('click', () => {
            zustand.ebene = k.dataset.ebene;
            for (const x of document.querySelectorAll('.k-kachel')) x.classList.toggle('aktiv', x === k);
            ladeNeu();
        });
    }
    for (const k of document.querySelectorAll('#kQuellen button')) {
        k.addEventListener('click', () => {
            zustand.quelle = k.dataset.quelle;
            for (const x of document.querySelectorAll('#kQuellen button')) x.classList.toggle('an', x === k);
            ladeNeu();
        });
    }
    $('kSuche').addEventListener('input', () => { clearTimeout(suchTimer); suchTimer = setTimeout(ladeNeu, 300); });
    $('kGruppiert').addEventListener('click', () => { zustand.gruppiert = !zustand.gruppiert; schalterSetzen($('kGruppiert'), zustand.gruppiert); ladeNeu(); });
    $('kLiveSchalter').addEventListener('click', () => { zustand.live = !zustand.live; schalterSetzen($('kLiveSchalter'), zustand.live); taktSetzen(); zeigeFuss(); });
    document.addEventListener('visibilitychange', taktSetzen);

    aelterKnopf.addEventListener('click', async () => {
        try {
            const daten = await hole(parameter({ vor: niedrigsteId }));
            for (const e of daten.eintraege) liste.append(eintragZeile(e));
            sichtbar += daten.eintraege.length;
            if (daten.eintraege.length) niedrigsteId = Math.min(...daten.eintraege.map((e) => Number(e.id)));
            aelterKnopf.hidden = daten.eintraege.length < 200;
            zeigeFuss();
        } catch (err) {
            meldung.textContent = err.message;
        }
    });

    $('kLeeren').addEventListener('click', async () => {
        const text = 'Das gesamte Fehlerprotokoll löschen?';
        const bestaetigt = window.zeigeZentraleBestaetigung ? await window.zeigeZentraleBestaetigung(text, 'Konsole leeren', 'delete') : window.confirm(text);
        if (!bestaetigt) return;
        try {
            const response = await fetch('/api/konsole', { method: 'DELETE' });
            if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Die Konsole konnte nicht geleert werden.');
            await ladeNeu();
        } catch (err) {
            meldung.textContent = err.message;
        }
    });

    ladeNeu().then(taktSetzen);
})();
