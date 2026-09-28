// Kopplung neuer Client-Geräte (Desktop-Client, Spec Desktop-Client Abschnitt 5.4): Der Hallen-
// Server hält ein gemeinsames Geheimnis (SYNC_SECRET) und einen 6-stelligen Kopplungscode, den die
// Turnierleitung auf matten.html sieht. Ein neues Gerät tauscht den Code einmalig gegen das
// Geheimnis. Ohne SYNC_SECRET in der .env erzeugt der Server das Geheimnis selbst (zero-config).
import { randomBytes, randomInt } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const DATEI = 'kopplung.json';

export function normalisiereCode(eingabe) {
    return String(eingabe || '').replace(/\D/g, '');
}

export function erzeugeCode() {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function dateipfad(datenverzeichnis) {
    return path.join(path.resolve(datenverzeichnis), DATEI);
}

function lies(datenverzeichnis) {
    const datei = dateipfad(datenverzeichnis);
    if (!existsSync(datei)) return {};
    try { return JSON.parse(readFileSync(datei, 'utf8')); } catch { return {}; }
}

function schreibe(datenverzeichnis, inhalt) {
    mkdirSync(path.resolve(datenverzeichnis), { recursive: true });
    writeFileSync(dateipfad(datenverzeichnis), JSON.stringify(inhalt, null, 2));
}

export function ladeKopplung({ datenverzeichnis, envSecret }) {
    const inhalt = lies(datenverzeichnis);
    let geaendert = false;
    let secretErzeugt = false;
    if (!inhalt.code) { inhalt.code = erzeugeCode(); geaendert = true; }
    if (!envSecret && !inhalt.secret) {
        inhalt.secret = randomBytes(32).toString('hex');
        secretErzeugt = true;
        geaendert = true;
    }
    if (geaendert) schreibe(datenverzeichnis, inhalt);
    return { secret: envSecret || inhalt.secret, code: inhalt.code, secretErzeugt };
}

export function erneuereCode({ datenverzeichnis }) {
    const inhalt = lies(datenverzeichnis);
    inhalt.code = erzeugeCode();
    schreibe(datenverzeichnis, inhalt);
    return inhalt.code;
}

// Fehlversuchs-Sperre je IP (gegen Durchprobieren der 10^6 Codes).
export function erzeugeSperre({ maxVersuche = 5, fensterMs = 60000, sperrMs = 60000, jetzt = () => Date.now() } = {}) {
    const versuche = new Map(); // ip -> Zeitstempel der Fehlversuche
    const gesperrtBis = new Map();
    return {
        pruefe(ip) {
            const bis = gesperrtBis.get(ip) || 0;
            const rest = bis - jetzt();
            if (rest > 0) return { gesperrt: true, restMs: rest };
            if (bis) gesperrtBis.delete(ip);
            return { gesperrt: false, restMs: 0 };
        },
        fehlversuch(ip) {
            const t = jetzt();
            const liste = (versuche.get(ip) || []).filter(z => t - z < fensterMs);
            liste.push(t);
            if (liste.length >= maxVersuche) {
                gesperrtBis.set(ip, t + sperrMs);
                versuche.delete(ip);
            } else {
                versuche.set(ip, liste);
            }
        },
        erfolg(ip) {
            versuche.delete(ip);
            gesperrtBis.delete(ip);
        }
    };
}
