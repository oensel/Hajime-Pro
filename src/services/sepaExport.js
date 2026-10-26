// SEPA-Lastschriftdatei je Turnier (Startgeld Stufe 3, Plan L7/L8): sammelt die versandten Lastschrift-Rechnungen
// (Rechnung = Vorabankündigung) in einer pain.008-Datei und merkt sich das am Beleg (rechnungen.sepa_datei_id), damit
// keine Rechnung zweimal eingezogen wird. Nur Cloud; Zugriff prüfen Route und Controller (requireTurnierAdmin, 2FA).
//
// Sicherheit:
//  - Die Klar-IBANs der Zahler entstehen nur hier, über ladeMandatIban, innerhalb der Anfrage. Sie stehen nur im
//    zurückgegebenen XML und werden weder gespeichert noch geloggt; gespeichert werden nur die Kopfdaten (sepa_dateien).
//  - Fehlermeldungen nennen Rechnungsnummern und Vereine, nie Kontodaten oder Fehlertexte der Entschlüsselung.
//  - Alles in EINER Transaktion unter einem Advisory-Lock je Turnier; das XML entsteht vor dem Commit, der Aufrufer
//    liefert es erst nach erfolgreichem Commit aus. Das bedingte UPDATE (sepa_datei_id IS NULL) ist die zweite Absicherung
//    gegen zwei gleichzeitige Downloads.
//  - Vor dem Einzug wird je Rechnung erneut geprüft: Mandat 'gueltig', Merker turnier_zahlwege.mandat_gueltig, Gläubiger-ID
//    des Mandats = aktuelle Gläubiger-ID der Stammdaten. Scheitert eine Rechnung, gibt es keine Datei (409 mit Liste),
//    damit z. B. ein Widerruf zwischen Rechnung und Datei sichtbar wird und nicht still verschwindet.
import { FachFehler } from '../utils/fachFehler.js';
import { heuteBerlin } from '../shared/abrechnung.js';
import { pruefeGlaeubigerId } from '../shared/glaeubigerId.js';
import { sepaKennung } from '../shared/sepaZeichen.js';
import { naechsterGeschaeftstag, addiereGeschaeftstage } from '../shared/targetKalender.js';
import { erzeugePain008 } from './sepaDatei.js';
import { ladeMandatIban, berechneLoeschenAb } from './mandate.js';
import { ermittleZahlungsempfaenger } from './abrechnungStammdaten.js';

export const MELDUNG_SCHON_DATEI = 'Für alle Lastschriften gibt es schon eine Datei.';
const MAX_ID = 2147483647;

const datumDe = (iso) => {
    const [j, m, t] = String(iso).split('-');
    return `${t}.${m}.${j}`;
};

/** Prüft die Auswahl für "Neu erzeugen": nicht leere Liste ganzer, positiver IDs (ohne Doppelte). */
export function pruefeAuswahl({ neu, rechnungIds }) {
    if (neu !== undefined && neu !== null && typeof neu !== 'boolean') throw new FachFehler(400, 'Ungültige Angabe „neu“.');
    if (!neu) {
        if (rechnungIds != null) throw new FachFehler(400, 'Rechnungen lassen sich nur beim Neu-Erzeugen auswählen.');
        return null;
    }
    if (!Array.isArray(rechnungIds) || rechnungIds.length === 0) {
        throw new FachFehler(400, 'Bitte die Rechnungen auswählen, die neu in eine Datei sollen.');
    }
    if (rechnungIds.length > 1000) throw new FachFehler(400, 'Zu viele Rechnungen ausgewählt.');
    const ids = rechnungIds.map((w) => (Number.isInteger(w) && w > 0 && w <= MAX_ID ? w : null));
    if (ids.some((w) => w == null)) throw new FachFehler(400, 'Ungültige Rechnungs-ID.');
    return [...new Set(ids)];
}

async function ladeKontoDesAusrichters(trx, turnier) {
    let konto;
    try {
        konto = await ermittleZahlungsempfaenger(trx, turnier);
    } catch (err) {
        const grund = err instanceof FachFehler && err.statusCode === 503
            ? 'der Schlüssel für Zahlungsdaten fehlt (ZAHLUNGSDATEN_SCHLUESSEL)'
            : 'die IBAN lässt sich mit dem eingestellten Schlüssel nicht entschlüsseln';
        throw new FachFehler(409, `Konto des Ausrichters nicht lesbar: ${grund}. Ohne dieses Konto kann keine Lastschriftdatei entstehen.`);
    }
    if (!konto) throw new FachFehler(409, 'Konto des Ausrichters nicht lesbar: es ist kein Konto hinterlegt. Ohne dieses Konto kann keine Lastschriftdatei entstehen.');
    return konto;
}

