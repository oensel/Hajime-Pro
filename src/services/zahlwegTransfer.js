// Zahlwege im Turnier-Export/-Import (Cloud <-> Hallen-Server). Exportiert werden nur Namen und Rechnungsdaten,
// kein Benutzer- und kein Vereinsbezug (geaendert_von/verein_id). Das Flag startgeld_zahlweg_gesichert reist nicht mit,
// es wird nach dem Import mit synchronisiereGesichert neu abgeleitet.

export async function exportiereZahlwege(knex, turnierId) {
    const zeilen = await knex('turnier_zahlwege').where({ turnier_id: turnierId }).orderBy('id', 'asc');
    return zeilen.map((z) => ({
        verein_name: z.verein_name,
        zahlweg: z.zahlweg,
        rechnung_email: z.rechnung_email ?? null,
        rechnung_ansprechperson: z.rechnung_ansprechperson ?? null,
        rechnung_anschrift: z.rechnung_anschrift ?? null
    }));
}

// Ersetzt die Zahlwege des Turniers durch die der Datei. Fehlt der Abschnitt (ältere Dateien), bleibt alles unberührt.
export async function ersetzeZahlwege(trx, turnierId, zahlwege) {
    if (!Array.isArray(zahlwege)) return 0;
    await trx('turnier_zahlwege').where({ turnier_id: turnierId }).del();
    const zeilen = [];
    const gesehen = new Set();
    for (const z of zahlwege) {
        const name = typeof z?.verein_name === 'string' ? z.verein_name : '';
        if (!name || gesehen.has(name) || typeof z.zahlweg !== 'string' || !z.zahlweg) continue;
        gesehen.add(name);
        zeilen.push({
            turnier_id: turnierId,
            verein_name: name,
            zahlweg: z.zahlweg,
            rechnung_email: z.rechnung_email ?? null,
            rechnung_ansprechperson: z.rechnung_ansprechperson ?? null,
            rechnung_anschrift: z.rechnung_anschrift ?? null
        });
    }
    if (zeilen.length) await trx('turnier_zahlwege').insert(zeilen);
    return zeilen.length;
}
