// Orga-Planer (orga.html, orga-aufgabe.html): gemeinsame Bausteine - API-Zugriff, Zeilen, Chips, Dialoge.
// Namen und Titel kommen nur per textContent in die Seite.

export function melde(text, typ = 'error') {
    if (window.zeigeNotification) window.zeigeNotification(text, typ);
    else console.warn(text);
}

export function el(tag, klasse, text) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
}

/** fetch mit JSON; liefert { ok, status, daten } (daten = geparste Antwort oder {}). */
export async function api(methode, url, body) {
    const optionen = { method: methode, headers: {} };
    if (body !== undefined) {
        optionen.headers['Content-Type'] = 'application/json';
        optionen.body = JSON.stringify(body);
    }
    try {
        const resp = await fetch(url, optionen);
        let daten = {};
        try { daten = await resp.json(); } catch { /* leere Antwort */ }
        return { ok: resp.ok, status: resp.status, daten: daten && !Array.isArray(daten) ? daten : { liste: daten } };
    } catch {
        return { ok: false, status: 0, daten: { error: 'Server nicht erreichbar.' } };
    }
}

export function turnierIdAusUrl() {
    const p = new URLSearchParams(window.location.search);
    let gemerkt = null;
    try { gemerkt = localStorage.getItem('aktiveTurnierId'); } catch { /* ohne Speicher */ }
    return p.get('turnierId') || p.get('id') || gemerkt;
}

export const PHASEN = [
    { key: 'grundlage', label: 'Grundlage', hinweis: '6 bis 12 Monate vorher, vor allem anderen' },
    { key: 'vorbereitung', label: 'Vorbereitung', hinweis: 'ab 8 Wochen vorher' },
    { key: 'meldephase', label: 'Meldephase', hinweis: 'ab Anmeldeschluss' },
    { key: 'turniertag', label: 'Turniertag', hinweis: 'am Turniertag' },
    { key: 'nachbereitung', label: 'Nachbereitung', hinweis: '1 bis 3 Tage danach' }
];

const LINK_SEITEN = {
    helferplan: 'helfer-plan.html', matten: 'matten.html', teilnehmer: 'teilnehmer.html', pools: 'pools.html',
    turnier: 'turnier.html', waage: 'teilnehmer.html', siegerliste: 'siegerliste.html'
};
const LINK_TEXTE = {
    helferplan: 'Zum Helferplan', matten: 'Zu den Matten', teilnehmer: 'Zu den Teilnehmern', pools: 'Zu den Pools',
    turnier: 'Zum Turnier', waage: 'Zur Anmeldung und Waage', siegerliste: 'Zur Siegerliste'
};

// ---------------------------------------------------------------- Datum

export function heuteBerlin() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}

const tagNummer = (iso) => {
    const [j, m, t] = String(iso).slice(0, 10).split('-').map(Number);
    return Date.UTC(j, m - 1, t) / 86400000;
};

/** Tage von a nach b (b - a), beide als YYYY-MM-DD. */
export function tageZwischen(a, b) {
    return Math.round(tagNummer(b) - tagNummer(a));
}

export function formatiereDatum(iso) {
    const [j, m, t] = String(iso).slice(0, 10).split('-');
    return `${t}.${m}.${j}`;
}

function tageText(n) {
    const betrag = Math.abs(n);
    return `${n < 0 ? '−' : '+'}${betrag} ${betrag === 1 ? 'Tag' : 'Tage'}`;
}

/** Text der Fälligkeit: relativ zum Turniertag, bei manuellem Datum das Datum. */
export function faelligkeitText(aufgabe, turnierDatum) {
    if (!aufgabe.faellig_am) return '';
    if (aufgabe.faellig_manuell || !turnierDatum) return formatiereDatum(aufgabe.faellig_am);
    const diff = tageZwischen(turnierDatum, aufgabe.faellig_am);
    return diff === 0 ? 'Turniertag' : tageText(diff);
}

export function istUeberfaellig(aufgabe) {
    return aufgabe.status?.status !== 'erledigt' && !!aufgabe.faellig_am
        && String(aufgabe.faellig_am).slice(0, 10) < heuteBerlin();
}

