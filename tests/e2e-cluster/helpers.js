import { expect } from '@playwright/test';
import { KNOTEN, LEITSTAND_URL, CLIENT_URL } from './test-env.js';

export { KNOTEN, CLIENT_URL };

export async function leitstand(request, pfad, methode = 'GET') {
    const resp = methode === 'GET' ? await request.get(`${LEITSTAND_URL}${pfad}`) : await request.post(`${LEITSTAND_URL}${pfad}`, { timeout: 90_000 });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return resp.json();
}

export async function vipHalter(request) {
    return (await leitstand(request, '/status')).vip;
}

// Wartet, bis die VIP bei `knoten` liegt und dieser Master ist.
export async function warteAufMaster(request, knoten, timeout = 20_000) {
    await expect.poll(async () => vipHalter(request), { timeout, message: `VIP bei ${knoten}` }).toBe(knoten);
    await expect.poll(async () => (await knotenStatus(request, knoten)).rolle, { timeout }).toBe('master');
}

export async function knotenStatus(request, knoten) {
    const resp = await request.get(`${KNOTEN[knoten].url}/api/cluster/status?nurEigen=1`);
    expect(resp.ok()).toBeTruthy();
    return resp.json();
}

// Master mit synchroner Replikation und gesundem, nachgezogenem Secondary.
export async function warteAufSynchron(request, master, timeout = 30_000) {
    const secondary = KNOTEN[master].partner;
    await expect.poll(async () => (await knotenStatus(request, master)).pg.absicherung, { timeout, message: `${master} synchron` }).toBe('synchron');
    await expect.poll(async () => {
        const s = await knotenStatus(request, secondary);
        return `${s.rolle}/${s.gesund}/${s.pg.rolle}`;
    }, { timeout, message: `${secondary} gesunder Standby` }).toBe('secondary/true/standby');
}

export async function warteLeerlauf(request) {
    const resp = await request.post('/api/sync/test/leerlauf');
    expect(resp.ok(), await resp.text()).toBeTruthy();
}

export async function legeTurnierAn(request, bezeichnung) {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung, ort: 'Teststadt', datum: '2027-03-20', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return (await resp.json()).turnierId;
}

export async function legeTeilnehmerAn(request, turnierId, vorname, nachname) {
    const resp = await request.post('/api/teilnehmer', {
        data: {
            turnier_id: turnierId, vorname, nachname, verein: 'JC Cluster', geburtsjahr: 2009,
            geschlecht: 'männlich', gewicht: 60, altersklasse: 'U18', gewichtsklasse: '-73kg'
        }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return (await resp.json()).teilnehmerId;
}

export async function teilnehmerNamen(request, basisUrl, turnierId) {
    const resp = await request.get(`${basisUrl}/api/teilnehmer?turnierId=${turnierId}`);
    expect(resp.ok(), await resp.text()).toBeTruthy();
    const daten = await resp.json();
    const liste = Array.isArray(daten) ? daten : daten.teilnehmer || [];
    return liste.map(t => t.nachname).sort();
}

export async function clientStatus(request) {
    const resp = await request.get(`${CLIENT_URL}/api/sync/status`);
    expect(resp.ok()).toBeTruthy();
    return resp.json();
}
