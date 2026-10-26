// Abrechnungsübersicht je Turnier (Startgeld Stufe 2): wer schuldet wie viel, welche Rechnung gibt es schon, und welche
// Kämpfer keinem meldenden Verein zugeordnet werden konnten. Nur Cloud; der Zugriff wird von den Routen geprüft.
import { FachFehler } from '../utils/fachFehler.js';
import { zaehleKaempferJeVerein, rechnungsAnzeigeStatus, heuteBerlin } from '../shared/abrechnung.js';
import { startgeldVerlangt } from '../shared/zahlweg.js';
import { pruefeStammdatenFuerTurnier, ladeStammdaten } from './abrechnungStammdaten.js';
import { synchronisiereGesichert } from './zahlwege.js';
import { ladeAusrichterNamen } from './zahlwegTransfer.js';

// Gleiche Normalisierung wie die Zählung (zaehleKaempferJeVerein): klein, getrimmt.
const normName = (s) => String(s ?? '').trim().toLowerCase();

// Platzhalter nur für die Zählung: Kämpfer ohne Vereinsnamen überspringt zaehleKaempferJeVerein still,
// hier sollen sie aber als "Nicht zugeordnet" sichtbar werden.
const OHNE_VEREIN = '\u0000ohne-verein';

// Alle Schreibweisen des Ausrichters (Vereinsname und Freitextfeld des Turniers), normalisiert.
async function ladeAusrichterSchluessel(knex, turnier) {
    return new Set([...(await ladeAusrichterNamen(knex, turnier.id))].map(normName));
}

// E5: bereit, sobald das Turnier zurückgespielt wurde, oder wenn es in der Cloud live lief (beendet) und nie auf einen
// Hallen-Server geholt wurde (Entscheidung des Auftraggebers: solche Turniere sind ohne Zurückspielen abrechenbar).
export async function ermittleAbrechnungsBereitschaft(knex, turnier) {
    // Abgesagt: kein Startgeld geschuldet; Lastschrift-Zeilen solcher Turniere haben kein Mandat mehr (mandatJob).
    if (turnier.status === 'abgesagt') return { bereit: false, grund: 'Das Turnier wurde abgesagt. Es gibt keine Abrechnung.' };
    if (!startgeldVerlangt(turnier)) return { bereit: false, grund: 'Für dieses Turnier wird kein Startgeld erhoben.' };
    if (turnier.zurueckgespielt_am) return { bereit: true, grund: null };
    const live = await knex('cloud_live').where({ turnier_id: turnier.id }).whereNotNull('beendet_am').first('turnier_id');
    if (live && !turnier.auf_hallen_server_geholt_am) return { bereit: true, grund: null };
    return { bereit: false, grund: 'Das Turnier wurde noch nicht vom Hallen-Server zurückgespielt.' };
}

// Mandatsstand je Zahlweg-Zeile (zahlweg_id): ein gültiges Mandat geht vor, sonst das jüngste.
async function ladeMandatsStand(knex, turnierId) {
    const stand = new Map();
    const zeilen = await knex('lastschrift_mandate').where({ turnier_id: turnierId }).whereNotNull('zahlweg_id')
        .select('id', 'zahlweg_id', 'status', 'glaeubiger_id').orderBy('id');
    for (const m of zeilen) {
        const bisher = stand.get(m.zahlweg_id);
        if (!bisher || bisher.status !== 'gueltig') stand.set(m.zahlweg_id, m);
    }
    return stand;
}

const GRUND_GLAEUBIGER_ID = 'Die Gläubiger-ID des Ausrichters hat sich seit dem Mandat geändert.';

export const glaeubigerIdGeaendertText = (vereinName) =>
    `Die Gläubiger-ID des Ausrichters hat sich seit dem Mandat von Verein ${vereinName} geändert.`;

/** Sperrtext für den Rechnungslauf zu einer Vereinszeile mit Mandatshinweis. */
export function mandatSperrText({ vereinName, hinweisCode }) {
    return hinweisCode === 'glaeubiger_id' ? glaeubigerIdGeaendertText(vereinName) : `Verein ${vereinName} hat kein gültiges Mandat.`;
}

const MANDAT_GRUENDE = {
    unbestaetigt: 'Das Lastschriftmandat wurde noch nicht von einem Admin des Vereins bestätigt.',
    abgelehnt: 'Das Lastschriftmandat wurde abgelehnt.',
    widerrufen: 'Das Lastschriftmandat wurde widerrufen.',
    umgestellt: 'Das Lastschriftmandat wurde auf Barzahlung umgestellt.'
};

