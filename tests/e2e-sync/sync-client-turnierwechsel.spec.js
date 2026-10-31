// Turnierwechsel am Hallen-Server, während ein Client offline noch Änderungen des alten Turniers
// hat: der Client übernimmt die neue Instanz, die alten Änderungen landen gesichert unter
// verworfen/ und erreichen die neue Server-DB nie.
import { test, expect } from '@playwright/test';
import {
    richteDk8TurnierEin, legeTurnierAn, syncStatus, syncLeerlauf, clientStatus, clientTrennen, clientVerbinden,
    ladeClientDokument, schreibeClientDokument, alleDokumente, CLIENT_BASE_URL
} from './helpers.js';

test('Turnierwechsel mit ausstehenden Offline-Änderungen', async ({ request }) => {
    test.setTimeout(90_000);
    const { teilnehmerIds, matId } = await richteDk8TurnierEin(request, 'Sync Wechsel Alt');
    await syncLeerlauf(request);
    const alt = await syncStatus(request);
    const clientId = (await clientStatus(request)).client_id;

    await clientTrennen(request);
    const kaempfe = await (await request.get(`${CLIENT_BASE_URL}/api/kaempfe?kampfflaecheId=${matId}`)).json();
    const kampfDoc = await ladeClientDokument(request, alt.db_name, `kampf:${kaempfe[0].id}`);
    await schreibeClientDokument(request, alt.db_name, {
        ...kampfDoc, status: 'beendet', sieger_id: kampfDoc.kaempfer1_id, bearbeitet_von: 'browser', geschrieben_von_knoten: clientId
    });
    const tDoc = await ladeClientDokument(request, alt.db_name, `teilnehmer:${teilnehmerIds[0]}`);
    await schreibeClientDokument(request, alt.db_name, {
        ...tDoc, gewicht: 58.2, gewogen: true, bearbeitet_von: 'browser', geschrieben_von_knoten: clientId
    });
    // ausstehend zählt der Änderungs-Feed der lokalen DB zeitversetzt mit (replikation.js), daher warten.
    await expect.poll(async () => (await clientStatus(request)).ausstehend).toBe(2);

    // Am Server wird inzwischen ein neues Turnier angelegt (löscht das alte komplett).
    await legeTurnierAn(request, 'Sync Wechsel Neu');
    const neu = await syncStatus(request);

    await clientVerbinden(request);
    await expect.poll(async () => (await clientStatus(request)).instanz_id, { timeout: 20000 }).toBe(neu.instanz_id);
    await syncLeerlauf(request);
    expect((await clientStatus(request)).ausstehend).toBe(0);

    const verworfen = await (await request.get(`${CLIENT_BASE_URL}/api/sync/test/verworfen`)).json();
    const eintrag = verworfen.find(v => v.alte_instanz_id === alt.instanz_id);
    expect(eintrag).toBeTruthy();
    expect(eintrag.dokumente.map(d => d._id).sort()).toEqual([`kampf:${kaempfe[0].id}`, `teilnehmer:${teilnehmerIds[0]}`].sort());

    const serverDocs = await alleDokumente(request, neu.db_name);
    expect(serverDocs.some(d => d._id === `kampf:${kaempfe[0].id}` || d._id === `teilnehmer:${teilnehmerIds[0]}`)).toBe(false);
    expect((await request.get(`/db/${alt.db_name}`)).status()).toBe(404);
});

test('Server ohne aktives Turnier: Client verwirft die Kopie des alten Turniers', async ({ request }) => {
    test.setTimeout(90_000);
    const turnierId = await legeTurnierAn(request, 'Sync Ohne Aktiv');
    await syncLeerlauf(request);
    const alt = await syncStatus(request);
    await expect.poll(async () => (await clientStatus(request)).instanz_id, { timeout: 20000 }).toBe(alt.instanz_id);

    const absage = await request.post(`/api/turniere/${turnierId}/absagen`);
    expect(absage.ok(), await absage.text()).toBeTruthy();
    expect((await syncStatus(request)).instanz_id).toBeNull();

    await expect.poll(async () => (await clientStatus(request)).instanz_id, { timeout: 20000 }).toBeNull();
    // ohne Datenbank liefert der Client keine Teilnehmer des alten Turniers mehr
    const teilnehmer = await request.get(`${CLIENT_BASE_URL}/api/teilnehmer?turnierId=${turnierId}`);
    expect(teilnehmer.ok() ? await teilnehmer.json() : []).toEqual([]);
});
