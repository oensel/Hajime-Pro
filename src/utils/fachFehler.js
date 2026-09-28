// Fachlicher Fehler einer Service-Funktion (ohne req/res): trägt den HTTP-Status, den die
// REST-Route zurückgibt, bzw. den die Sync-Brücke als Ablehnung an die Matte/Waage meldet.
export class FachFehler extends Error {
    constructor(statusCode, nachricht, { code = null, daten = null } = {}) {
        super(nachricht);
        this.statusCode = statusCode;
        this.code = code;
        this.daten = daten;
    }
}
