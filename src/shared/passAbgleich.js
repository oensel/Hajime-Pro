// Abgleich eines gescannten Judopasses mit den Teilnehmern eines Turniers (Waage). Framework-/DB-frei,
// läuft im Browser (waage-modal.js) und in den Unit-Tests identisch.

// Namen vergleichbar machen: Groß-/Kleinschreibung, Akzente (é → e), Umlaute (ä → ae, ß → ss),
// Bindestriche und mehrfache Leerzeichen spielen für die Zuordnung keine Rolle.
export function normalisiereName(wert) {
    return String(wert ?? '')
        .trim()
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[-–]/g, ' ')
        .replace(/\s+/g, ' ');
}

// Geburtsjahr aus einem Scanwert: "2012", "2012-05-01", "01.05.2012" oder "1.5.2012".
export function ermittleJahrAusWert(wert) {
    const str = String(wert ?? '').trim();
    const iso = str.match(/^(\d{4})(?!\d)/);
    if (iso) return iso[1];
    const deutsch = str.match(/(?:^|\D)(\d{4})$/);
    return deutsch ? deutsch[1] : '';
}

const idText = (id) => String(id ?? '').trim();

/**
 * Sucht den Teilnehmer zu einem gescannten Pass.
 * 1. über die Judopass-Nr., 2. ersatzweise über Vorname, Nachname und Geburtsjahr.
 * Bei mehreren Namenstreffern gewinnt ein Teilnehmer ohne eigene Judopass-Nr.
 * @returns {{ teilnehmer: object, ueber: 'judopass'|'name' } | null}
 */
export function findeTeilnehmerZuPass(teilnehmerListe, { judopassId, vorname, nachname, geburtsjahr }) {
    const liste = Array.isArray(teilnehmerListe) ? teilnehmerListe : [];

    const scanId = idText(judopassId);
    if (scanId) {
        const t = liste.find(x => idText(x.judopass_id ?? x.judopassId) === scanId);
        if (t) return { teilnehmer: t, ueber: 'judopass' };
    }

    const vn = normalisiereName(vorname);
    const nn = normalisiereName(nachname);
    const jahr = String(geburtsjahr ?? '').trim();
    if (!vn || !nn || !jahr) return null;

    const kandidaten = liste.filter(x =>
        normalisiereName(x.vorname) === vn &&
        normalisiereName(x.nachname) === nn &&
        String(x.geburtsjahr ?? '').trim() === jahr
    );
    if (kandidaten.length === 0) return null;
    const t = kandidaten.find(x => !idText(x.judopass_id ?? x.judopassId)) || kandidaten[0];
    return { teilnehmer: t, ueber: 'name' };
}
