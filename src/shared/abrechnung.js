// Reine Abrechnungslogik (Startgeld-Rechnungen): kein knex, kein DOM.

export const STAMMDATEN_FELDER = ['anschrift', 'rechnung_email', 'absender_name', 'ust_hinweis', 'rechnungs_praefix'];

const leer = (w) => w == null || String(w).trim() === '';

export function fehlendeStammdaten(stammdaten, turnier) {
    const s = stammdaten || {};
    const tu = turnier || {};
    const fehlt = [];
    if (leer(s.anschrift)) fehlt.push('Anschrift');
    if (leer(s.rechnung_email)) fehlt.push('Rechnungs-E-Mail');
    if (leer(s.absender_name)) fehlt.push('Absendername');
    if (leer(s.steuernummer) && leer(s.ust_id)) fehlt.push('Steuernummer oder USt-IdNr.');
    if (leer(s.ust_hinweis)) fehlt.push('Umsatzsteuer-Hinweis');
    if (leer(s.rechnungs_praefix)) fehlt.push('Rechnungsnummern-Präfix');
    const turnierBank = !leer(tu.iban) && !leer(tu.kontoinhaber);
    if (!turnierBank && !s.iban_vorhanden) fehlt.push('Kontoinhaber und IBAN');
    return fehlt;
}

export function pruefePraefix(text) {
    if (leer(text)) return 'Der Rechnungsnummern-Präfix darf nicht leer sein.';
    if (!/^[A-Za-z0-9-]{1,12}$/.test(String(text))) {
        return 'Der Präfix darf nur Buchstaben, Ziffern und Bindestrich enthalten (höchstens 12 Zeichen).';
    }
    return null;
}

export function formatiereRechnungsnummer(praefix, nummer) {
    return `${praefix}${String(nummer).padStart(5, '0')}`;
}

export function kaempferSchluessel(t) {
    const pass = String(t.judopass_id ?? '').trim();
    if (pass) return `pass:${pass.toLowerCase()}`;
    const teil = [t.vorname, t.nachname, t.geburtsjahr].map((x) => String(x ?? '').trim().toLowerCase());
    return `name:${teil.join('|')}`;
}

const normName = (s) => String(s ?? '').trim().toLowerCase();

export function zaehleKaempferJeVerein(teilnehmer, { basis, ausrichterName }) {
    const ausrichter = ausrichterName ? normName(ausrichterName) : null;
    const jeVerein = new Map();
    for (const t of teilnehmer || []) {
        if (t.status === 'zurueckgezogen') continue;
        const vereinName = String(t.verein ?? '').trim();
        if (!vereinName) continue;
        const vKey = normName(vereinName);
        if (ausrichter && vKey === ausrichter) continue;
        if (basis === 'teilnahme_waage' && !t.gewogen) continue;
        let eintrag = jeVerein.get(vKey);
        if (!eintrag) {
            eintrag = { vereinName, kaempfer: [], anzahl: 0, bezahltAnzahl: 0, _gesehen: new Map() };
            jeVerein.set(vKey, eintrag);
        }
        const k = kaempferSchluessel(t);
        const vorhanden = eintrag._gesehen.get(k);
        if (vorhanden) {
            if (t.startgeld_bezahlt && !vorhanden.bezahlt) {
                vorhanden.bezahlt = true;
                eintrag.bezahltAnzahl += 1;
            }
            continue;
        }
        const pass = String(t.judopass_id ?? '').trim();
        eintrag._gesehen.set(k, { bezahlt: !!t.startgeld_bezahlt });
        eintrag.kaempfer.push({
            name: `${String(t.nachname ?? '').trim()}, ${String(t.vorname ?? '').trim()}`,
            judopass_id: pass || null
        });
        eintrag.anzahl += 1;
        if (t.startgeld_bezahlt) eintrag.bezahltAnzahl += 1;
    }
    for (const e of jeVerein.values()) {
        e.kaempfer.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        delete e._gesehen;
    }
    return jeVerein;
}

const MAX_ZWECK = 140;

export function baueVerwendungszweck(vorlage, { turnierName, vereinName, rechnungsnummer }) {
    let text = leer(vorlage) ? 'Startgeld <Turniername> <Verein> <Rechnungsnummer>' : String(vorlage).trim();
    if (!text.includes('<Rechnungsnummer>')) text += ' <Rechnungsnummer>';
    const nr = String(rechnungsnummer ?? '');
    let turnier = String(turnierName ?? '').trim();
    let verein = String(vereinName ?? '').trim();
    const baue = () => text
        .split('<Turniername>').join(turnier)
        .split('<Verein>').join(verein)
        .split('<Rechnungsnummer>').join(nr);
    let ergebnis = baue();
    while (ergebnis.length > MAX_ZWECK && (turnier.length > 0 || verein.length > 0)) {
        if (turnier.length >= verein.length) turnier = turnier.slice(0, -1);
        else verein = verein.slice(0, -1);
        ergebnis = baue();
    }
    if (ergebnis.length > MAX_ZWECK) {
        // Vorlage selbst zu lang: Text vor der Nummer kürzen, die Nummer bleibt erhalten.
        const rest = MAX_ZWECK - nr.length - 1;
        ergebnis = `${ergebnis.replace(nr, '').trim().slice(0, Math.max(rest, 0)).trim()} ${nr}`.trim();
    }
    return ergebnis;
}

export function addiereTage(isoDatum, tage) {
    const [j, m, d] = String(isoDatum).slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(j, m - 1, d + tage));
    return dt.toISOString().slice(0, 10);
}

export function heuteBerlin(jetzt = new Date()) {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(jetzt);
}

export function rechnungsAnzeigeStatus(rechnung, heute) {
    const { status, zahlungsziel_datum: ziel } = rechnung;
    if (status === 'versandt' && ziel && String(ziel).slice(0, 10) < heute) return 'ueberfaellig';
    return status;
}

export function rechnungsArt({ zahlweg, anzahl, bezahltAnzahl }) {
    return zahlweg === 'bar' && anzahl > 0 && bezahltAnzahl >= anzahl ? 'quittung' : 'rechnung';
}