// ---------------------------------------------------------------- Kontext

/** Lädt angemeldeten Benutzer und Vereinsmitglieder; ctx wird von den Zeilen und Dialogen genutzt. */
export async function ladeKontext(turnierId) {
    const [me, mit] = await Promise.all([
        api('GET', '/api/auth/me'),
        api('GET', `/api/orga/mitglieder?turnierId=${encodeURIComponent(turnierId)}`)
    ]);
    const user = me.ok ? me.daten.user : null;
    const mitglieder = mit.ok && Array.isArray(mit.daten.liste) ? mit.daten.liste : [];
    const ich = user
        ? { id: String(user.id), name: [user.vorname, user.nachname].filter(Boolean).join(' ').trim() || 'Ich' }
        : { id: null, name: 'Ich' };
    return { turnierId, ich, mitglieder, einzelbenutzer: ich.id === 'offline_user' };
}

const mitgliedName = (m) => [m.vorname, m.nachname].filter(Boolean).join(' ').trim() || m.email || 'Unbekannt';

/** { schluessel, name, ich } der zuständigen Person oder null. */
export function zustaendiger(aufgabe, ctx) {
    if (aufgabe.benutzer_id) {
        const id = String(aufgabe.benutzer_id);
        if (ctx.ich.id === id) return { schluessel: `b:${id}`, name: ctx.ich.name, ich: true };
        const m = ctx.mitglieder.find((x) => String(x.id) === id);
        return { schluessel: `b:${id}`, name: m ? mitgliedName(m) : 'Unbekannt', ich: false };
    }
    if (aufgabe.name_frei) return { schluessel: `n:${aufgabe.name_frei.toLowerCase()}`, name: aufgabe.name_frei, ich: false };
    return null;
}

export function linkUrl(key, turnierId) {
    const seite = LINK_SEITEN[key];
    return seite ? `/${seite}?turnierId=${encodeURIComponent(turnierId)}` : null;
}

// ---------------------------------------------------------------- Dialoge

/** Modales Fenster; Esc und Klick daneben schließen. Liefert { karte, schliesse }. */
export function oeffneModal(titel) {
    const vorher = document.activeElement;
    const huelle = el('div', 'og-modal');
    const karte = el('div', 'og-modal-karte');
    karte.setAttribute('role', 'dialog');
    karte.setAttribute('aria-modal', 'true');
    const kopf = el('h2', null, titel);
    kopf.id = `ogModalTitel${Date.now()}`;
    karte.setAttribute('aria-labelledby', kopf.id);
    karte.append(kopf);
    huelle.append(karte);
    const schliesse = () => {
        document.removeEventListener('keydown', taste, true);
        huelle.remove();
        if (vorher && vorher.focus) vorher.focus();
    };
    const taste = (e) => { if (e.key === 'Escape') { e.stopPropagation(); schliesse(); } };
    document.addEventListener('keydown', taste, true);
    huelle.addEventListener('mousedown', (e) => { if (e.target === huelle) schliesse(); });
    document.body.append(huelle);
    return { karte, schliesse };
}

export async function bestaetige(text, titel = 'Löschen bestätigen') {
    if (window.zeigeZentraleBestaetigung) return window.zeigeZentraleBestaetigung(text, titel, 'delete_outline');
    return window.confirm(text);
}

function feld(id, beschriftung, steuerelement) {
    const gruppe = el('div', 'form-group');
    const label = el('label', null, beschriftung);
    label.htmlFor = id;
    steuerelement.id = id;
    gruppe.append(label, steuerelement);
    return gruppe;
}

function eingabe(typ, wert = '', extra = {}) {
    const i = el('input');
    i.type = typ;
    i.value = wert ?? '';
    Object.assign(i, extra);
    return i;
}

/**
 * Zuweisen-Dialog: Vereinsmitglied oder freier Name (+ optionale E-Mail), oder Zuständigen entfernen.
 * `speichere(ziel)` ruft zuweisen auf (Body wie /zuweisen), `onFertig(modus, name)` nach Erfolg.
 */
