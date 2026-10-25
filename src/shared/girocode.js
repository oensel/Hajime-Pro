// GiroCode/EPC-QR-Inhalt nach EPC069-12, von SEPA-fähigen Banking-Apps direkt scanbar.
export function baueGiroCodePayload({ name, iban, betrag, verwendungszweck }) {
    const zeilen = [
        'BCD',
        '002',
        '1',
        'SCT',
        '', // BIC — seit 2016 für IBANs aus dem EWR nicht mehr erforderlich
        (name || '').slice(0, 70),
        (iban || '').replace(/\s+/g, ''),
        `EUR${Number(betrag).toFixed(2)}`,
        '', // Purpose
        '', // Strukturierte Zahlungsreferenz
        (verwendungszweck || '').slice(0, 140)
    ];
    return zeilen.join('\n');
}