// Grund, warum ein Lastschrift-Verein kein gültiges Mandat hat (null = gültig). Gültig nur, wenn Mandat und Zahlweg-Merker
// übereinstimmen (L3: mandat_gueltig ist der abgeleitete Merker, das Mandat die Quelle) und die im Mandat zugesagte
// Gläubiger-ID noch die des Ausrichters ist (die Mandats-ID ist maßgeblich).
function mandatUngueltig(zahlwegZeile, mandat, glaeubigerId) {
    const mandatFehlt = (grund) => ({ code: 'mandat', grund });
    if (!mandat) return mandatFehlt('Es wurde kein Lastschriftmandat erteilt.');
    if (mandat.status === 'gueltig' && zahlwegZeile.mandat_gueltig === true) {
        return mandat.glaeubiger_id === (glaeubigerId || null) ? null : { code: 'glaeubiger_id', grund: GRUND_GLAEUBIGER_ID };
    }
    if (mandat.status === 'gueltig') return mandatFehlt('Das Lastschriftmandat ist nicht als gültig vermerkt.');
    return mandatFehlt(MANDAT_GRUENDE[mandat.status] || 'Das Lastschriftmandat ist nicht gültig.');
}

/** Lastschrift-Vereine, für die eine Rechnung zu erstellen wäre, die aber kein gültiges Mandat haben. */
export function vereineOhneGueltigesMandat(abrechnung) {
    return (abrechnung.vereine || []).filter((v) => v.zahlweg === 'lastschrift' && v.hinweis && v.anzahl > 0 && !v.rechnung);
}

// Autorität für "bezahlt" (Quittung statt offener Rechnung): allein das Flag turnier_teilnehmer.startgeld_bezahlt je Kämpfer.
// Es wird von "Alles bar kassiert" (kassiereBar) ebenso gesetzt wie vom Einzelhäkchen in der Teilnehmerliste, deckt also beide
// Wege ab. Das Kassenjournal (turnier_barzahlungen) dient nur der Nachvollziehbarkeit und wird hier nie für Beträge
// herangezogen; Beträge entstehen immer aus Anzahl x Startgeld.
export async function ladeAbrechnung(knex, turnier) {
    const { bereit, grund } = await ermittleAbrechnungsBereitschaft(knex, turnier);
    const startgeldCent = Math.round((parseFloat(turnier.startgeld) || 0) * 100);
    const basis = turnier.abrechnungsbasis || 'gemeldet';
    const stammdaten = await pruefeStammdatenFuerTurnier(knex, turnier);
    const antwort = { bereit, grund, basis, startgeldCent, stammdaten, vereine: [], nichtZugeordnet: [], summeCent: 0 };
    if (!bereit) return antwort;

    const ausrichter = await ladeAusrichterSchluessel(knex, turnier);
    const teilnehmer = await knex('turnier_teilnehmer').where({ turnier_id: turnier.id });
    const zaehlung = zaehleKaempferJeVerein(
        teilnehmer.map((t) => (String(t.verein ?? '').trim() ? t : { ...t, verein: OHNE_VEREIN })),
        { basis, ausrichterNamen: [...ausrichter] }
    );
    const zahlwege = new Map();
    for (const z of (await knex('turnier_zahlwege').where({ turnier_id: turnier.id }).orderBy('id'))) {
        const schluessel = normName(z.verein_name);
        if (!zahlwege.has(schluessel)) zahlwege.set(schluessel, z);
    }

    const heute = heuteBerlin();
    const rechnungen = new Map();
    const zeilen = await knex('rechnungen')
        .where({ turnier_id: turnier.id }).whereNot('status', 'zurueckgebucht')
        .select('id', 'verein_name', 'zahlweg', 'nummer', 'art', 'status', 'versandt_am', 'bezahlt_am', 'versand_fehler', 'anzahl',
            'betrag_cent', 'sepa_datei_id', 'mandatsreferenz', 'iban_maske_zahler',
            knex.raw("to_char(zahlungsziel_datum, 'YYYY-MM-DD') as zahlungsziel_datum"),
            knex.raw("to_char(einzug_am, 'YYYY-MM-DD') as einzug_am"))
        .orderBy('id');
    for (const z of zeilen) {
        rechnungen.set(normName(z.verein_name), {
            id: z.id, nummer: z.nummer, art: z.art, status: z.status,
            anzeigeStatus: rechnungsAnzeigeStatus(z, heute),
            versandt_am: z.versandt_am, bezahlt_am: z.bezahlt_am, versand_fehler: z.versand_fehler,
            anzahl: z.anzahl, betrag_cent: z.betrag_cent,
            zahlweg: z.zahlweg, einzug_am: z.einzug_am, sepa_datei_id: z.sepa_datei_id,
            mandatsreferenz: z.mandatsreferenz, iban_maske_zahler: z.iban_maske_zahler
        });
    }
    const mandate = await ladeMandatsStand(knex, turnier.id);
    const glaeubigerId = turnier.verein_id ? (await ladeStammdaten(knex, turnier.verein_id))?.glaeubiger_id ?? null : null;

    for (const [schluessel, z] of zahlwege) {
        if (ausrichter.has(schluessel)) continue;
        const gezaehlt = zaehlung.get(schluessel);
        const anzahl = gezaehlt?.anzahl ?? 0;
        const rechnung = rechnungen.get(schluessel) ?? null;
        // Nur solange noch keine Rechnung besteht: danach ist die Rechnung der Beleg (Rücklastschrift: Task 10).
        const mandatProblem = z.zahlweg === 'lastschrift' && !rechnung ? mandatUngueltig(z, mandate.get(z.id), glaeubigerId) : null;
        antwort.vereine.push({
            vereinName: z.verein_name,
            zahlweg: z.zahlweg,
            anzahl,
            bezahltAnzahl: gezaehlt?.bezahltAnzahl ?? 0,
            betragCent: anzahl * startgeldCent,
            rechnungEmail: z.rechnung_email || null,
            rechnung,
            // Rechnungen sind Momentaufnahmen und werden nie angepasst; spätere Änderungen (z. B. ordneVereinZu) nur melden.
            rechnungWeichtAb: !!rechnung && (rechnung.anzahl !== anzahl || rechnung.betrag_cent !== anzahl * startgeldCent),
            // Lastschrift ohne gültiges Mandat: sichtbar mit dem echten Grund; blockiert den Rechnungslauf, solange für den
            // Verein noch eine Rechnung zu erstellen ist (vereineOhneGueltigesMandat).
            hinweis: mandatProblem ? 'Mandat nicht gültig' : null,
            hinweisGrund: mandatProblem?.grund ?? null,
            hinweisCode: mandatProblem?.code ?? null
        });
    }
    antwort.vereine.sort((a, b) => a.vereinName.localeCompare(b.vereinName, 'de'));
    antwort.summeCent = antwort.vereine.reduce((s, v) => s + v.betragCent, 0);

    for (const [schluessel, e] of zaehlung) {
        if (zahlwege.has(schluessel)) continue;
        antwort.nichtZugeordnet.push({ vereinName: schluessel === normName(OHNE_VEREIN) ? '' : e.vereinName, anzahl: e.anzahl });
    }
    antwort.nichtZugeordnet.sort((a, b) => a.vereinName.localeCompare(b.vereinName, 'de'));
    return antwort;
}