export function oeffneZuweisenDialog(aufgabe, ctx, onFertig) {
    const { karte, schliesse } = oeffneModal(`Zuständigen wählen: ${aufgabe.titel}`);
    const form = el('form');
    form.noValidate = true;

    const auswahl = el('select');
    auswahl.append(new Option('Kein Vereinsmitglied', ''));
    for (const m of ctx.mitglieder) auswahl.append(new Option(mitgliedName(m), String(m.id)));
    if (aufgabe.benutzer_id) auswahl.value = String(aufgabe.benutzer_id);

    const name = eingabe('text', aufgabe.benutzer_id ? '' : (aufgabe.name_frei || ''), { maxLength: 100, autocomplete: 'off' });
    const email = eingabe('email', aufgabe.benutzer_id ? '' : (aufgabe.email_frei || ''), { maxLength: 254, autocomplete: 'off' });
    const hinweis = el('p', 'og-hinweis', 'Ohne Vereinskonto: Name eintragen. Mit E-Mail-Adresse erhält die Person in der Cloud eine Einladung.');
    const fehler = el('div', 'og-fehler');
    fehler.setAttribute('role', 'alert');

    const entfernen = el('button', 'btn btn-outlined og-gefahr', 'Zuständigen entfernen');
    entfernen.type = 'button';
    entfernen.hidden = !(aufgabe.benutzer_id || aufgabe.name_frei);
    const abbrechen = el('button', 'btn btn-outlined', 'Abbrechen');
    abbrechen.type = 'button';
    const ok = el('button', 'btn btn-raised', 'Zuweisen');
    ok.type = 'submit';
    const aktionen = el('div', 'og-modal-aktionen');
    aktionen.append(entfernen, abbrechen, ok);

    form.append(feld('ogZuMitglied', 'Vereinsmitglied', auswahl), feld('ogZuName', 'oder freier Name', name),
        feld('ogZuEmail', 'E-Mail-Adresse (optional)', email), hinweis, fehler, aktionen);
    karte.append(form);

    auswahl.addEventListener('change', () => { if (auswahl.value) { name.value = ''; email.value = ''; } });
    for (const f of [name, email]) f.addEventListener('input', () => { if (f.value) auswahl.value = ''; });

    const sende = async (ziel) => {
        ok.disabled = true;
        const r = await api('POST', `/api/orga/aufgaben/${aufgabe.id}/zuweisen`, ziel);
        ok.disabled = false;
        if (!r.ok) { fehler.textContent = r.daten.error || 'Zuweisen fehlgeschlagen.'; return; }
        schliesse();
        await onFertig(r.daten.modus, ziel.benutzerId
            ? (ziel.benutzerId === ctx.ich.id ? ctx.ich.name : mitgliedName(ctx.mitglieder.find((m) => String(m.id) === ziel.benutzerId) || {}))
            : ziel.name);
    };

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        fehler.textContent = '';
        if (auswahl.value) return sende({ benutzerId: auswahl.value });
        if (!name.value.trim()) { fehler.textContent = 'Vereinsmitglied wählen oder Namen eingeben.'; name.focus(); return; }
        const ziel = { name: name.value.trim() };
        if (email.value.trim()) ziel.email = email.value.trim();
        return sende(ziel);
    });
    entfernen.addEventListener('click', () => sende({ frei: false }));
    abbrechen.addEventListener('click', schliesse);
    (aufgabe.benutzer_id || aufgabe.name_frei ? auswahl : (ctx.mitglieder.length ? auswahl : name)).focus();
}

/** Meldung nach dem Zuweisen laut Modus der Antwort. */
export function meldeZuweisung(modus, name, ctx) {
    if (modus === null || modus === undefined) return melde('Zuständiger entfernt.', 'success');
    if (modus === 'konto') {
        return melde(ctx.einzelbenutzer ? `Zugewiesen an ${name}.` : `E-Mail an ${name} verschickt.`, 'success');
    }
    if (modus === 'einladung') return melde('Einladung per E-Mail verschickt.', 'success');
    return melde('Eingetragen.', 'success');
}

