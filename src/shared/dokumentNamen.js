// Namen der Dokument-Datenbanken — gemeinsam für Hallen-Server, Node-Client und Android-App.
export function turnierDbName(instanzId) {
    return `turnier_${instanzId}`;
}
