import test from 'node:test';
import assert from 'node:assert/strict';
import { pushStatus, pushHinweis } from '../../teilnehmer-app/js/push.js';

const umgebung = (extra = {}) => ({ hatServiceWorker: true, hatPushManager: true, hatNotification: true, berechtigung: 'default', istIos: false, istInstalliert: false, ...extra });

test('Push-Status: unterstützt, blockiert, aktiv, iPhone ohne Installation, nicht unterstützt', () => {
    assert.equal(pushStatus(umgebung()), 'bereit');
    assert.equal(pushStatus(umgebung({ berechtigung: 'granted' })), 'aktiv');
    assert.equal(pushStatus(umgebung({ berechtigung: 'denied' })), 'blockiert');
    assert.equal(pushStatus(umgebung({ hatPushManager: false, istIos: true })), 'ios_installieren');
    assert.equal(pushStatus(umgebung({ hatPushManager: false })), 'nicht_unterstuetzt');
    assert.equal(pushStatus(umgebung({ hatServiceWorker: false })), 'nicht_unterstuetzt');
});

test('Push-Hinweis: Text nur, wenn etwas zu tun oder zu wissen ist', () => {
    assert.equal(pushHinweis('aktiv'), null);
    assert.equal(pushHinweis('bereit'), null);
    assert.match(pushHinweis('blockiert'), /blockiert/);
    assert.match(pushHinweis('ios_installieren'), /Home-Bildschirm/);
    assert.match(pushHinweis('nicht_unterstuetzt'), /keine Benachrichtigungen/);
});
