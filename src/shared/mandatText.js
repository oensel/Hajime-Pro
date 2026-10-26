// Text des SEPA-Lastschriftmandats (framework-frei). Rechtlich zu prüfen, deshalb versioniert.
// Die Pflichtbestandteile (Ermächtigung, Anweisung an die Bank, Erstattungshinweis, Gläubiger-ID, Referenz) sind fest;
// der Ausrichter kann nur einen Zusatztext anhängen.

export const MANDATSTEXT_VERSION = '2026-11-v1';
export const MANDAT_ZUSATZTEXT_MAX = 500;

// Fassung mit Zusatztext hat eine eigene Kennung, damit am gespeicherten Mandat erkennbar bleibt, welcher Wortlaut galt.
export function mandatstextVersion(zusatztext) {
    return normalisiereZusatztext(zusatztext) ? `${MANDATSTEXT_VERSION}+zusatz` : MANDATSTEXT_VERSION;
}

/** Zeilenenden vereinheitlichen, Steuerzeichen entfernen, Ränder trimmen; leer = kein Zusatz (null). */
export function normalisiereZusatztext(roh) {
    if (roh == null) return null;
    const text = String(roh).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
    return text || null;
}

export function baueMandatstext({ glaeubigerName, glaeubigerId, mandatsreferenz, vorabTage, turnierBezeichnung, zahlenderVerein, zusatztext = null }) {
    const zusatz = normalisiereZusatztext(zusatztext);
    return [
        'SEPA-Lastschriftmandat (einmalige Zahlung)',
        '',
        `Gläubiger: ${glaeubigerName}`,
        `Gläubiger-Identifikationsnummer: ${glaeubigerId}`,
        `Mandatsreferenz: ${mandatsreferenz}`,
        `Zahlungspflichtiger: ${zahlenderVerein}`,
        '',
        `Wir ermächtigen ${glaeubigerName}, einmalig Zahlungen von unserem Konto mittels Lastschrift einzuziehen. ` +
            `Zugleich weisen wir unser Kreditinstitut an, die von ${glaeubigerName} auf unser Konto gezogenen Lastschriften einzulösen.`,
        '',
        'Hinweis: Wir können innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, die Erstattung des belasteten Betrages verlangen. ' +
            'Es gelten dabei die mit unserem Kreditinstitut vereinbarten Bedingungen.',
        '',
        `Zahlungszweck: Startgeld ${turnierBezeichnung}`,
        `Vorabankündigung: spätestens ${vorabTage} ${Number(vorabTage) === 1 ? 'Tag' : 'Tage'} vor Fälligkeit per E-Mail (Rechnung).`,
        ...(zusatz ? ['', `Zusatz des Gläubigers: ${zusatz}`] : [])
    ].join('\n');
}
