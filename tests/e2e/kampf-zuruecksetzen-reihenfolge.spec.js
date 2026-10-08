// End-to-End (API): Kampf zurücksetzen (inkl. Sperrregeln je Turniersystem) und Drag&Drop-Reihenfolge.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ladeUndErstelleTurnier } from './helpers/pool-fixture-turnier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtur = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8'));

async function aufMatteLegen(request, f) {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, f);
    const matten = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const mattenId = matten[0].id;
    const r = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: mattenId, position: 1 } });
    expect(r.ok(), await r.text()).toBeTruthy();
    return { turnierId, poolId, mattenId };
}

const kaempfeDerMatte = async (request, mattenId) => (await request.get(`/api/kaempfe?kampfflaecheId=${mattenId}`)).json();
const kaempfeDesPools = async (request, poolId) => (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
const beende = (request, k) => request.put(`/api/kaempfe/${k.id}`, {
    data: { status: 'beendet', sieger_id: k.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 90 }
});
const setzeZurueck = (request, turnierId, k) => request.post(`/api/kaempfe/${k.id}/zuruecksetzen`, { data: { turnierId } });

test.describe.configure({ mode: 'serial' });

test('Jeder gegen Jeden: Zurücksetzen landet an zweiter Stelle und ist auch nach Abschluss möglich', async ({ request }) => {
    const { turnierId, poolId, mattenId } = await aufMatteLegen(request, fixtur('pool-ko-jeder-gegen-jeden.json'));

    let kaempfe = await kaempfeDerMatte(request, mattenId);
    expect(kaempfe).toHaveLength(6);
    const [erster, zweiter] = kaempfe;
    expect((await beende(request, erster)).ok()).toBeTruthy();
    expect((await beende(request, zweiter)).ok()).toBeTruthy();

    const r = await setzeZurueck(request, turnierId, erster);
    expect(r.ok(), await r.text()).toBeTruthy();

    kaempfe = await kaempfeDerMatte(request, mattenId);
    const bereit = kaempfe.filter(k => k.status === 'bereit');
    expect(bereit).toHaveLength(5);
    expect(bereit[1].id).toBe(erster.id);
    expect(bereit[0].id).not.toBe(erster.id);
    const zurueck = kaempfe.find(k => k.id === erster.id);
    expect(zurueck.sieger_id).toBeNull();
    expect(zurueck.unterbewertung_kaempfer1).toBe(0);

    // Alles austragen -> Pool beendet; Zurücksetzen bleibt trotzdem erlaubt und öffnet den Pool wieder.
    for (const k of (await kaempfeDesPools(request, poolId)).filter(k => k.status === 'bereit')) {
        expect((await beende(request, k)).ok()).toBeTruthy();
    }
    expect((await (await request.get(`/api/pools/${poolId}`)).json()).status).toBe('kaempfe_beendet');
    const nochmal = await setzeZurueck(request, turnierId, zweiter);
    expect(nochmal.ok(), await nochmal.text()).toBeTruthy();
    expect((await (await request.get(`/api/pools/${poolId}`)).json()).status).toBe('gestartet');
});

test('Drag&Drop-Reihenfolge: neue Reihenfolge wird gespeichert und bleibt nach dem nächsten Ergebnis erhalten', async ({ request }) => {
    const { turnierId, mattenId } = await aufMatteLegen(request, fixtur('pool-ko-jeder-gegen-jeden.json'));
    const bereit = (await kaempfeDerMatte(request, mattenId)).filter(k => k.status === 'bereit');
    const umgekehrt = [...bereit].reverse().map(k => k.id);

    const r = await request.put('/api/kaempfe/reihenfolge', { data: { turnierId, kampfflaecheId: mattenId, kampfIds: umgekehrt } });
    expect(r.ok(), await r.text()).toBeTruthy();
    let reihenfolge = (await kaempfeDerMatte(request, mattenId)).filter(k => k.status === 'bereit').map(k => k.id);
    expect(reihenfolge).toEqual(umgekehrt);

    // Der erste Kampf wird ausgetragen -> die Neuplanung darf die manuelle Reihenfolge nicht kippen.
    const ersterKampf = (await kaempfeDerMatte(request, mattenId)).find(k => k.id === umgekehrt[0]);
    expect((await beende(request, ersterKampf)).ok()).toBeTruthy();
    reihenfolge = (await kaempfeDerMatte(request, mattenId)).filter(k => k.status === 'bereit').map(k => k.id);
    expect(reihenfolge).toEqual(umgekehrt.slice(1));

    // Ein beendeter Kampf lässt sich nicht umsortieren.
    const abgelehnt = await request.put('/api/kaempfe/reihenfolge', { data: { turnierId, kampfflaecheId: mattenId, kampfIds: [umgekehrt[0], umgekehrt[1]] } });
    expect(abgelehnt.status()).toBe(409);
});

test('Doppel-KO: Zurücksetzen leert Folgekämpfe und ist gesperrt, sobald ein Folgekampf läuft', async ({ request }) => {
    const { turnierId, poolId } = await aufMatteLegen(request, fixtur('pool-ko-doppel-ko8.json'));

    let kaempfe = await kaempfeDesPools(request, poolId);
    const erstrunde = kaempfe.filter(k => k.status === 'bereit');
    expect(erstrunde.length).toBeGreaterThan(1);
    const [a, b] = erstrunde;
    expect((await beende(request, a)).ok()).toBeTruthy();

    // Folgekämpfe von a sind jetzt (teilweise) befüllt; Zurücksetzen leert den Slot wieder.
    kaempfe = await kaempfeDesPools(request, poolId);
    const abhaengig = kaempfe.filter(k => k.kaempfer1_quelle_kampf_id === a.id || k.kaempfer2_quelle_kampf_id === a.id);
    expect(abhaengig.length).toBeGreaterThan(0);
    const r = await setzeZurueck(request, turnierId, a);
    expect(r.ok(), await r.text()).toBeTruthy();
    kaempfe = await kaempfeDesPools(request, poolId);
    for (const dep of abhaengig) {
        const jetzt = kaempfe.find(k => k.id === dep.id);
        const slot = jetzt.kaempfer1_quelle_kampf_id === a.id ? jetzt.kaempfer1_id : jetzt.kaempfer2_id;
        expect(slot).toBeNull();
        expect(['angelegt', 'freilos']).toContain(jetzt.status);
    }
    expect(kaempfe.find(k => k.id === a.id).status).toBe('bereit');

    // Erstrunde komplett, einen Folgekampf starten -> Zurücksetzen der Quelle ist gesperrt.
    for (const k of (await kaempfeDesPools(request, poolId)).filter(k => k.status === 'bereit' && erstrunde.some(e => e.id === k.id))) {
        expect((await beende(request, k)).ok()).toBeTruthy();
    }
    kaempfe = await kaempfeDesPools(request, poolId);
    const folge = kaempfe.find(k => k.status === 'bereit' && (erstrunde.some(e => e.id === k.kaempfer1_quelle_kampf_id) || erstrunde.some(e => e.id === k.kaempfer2_quelle_kampf_id)));
    expect(folge, 'es gibt einen bereiten Folgekampf').toBeTruthy();
    const quelleId = erstrunde.map(e => e.id).find(id => id === folge.kaempfer1_quelle_kampf_id || id === folge.kaempfer2_quelle_kampf_id);
    const start = await request.put(`/api/kaempfe/${folge.id}`, { data: { status: 'gestartet' } });
    expect(start.ok(), await start.text()).toBeTruthy();
    const gesperrt = await setzeZurueck(request, turnierId, { id: quelleId });
    expect(gesperrt.status()).toBe(409);
    // b war ebenfalls Teil der Erstrunde; ohne laufenden Folgekampf wäre es erlaubt gewesen.
    expect(b.id).toBeTruthy();
});

test('Gruppen-Überkreuz: Vorrunde zurücksetzbar bis ein Halbfinale läuft, Halbfinale bis das Finale läuft', async ({ request }) => {
    const { turnierId, poolId } = await aufMatteLegen(request, fixtur('pool-ko-gruppen-ueberkreuz.json'));

    let kaempfe = await kaempfeDesPools(request, poolId);
    const vorrunde = kaempfe.filter(k => k.reihenfolge_nummer?.startsWith('V_'));
    expect(vorrunde).toHaveLength(6);
    for (const k of vorrunde) expect((await beende(request, k)).ok()).toBeTruthy();

    kaempfe = await kaempfeDesPools(request, poolId);
    expect(kaempfe.find(k => k.reihenfolge_nummer === 'HF1').status).toBe('bereit');

    // Vorrundenkampf zurücksetzen: Halbfinals werden wieder leer.
    const r = await setzeZurueck(request, turnierId, vorrunde[0]);
    expect(r.ok(), await r.text()).toBeTruthy();
    kaempfe = await kaempfeDesPools(request, poolId);
    for (const nr of ['HF1', 'HF2']) {
        const hf = kaempfe.find(k => k.reihenfolge_nummer === nr);
        expect(hf.status).toBe('angelegt');
        expect(hf.kaempfer1_id).toBeNull();
        expect(hf.kaempfer2_id).toBeNull();
    }

    // Wieder beenden -> Halbfinals füllen sich erneut.
    expect((await beende(request, kaempfe.find(k => k.id === vorrunde[0].id))).ok()).toBeTruthy();
    kaempfe = await kaempfeDesPools(request, poolId);
    const hf1 = kaempfe.find(k => k.reihenfolge_nummer === 'HF1');
    expect(hf1.status).toBe('bereit');

    // Halbfinale läuft -> Vorrunde gesperrt.
    expect((await request.put(`/api/kaempfe/${hf1.id}`, { data: { status: 'gestartet' } })).ok()).toBeTruthy();
    expect((await setzeZurueck(request, turnierId, vorrunde[1])).status()).toBe(409);

    // Halbfinale beenden, Finale starten -> Halbfinale gesperrt.
    expect((await beende(request, hf1)).ok()).toBeTruthy();
    const hf2 = (await kaempfeDesPools(request, poolId)).find(k => k.reihenfolge_nummer === 'HF2');
    expect((await beende(request, hf2)).ok()).toBeTruthy();
    const finale = (await kaempfeDesPools(request, poolId)).find(k => k.reihenfolge_nummer === 'F1');
    expect(finale.status).toBe('bereit');
    // Halbfinale lässt sich zurücksetzen, solange das Finale nicht läuft ...
    const hfZurueck = await setzeZurueck(request, turnierId, hf2);
    expect(hfZurueck.ok(), await hfZurueck.text()).toBeTruthy();
    expect((await beende(request, (await kaempfeDesPools(request, poolId)).find(k => k.id === hf2.id))).ok()).toBeTruthy();
    // ... danach nicht mehr.
    const f1 = (await kaempfeDesPools(request, poolId)).find(k => k.reihenfolge_nummer === 'F1');
    expect((await request.put(`/api/kaempfe/${f1.id}`, { data: { status: 'gestartet' } })).ok()).toBeTruthy();
    expect((await setzeZurueck(request, turnierId, hf2)).status()).toBe(409);
});

test('kampf.html: Kampf per Griff nach unten ziehen speichert die neue Reihenfolge; Zurücksetzen-Knopf bei beendeten Kämpfen', async ({ page, request }) => {
    const { turnierId, mattenId } = await aufMatteLegen(request, fixtur('pool-ko-jeder-gegen-jeden.json'));
    const vorher = (await kaempfeDerMatte(request, mattenId)).filter(k => k.status === 'bereit');
    expect((await beende(request, vorher[0])).ok()).toBeTruthy();

    await page.goto(`/kampf.html?turnierId=${turnierId}`);
    await page.locator('#mattenSelect').selectOption(String(mattenId));
    const zeilen = page.locator('#upcomingFightsList [data-sortierbar="1"]');
    await expect(zeilen).toHaveCount(4);

    // Der erste Warteschlangen-Kampf wandert per Maus hinter den dritten.
    const reihenfolgeVorher = await zeilen.evaluateAll(z => z.map(e => e.dataset.kampfId));
    const griff = zeilen.nth(0).locator('.sortier-griff');
    const start = await griff.boundingBox();
    const ziel = await zeilen.nth(2).boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2, ziel.y + ziel.height * 0.8, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await kaempfeDerMatte(request, mattenId)).filter(k => k.status === 'bereit').map(k => String(k.id)).slice(1))
        .toEqual([reihenfolgeVorher[1], reihenfolgeVorher[2], reihenfolgeVorher[0], reihenfolgeVorher[3]]);

    await expect(page.getByRole('button', { name: 'Zurücksetzen' })).toHaveCount(1);

    // Ergebnis und Knöpfe der beendeten Zeile überlagern sich nicht.
    const ergebnisBox = await page.locator('#finishedFightsList .fight-row-status').first().boundingBox();
    const knopfBox = await page.locator('#finishedFightsList .fight-row-actions').first().boundingBox();
    expect(ergebnisBox.x + ergebnisBox.width).toBeLessThanOrEqual(knopfBox.x + 1);
});

