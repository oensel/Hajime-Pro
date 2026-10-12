// Löscht Live-Daten nach dem Turnier (Spec 6.1/10: Aufbewahrung 7 Tage). Die Kindtabellen folgen per ON DELETE CASCADE.
export async function loescheAlteLiveDaten(knex, { tage = 7, jetzt = () => new Date() } = {}) {
    const grenze = new Date(jetzt().getTime() - tage * 86_400_000);
    const grenzDatum = grenze.toISOString().slice(0, 10);
    return knex('live_turniere').where(function () {
        this.where('datum', '<', grenzDatum).orWhere(function () {
            this.where('zurueckgezogen', true).andWhere('empfangen_am', '<', grenze);
        });
    }).del();
}

export function starteAufbewahrung(knex, { tage = 7, intervallMs = 3_600_000, log = console } = {}) {
    const lauf = () => loescheAlteLiveDaten(knex, { tage }).then(
        (anzahl) => { if (anzahl) log.log(`[LiveCloud] ${anzahl} abgelaufene(s) Turnier(e) gelöscht`); },
        (fehler) => log.warn(`[LiveCloud] Aufbewahrung fehlgeschlagen: ${fehler.message}`)
    );
    lauf();
    const timer = setInterval(lauf, intervallMs);
    timer.unref?.();
    return { stoppe: () => clearInterval(timer) };
}