/**
 * Aufgabe/Posten/Mitbringeintrag anlegen oder bearbeiten.
 * optionen: { art, aufgabe? (Bearbeiten), elternId?, phase? }
 */
export function oeffneAufgabeDialog(ctx, optionen, onFertig) {
    const { art = 'aufgabe', aufgabe = null, elternId = null } = optionen;
    const bearbeiten = !!aufgabe;
    const nenner = { aufgabe: 'Aufgabe', posten: 'Posten', mitbringen: 'Eintrag' }[art];
    const { karte, schliesse } = oeffneModal(bearbeiten ? `${nenner} bearbeiten` : `${nenner} hinzufügen`);
    const form = el('form');
    form.noValidate = true;

    const titel = eingabe('text', aufgabe?.titel || '', { maxLength: 200, autocomplete: 'off' });
    const notiz = el('textarea');
    notiz.rows = 3;
    notiz.maxLength = 2000;
    notiz.value = aufgabe?.notiz || '';
    const phase = el('select');
    for (const p of PHASEN) phase.append(new Option(p.label, p.key));
    phase.value = aufgabe?.phase || optionen.phase || 'vorbereitung';
    const faellig = eingabe('date', aufgabe?.faellig_manuell ? String(aufgabe.faellig_am).slice(0, 10) : '');
    const faelligHinweis = el('p', 'og-hinweis',
        aufgabe && !aufgabe.faellig_manuell && aufgabe.faellig_am
            ? `Zurzeit automatisch: ${formatiereDatum(aufgabe.faellig_am)}. Ein eigenes Datum überschreibt das.`
            : 'Leer lassen für die automatische Fälligkeit.');
    const menge = eingabe('number', aufgabe?.menge ?? '', { min: 1, max: 99999, step: 1 });
    const fehler = el('div', 'og-fehler');
    fehler.setAttribute('role', 'alert');
    const abbrechen = el('button', 'btn btn-outlined', 'Abbrechen');
    abbrechen.type = 'button';
    const ok = el('button', 'btn btn-raised', bearbeiten ? 'Speichern' : 'Hinzufügen');
    ok.type = 'submit';
    const aktionen = el('div', 'og-modal-aktionen');
    aktionen.append(abbrechen, ok);

    form.append(feld('ogAufTitel', 'Titel', titel));
    if (art === 'aufgabe') {
        form.append(feld('ogAufNotiz', 'Notiz (optional)', notiz), feld('ogAufPhase', 'Phase', phase),
            feld('ogAufFaellig', 'Fälligkeit (optional)', faellig), faelligHinweis);
    } else {
        form.append(feld('ogAufMenge', 'Menge (optional)', menge));
    }
    form.append(fehler, aktionen);
    karte.append(form);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        fehler.textContent = '';
        if (!titel.value.trim()) { fehler.textContent = 'Titel eingeben.'; titel.focus(); return; }
        const body = { titel: titel.value.trim() };
        if (art === 'aufgabe') {
            body.notiz = notiz.value.trim() || null;
            body.phase = phase.value;
            if (faellig.value) body.faellig_am = faellig.value;
            else if (aufgabe?.faellig_manuell) body.faellig_am = null;
        } else {
            body.menge = menge.value === '' ? null : Number(menge.value);
        }
        ok.disabled = true;
        const r = bearbeiten
            ? await api('PUT', `/api/orga/aufgaben/${aufgabe.id}`, body)
            : await api('POST', '/api/orga/aufgaben', { ...body, turnierId: ctx.turnierId, art, ...(elternId ? { eltern_id: elternId } : {}) });
        ok.disabled = false;
        if (!r.ok) { fehler.textContent = r.daten.error || 'Speichern fehlgeschlagen.'; return; }
        schliesse();
        await onFertig(r.daten.id);
    });
    abbrechen.addEventListener('click', schliesse);
    titel.focus();
}

// ---------------------------------------------------------------- Zeilen