test('Reihenfolge: auch noch nicht eingeplante Kämpfe (ohne Position) lassen sich verschieben', async ({ request }) => {
    const { turnierId, mattenId } = await aufMatteLegen(request, fixtur('pool-ko-jeder-gegen-jeden.json'));
    const bereit = (await kaempfeDerMatte(request, mattenId)).filter(k => k.status === 'bereit');
    // Zwei Kämpfe verlieren ihre Position (wie nach einer Auslosung ohne Neuplanung).
    const { default: knexLib } = await import('knex');
    const { testDbVerbindung } = await import('./test-env.js');
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('kaempfe').whereIn('id', [bereit[4].id, bereit[5].id]).update({ matten_reihenfolge: null });
    } finally {
        await db.destroy();
    }
    const gewuenscht = [bereit[5].id, bereit[0].id, bereit[1].id, bereit[2].id, bereit[3].id, bereit[4].id];
    const r = await request.put('/api/kaempfe/reihenfolge', { data: { turnierId, kampfflaecheId: mattenId, kampfIds: gewuenscht } });
    expect(r.ok(), await r.text()).toBeTruthy();
    const reihenfolge = (await kaempfeDerMatte(request, mattenId)).filter(k => k.status === 'bereit').map(k => k.id);
    expect(reihenfolge).toEqual(gewuenscht);
});
