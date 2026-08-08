import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Datenquelle & Lizenz: siehe THIRD_PARTY_NOTICES.md im Projekt-Root.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLZ_KOORDINATEN = JSON.parse(readFileSync(path.join(__dirname, '../config/plz_koordinaten.json'), 'utf-8'));

const ERDRADIUS_KM = 6371;

// Haversine-Formel: Luftlinie zwischen zwei Punkten auf der Erdkugel in km.
function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return ERDRADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Liefert [lat, lon] für eine deutsche Postleitzahl, oder null, wenn die PLZ unbekannt ist
// (z.B. Tippfehler oder sehr neue Postleitzahl, die im Datensatz noch fehlt).
export function koordinatenFuerPlz(plz) {
    if (!plz) return null;
    const eintrag = PLZ_KOORDINATEN[String(plz).trim()];
    return eintrag || null;
}

// Entfernung in km (auf eine Nachkommastelle gerundet) zwischen einer deutschen Postleitzahl und
// einem gegebenen Standort (z.B. dem per Browser-Geolocation ermittelten aktuellen Standort des
// Nutzers). Gibt null zurück, wenn die PLZ fehlt/unbekannt ist oder kein Standort übergeben wurde.
export function entfernungZuPlzInKm(plz, standortLat, standortLon) {
    if (standortLat === undefined || standortLat === null || standortLon === undefined || standortLon === null) {
        return null;
    }
    const koordinaten = koordinatenFuerPlz(plz);
    if (!koordinaten) return null;

    const [plzLat, plzLon] = koordinaten;
    const lat = parseFloat(standortLat);
    const lon = parseFloat(standortLon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

    return Math.round(haversineKm(plzLat, plzLon, lat, lon) * 10) / 10;
}
