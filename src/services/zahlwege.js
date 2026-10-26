// Startgeld-Zahlweg je Verein und Turnier (Stufe 1): Speichern der Wahl, Ableitung des Flags
// turnier_teilnehmer.startgeld_zahlweg_gesichert, Kassenliste für Bar-Zahler und Bar-Kassieren.
// Die Verknüpfung zum Teilnehmer läuft über den Vereinsnamen (turnier_teilnehmer.verein = verein_name).
// Der Sync-Abgleich (SQL -> Dokumente) wird nach schreibenden Requests bzw. durch die Brücke angestoßen,
// diese Funktionen müssen ihn nicht selbst auslösen.
import crypto from 'node:crypto';
import { FachFehler } from '../utils/fachFehler.js';
import { ermittleEffektivenStatus } from '../controllers/turnierController.js';
import { turnierHatEchteKaempfe } from '../controllers/poolController.js';
import { pruefeKampfbereitschaft, leiteStatusAusKampfbereitschaftAb, setzeStartgeldBezahlt } from '../controllers/teilnehmerController.js';
import { istZahlwegGesichert, pruefeZahlwegEingabe, parseAngeboteneZahlwege, startgeldVerlangt } from '../shared/zahlweg.js';
import { ladeLastschriftStatus } from './abrechnungStammdaten.js';

const STANDARD_ANGEBOTEN = ['ueberweisung', 'bar'];

// Angebotene Zahlwege eines Turniers: die Wahl des Ausrichters, Lastschrift nur wenn er sie einziehen kann;
// bleibt nichts übrig, gilt der Standard (Überweisung und Bar).
export async function ermittleAngeboteneZahlwege(knex, turnier) {
    let liste = parseAngeboteneZahlwege(turnier.angebotene_zahlwege);
    if (liste.includes('lastschrift') && !(await ladeLastschriftStatus(knex, turnier)).moeglich) {
        liste = liste.filter((z) => z !== 'lastschrift');
    }
    return liste.length > 0 ? liste : [...STANDARD_ANGEBOTEN];
}

async function ladeAusrichterName(knex, turnier) {
    if (turnier.verein_id == null) return null;
    const verein = await knex('vereine').where({ id: turnier.verein_id }).first('name');
    return verein?.name ?? null;
}

export async function ladeZahlwegFuerVerein(knex, turnierId, vereinName) {
    return (await knex('turnier_zahlwege').where({ turnier_id: turnierId, verein_name: vereinName }).first()) || null;
}

export async function ladeVorbelegung(knex, vereinName) {
    const zeile = await knex('turnier_zahlwege')
        .where({ verein_name: vereinName })
        .whereNotNull('geaendert_von') // importierte Zeilen (aus Dateien) speisen die Vorbelegung nie
        .orderBy([{ column: 'updated_at', order: 'desc' }, { column: 'id', order: 'desc' }])
        .first('rechnung_email', 'rechnung_ansprechperson', 'rechnung_anschrift');
    return zeile || null;
}

export async function speichereZahlweg(knex, { turnier, vereinName, vereinId, benutzerId, eingabe }) {
    if (!startgeldVerlangt(turnier)) {
        throw new FachFehler(400, 'Für dieses Turnier wird kein Startgeld erhoben, ein Zahlweg ist nicht nötig.');
    }
    const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnier.id);
    if (ermittleEffektivenStatus(turnier, { hatEchteKaempfe }) !== 'veroeffentlicht') {
        throw new FachFehler(403, 'Die Anmeldung ist nicht mehr offen, der Zahlweg kann nicht mehr geändert werden.');
    }
    const ausrichter = await ladeAusrichterName(knex, turnier);
    if (ausrichter && ausrichter === vereinName) {
        throw new FachFehler(403, 'Der ausrichtende Verein wählt keinen Zahlweg.');
    }
    const angeboten = await ermittleAngeboteneZahlwege(knex, turnier);
    const { fehler, werte } = pruefeZahlwegEingabe(eingabe, angeboten);
    if (fehler) throw new FachFehler(400, fehler);

    const jetzt = knex.fn.now();
    const zeile = {
        turnier_id: turnier.id,
        verein_id: vereinId ?? null,
        verein_name: vereinName,
        ...werte,
        geaendert_von: benutzerId == null ? null : String(benutzerId),
        updated_at: jetzt
    };
    const [gespeichert] = await knex('turnier_zahlwege')
        .insert(zeile)
        .onConflict(['turnier_id', 'verein_name'])
        .merge({ ...zeile, turnier_id: undefined, verein_name: undefined })
        .returning('*');
    await synchronisiereGesichert(knex, turnier.id);
    return gespeichert;
}

