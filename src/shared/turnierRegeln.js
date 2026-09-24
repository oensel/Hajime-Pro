// Anmeldeschluss wird als reines Datum (ohne Uhrzeit) gespeichert; die Frist gilt bis
// einschließlich 24:00 Uhr Ortszeit dieses Tages. setHours (lokale Zeit) statt setUTCHours,
// da UTC-Mitternacht je nach Zeitzone des Servers mehrere Stunden von der tatsächlichen
// deutschen Ortszeit abweicht.
export function berechneAnmeldefrist(anmeldeschluss) {
    const deadline = new Date(anmeldeschluss);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(anmeldeschluss).trim())) {
        deadline.setHours(23, 59, 59, 999);
    }
    return deadline;
}

// Export und Ergebnis-Upload sind erst sinnvoll, wenn sich die Anmeldungen nicht mehr ändern
// können — ohne hinterlegte Frist gilt sie als noch nicht abgelaufen (sicherer Default).
export function istAnmeldefristAbgelaufen(turnier) {
    if (!turnier.anmeldeschluss) return false;
    return new Date() > berechneAnmeldefrist(turnier.anmeldeschluss);
}

// Nur 'entwurf' | 'veroeffentlicht' | 'abgeschlossen' | 'abgesagt' werden physisch gespeichert.
// 'anmeldung_geschlossen' und 'in_durchfuehrung' sind reine Ableitungen (kein Cronjob nötig).
export function ermittleEffektivenStatus(turnier, { hatEchteKaempfe = false } = {}) {
    if (turnier.status !== 'veroeffentlicht') return turnier.status;

    const heuteStr = new Date().toISOString().slice(0, 10);
    const wettkampftagErreicht = turnier.datum && String(turnier.datum).slice(0, 10) <= heuteStr;
    if (wettkampftagErreicht || hatEchteKaempfe) return 'in_durchfuehrung';
    if (istAnmeldefristAbgelaufen(turnier)) return 'anmeldung_geschlossen';
    return 'veroeffentlicht';
}

// Wird ein Startgeld verlangt, müssen die Zahlungsdaten vollständig sein, sonst kann später
// niemand zuverlässig bezahlen (fehlende IBAN/Kontoinhaber/Verwendungszweck).
export function validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck) {
    const startgeldWert = startgeld !== undefined && startgeld !== '' ? parseInt(startgeld, 10) : 0;
    if (startgeldWert > 0) {
        if (!iban || !iban.trim() || !kontoinhaber || !kontoinhaber.trim() || !verwendungszweck || !verwendungszweck.trim()) {
            return 'Wenn ein Startgeld verlangt wird, müssen IBAN, Kontoinhaber und Verwendungszweck ausgefüllt sein.';
        }
    }
    return null;
}

// Nur diese vier Werte werden physisch gespeichert; 'anmeldung_geschlossen' und
// 'in_durchfuehrung' sind reine Ableitungen von ermittleEffektivenStatus.
export const GUELTIGE_STATUS_WERTE = ['entwurf', 'veroeffentlicht', 'abgeschlossen', 'abgesagt'];

// Übersetzt den alten 3-Werte-Kampf-Status (wartet/laufend/beendet) aus vor der
// 6-Werte-Migration exportierten Dateien in das neue Vokabular; bereits neue Werte
// bleiben unverändert.
export function normalisiereKampfStatus(status, kaempfer1Id, kaempfer2Id) {
    if (status === 'laufend') return 'gestartet';
    if (status === 'wartet') return (kaempfer1Id != null && kaempfer2Id != null) ? 'bereit' : 'angelegt';
    if (status === 'beendet' && (kaempfer1Id == null || kaempfer2Id == null)) return 'freilos';
    return status || 'angelegt';
}
