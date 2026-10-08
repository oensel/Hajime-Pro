// End-to-End: Sperre der Mannschaften. Einzelkämpfe sperren sie nicht; sobald ein Mannschafts-Pool
// seinen ersten echten Kampf hatte, sind Teams, ihre Mitglieder und der Mannschafts-Import gesperrt,
// Einzelstarter anderer Altersklassen bleiben bearbeitbar (Waage in Runden).
import { test, expect } from '@playwright/test';

test.describe.serial('Mannschaften: Sperre ab dem ersten Mannschaftskampf', () => {
    let turnierId;
    let poolId;
    const mitglieder = [];
    let einzelStarterId;

    async function legeTeilnehmerAn(request, daten) {
        const resp = await request.post('/api/teilnehmer', {
            data: { turnier_id: turnierId, nachname: 'Judoka', geschlecht: 'männlich', ...daten }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        return (await resp.json()).teilnehmerId;
    }

    test('Turnier mit Mannschafts-Pool und zwei Teams aufbauen', async ({ request }) => {
        const turnierResp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Mannschaftssperre ${Date.now()}`, ort: 'Halle', datum: '2027-06-01', ausrichter: 'JC Sperre', anzahl_kampfflaechen: 1 }
        });
        turnierId = (await turnierResp.json()).turnierId;

        const poolResp = await request.post('/api/pools', {
            data: {
                turnier_id: turnierId, bezeichnung: 'Team-Pool', modus: 'Jeder-gegen-Jeden', altersklasse: 'U18',
                geschlecht: 'männlich', typ: 'mannschaft', mannschafts_gewichtsklassen: ['-73kg'], kampfzeit_sekunden: 180
            }
        });
        expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
        poolId = (await poolResp.json()).poolId;

        for (const buchstabe of ['A', 'B']) {
            const teamResp = await request.post('/api/mannschaften', {
                data: { turnier_id: turnierId, pool_id: poolId, verein: `JC ${buchstabe}`, bezeichnung: `Team ${buchstabe}` }
            });
            expect(teamResp.status()).toBe(201);
            const { mannschaftId } = await teamResp.json();
            const teilnehmerId = await legeTeilnehmerAn(request, {
                vorname: buchstabe, verein: `JC ${buchstabe}`, geburtsjahr: 2007, gewicht: 70, altersklasse: 'U18'
            });
            const mResp = await request.post(`/api/mannschaften/${mannschaftId}/mitglieder`, { data: { turnier_teilnehmer_id: teilnehmerId } });
            expect(mResp.ok(), await mResp.text()).toBeTruthy();
            mitglieder.push(teilnehmerId);
        }
        einzelStarterId = await legeTeilnehmerAn(request, {
            vorname: 'Einzel', verein: 'JC E', geburtsjahr: 2012, gewicht: 35, altersklasse: 'U13'
        });
    });

    test('Vor dem ersten Mannschaftskampf ist nichts gesperrt', async ({ request }) => {
        const vorhanden = await (await request.get(`/api/pools/vorhanden?turnierId=${turnierId}`)).json();
        expect(vorhanden.mannschaftenGesperrt).toBe(false);
        const resp = await request.post('/api/mannschaften', { data: { turnier_id: turnierId, verein: 'JC C', bezeichnung: 'Team C' } });
        expect(resp.status()).toBe(201);
    });

    test('Nach dem ersten Mannschaftskampf: Teams und Mitglieder sind gesperrt, Einzelstarter nicht', async ({ request }) => {
        const kaempfe = await (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
        const kampf = kaempfe.find(k => k.status === 'bereit');
        expect(kampf, 'kein spielbarer Mannschafts-Einzelkampf').toBeTruthy();
        const spiel = await request.put(`/api/kaempfe/${kampf.id}`, {
            data: { status: 'beendet', sieger_id: kampf.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 90 }
        });
        expect(spiel.ok(), await spiel.text()).toBeTruthy();

        const vorhanden = await (await request.get(`/api/pools/vorhanden?turnierId=${turnierId}`)).json();
        expect(vorhanden.mannschaftenGesperrt).toBe(true);

        const neuesTeam = await request.post('/api/mannschaften', { data: { turnier_id: turnierId, verein: 'JC D', bezeichnung: 'Team D' } });
        expect(neuesTeam.status()).toBe(409);
        expect((await neuesTeam.json()).error).toContain('Mannschaftskämpfe');

        const loeschen = await request.delete(`/api/teilnehmer/${mitglieder[0]}`);
        expect(loeschen.status()).toBe(409);
        expect((await loeschen.json()).error).toContain('Mannschaftskämpfe');

        // der Einzelstarter einer anderen Altersklasse bleibt bearbeitbar
        const einzel = await request.delete(`/api/teilnehmer/${einzelStarterId}`);
        expect(einzel.ok(), await einzel.text()).toBeTruthy();
    });
});
