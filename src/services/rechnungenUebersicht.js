// Alle Startgeld-Rechnungen, die ein Verein als Ausrichter gestellt hat (über alle Turniere), für die Seite "Rechnungen".
// Ohne PDF-Inhalt (der kommt je Rechnung über die Turnier-Abrechnung); der Zugriff wird von der Route geprüft.
import { rechnungsAnzeigeStatus, heuteBerlin } from '../shared/abrechnung.js';

export async function ladeRechnungenDesVereins(knex, vereinId, heute = heuteBerlin()) {
    const zeilen = await knex('rechnungen')
        .where({ aussteller_verein_id: vereinId })
        .select('id', 'turnier_id', 'verein_name', 'zahlweg', 'art', 'nummer', 'turnier_bezeichnung', 'anzahl', 'betrag_cent',
            'status', 'versandt_am', 'bezahlt_am', 'sepa_datei_id',
            knex.raw("to_char(rechnungsdatum, 'YYYY-MM-DD') as rechnungsdatum"),
            knex.raw("to_char(zahlungsziel_datum, 'YYYY-MM-DD') as zahlungsziel_datum"),
            knex.raw("to_char(einzug_am, 'YYYY-MM-DD') as einzug_am"))
        .orderBy([{ column: 'rechnungsdatum', order: 'desc' }, { column: 'id', order: 'desc' }]);
    return zeilen.map((z) => ({ ...z, anzeigeStatus: rechnungsAnzeigeStatus(z, heute) }));
}

/** Anzahl der Rechnungen des Vereins als Ausrichter (Menüpunkt "Rechnungen" erscheint erst, wenn es welche gibt). */
export async function zaehleRechnungenDesVereins(knex, vereinId) {
    const zeile = await knex('rechnungen').where({ aussteller_verein_id: vereinId }).count({ anzahl: 'id' }).first();
    return Number(zeile?.anzahl ?? 0);
}
