// Teilnehmer in einen Pool anderer Altersklasse/anderen Geschlechts verschieben: erst nach Rückfrage (bestaetigt=true).
import { test, expect } from '@playwright/test';

test.describe.serial('Verschieben in andere Klasse', () => {
    let turnierId;
    let teilnehmerId;
    const pools = {};

    const legePoolAn = async (request, bezeichnung, altersklasse, geschlecht) => {
        const r = await request.post('/api/pools', {
            data: { turnier_id: turnierId, bezeichnung, altersklasse, geschlecht, gewichtsklasse: '-30' }
        });
        expect(r.ok(), await r.text()).toBeTruthy();
        return (await r.json()).poolId;
    };
    const verschiebe = (request, zielPoolId, extra = {}) =>
        request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId, turnierId, ...extra } });

    test('Aufbau: Teilnehmer U11 männlich, drei Pools', async ({ request }) => {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Klassenwechsel ${Date.now()}`, ort: 'Halle', datum: '2027-07-10', ausrichter: 'JC Klasse', anzahl_kampfflaechen: 1 }
        });
        turnierId = (await resp.json()).turnierId;
        const t = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: 'Wechsel', nachname: 'Test', verein: 'JC Klasse', geburtsjahr: 2016,
                geschlecht: 'männlich', gewicht: 29, altersklasse: 'U11', gewichtsklasse: '-30', lizenz_ablauf: '2099-12-31', gewogen: true
            }
        });
        teilnehmerId = (await t.json()).teilnehmerId;
        pools.gleich = await legePoolAn(request, 'U11 m -30kg', 'U11', 'männlich');
        pools.alter = await legePoolAn(request, 'U13 m -30kg', 'U13', 'männlich');
        pools.geschlecht = await legePoolAn(request, 'U11 w -30kg', 'U11', 'weiblich');
    });

    test('gleiche Klasse: ohne Rückfrage', async ({ request }) => {
        expect((await verschiebe(request, pools.gleich)).ok()).toBeTruthy();
    });

    test('andere Altersklasse: 409 mit Abweichung, Teilnehmer bleibt, mit bestaetigt wird verschoben', async ({ request }) => {
        const r = await verschiebe(request, pools.alter);
        expect(r.status()).toBe(409);
        const body = await r.json();
        expect(body.code).toBe('klasse_abweichung');
        expect(body.abweichungen).toEqual([{ art: 'altersklasse', von: 'U11', nach: 'U13' }]);
        const vorher = (await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json()).find(x => x.id === teilnehmerId);
        expect(vorher.pool_id).toBe(pools.gleich);

        expect((await verschiebe(request, pools.alter, { bestaetigt: true })).ok()).toBeTruthy();
        const nachher = (await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json()).find(x => x.id === teilnehmerId);
        expect(nachher.pool_id).toBe(pools.alter);
    });

    test('anderes Geschlecht: 409 mit Abweichung', async ({ request }) => {
        const r = await verschiebe(request, pools.geschlecht);
        expect(r.status()).toBe(409);
        expect((await r.json()).abweichungen).toEqual([{ art: 'geschlecht', von: 'männlich', nach: 'weiblich' }]);
    });
});