// Verschiebt die Kämpfer eines nicht zugeordneten Vereinsnamens (auch "" = ohne Verein) zu einem Verein mit Zahlweg-Zeile.
export async function ordneVereinZu(knex, turnierId, { vonVereinName, zuVereinName }) {
    if (typeof vonVereinName !== 'string' || typeof zuVereinName !== 'string' || !zuVereinName.trim()) {
        throw new FachFehler(400, 'Quell- und Zielverein müssen angegeben werden.');
    }
    const zahlwege = await knex('turnier_zahlwege').where({ turnier_id: turnierId }).orderBy('id');
    const ziel = zahlwege.find((z) => normName(z.verein_name) === normName(zuVereinName));
    if (!ziel) throw new FachFehler(400, 'Der Zielverein hat für dieses Turnier keinen Zahlweg gewählt.');
    const vonKey = normName(vonVereinName);
    if (vonKey && zahlwege.some((z) => normName(z.verein_name) === vonKey)) {
        throw new FachFehler(400, 'Der Quellverein hat bereits einen Zahlweg und kann nicht verschoben werden.');
    }
    const turnier = await knex('turniere').where({ id: turnierId }).first();
    const ausrichter = turnier ? await ladeAusrichterSchluessel(knex, turnier) : new Set();
    if (vonKey && ausrichter.has(vonKey)) {
        throw new FachFehler(400, 'Kämpfer des ausrichtenden Vereins können nicht verschoben werden.');
    }
    const kandidaten = await knex('turnier_teilnehmer').where({ turnier_id: turnierId }).select('id', 'verein');
    const ids = kandidaten.filter((t) => normName(t.verein) === vonKey).map((t) => t.id);
    if (ids.length === 0) return 0;
    await knex('turnier_teilnehmer').whereIn('id', ids).update({ verein: ziel.verein_name, updated_at: knex.fn.now() });
    // Der Zahlweg des Ziels kann das Startgeld sichern: Flag neu ableiten, den Status aber nicht anfassen.
    await synchronisiereGesichert(knex, turnierId, { statusAbleiten: false });
    return ids.length;
}
