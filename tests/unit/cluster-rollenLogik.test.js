import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liesClusterKonfig } from '../../src/cluster/konfig.js';
import { entscheideStart, pruefePartner, entscheideBefoerderung, partnerGewinnt } from '../../src/cluster/rollenLogik.js';

const JETZT = '2026-09-26T10:00:00.000Z';

test('Cluster-Konfiguration: ohne CLUSTER_KNOTEN inaktiv, sonst Partner abgeleitet', () => {
    assert.equal(liesClusterKonfig({}).aktiv, false);
    assert.equal(liesClusterKonfig({ CLUSTER_KNOTEN: 'server3' }).aktiv, false);
    const k = liesClusterKonfig({
        CLUSTER_KNOTEN: 'server2', CLUSTER_PARTNER_URL: 'http://192.168.10.11:3000/', CLUSTER_ZEUGE: '192.168.10.1'
    });
    assert.equal(k.aktiv, true);
    assert.equal(k.knoten, 'server2');
    assert.equal(k.partnerKnoten, 'server1');
    assert.equal(k.partnerUrl, 'http://192.168.10.11:3000');
    assert.equal(k.zeuge, '192.168.10.1');
    assert.match(k.rueckstufenBefehl, /hajime-rueckstufen\.sh/);
});

test('Erststart server1 mit Primary: Master mit Epoche 1', () => {
    const { zustand, aktion } = entscheideStart({ knoten: 'server1', eigenerZustand: null, partner: null, pgRolle: 'primary', jetzt: JETZT });
    assert.equal(aktion, 'keine');
    assert.deepEqual(zustand, { epoche: 1, master: 'server1', geaendert_am: JETZT, grund: 'erststart', rueckstufung_erforderlich: false });
});

test('Erststart server2 mit Standby: übernimmt Epoche und Master des Partners', () => {
    const partner = { knoten: 'server1', epoche: 1, master: 'server1' };
    const { zustand, aktion } = entscheideStart({ knoten: 'server2', eigenerZustand: null, partner, pgRolle: 'standby', jetzt: JETZT });
    assert.equal(aktion, 'keine');
    assert.equal(zustand.epoche, 1);
    assert.equal(zustand.master, 'server1');
    assert.equal(zustand.rueckstufung_erforderlich, false);
});

test('Alter Master (Primary) trifft Partner mit höherer Epoche: Rückstufung', () => {
    const eigen = { epoche: 1, master: 'server1', rueckstufung_erforderlich: false };
    const partner = { knoten: 'server2', epoche: 2, master: 'server2' };
    const { zustand, aktion } = entscheideStart({ knoten: 'server1', eigenerZustand: eigen, partner, pgRolle: 'primary', jetzt: JETZT });
    assert.equal(aktion, 'rueckstufen');
    assert.equal(zustand.rueckstufung_erforderlich, true);
    assert.equal(pruefePartner({ knoten: 'server1', eigenerZustand: eigen, partner, pgRolle: 'primary' }), 'rueckstufen');
});

test('Standby sieht höhere Partner-Epoche: nur übernehmen, kein Umbau', () => {
    const eigen = { epoche: 1, master: 'server1', rueckstufung_erforderlich: false };
    const partner = { knoten: 'server1', epoche: 2, master: 'server1' };
    assert.equal(pruefePartner({ knoten: 'server2', eigenerZustand: eigen, partner, pgRolle: 'standby' }), 'uebernehmen');
    assert.equal(pruefePartner({ knoten: 'server2', eigenerZustand: eigen, partner: null, pgRolle: 'standby' }), 'ok');
    assert.equal(pruefePartner({ knoten: 'server2', eigenerZustand: { ...eigen, epoche: 2 }, partner, pgRolle: 'standby' }), 'ok');
});

test('Beförderung aus dem Standby: Epoche +1 über beide Seiten, pg_promote', () => {
    const eigen = { epoche: 3, master: 'server1', rueckstufung_erforderlich: false };
    const r = entscheideBefoerderung({ knoten: 'server2', eigenerZustand: eigen, partner: null, pgRolle: 'standby', grund: 'automatisch', jetzt: JETZT });
    assert.equal(r.pgPromote, true);
    assert.equal(r.epocheErhoeht, true);
    assert.deepEqual(r.zustand, { epoche: 4, master: 'server2', geaendert_am: JETZT, grund: 'automatisch', rueckstufung_erforderlich: false });
    const mitPartner = entscheideBefoerderung({ knoten: 'server2', eigenerZustand: eigen, partner: { knoten: 'server1', epoche: 5, master: 'server1' }, pgRolle: 'standby', grund: 'uebergabe', jetzt: JETZT });
    assert.equal(mitPartner.zustand.epoche, 6);
    assert.equal(mitPartner.zustand.grund, 'uebergabe');
});

test('Bisheriger Master bekommt die VIP zurück: keine neue Epoche, kein pg_promote', () => {
    const eigen = { epoche: 2, master: 'server1', geaendert_am: 'x', grund: 'automatisch', rueckstufung_erforderlich: false };
    const r = entscheideBefoerderung({ knoten: 'server1', eigenerZustand: eigen, partner: { knoten: 'server2', epoche: 2, master: 'server1' }, pgRolle: 'primary', grund: 'automatisch', jetzt: JETZT });
    assert.equal(r.pgPromote, false);
    assert.equal(r.epocheErhoeht, false);
    assert.deepEqual(r.zustand, eigen);
});

test('Beförderung verweigert bei ausstehender Rückstufung oder überholter Epoche', () => {
    assert.throws(() => entscheideBefoerderung({
        knoten: 'server1', eigenerZustand: { epoche: 1, master: 'server1', rueckstufung_erforderlich: true },
        partner: null, pgRolle: 'primary', grund: 'automatisch', jetzt: JETZT
    }), /Rückstufung/);
    assert.throws(() => entscheideBefoerderung({
        knoten: 'server1', eigenerZustand: { epoche: 1, master: 'server1', rueckstufung_erforderlich: false },
        partner: { knoten: 'server2', epoche: 2, master: 'server2' }, pgRolle: 'primary', grund: 'automatisch', jetzt: JETZT
    }), /Rückstufung/);
});

test('Gleichstand nach Netztrennung (beide Master, gleiche Epoche): server1 gewinnt', () => {
    const s1 = { epoche: 3, master: 'server1' };
    const s2 = { epoche: 3, master: 'server2' };
    assert.equal(partnerGewinnt('server2', s2, { knoten: 'server1', ...s1 }), true);
    assert.equal(partnerGewinnt('server1', s1, { knoten: 'server2', ...s2 }), false);
    assert.equal(pruefePartner({ knoten: 'server2', eigenerZustand: s2, partner: { knoten: 'server1', ...s1 }, pgRolle: 'primary' }), 'rueckstufen');
});
