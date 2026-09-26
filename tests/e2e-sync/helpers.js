import { expect } from '@playwright/test';

export async function syncStatus(request) {
    const resp = await request.get('/api/sync/status');
    expect(resp.ok()).toBeTruthy();
    return resp.json();
}

// Wartet, bis Brücke und Abgleich alle anstehenden Änderungen verarbeitet haben (Test-Endpunkt).
export async function warteLeerlauf(request) {
    const resp = await request.post('/api/sync/test/leerlauf');
    expect(resp.ok(), await resp.text()).toBeTruthy();
}

export async function legeTurnierAn(request, bezeichnung, anzahl_kampfflaechen = 1) {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung, ort: 'Teststadt', datum: '2027-03-20', ausrichter: 'JC Test', anzahl_kampfflaechen }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return (await resp.json()).turnierId;
}

export async function ladeDokument(request, dbName, id) {
    const resp = await request.get(`/db/${dbName}/${encodeURIComponent(id)}`);
    return resp.ok() ? resp.json() : null;
}

export async function schreibeDokument(request, dbName, dokument) {
    const resp = await request.put(`/db/${dbName}/${encodeURIComponent(dokument._id)}`, { data: dokument });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return resp.json();
}

export async function alleDokumente(request, dbName) {
    const resp = await request.get(`/db/${dbName}/_all_docs?include_docs=true`);
    expect(resp.ok()).toBeTruthy();
    return (await resp.json()).rows.map(r => r.doc).filter(d => !d._id.startsWith('_design/'));
}

export const DK8_TEILNEHMER = [
    { vorname: 'Anna', nachname: 'Adler', verein: 'JC Alpha', gewicht: 60 },
    { vorname: 'Berta', nachname: 'Busch', verein: 'JC Beta', gewicht: 61 },
    { vorname: 'Clara', nachname: 'Conrad', verein: 'JC Gamma', gewicht: 62 },
    { vorname: 'Diana', nachname: 'Diehl', verein: 'JC Delta', gewicht: 63 },
    { vorname: 'Elena', nachname: 'Ebert', verein: 'JC Epsilon', gewicht: 64 },
    { vorname: 'Frida', nachname: 'Fuchs', verein: 'JC Zeta', gewicht: 65 },
    { vorname: 'Greta', nachname: 'Graf', verein: 'JC Eta', gewicht: 66 },
    { vorname: 'Hanna', nachname: 'Hoffmann', verein: 'JC Theta', gewicht: 67 }
];

// Turnier + Matte + DK8-Pool mit 8 Teilnehmern, Pool der Matte zugeordnet (11 Kämpfe) — gleicher
// Aufbau wie richteDk8TurnierEin in tests/e2e/steuerung-dk8-online-vs-offline.spec.js.
export async function richteDk8TurnierEin(request, bezeichnung) {
    const turnierId = await legeTurnierAn(request, bezeichnung);
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const poolResp = await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: `${bezeichnung} Pool`, altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg' }
    });
    expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
    const { poolId } = await poolResp.json();
    const teilnehmerIds = [];
    for (const t of DK8_TEILNEHMER) {
        const tResp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: t.vorname, nachname: t.nachname, verein: t.verein,
                geburtsjahr: 2009, geschlecht: 'männlich', gewicht: t.gewicht, altersklasse: 'U18', gewichtsklasse: '-73kg'
            }
        });
        expect(tResp.ok(), await tResp.text()).toBeTruthy();
        teilnehmerIds.push((await tResp.json()).teilnehmerId);
    }
    for (const teilnehmerId of teilnehmerIds) {
        const r = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(r.ok(), await r.text()).toBeTruthy();
    }
    const z = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(z.ok(), await z.text()).toBeTruthy();
    return { turnierId, matId, poolId, teilnehmerIds };
}

// ---------- Client-Knoten (Port 3201) ----------
import { CLIENT_BASE_URL } from './test-env.js';
export { CLIENT_BASE_URL };

export async function clientStatus(request) {
    const resp = await request.get(`${CLIENT_BASE_URL}/api/sync/status`);
    expect(resp.ok()).toBeTruthy();
    return resp.json();
}

// Wartet, bis der Client die aktuelle Server-Instanz geöffnet und alles übertragen hat, und
// danach, bis der Server alles verarbeitet hat — und holt die Folgeänderungen des Servers zurück.
export async function syncLeerlauf(request) {
    const server = await syncStatus(request);
    await expect.poll(async () => (await clientStatus(request)).instanz_id, { timeout: 15000 }).toBe(server.instanz_id);
    for (let i = 0; i < 2; i++) {
        const c = await request.post(`${CLIENT_BASE_URL}/api/sync/test/leerlauf`);
        expect(c.ok()).toBeTruthy();
        await warteLeerlauf(request);
    }
    const c = await request.post(`${CLIENT_BASE_URL}/api/sync/test/leerlauf`);
    expect(c.ok()).toBeTruthy();
}

export async function clientTrennen(request) {
    const r = await request.post(`${CLIENT_BASE_URL}/api/sync/test/trennen`);
    expect(r.ok()).toBeTruthy();
}

export async function clientVerbinden(request) {
    const r = await request.post(`${CLIENT_BASE_URL}/api/sync/test/verbinden`);
    expect(r.ok()).toBeTruthy();
}

export async function ladeClientDokument(request, dbName, id) {
    const resp = await request.get(`${CLIENT_BASE_URL}/db/${dbName}/${encodeURIComponent(id)}`);
    return resp.ok() ? resp.json() : null;
}

export async function schreibeClientDokument(request, dbName, dokument) {
    const resp = await request.put(`${CLIENT_BASE_URL}/db/${dbName}/${encodeURIComponent(dokument._id)}`, { data: dokument });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return resp.json();
}
