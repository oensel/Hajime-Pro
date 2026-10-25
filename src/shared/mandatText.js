// Text des SEPA-Lastschriftmandats (framework-frei). Rechtlich zu prüfen, deshalb versioniert.

export const MANDATSTEXT_VERSION = '2026-11-v1';

export function baueMandatstext({ glaeubigerName, glaeubigerId, mandatsreferenz, vorabTage, turnierBezeichnung, zahlenderVerein }) {
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
        `Vorabankündigung: spätestens ${vorabTage} Tage vor Fälligkeit per E-Mail (Rechnung).`
    ].join('\n');
}