// Zeitstempel für die Nachrichten-ID (UTC, bis Millisekunden), z. B. 20261026081530123.
const zeitstempel = (jetzt) => jetzt.toISOString().replace(/\D/g, '').slice(0, 17);

/**
 * Erzeugt die pain.008-Datei für die Lastschriften eines Turniers und merkt sie an den Rechnungen.
 * @returns {Promise<{ xml: string, dateiname: string, anzahl: number, summeCent: number, faelligkeit: string,
 *   warnung: string|null, sepaDateiId: number, msgId: string }>}
 */
export async function erzeugeSepaExport(knex, { turnier, benutzerId, neu = false, rechnungIds = null, heute = heuteBerlin(), jetzt = new Date() }) {
    const auswahl = pruefeAuswahl({ neu, rechnungIds });
    if (!turnier?.id) throw new FachFehler(404, 'Turnier nicht gefunden.');

    return knex.transaction(async (trx) => {
        // Serialisiert Dateien desselben Turniers (eigener Namensraum, wie der Rechnungslauf).
        await trx.raw("SELECT pg_advisory_xact_lock(hashtext('sepa_datei'), ?)", [turnier.id]);

        const aktuell = await trx('turniere').where({ id: turnier.id }).forShare().first('id', 'status', 'verein_id', 'bezeichnung', 'iban', 'kontoinhaber');
        if (!aktuell) throw new FachFehler(404, 'Turnier nicht gefunden.');
        if (aktuell.status === 'abgesagt') {
            throw new FachFehler(409, 'Das Turnier wurde abgesagt. Für abgesagte Turniere werden keine Lastschriften eingezogen.');
        }

        // Gläubiger: EINE Gläubiger-ID je Datei (die aktuelle der Stammdaten, gesperrt gegen gleichzeitiges Ändern).
        const stamm = aktuell.verein_id
            ? await trx('vereins_abrechnung').where({ verein_id: aktuell.verein_id }).forShare().first('glaeubiger_id')
            : null;
        const gid = pruefeGlaeubigerId(stamm?.glaeubiger_id ?? '');
        if (!stamm?.glaeubiger_id || !gid.ok) {
            throw new FachFehler(409, 'Die Gläubiger-ID des Ausrichters fehlt oder ist ungültig. Bitte die Abrechnungsdaten des Vereins ergänzen.');
        }
        const konto = await ladeKontoDesAusrichters(trx, aktuell);

        // Auswahl der Rechnungen (gesperrt).
        const spalten = [
            'id', 'turnier_id', 'nummer', 'verein_name', 'zahlweg', 'art', 'status', 'betrag_cent', 'bar_erhalten_cent', 'verwendungszweck',
            'mandat_id', 'mandatsreferenz', 'sepa_datei_id',
            trx.raw("to_char(einzug_am, 'YYYY-MM-DD') as einzug_am"),
            trx.raw("to_char(mandat_datum, 'YYYY-MM-DD') as mandat_datum")
        ];
        let rechnungen;
        const hinweise = [];
        if (auswahl) {
            rechnungen = await trx('rechnungen').whereIn('id', auswahl).forUpdate().orderBy('id').select(spalten);
            if (rechnungen.length !== auswahl.length || rechnungen.some((r) => r.turnier_id !== turnier.id)) {
                throw new FachFehler(400, 'Mindestens eine ausgewählte Rechnung gehört nicht zu diesem Turnier.');
            }
            const unpassend = rechnungen.filter((r) => r.zahlweg !== 'lastschrift' || r.art !== 'rechnung' || r.status !== 'versandt');
            if (unpassend.length > 0) {
                throw new FachFehler(409, 'Nur versandte Lastschrift-Rechnungen können eingezogen werden, nicht: '
                    + `${unpassend.map((r) => `${r.nummer} (${r.verein_name}, ${r.zahlweg === 'lastschrift' ? r.status : r.zahlweg})`).join(', ')}.`);
            }
        } else {
            const alle = await trx('rechnungen')
                .where({ turnier_id: turnier.id, zahlweg: 'lastschrift', art: 'rechnung' })
                .whereIn('status', ['offen', 'versandt'])
                .whereNull('sepa_datei_id')
                .forUpdate().orderBy('id').select(spalten);
            rechnungen = alle.filter((r) => r.status === 'versandt');
            // Nicht versandt = keine Vorabankündigung beim Zahler: nicht einziehen, aber sichtbar machen.
            const nichtVersandt = alle.filter((r) => r.status !== 'versandt');
            if (nichtVersandt.length > 0) {
                hinweise.push(`Nicht enthalten, weil die Rechnung (Vorabankündigung) noch nicht versandt wurde: ${nichtVersandt.map((r) => `${r.nummer} (${r.verein_name})`).join(', ')}.`);
            }
            if (rechnungen.length === 0) {
                if (nichtVersandt.length > 0) throw new FachFehler(409, `Keine Lastschrift kann eingezogen werden. ${hinweise[0]}`);
                const irgendeine = await trx('rechnungen').where({ turnier_id: turnier.id, zahlweg: 'lastschrift' }).first('id');
                throw new FachFehler(409, irgendeine ? MELDUNG_SCHON_DATEI : 'Für dieses Turnier gibt es keine Lastschrift-Rechnungen.');
            }
        }

        // Je Rechnung: Mandat, Merker und Gläubiger-ID JETZT prüfen (Mandatszeilen gesperrt gegen gleichzeitigen Widerruf).
        const mandatIds = [...new Set(rechnungen.map((r) => r.mandat_id).filter((m) => m != null))].sort((a, b) => a - b);
        const mandate = new Map();
        for (const m of mandatIds.length ? await trx('lastschrift_mandate').whereIn('id', mandatIds).orderBy('id').forUpdate()
            .select('id', 'status', 'glaeubiger_id', 'zahlweg_id', 'turnier_id') : []) {
            mandate.set(m.id, m);
        }
        const zahlwegIds = [...new Set([...mandate.values()].map((m) => m.zahlweg_id).filter((z) => z != null))];
        const zahlwege = new Map();
        for (const z of zahlwegIds.length ? await trx('turnier_zahlwege').whereIn('id', zahlwegIds).select('id', 'zahlweg', 'mandat_gueltig', 'turnier_id') : []) {
            zahlwege.set(z.id, z);
        }
        const probleme = [];
        for (const r of rechnungen) {
            const m = r.mandat_id != null ? mandate.get(r.mandat_id) : null;
            const z = m?.zahlweg_id != null ? zahlwege.get(m.zahlweg_id) : null;
            let grund = null;
            if (!m) grund = 'zum Mandat liegen keine Daten mehr vor';
            else if (m.status !== 'gueltig') grund = `das Mandat ist nicht mehr gültig (${m.status})`;
            else if (m.turnier_id !== turnier.id || !z || z.turnier_id !== turnier.id || z.zahlweg !== 'lastschrift' || z.mandat_gueltig !== true) {
                grund = 'der Verein zahlt nicht mehr per Lastschrift mit gültigem Mandat';
            } else if (m.glaeubiger_id !== gid.wert) grund = 'die Gläubiger-ID des Ausrichters hat sich seit dem Mandat geändert';
            else if (!r.einzug_am || !r.mandat_datum || !r.mandatsreferenz) grund = 'die Lastschriftangaben der Rechnung sind unvollständig';
            else if (r.betrag_cent - r.bar_erhalten_cent <= 0) grund = 'es ist kein Betrag offen';
            if (grund) probleme.push(`${r.nummer} (${r.verein_name}): ${grund}`);
        }
        if (probleme.length > 0) {
            throw new FachFehler(409, `Es wurde keine Datei erzeugt. Bitte zuerst klären: ${probleme.join('; ')}.`);
        }

        // L7: nie in der Vergangenheit, frühestens der nächste Geschäftstag nach heute, nie vor dem angekündigten Datum.
        const fruehestens = naechsterGeschaeftstag(addiereGeschaeftstage(heute, 1));
        const faelligkeit = naechsterGeschaeftstag(
            rechnungen.reduce((max, r) => (r.einzug_am > max ? r.einzug_am : max), fruehestens)
        );
        const spaeter = rechnungen.filter((r) => r.einzug_am < faelligkeit);
        if (spaeter.length > 0) {
            hinweise.unshift(`Eingezogen wird am ${datumDe(faelligkeit)}, später als angekündigt bei: `
                + `${spaeter.map((r) => `${r.nummer} (${r.verein_name}, angekündigt ${datumDe(r.einzug_am)})`).join(', ')}.`);
        }

        // Kontodaten der Zahler: nur hier und nur im Arbeitsspeicher.
        const posten = [];
        for (const r of rechnungen) {
            let daten;
            try {
                daten = await ladeMandatIban(trx, r.mandat_id);
            } catch {
                throw new FachFehler(409, `Die Kontodaten des Mandats zu ${r.nummer} (${r.verein_name}) lassen sich nicht lesen (Schlüssel für Zahlungsdaten prüfen). Es wurde keine Datei erzeugt.`);
            }
            posten.push({
                endToEndId: r.nummer,
                betragCent: r.betrag_cent - r.bar_erhalten_cent,
                mandatsreferenz: r.mandatsreferenz,
                mandatDatum: r.mandat_datum,
                zahlerName: daten.kontoinhaber || r.verein_name,
                zahlerIban: daten.iban,
                verwendungszweck: r.verwendungszweck || `Startgeld ${aktuell.bezeichnung} ${r.nummer}`
            });
        }

        const msgId = sepaKennung(`HJ${turnier.id}-${zeitstempel(jetzt)}`);
        let datei;
        try {
            datei = erzeugePain008({
                msgId, erzeugtAm: jetzt, faelligkeit, posten,
                glaeubiger: { name: konto.kontoinhaber, iban: konto.iban, glaeubigerId: gid.wert }
            });
        } catch (err) {
            // Meldungen des Generators nennen nur Posten-Nummern und Prüfergebnisse, keine IBAN.
            if (err instanceof FachFehler) throw new FachFehler(409, `Die Lastschriftdatei kann nicht erzeugt werden: ${err.message}`);
            throw err;
        }

        const [kopf] = await trx('sepa_dateien').insert({
            turnier_id: turnier.id, msg_id: msgId, erzeugt_am: jetzt, erzeugt_von: benutzerId == null ? null : String(benutzerId),
            faelligkeit, anzahl: datei.anzahl, summe_cent: datei.summeCent
        }).returning('id');
        const sepaDateiId = typeof kopf === 'object' ? kopf.id : kopf;

        // Bedingtes UPDATE: nur Rechnungen, die noch so sind wie ausgewählt; sonst Rollback (gleichzeitiger Download).
        const ids = rechnungen.map((r) => r.id);
        const aktualisierung = trx('rechnungen').whereIn('id', ids).where({ turnier_id: turnier.id, status: 'versandt', zahlweg: 'lastschrift' });
        if (!auswahl) aktualisierung.whereNull('sepa_datei_id');
        const geaendert = await aktualisierung
            .update({ sepa_datei_id: sepaDateiId, einzug_am: faelligkeit, updated_at: trx.fn.now() })
            .returning('id');
        if (geaendert.length !== ids.length) {
            throw new FachFehler(409, 'Die Lastschriften wurden gerade gleichzeitig geändert, bitte erneut versuchen.');
        }
        await trx('lastschrift_mandate').whereIn('id', mandatIds).update({
            letzter_einzug_am: faelligkeit, loeschen_ab: berechneLoeschenAb(faelligkeit), updated_at: trx.fn.now()
        });

        return {
            xml: datei.xml,
            dateiname: `sepa-lastschrift-${turnier.id}-${heute}.xml`,
            anzahl: datei.anzahl,
            summeCent: datei.summeCent,
            faelligkeit,
            warnung: hinweise.length ? hinweise.join(' ') : null,
            sepaDateiId,
            msgId
        };
    });
}

/** Kopfdaten der erzeugten Dateien eines Turniers (neueste zuerst), ohne Inhalt. */
export async function listeSepaDateien(knex, turnierId) {
    const zeilen = await knex('sepa_dateien').where({ turnier_id: turnierId })
        .orderBy([{ column: 'erzeugt_am', order: 'desc' }, { column: 'id', order: 'desc' }])
        .select('id', 'erzeugt_am', 'anzahl', 'summe_cent', knex.raw("to_char(faelligkeit, 'YYYY-MM-DD') as faelligkeit"));
    return zeilen.map((z) => ({
        id: z.id,
        erzeugt_am: z.erzeugt_am instanceof Date ? z.erzeugt_am.toISOString() : z.erzeugt_am,
        faelligkeit: z.faelligkeit,
        anzahl: z.anzahl,
        summe_cent: z.summe_cent
    }));
}