// Setzt startgeld_zahlweg_gesichert für alle Teilnehmer des Turniers neu (gesicherter Zahlweg des Vereins
// oder Ausrichter-Verein) und leitet bei geänderten Zeilen den Status neu ab. Gibt die Zahl geänderter Zeilen zurück.
export async function synchronisiereGesichert(knex, turnierId, { statusAbleiten = true } = {}) {
    return knex.transaction(async (trx) => {
        // Serialisiert gleichzeitige Neuberechnungen desselben Turniers.
        await trx.raw('SELECT pg_advisory_xact_lock(?)', [turnierId]);
        const turnier = await trx('turniere').where({ id: turnierId }).first();
        if (!turnier) return 0;
        const ausrichter = await ladeAusrichterName(trx, turnier);
        const gesichert = (await trx('turnier_zahlwege').where({ turnier_id: turnierId }))
            .filter(istZahlwegGesichert).map((z) => z.verein_name);
        if (ausrichter) gesichert.push(ausrichter);

        const teilnehmer = await trx('turnier_teilnehmer').where({ turnier_id: turnierId });
        const gesetzt = new Set(gesichert);
        let geaendert = 0;
        for (const t of teilnehmer) {
            const soll = gesetzt.has(t.verein);
            if (Boolean(t.startgeld_zahlweg_gesichert) === soll) continue;
            const updates = { startgeld_zahlweg_gesichert: soll };
            if (statusAbleiten) {
                const { erfuellt } = pruefeKampfbereitschaft({ ...t, ...updates }, turnier);
                updates.status = leiteStatusAusKampfbereitschaftAb(t.status, erfuellt);
            }
            await trx('turnier_teilnehmer').where({ id: t.id }).update({ ...updates, updated_at: trx.fn.now() });
            geaendert += 1;
        }
        return geaendert;
    });
}

// Vereine, die ihr Startgeld an der Kasse bar zahlen: Zahlweg Bar oder keine Wahl getroffen (und nicht Ausrichter).
export async function ladeKasse(knex, turnierId) {
    const turnier = await knex('turniere').where({ id: turnierId }).first();
    if (!turnier) return [];
    const ausrichter = await ladeAusrichterName(knex, turnier);
    const zahlwege = new Map((await knex('turnier_zahlwege').where({ turnier_id: turnierId })).map((z) => [z.verein_name, z]));
    // Zurückgezogene Kämpfer zahlen nichts mehr und zählen nicht. Disqualifizierte und nicht erschienene
    // bleiben drin: das Startgeld ist mit der Anmeldung fällig geworden.
    const teilnehmer = await knex('turnier_teilnehmer').where({ turnier_id: turnierId }).whereNot('status', 'zurueckgezogen');

    const nachVerein = new Map();
    for (const t of teilnehmer) {
        if (ausrichter && t.verein === ausrichter) continue;
        const zeile = zahlwege.get(t.verein);
        if (zeile && zeile.zahlweg !== 'bar') continue;
        if (!nachVerein.has(t.verein)) {
            nachVerein.set(t.verein, {
                vereinName: t.verein,
                zahlweg: zeile ? 'bar' : 'ohneZahlweg',
                anzahlKaempfer: 0,
                anzahlOffen: 0,
                rechnungEmail: zeile?.rechnung_email || null
            });
        }
        const eintrag = nachVerein.get(t.verein);
        eintrag.anzahlKaempfer += 1;
        if (!t.startgeld_bezahlt) eintrag.anzahlOffen += 1;
    }
    return [...nachVerein.values()].sort((a, b) => a.vereinName.localeCompare(b.vereinName, 'de'));
}

