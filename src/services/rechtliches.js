// Betreiberangaben für Impressum und Datenschutzerklärung (src/services/rechtstexte.js). Die Angaben stehen in einer JSON-Datei außerhalb des
// Programms (RECHTLICHES_DATEI, Standard ./data/rechtliches.json; Vorlage: docs/datenschutz/rechtliches.example.json), damit jeder Betreiber seine
// eigenen Daten eintragen kann und kein Platzhalter im Programm steht. Fehlende Pflichtangaben werden im Text rot als „[ANGABE FEHLT: …]“
// angezeigt und beim Start als Warnung gemeldet (Konsole); GET /api/rechtliches/status nennt sie dem Super-Admin.
import fs from 'fs';
import path from 'path';

export const ARTEN = ['privatperson', 'einzelunternehmen', 'verein', 'gbr', 'ug', 'gmbh', 'sonstige'];
const MIT_VERTRETUNG = new Set(['verein', 'gbr', 'ug', 'gmbh', 'sonstige']);
const MIT_REGISTER = new Set(['verein', 'ug', 'gmbh']); // ein nicht eingetragener Verein setzt ohneRegister: true

const STANDARD_AUFSICHT = {
    name: 'Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen',
    anschrift: 'Kavalleriestraße 2–4, 40213 Düsseldorf',
    web: 'https://www.ldi.nrw.de'
};

export function rechtlichesDatei(env = process.env) {
    return path.resolve(env.RECHTLICHES_DATEI || './data/rechtliches.json');
}

const text = (w) => (typeof w === 'string' ? w.trim() : '');
const zeile = (o = {}, felder) => Object.fromEntries(felder.map((f) => [f, text(o[f])]));

/** Liest und normalisiert die Angaben; fehlt die Datei, sind alle Felder leer (die Seiten zeigen dann überall „ANGABE FEHLT“). */
export function ladeRechtliches(env = process.env) {
    let roh = {};
    let dateiFehler = null;
    const datei = rechtlichesDatei(env);
    try {
        roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
    } catch (err) {
        dateiFehler = err.code === 'ENOENT' ? `Die Datei ${datei} fehlt.` : `Die Datei ${datei} ist nicht lesbar: ${err.message}`;
    }
    const b = roh.betreiber || {};
    const art = ARTEN.includes(b.art) ? b.art : 'privatperson';
    const ds = roh.datenschutz || {};
    const daten = {
        betreiber: {
            art,
            ohneRegister: b.ohneRegister === true,
            ...zeile(b, ['name', 'vorname', 'rechtsform', 'strasse', 'plz', 'ort', 'land', 'vertretung', 'registergericht', 'registernummer', 'umsatzsteuerId', 'wirtschaftsId', 'email', 'telefon', 'kontaktformularUrl', 'zusatz'])
        },
        redaktionell: zeile(roh.redaktionell, ['name', 'anschrift']),
        datenschutz: {
            email: text(ds.email),
            beauftragter: zeile(ds.beauftragter, ['name', 'email', 'telefon']),
            aufsichtsbehoerde: { ...STANDARD_AUFSICHT, ...zeile(ds.aufsichtsbehoerde, ['name', 'anschrift', 'web']) },
            logfileTage: Number(ds.logfileTage) > 0 ? Number(ds.logfileTage) : 7
        },
        hosting: zeile(roh.hosting, ['anbieter', 'standort']),
        datenbank: { ...zeile(roh.datenbank, ['anbieter', 'region']), drittland: roh.datenbank?.drittland === true },
        mail: zeile(roh.mail, ['anbieter']),
        backup: { aktiv: roh.backup?.aktiv === true, ...zeile(roh.backup, ['anbieter', 'ziel']), drittland: roh.backup?.drittland === true, aufbewahrungTage: Number(roh.backup?.aufbewahrungTage) > 0 ? Number(roh.backup.aufbewahrungTage) : 60 },
        teilnehmerApp: { aktiv: roh.teilnehmerApp?.aktiv !== false },
        verbraucherstreit: roh.verbraucherstreit === 'bereit' ? 'bereit' : roh.verbraucherstreit === 'nicht-bereit' ? 'nicht-bereit' : '',
        stand: text(roh.stand)
    };
    return { daten, dateiFehler, ...pruefeRechtliches(daten, dateiFehler) };
}

const eintrag = (pfad, beschreibung) => ({ pfad, beschreibung });

/** Welche Pflichtangaben fehlen (für Impressum und Datenschutzerklärung)? */
export function pruefeRechtliches(daten, dateiFehler = null) {
    const fehlend = [];
    const b = daten.betreiber;
    const brauche = (wert, pfad, beschreibung) => { if (!wert) fehlend.push(eintrag(pfad, beschreibung)); };
    brauche(b.name, 'betreiber.name', 'Name bzw. Firma des Betreibers');
    brauche(b.strasse, 'betreiber.strasse', 'Straße und Hausnummer (ladungsfähige Anschrift, kein Postfach)');
    brauche(b.plz, 'betreiber.plz', 'Postleitzahl');
    brauche(b.ort, 'betreiber.ort', 'Ort');
    brauche(b.email, 'betreiber.email', 'E-Mail-Adresse für die Kontaktaufnahme');
    if (!b.telefon && !b.kontaktformularUrl) fehlend.push(eintrag('betreiber.telefon', 'Zweiter Kontaktweg: Telefonnummer oder Adresse eines Kontaktformulars'));
    if (MIT_VERTRETUNG.has(b.art)) brauche(b.vertretung, 'betreiber.vertretung', 'Vertretungsberechtigte (z. B. Vorstand, Geschäftsführer)');
    if (MIT_REGISTER.has(b.art) && !b.ohneRegister) {
        brauche(b.registergericht, 'betreiber.registergericht', 'Registergericht (Vereins- bzw. Handelsregister)');
        brauche(b.registernummer, 'betreiber.registernummer', 'Registernummer');
    }
    brauche(daten.datenschutz.email, 'datenschutz.email', 'E-Mail-Adresse für Datenschutzanfragen');
    brauche(daten.hosting.anbieter, 'hosting.anbieter', 'Hosting-Anbieter mit Anschrift (z. B. STRATO AG)');
    brauche(daten.mail.anbieter, 'mail.anbieter', 'Anbieter des E-Mail-Versands');
    if (!daten.datenbank.anbieter) fehlend.push(eintrag('datenbank.anbieter', 'Anbieter der Datenbank (z. B. Supabase) oder Eigenbetrieb'));
    if (daten.backup.aktiv) brauche(daten.backup.anbieter, 'backup.anbieter', 'Anbieter der Sicherungskopie (z. B. Google Drive)');
    const hinweise = [];
    if (!b.umsatzsteuerId) hinweise.push('Keine Umsatzsteuer-Identifikationsnummer angegeben (nur Pflicht, wenn vorhanden).');
    if (!daten.stand) hinweise.push('Kein Stand angegeben: es wird das Datum des Abrufs angezeigt.');
    return { fehlend: dateiFehler ? [eintrag('datei', dateiFehler), ...fehlend] : fehlend, hinweise, vollstaendig: !dateiFehler && fehlend.length === 0 };
}
