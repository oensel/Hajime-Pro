import test from 'node:test';
import assert from 'node:assert/strict';
import { istLiveApiAktiv } from '../../src/liveCloud/liveApiAktiv.js';

test('Die Cloud stellt Live-Tokens aus: im Modus cloud immer, sonst nur mit LIVE_API_AKTIV=true', () => {
    assert.equal(istLiveApiAktiv({ BETRIEBSMODUS: 'cloud' }), true);
    assert.equal(istLiveApiAktiv({ BETRIEBSMODUS: 'server', DB_HOST: '127.0.0.1' }), false);
    assert.equal(istLiveApiAktiv({ BETRIEBSMODUS: 'server', DB_HOST: '127.0.0.1', LIVE_API_AKTIV: 'true' }), true);
    assert.equal(istLiveApiAktiv({ IS_OFFLINE: 'true' }), false);
    assert.equal(istLiveApiAktiv({}), true); // ohne Angaben gilt das Altverhalten: Cloud
});
