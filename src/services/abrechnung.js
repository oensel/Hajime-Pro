// Abrechnungsübersicht je Turnier (Startgeld Stufe 2): wer schuldet wie viel, welche Rechnung gibt es schon, und welche
// Kämpfer keinem meldenden Verein zugeordnet werden konnten. Nur Cloud; der Zugriff wird von den Routen geprüft.
import { FachFehler } from '../utils/fachFehler.js';
import { zaehleKaempferJeVerein, rechnungsAnzeigeStatus, heuteBerlin } from '../shared/abrechnung.js';
import { startgeldVerlangt } from '../shared/zahlweg.js';
import { pruefeStammdatenFuerTurnier } from './abrechnungStammdaten.js';
import { synchronisiereGesichert } from './zahlwege.js';

// Gleiche Normalisierung wie die Zählung (zaehleKaempferJeVerein): klein, getrimmt.
const normName = (s) => String(s ?? '').trim().toLowerCase();

// Platzhalter nur für die Zählung: Kämpfer ohne Vereinsnamen überspringt zaehleKaempferJeVerein still,
// hier sollen sie aber als "Nicht zugeordnet" sichtbar werden.
const OHNE_VEREIN = '\u0000ohne-verein';

async function ladeAusrichterName(knex, turnier) {
    if (turnier.verein_id == null) return null;
    const verein = await knex('vereine').where({ id: turnier.verein_id }).first('name');
    return verein?.name ?? null;
}

// E5: bereit, sobald das Turnier zurückgespielt wurde, oder wenn es in der Cloud live lief (beendet) und nie auf einen
// Hallen-Server geholt wurde (Entscheidung des Auftraggebers: solche Turniere sind ohne Zurückspielen abrechenbar).
export async function ermittleAbrechnungsBereitschaft(knex, turnier) {
    if (!startgeldVerlangt(turnier)) return { bereit: false, grund: 'Für dieses Turnier wird kein Startgeld erhoben.' };
    if (turnier.zurueckgespielt_am) return { bereit: true, grund: null };
    const live = await knex('cloud_live').where({ turnier_id: turnier.id }).whereNotNull('beendet_am').first('turnier_id');
    if (live && !turnier.auf_hallen_server_geholt_am) return { bereit: true, grund: null };
    return { bereit: false, grund: 'Das Turnier wurde noch nicht vom Hallen-Server zurückgespielt.' };
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

    const ausrichterName = await ladeAusrichterName(knex, turnier);
    const teilnehmer = await knex('turnier_teilnehmer').where({ turnier_id: turnier.id });
    const zaehlung = zaehleKaempferJeVerein(
        teilnehmer.map((t) => (String(t.verein ?? '').trim() ? t : { ...t, verein: OHNE_VEREIN })),
        { basis, ausrichterName }
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
        .select('id', 'verein_name', 'nummer', 'art', 'status', 'versandt_am', 'bezahlt_am', 'versand_fehler', 'anzahl', 'betrag_cent',
            knex.raw("to_char(zahlungsziel_datum, 'YYYY-MM-DD') as zahlungsziel_datum"))
        .orderBy('id');
    for (const z of zeilen) {
        rechnungen.set(normName(z.verein_name), {
            id: z.id, nummer: z.nummer, art: z.art, status: z.status,
            anzeigeStatus: rechnungsAnzeigeStatus(z, heute),
            versandt_am: z.versandt_am, bezahlt_am: z.bezahlt_am, versand_fehler: z.versand_fehler,
            anzahl: z.anzahl, betrag_cent: z.betrag_cent
        });
    }

    for (const [schluessel, z] of zahlwege) {
        if (ausrichterName && schluessel === normName(ausrichterName)) continue;
        const gezaehlt = zaehlung.get(schluessel);
        const anzahl = gezaehlt?.anzahl ?? 0;
        const rechnung = rechnungen.get(schluessel) ?? null;
        antwort.vereine.push({
            vereinName: z.verein_name,
            zahlweg: z.zahlweg,
            anzahl,
            bezahltAnzahl: gezaehlt?.bezahltAnzahl ?? 0,
            betragCent: anzahl * startgeldCent,
            rechnungEmail: z.rechnung_email || null,
            rechnung,
            // Rechnungen sind Momentaufnahmen und werden nie angepasst; spätere Änderungen (z. B. ordneVereinZu) nur melden.
            rechnungWeichtAb: !!rechnung && (rechnung.anzahl !== anzahl || rechnung.betrag_cent !== anzahl * startgeldCent)
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
    const ausrichter = turnier ? await ladeAusrichterName(knex, turnier) : null;
    if (vonKey && ausrichter && normName(ausrichter) === vonKey) {
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