/** Status-Knopf (Checkbox-Rolle): offen leer, angefangen halb gefüllt, erledigt grün gefüllt. */
export function baueStatusKnopf(aufgabe, onUmschalten) {
    const status = aufgabe.status?.status || 'offen';
    const knopf = el('button', `og-punkt og-punkt-${status}`);
    knopf.type = 'button';
    knopf.setAttribute('role', 'checkbox');
    knopf.setAttribute('aria-checked', status === 'erledigt' ? 'true' : status === 'angefangen' ? 'mixed' : 'false');
    knopf.setAttribute('aria-label', `${aufgabe.titel}: ${status === 'erledigt' ? 'als offen markieren' : 'als erledigt markieren'}`);
    knopf.title = status === 'erledigt' ? 'Als offen markieren' : 'Als erledigt markieren';
    knopf.append(el('span', 'og-punkt-fuellung'));
    knopf.addEventListener('click', () => onUmschalten(aufgabe, status !== 'erledigt'));
    return knopf;
}

export async function setzeErledigt(aufgabe, erledigt) {
    const r = await api('POST', `/api/orga/aufgaben/${aufgabe.id}/erledigt`, { erledigt });
    if (!r.ok) melde(r.daten.error || 'Speichern fehlgeschlagen.');
    return r.ok;
}

export function baueZustaendigenChip(aufgabe, ctx, onGeaendert) {
    const z = zustaendiger(aufgabe, ctx);
    const ueberfaellig = istUeberfaellig(aufgabe);
    const knopf = el('button', 'og-chip og-chip-person');
    knopf.type = 'button';
    if (z) {
        knopf.textContent = z.ich ? 'Du' : z.name;
        if (z.ich) knopf.classList.add('og-chip-ich');
        knopf.setAttribute('aria-label', `Zuständig: ${z.name}. Ändern`);
        knopf.title = z.name;
    } else {
        knopf.textContent = 'Zuweisen';
        knopf.classList.add('og-chip-leer');
        knopf.setAttribute('aria-label', `Zuständigen für ${aufgabe.titel} zuweisen`);
    }
    if (ueberfaellig) knopf.classList.add('og-chip-rot');
    knopf.addEventListener('click', () => oeffneZuweisenDialog(aufgabe, ctx, async (modus, name) => {
        meldeZuweisung(modus, name, ctx);
        await onGeaendert();
    }));
    return knopf;
}

export function baueFaelligkeitChip(aufgabe, turnierDatum) {
    const text = faelligkeitText(aufgabe, turnierDatum);
    if (!text) return null;
    const chip = el('span', 'og-chip og-chip-faellig', text);
    chip.title = `Fällig am ${formatiereDatum(aufgabe.faellig_am)}${aufgabe.faellig_manuell ? '' : ' (automatisch)'}`;
    if (istUeberfaellig(aufgabe)) {
        chip.classList.add('og-chip-rot');
        chip.title += ', überfällig';
    }
    return chip;
}

function fortschrittText(aufgabe) {
    const posten = (aufgabe.kinder || []).filter((k) => k.art !== 'mitbringen');
    if (posten.length) return `${posten.filter((k) => k.status.status === 'erledigt').length} von ${posten.length} Posten`;
    if (aufgabe.status?.quelle === 'helferplan') return `${aufgabe.status.erledigt} von ${aufgabe.status.gesamt} Plätzen`;
    return '';
}

/**
 * Eine Zeile der Checkliste (Hauptaufgabe) oder einer Unterliste (Posten).
 * optionen: { turnierDatum, mitDetails (Chevron/Link/Bearbeiten/Löschen), neuLaden }
 */