// Markiert alle noch offenen Kämpfer des Vereins als bezahlt (Einzelmarkierung inkl. Statusableitung) und
// schreibt das Kassenjournal. Alles in EINER Transaktion, je (Turnier, Verein) per Advisory-Lock serialisiert:
// zwei gleichzeitige Aufrufe zählen nie dieselben Kämpfer doppelt; scheitert der Journal-INSERT, bleibt nichts markiert.
// Grenze: Das Journal erfasst nur "Alles bar kassiert". Das einzelne Häkchen startgeld_bezahlt in der Teilnehmerliste
// wird nicht journalisiert (Task 8 entscheidet, was bei der Abrechnung maßgeblich ist).
export async function kassiereBar(knex, turnierId, vereinName) {
    return knex.transaction(async (trx) => {
        await trx.raw('SELECT pg_advisory_xact_lock(?, hashtext(?))', [turnierId, vereinName]);
        const offene = await trx('turnier_teilnehmer')
            .where({ turnier_id: turnierId, verein: vereinName })
            .whereNot('status', 'zurueckgezogen')
            .andWhere((q) => q.where('startgeld_bezahlt', false).orWhereNull('startgeld_bezahlt'))
            .select('id');
        if (offene.length === 0) return 0;
        const turnier = await trx('turniere').where({ id: turnierId }).first('startgeld');
        const startgeld = parseFloat(turnier?.startgeld) || 0;
        await trx('turnier_barzahlungen').insert({
            uid: crypto.randomUUID(),
            turnier_id: turnierId,
            verein_name: vereinName,
            anzahl: offene.length,
            betrag_cent: Math.round(offene.length * startgeld * 100)
        });
        for (const { id } of offene) await setzeStartgeldBezahlt(trx, id, true);
        return offene.length;
    });
}

// Rechnungsdaten eines Vereins, der erst vor Ort auftaucht (kein Zahlweg gewählt): immer Bar, kein Benutzerbezug,
// keine Anmeldeschluss-Prüfung (die Kasse ist ein Wettkampftag-Werkzeug).
export async function erfasseVorOrt(knex, { turnier, vereinName, eingabe }) {
    const kasse = await ladeKasse(knex, turnier.id);
    if (await ladeZahlwegFuerVerein(knex, turnier.id, vereinName)) {
        throw new FachFehler(400, 'Für diesen Verein gibt es schon einen Zahlweg.');
    }
    if (!kasse.some((e) => e.vereinName === vereinName && e.zahlweg === 'ohneZahlweg')) {
        throw new FachFehler(400, 'Dieser Verein steht nicht auf der Kassenliste.');
    }
    const { fehler, werte } = pruefeZahlwegEingabe({ ...(eingabe || {}), zahlweg: 'bar' }, ['bar']);
    if (fehler) throw new FachFehler(400, fehler);
    let zeile;
    try {
        [zeile] = await knex('turnier_zahlwege')
            .insert({ turnier_id: turnier.id, verein_id: null, verein_name: vereinName, ...werte, geaendert_von: null, updated_at: knex.fn.now() })
            .returning('*');
    } catch (fehler) {
        // Gleichzeitiger zweiter Aufruf: die Unique-Bedingung (turnier_id, verein_name) hat gegriffen.
        if (fehler?.code === '23505') throw new FachFehler(400, 'Für diesen Verein gibt es schon einen Zahlweg.');
        throw fehler;
    }
    await synchronisiereGesichert(knex, turnier.id);
    return zeile;
}
