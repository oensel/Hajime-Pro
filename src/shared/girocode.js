// GiroCode/EPC-QR-Inhalt nach EPC069-12, von SEPA-fähigen Banking-Apps direkt scanbar.
const einzeilig = (t) => String(t ?? '').replace(/[\r\n]+/g, ' ');

export function baueGiroCodePayload({ name, iban, betrag, verwendungszweck }) {
    const summe = Number(betrag);
    if (!Number.isFinite(summe) || summe < 0) throw new RangeError('Ungültiger Betrag für den GiroCode.');
    const zeilen = [
        'BCD',
        '002',
        '1',
        'SCT',
        '', // BIC — seit 2016 für IBANs aus dem EWR nicht mehr erforderlich
        einzeilig(name).slice(0, 70),
        (iban || '').replace(/\s+/g, ''),
        `EUR${summe.toFixed(2)}`,
        '', // Purpose
        '', // Strukturierte Zahlungsreferenz
        einzeilig(verwendungszweck).slice(0, 140)
    ];
    return zeilen.join('\n');
}
