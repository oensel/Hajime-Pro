// Urkunden-Generator (docs/superpowers/specs/2026-09-29-urkunden-generator-design.md):
// Vorlagen-API, Generierung (Seitenzahl je Platzbereich), Editor/Vorschau im Browser und das
// Druck-Angebot nach "Pool abschließen". Die Tests bauen seriell aufeinander auf.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { ladeUndErstelleTurnier, spieleBracketKomplettDurch } from './helpers/pool-fixture-turnier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK8 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pool-ko-doppel-ko8.json'), 'utf8'));
const BLANKO = fs.readFileSync(path.join(__dirname, 'fixtures/urkunde-blanko.pdf')).toString('base64');
const VORLAGEN_NAME = `Standard ${Date.now()}`;
const FELD = { id: 'f1', text: '{Name}', x: 97, y: 400, breite: 400, schrift: 'noto-serif-bold', groesse: 30, farbe: '#1a1a1a', ausrichtung: 'zentriert' };

test.describe.configure({ mode: 'serial' });

let turnierId;
let poolId;
let vorlageId;

async function seitenzahl(resp) {
    return (await PDFDocument.load(await resp.body())).getPageCount();
}

test.describe('Urkunden', () => {
    test.beforeAll(async ({ request }) => {
        ({ turnierId, poolId } = await ladeUndErstelleTurnier(request, DK8));
        await spieleBracketKomplettDurch(request, poolId);
    });

    test('Vorlage anlegen: gültig, doppelter Name, ungültiges PDF', async ({ request }) => {
        const resp = await request.post('/api/urkunden/vorlagen', {
            data: { turnierId, name: VORLAGEN_NAME, pdf_base64: BLANKO, pdf_dateiname: 'blanko.pdf' }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        vorlageId = (await resp.json()).id;

        const doppelt = await request.post('/api/urkunden/vorlagen', {
            data: { turnierId, name: VORLAGEN_NAME, pdf_base64: BLANKO }
        });
        expect(doppelt.status()).toBe(409);

        const kaputt = await request.post('/api/urkunden/vorlagen', {
            data: { turnierId, name: `${VORLAGEN_NAME} kaputt`, pdf_base64: Buffer.from('kein pdf').toString('base64') }
        });
        expect(kaputt.status()).toBe(400);
    });

    test('Felder speichern: außerhalb der Seite abgelehnt, gültig gespeichert', async ({ request }) => {
        const aussen = await request.put(`/api/urkunden/vorlagen/${vorlageId}?turnierId=${turnierId}`, {
            data: { felder: [{ ...FELD, x: 500 }] }
        });
        expect(aussen.status()).toBe(400);

        const ok = await request.put(`/api/urkunden/vorlagen/${vorlageId}?turnierId=${turnierId}`, { data: { felder: [FELD] } });
        expect(ok.ok(), await ok.text()).toBeTruthy();

        const liste = await (await request.get(`/api/urkunden/vorlagen?turnierId=${turnierId}`)).json();
        expect(liste.find(v => v.id === vorlageId).felder).toEqual([FELD]);
    });

    test('Generieren: Seitenzahl je Platzbereich, leere Auswahl → 422', async ({ request }) => {
        const uebersicht = await (await request.get(`/api/urkunden/uebersicht?turnierId=${turnierId}`)).json();
        const pool = uebersicht.pools.find(p => p.id === poolId);
        expect(pool.abgeschlossen).toBe(true);
        expect(pool.anzahl['3']).toBe(4);
        expect(pool.anzahl.alle).toBe(DK8.teilnehmer.length);

        for (const platzbereich of ['3', '7', 'alle']) {
            const resp = await request.post('/api/urkunden/generieren', {
                data: { turnierId, vorlageId, platzbereich, poolIds: [poolId], reihenfolge: 'siegerehrung' }
            });
            expect(resp.ok(), await resp.text()).toBeTruthy();
            expect(resp.headers()['content-type']).toContain('application/pdf');
            expect(resp.headers()['x-urkunden-anzahl']).toBe(String(pool.anzahl[platzbereich]));
            expect(await seitenzahl(resp)).toBe(pool.anzahl[platzbereich]);
        }

        const leer = await request.post('/api/urkunden/generieren', {
            data: { turnierId, vorlageId, platzbereich: '3', poolIds: [], reihenfolge: 'siegerehrung' }
        });
        expect(leer.status()).toBe(422);
    });

    test('Turnier-Export enthält die Vorlagen des Ausrichter-Vereins', async ({ request }) => {
        // Export erst ab Veröffentlichung + echten Kämpfen ("in_durchfuehrung") erlaubt.
        const pub = await request.post(`/api/turniere/${turnierId}/veroeffentlichen`);
        expect(pub.ok(), await pub.text()).toBeTruthy();
        const resp = await request.get(`/api/turniere/${turnierId}/export`);
        expect(resp.ok(), await resp.text()).toBeTruthy();
        const vorlage = (await resp.json()).urkunden_vorlagen?.find(v => v.name === VORLAGEN_NAME);
        expect(vorlage?.felder).toEqual([FELD]);
        expect(vorlage.pdf_base64).toBe(BLANKO);
    });

    test('Editor: freies Textfeld anlegen und speichern, Generieren öffnet die Vorschau', async ({ page, request }) => {
        await page.goto(`/urkunden.html?turnierId=${turnierId}`);
        await page.locator('#vorlagenAuswahl').selectOption(String(vorlageId));
        await expect(page.locator('#editorLeer')).toBeHidden();
        await page.locator('#btnFeldText').click();
        await page.locator('#feldText').fill('Kreismeisterschaft 2026');
        await page.locator('#btnVorlageSpeichern').click();
        await expect.poll(async () => {
            const liste = await (await request.get(`/api/urkunden/vorlagen?turnierId=${turnierId}`)).json();
            return liste.find(v => v.id === vorlageId).felder.map(f => f.text);
        }).toEqual(['{Name}', 'Kreismeisterschaft 2026']);

        await page.locator('#genVorlage').selectOption(String(vorlageId));
        await page.locator(`#genPoolListe input[data-pool-id="${poolId}"]`).check();
        await page.locator('#btnGenerieren').click();
        await expect(page.locator('#urkundenVorschauFrame')).toHaveAttribute('src', /^blob:/);
    });
});