export function baueZeile(aufgabe, ctx, optionen) {
    const { turnierDatum, neuLaden, mitAktionen = true, mitDetails = true, postenModus = false } = optionen;
    const status = aufgabe.status?.status || 'offen';
    const zeile = el('div', 'og-zeile');
    zeile.dataset.aufgabeId = aufgabe.id;
    zeile.classList.add(`og-status-${status}`);
    if (istUeberfaellig(aufgabe)) zeile.classList.add('og-ueberfaellig');

    const punkt = baueStatusKnopf(aufgabe, async (a, erledigt) => {
        if (!(await setzeErledigt(a, erledigt))) return;
        await neuLaden({ pruefeErledigt: erledigt ? null : a.id });
    });

    const text = el('div', 'og-text');
    const titelZeile = el('div', 'og-titel-zeile');
    titelZeile.append(el('span', 'og-titel', aufgabe.titel));
    if (postenModus && aufgabe.menge != null) titelZeile.append(el('span', 'og-menge', `${aufgabe.menge}×`));
    const url = !postenModus && aufgabe.link ? linkUrl(aufgabe.link, ctx.turnierId) : null;
    if (url) {
        const a = el('a', 'og-link', LINK_TEXTE[aufgabe.link] || 'Öffnen');
        a.href = url;
        titelZeile.append(a);
    }
    text.append(titelZeile);
    const meta = el('div', 'og-meta');
    const fortschritt = postenModus ? '' : fortschrittText(aufgabe);
    if (fortschritt) meta.append(el('span', 'og-fortschritt', fortschritt));
    if (!postenModus && aufgabe.status?.quelle === 'helferplan') {
        meta.append(el('span', 'og-auto', 'automatisch: aus dem Helferplan'));
    }
    if (aufgabe.notiz && !postenModus) meta.append(el('span', 'og-notiz', aufgabe.notiz));
    if (meta.childNodes.length) text.append(meta);

    const chips = el('div', 'og-chips');
    chips.append(baueZustaendigenChip(aufgabe, ctx, neuLaden));
    const faellig = postenModus ? null : baueFaelligkeitChip(aufgabe, turnierDatum);
    if (faellig) chips.append(faellig);

    const aktionen = el('div', 'og-aktionen');
    if (mitDetails && !postenModus && ((aufgabe.kinder || []).some((k) => k.art !== 'mitbringen') || aufgabe.mitbringliste)) {
        const oeffnen = el('a', 'og-icon-knopf og-oeffnen');
        oeffnen.href = `/orga-aufgabe.html?id=${encodeURIComponent(aufgabe.id)}&turnierId=${encodeURIComponent(ctx.turnierId)}`;
        oeffnen.setAttribute('aria-label', `${aufgabe.titel}: Posten öffnen`);
        oeffnen.title = 'Posten öffnen';
        oeffnen.append(el('span', 'material-icons', 'chevron_right'));
        aktionen.append(oeffnen);
    }
    if (mitAktionen) {
        const bearbeiten = el('button', 'og-icon-knopf');
        bearbeiten.type = 'button';
        bearbeiten.setAttribute('aria-label', `${aufgabe.titel} bearbeiten`);
        bearbeiten.title = 'Bearbeiten';
        bearbeiten.append(el('span', 'material-icons', 'edit'));
        bearbeiten.addEventListener('click', () => oeffneAufgabeDialog(ctx,
            { art: postenModus ? 'posten' : 'aufgabe', aufgabe }, () => neuLaden()));
        const loeschen = el('button', 'og-icon-knopf og-icon-gefahr');
        loeschen.type = 'button';
        loeschen.setAttribute('aria-label', `${aufgabe.titel} löschen`);
        loeschen.title = 'Löschen';
        loeschen.append(el('span', 'material-icons', 'delete_outline'));
        loeschen.addEventListener('click', async () => {
            const hatKinder = (aufgabe.kinder || []).length > 0;
            const frage = hatKinder
                ? `"${aufgabe.titel}" mit allen Posten löschen?`
                : `"${aufgabe.titel}" löschen?`;
            if (!(await bestaetige(frage))) return;
            const r = await api('DELETE', `/api/orga/aufgaben/${aufgabe.id}`);
            if (!r.ok) return melde(r.daten.error || 'Löschen fehlgeschlagen.');
            await neuLaden();
        });
        aktionen.append(bearbeiten, loeschen);
    }

    zeile.append(punkt, text, chips, aktionen);
    return zeile;
}

export function zeigeZugriffsFehler(box, antwort) {
    box.textContent = antwort.status === 403
        ? 'Für den Orga-Planer brauchen Sie die Rolle Benutzer oder Admin in diesem Verein.'
        : (antwort.daten.error || 'Der Orga-Planer konnte nicht geladen werden.');
}
