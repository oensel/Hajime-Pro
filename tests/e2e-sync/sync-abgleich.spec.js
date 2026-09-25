// Abgleich relationale DB -> Dokument-DB: nach jedem REST-Schreibzugriff stehen die Live-Daten
// des Turniers (Matten, Pools, Teilnehmer, Kämpfe) als Server-Dokumente bereit.
import { test, expect } from '@playwright/test';
import { syncStatus, warteLeerlauf, richteDk8TurnierEin, alleDokumente, ladeDokument } from './helpers.js';

test.describe.serial('Abgleich: relationale DB -> Dokumente', () => {
    let dbName;
    let matId;

    test('nach dem Aufbau stehen alle Live-Daten als Server-Dokumente bereit', async ({ request }) => {
        ({ matId } = await richteDk8TurnierEin(request, 'Sync Abgleich'));
        await warteLeerlauf(request);
        dbName = (await syncStatus(request)).db_name;
        const docs = await alleDokumente(request, dbName);
        const anzahl = (typ) => docs.filter(d => d.dokumenttyp === typ).length;
        expect(anzahl('kampf')).toBe(11);
        expect(anzahl('teilnehmer')).toBe(8);
        expect(anzahl('pool')).toBe(1);
        expect(anzahl('kampfflaeche')).toBe(1);
        expect(docs.every(d => d.bearbeitet_von === 'server')).toBe(true);
        const konfig = await ladeDokument(request, dbName, 'konfig:steuerung');
        expect(konfig.bezeichnung).toBe('Sync Abgleich');
    });

    test('REST-Ergebnis erscheint samt Kaskade in den Dokumenten', async ({ request }) => {
        const kaempfe = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
        const erster = kaempfe.find(k => k.status === 'bereit');
        const put = await request.put(`/api/kaempfe/${erster.id}`, {
            data: { status: 'beendet', sieger_id: erster.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 30 }
        });
        expect(put.ok(), await put.text()).toBeTruthy();
        await warteLeerlauf(request);

        const doc = await ladeDokument(request, dbName, `kampf:${erster.id}`);
        expect(doc.status).toBe('beendet');
        expect(doc.sieger_id).toBe(erster.kaempfer1_id);
        expect(doc.bearbeitet_von).toBe('server');

        const sqlNachher = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
        for (const k of sqlNachher) {
            const d = await ladeDokument(request, dbName, `kampf:${k.id}`);
            expect([d.kaempfer1_id, d.kaempfer2_id, d.status, d.matten_reihenfolge])
                .toEqual([k.kaempfer1_id, k.kaempfer2_id, k.status, k.matten_reihenfolge]);
        }
    });
});
