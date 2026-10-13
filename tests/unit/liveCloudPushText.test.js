import test from 'node:test';
import assert from 'node:assert/strict';
import { baueNachricht } from '../../src/liveCloud/pushText.js';

const basis = { turnierKey: 'demo-2026', turnierName: 'Demo-Turnier', name: 'Mia Mustermann', poolBezeichnung: 'U15 w -44', matte: 'Matte 2' };

test('Nachricht: Pool-Start, Kampf und beides zusammen', () => {
    const pool = baueNachricht({ ...basis, pool: { abstand: 3 }, kampf: null });
    assert.equal(pool.titel, 'Hajime Live · Demo-Turnier');
    assert.equal(pool.text, 'Mia Mustermann: Pool U15 w -44 startet in 3 Kämpfen (Matte 2)');
    assert.equal(baueNachricht({ ...basis, pool: { abstand: 0 }, kampf: null }).text, 'Mia Mustermann: Pool U15 w -44 startet als Nächstes (Matte 2)');
    assert.equal(baueNachricht({ ...basis, pool: { abstand: 1 }, kampf: null }).text, 'Mia Mustermann: Pool U15 w -44 startet in 1 Kampf (Matte 2)');
    assert.equal(baueNachricht({ ...basis, pool: null, kampf: { abstand: 3 } }).text, 'Mia Mustermann: Kampf in 3 Kämpfen (Matte 2)');
    assert.equal(baueNachricht({ ...basis, pool: null, kampf: { abstand: 0 } }).text, 'Mia Mustermann: Kampf als Nächstes (Matte 2)');
    const beides = baueNachricht({ ...basis, pool: { abstand: 3 }, kampf: { abstand: 3 } });
    assert.equal(beides.text, 'Mia Mustermann: Pool U15 w -44 startet in 3 Kämpfen, Kampf in 3 Kämpfen (Matte 2)');
});

test('Nachricht: Ziel-URL, Tag und fehlende Matte', () => {
    const n = baueNachricht({ ...basis, matte: '', pool: null, kampf: { abstand: 2 } });
    assert.equal(n.url, '/live/#/t/demo-2026/uebersicht');
    assert.equal(n.tag, 'hajime-demo-2026');
    assert.equal(n.text, 'Mia Mustermann: Kampf in 2 Kämpfen');
});
