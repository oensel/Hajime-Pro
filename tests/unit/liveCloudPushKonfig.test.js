import test from 'node:test';
import assert from 'node:assert/strict';
import { liesPushKonfig, istErlaubterEndpunkt, PUSH_SCHWELLE } from '../../src/liveCloud/pushKonfig.js';

test('Push-Konfiguration: aktiv nur mit Schlüsselpaar und Betreff, Standard 3 Tage', () => {
    assert.equal(liesPushKonfig({}).aktiv, false);
    const k = liesPushKonfig({ LIVE_PUSH_VAPID_PUBLIC: 'pub', LIVE_PUSH_VAPID_PRIVATE: 'priv', LIVE_PUSH_BETREFF: 'mailto:a@b.de' });
    assert.equal(k.aktiv, true);
    assert.equal(k.tage, 3);
    assert.equal(k.maxAbos, 5000);
    assert.equal(liesPushKonfig({ LIVE_PUSH_VAPID_PUBLIC: 'pub', LIVE_PUSH_VAPID_PRIVATE: 'priv', LIVE_PUSH_BETREFF: 'mailto:a@b.de', LIVE_PUSH_AUFBEWAHRUNG_TAGE: '5' }).tage, 5);
    assert.equal(PUSH_SCHWELLE, 3);
});

test('Endpunkt-Prüfung: nur https und bekannte Push-Dienste', () => {
    for (const ok of [
        'https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc',
        'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://web.push.apple.com/QGx', 'https://api.push.apple.com/3/device/x'
    ]) assert.equal(istErlaubterEndpunkt(ok), true, ok);
    for (const nein of [
        'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evil.com/fcm.googleapis.com',
        'https://localhost/x', 'https://127.0.0.1/x', 'ftp://web.push.apple.com/x', '', null, 42, `https://fcm.googleapis.com/${'a'.repeat(500)}`
    ]) assert.equal(istErlaubterEndpunkt(nein), false, String(nein));
});
