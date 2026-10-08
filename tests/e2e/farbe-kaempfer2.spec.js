// End-to-End: Farbe von Kämpfer 2 -- feinste Einstellung gewinnt (Kampf/Scoreboard > Pool > Turnier).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ladeUndErstelleTurnier } from './helpers/pool-fixture-turnier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTUR = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'pool-ko-jeder-gegen-jeden.json'), 'utf-8')
);

test('Kämpfer-2-Farbe: Turnier < Pool < Kampf', async ({ request }) => {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, FIXTUR);

    // Matte zuweisen, damit die Kampfliste der Matte abrufbar ist
    const matten = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const mattenId = matten[0].id;
    const planResp = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: mattenId, position: 1 } });
    expect(planResp.ok(), await planResp.text()).toBeTruthy();

    const farbeVon = async () => {
        const kaempfe = await (await request.get(`/api/kaempfe?kampfflaecheId=${mattenId}`)).json();
        return { kaempfe, farbe: kaempfe[0] && kaempfe[0].farbe_kaempfer2 };
    };

    // Standard: blau
    expect((await farbeVon()).farbe).toBe('blau');

    // Turnier auf rot
    const turnier = await (await request.get(`/api/turniere/${turnierId}`)).json();
    let r = await request.put(`/api/turniere/${turnierId}`, { data: { ...turnier, farbe_kaempfer2: 'rot' } });
    expect(r.ok(), await r.text()).toBeTruthy();
    expect((await farbeVon()).farbe).toBe('rot');

    // Pool überschreibt: blau
    r = await request.put(`/api/pools/${poolId}`, { data: { bezeichnung: 'Farbtest', kampfzeit_sekunden: 240, farbe_kaempfer2: 'blau' } });
    expect(r.ok(), await r.text()).toBeTruthy();
    const { kaempfe } = await farbeVon();
    expect(kaempfe[0].farbe_kaempfer2).toBe('blau');

    // Scoreboard überschreibt für einen einzelnen Kampf: rot
    r = await request.put(`/api/kaempfe/${kaempfe[0].id}/color`, { data: { color: 'rot' } });
    expect(r.ok()).toBeTruthy();
    const nachLive = (await farbeVon()).kaempfe;
    expect(nachLive.find(k => k.id === kaempfe[0].id).farbe_kaempfer2).toBe('rot');
    expect(nachLive.find(k => k.id !== kaempfe[0].id).farbe_kaempfer2).toBe('blau');
});
