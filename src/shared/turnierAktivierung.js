// Regeln für mehrere Turniere am Hallen-Server (Spec docs/specs/2026-10-17-mehrere-turniere-design.md):
// ein Turnier pro Tag, höchstens ein aktives Turnier, Aktivieren nur am Wettkampftag.
// Bewusst frei von knex/DOM, damit die Regeln einzeln testbar sind.

// Liefert 'JJJJ-MM-TT' aus einem Datum (Date aus der Datenbank oder String).
export function datumAlsIso(wert) {
    if (!wert) return null;
    if (wert instanceof Date) {
        if (Number.isNaN(wert.getTime())) return null;
        const monat = String(wert.getMonth() + 1).padStart(2, '0');
        const tag = String(wert.getDate()).padStart(2, '0');
        return `${wert.getFullYear()}-${monat}-${tag}`;
    }
    const text = String(wert).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

export function heuteIso(jetzt = new Date()) {
    return datumAlsIso(jetzt);
}

// Sucht ein anderes (nicht abgesagtes) Turnier am selben Tag.
export function findeTerminKonflikt(turniere, datum, ausserId = null) {
    const tag = datumAlsIso(datum);
    if (!tag) return null;
    return turniere.find(t => (ausserId == null || Number(t.id) !== Number(ausserId))
        && t.status !== 'abgesagt'
        && datumAlsIso(t.datum) === tag) || null;
}

// Darf das Turnier jetzt aktiviert werden? Antwort { moeglich, grund }.
export function ermittleAktivierbarkeit({ turnier, aktivesTurnier = null, heute = heuteIso() }) {
    if (turnier.aktiv) return { moeglich: false, grund: 'Dieses Turnier ist bereits aktiv.' };
    if (turnier.status === 'abgeschlossen') return { moeglich: false, grund: 'Ein abgeschlossenes Turnier kann nicht mehr aktiviert werden.' };
    if (turnier.status === 'abgesagt') return { moeglich: false, grund: 'Ein abgesagtes Turnier kann nicht aktiviert werden.' };
    if (aktivesTurnier && Number(aktivesTurnier.id) !== Number(turnier.id)) {
        return { moeglich: false, grund: `Das Turnier „${aktivesTurnier.bezeichnung}“ ist noch aktiv. Beende zuerst dessen Durchführung.` };
    }
    const tag = datumAlsIso(turnier.datum);
    if (tag !== heute) {
        return { moeglich: false, grund: 'Ein Turnier kann nur am Wettkampftag aktiviert werden.' };
    }
    return { moeglich: true, grund: null };
}

// Teilnehmer für die Kopie eines Turniers: Gewicht, Stammdaten, Pass und das Lizenz-Ablaufdatum
// bleiben; was am Wettkampftag neu erfasst wird, wird zurückgesetzt (nicht gewogen, Startgeld
// offen, Status "angemeldet", kein Pool).
export function kopiereTeilnehmerFuerNeuesTurnier(teilnehmer, neueTurnierId) {
    const {
        id, pool_id, created_at, updated_at, dokument_id, ...rest
    } = teilnehmer;
    return {
        ...rest,
        turnier_id: neueTurnierId,
        pool_id: null,
        status: 'angemeldet',
        gewogen: false,
        startgeld_bezahlt: false,
        // Wird nach dem Kopieren aus den Zahlwegen der Kopie neu abgeleitet (synchronisiereGesichert).
        startgeld_zahlweg_gesichert: false
    };
}
