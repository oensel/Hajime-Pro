// Persistente Einstellungen des Desktop-Clients im Benutzerprofil (app.getPath('userData')),
// außerhalb des Programmordners — Updates überschreiben sie nie.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const STANDARD = { serverUrl: null, secret: null, updateVersuche: {} };

export function erzeugeEinstellungen(datei) {
    function lade() {
        let inhalt = {};
        if (existsSync(datei)) {
            try { inhalt = JSON.parse(readFileSync(datei, 'utf8')); } catch { inhalt = {}; }
        }
        const werte = { ...STANDARD, ...inhalt };
        if (!werte.clientId) {
            werte.clientId = randomUUID();
            schreibe(werte);
        }
        return werte;
    }
    function schreibe(werte) {
        mkdirSync(path.dirname(datei), { recursive: true });
        writeFileSync(datei, JSON.stringify(werte, null, 2));
    }
    return {
        lade,
        speichere(teil) {
            const werte = { ...lade(), ...teil };
            schreibe(werte);
            return werte;
        }
    };
}
