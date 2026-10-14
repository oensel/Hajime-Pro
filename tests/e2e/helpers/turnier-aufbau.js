// Gemeinsamer Aufbau für E2E-Specs, die ihr Turnier selbst herstellen (eigener DB-Stand je Datei, damit
// Specs unabhängig voneinander und später parallel laufen können). Alles läuft über die HTTP-API
// (IS_OFFLINE: keine Anmeldung nötig), bewusst NICHT über /api/turniere/import: der Import löscht alle
// Turniere der Test-DB (siehe pool-fixture-turnier.js).
import { expect } from '@playwright/test';

export async function legeTurnierAn(request, { name, anzahlKampfflaechen = 1, datum = '2027-05-15' } = {}) {
    const resp = await request.post('/api/turniere', {
        data: {
            bezeichnung: `E2E ${name} ${Date.now()}`, ort: 'Halle', datum, ausrichter: 'JC E2E',
            anzahl_kampfflaechen: anzahlKampfflaechen
        }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return (await resp.json()).turnierId;
}

// Legt `anzahl` Teilnehmer einer Klasse an; `gewogen: false` lässt sie "angemeldet" (Einwiegen später).
export async function legeKlasseAn(request, turnierId, { altersklasse, geschlecht, gewichtsklasse, anzahl, gewogen = true, gewichtStart = 30 }) {
    const ids = [];
    for (let i = 0; i < anzahl; i++) {
        const resp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: `${altersklasse}${geschlecht}${i}`, nachname: `Test${turnierId}`,
                verein: `Verein ${i % 2}`, geburtsjahr: 2010, geschlecht, gewicht: gewichtStart + i,
                altersklasse, gewichtsklasse, lizenz_ablauf: '2099-12-31', gewogen
            }
        });
        expect(resp.status(), await resp.text()).toBe(201);
        ids.push((await resp.json()).teilnehmerId);
    }
    return ids;
}

export async function wiege(request, teilnehmerIds) {
    for (const id of teilnehmerIds) {
        const resp = await request.put(`/api/teilnehmer/${id}/status`, { data: { gewogen: true, lizenz_ablauf: '2099-12-31' } });
        expect(resp.ok(), await resp.text()).toBeTruthy();
    }
}

export async function loseAus(request, turnierId, altersklassen) {
    const resp = await request.post('/api/pools/generieren', { data: { turnierId, altersklassen } });
    expect(resp.ok(), await resp.text()).toBeTruthy();
}

export async function verteileAufMatten(request, turnierId, modus = 'neue') {
    const resp = await request.post('/api/pools/aufteilen', { data: { turnierId, modus } });
    expect(resp.ok(), await resp.text()).toBeTruthy();
}

export const holePools = async (request, turnierId) =>
    (await request.get(`/api/pools/details?turnierId=${turnierId}`)).json();

// Was ein Scoreboard/die Steuerung für die Matte sieht (public/js/datenzugriff.js: ladeKaempfeDerMatte).
export const holeKaempfeDerMatte = async (request, matteId) =>
    (await request.get(`/api/kaempfe?kampfflaecheId=${matteId}`)).json();

export const holeKaempfeDesPools = async (request, poolId) =>
    (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
