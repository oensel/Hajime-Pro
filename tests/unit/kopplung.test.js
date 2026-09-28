import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { normalisiereCode, erzeugeCode, ladeKopplung, erneuereCode, erzeugeSperre } from '../../src/sync/kopplung.js';

const verzeichnis = () => mkdtempSync(path.join(tmpdir(), 'kopplung-'));

test('normalisiereCode akzeptiert Leerzeichen und Bindestrich', () => {
    assert.equal(normalisiereCode('482 913'), '482913');
    assert.equal(normalisiereCode(' 482-913 '), '482913');
    assert.equal(normalisiereCode(''), '');
});

test('erzeugeCode liefert genau 6 Ziffern', () => {
    for (let i = 0; i < 50; i++) assert.match(erzeugeCode(), /^\d{6}$/);
});

test('ohne envSecret wird ein Geheimnis erzeugt und beim zweiten Laden wiederverwendet', () => {
    const dir = verzeichnis();
    const erst = ladeKopplung({ datenverzeichnis: dir, envSecret: '' });
    assert.equal(erst.secretErzeugt, true);
    assert.match(erst.secret, /^[0-9a-f]{64}$/);
    const zweit = ladeKopplung({ datenverzeichnis: dir, envSecret: '' });
    assert.equal(zweit.secretErzeugt, false);
    assert.equal(zweit.secret, erst.secret);
    assert.equal(zweit.code, erst.code);
});

test('envSecret hat Vorrang und wird nicht in die Datei geschrieben', () => {
    const dir = verzeichnis();
    const k = ladeKopplung({ datenverzeichnis: dir, envSecret: 'aus-env' });
    assert.equal(k.secret, 'aus-env');
    assert.equal(k.secretErzeugt, false);
    const datei = JSON.parse(readFileSync(path.join(dir, 'kopplung.json'), 'utf8'));
    assert.equal(datei.secret, undefined);
    assert.match(datei.code, /^\d{6}$/);
});

test('erneuereCode ändert nur den Code, nicht das Geheimnis', () => {
    const dir = verzeichnis();
    const vorher = ladeKopplung({ datenverzeichnis: dir, envSecret: '' });
    let neu = erneuereCode({ datenverzeichnis: dir });
    while (neu === vorher.code) neu = erneuereCode({ datenverzeichnis: dir });
    const nachher = ladeKopplung({ datenverzeichnis: dir, envSecret: '' });
    assert.equal(nachher.code, neu);
    assert.equal(nachher.secret, vorher.secret);
});

test('Sperre nach 5 Fehlversuchen innerhalb 60 s, Ende nach 60 s', () => {
    let t = 0;
    const s = erzeugeSperre({ jetzt: () => t });
    for (let i = 0; i < 4; i++) s.fehlversuch('1.2.3.4');
    assert.equal(s.pruefe('1.2.3.4').gesperrt, false);
    s.fehlversuch('1.2.3.4');
    const p = s.pruefe('1.2.3.4');
    assert.equal(p.gesperrt, true);
    assert.equal(p.restMs, 60000);
    assert.equal(s.pruefe('5.6.7.8').gesperrt, false);
    t = 60001;
    assert.equal(s.pruefe('1.2.3.4').gesperrt, false);
});

test('Fehlversuche außerhalb des Fensters zählen nicht, erfolg setzt zurück', () => {
    let t = 0;
    const s = erzeugeSperre({ jetzt: () => t });
    for (let i = 0; i < 4; i++) s.fehlversuch('ip');
    t = 61000;
    s.fehlversuch('ip');
    assert.equal(s.pruefe('ip').gesperrt, false);
    for (let i = 0; i < 3; i++) s.fehlversuch('ip');
    s.erfolg('ip');
    s.fehlversuch('ip');
    assert.equal(s.pruefe('ip').gesperrt, false);
});
