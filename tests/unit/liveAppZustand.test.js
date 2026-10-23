import test from 'node:test';
import assert from 'node:assert/strict';
import { entscheideSender, berechneAnzeige, ERFOLG_MAX_ALTER_MS } from '../../src/liveApp/zustand.js';

const partner = (rolle, erreichbar) => ({ rolle, cloud_erreichbar: erreichbar });

test('entscheideSender: ohne Cluster sendet der Server, wenn er die Cloud erreicht', () => {
    assert.equal(entscheideSender({ clusterAktiv: false, rolle: 'master', eigenErreichbar: true, partner: null }), 'eigener');
    assert.equal(entscheideSender({ clusterAktiv: false, rolle: 'master', eigenErreichbar: false, partner: null }), 'keiner');
});

test('entscheideSender: Secondary mit Internet sendet, auch wenn der Master ebenfalls Internet hat', () => {
    assert.equal(entscheideSender({ clusterAktiv: true, rolle: 'secondary', eigenErreichbar: true, partner: partner('master', true) }), 'eigener');
    assert.equal(entscheideSender({ clusterAktiv: true, rolle: 'secondary', eigenErreichbar: true, partner: null }), 'eigener');
});

test('entscheideSender: Secondary ohne Internet überlässt dem Master, sofern dieser die Cloud erreicht', () => {
    assert.equal(entscheideSender({ clusterAktiv: true, rolle: 'secondary', eigenErreichbar: false, partner: partner('master', true) }), 'partner');
    assert.equal(entscheideSender({ clusterAktiv: true, rolle: 'secondary', eigenErreichbar: false, partner: partner('master', false) }), 'keiner');
    assert.equal(entscheideSender({ clusterAktiv: true, rolle: 'secondary', eigenErreichbar: false, partner: null }), 'keiner');
});

test('entscheideSender: Master verzichtet, wenn der Secondary die Cloud erreicht, sonst sendet er selbst', () => {
    assert.equal(entscheideSender({ clusterAktiv: true, rolle: 'master', eigenErreichbar: true, partner: partner('secondary', true) }), 'partner');
    assert.equal(entscheideSender({ clusterAktiv: true, rolle: 'master', eigenErreichbar: true, partner: partner('secondary', false) }), 'eigener');
    assert.equal(entscheideSender({ clusterAktiv: true, rolle: 'master', eigenErreichbar: true, partner: null }), 'eigener');
    assert.equal(entscheideSender({ clusterAktiv: true, rolle: 'master', eigenErreichbar: false, partner: partner('secondary', false) }), 'keiner');
});

test('entscheideSender: bei zwei Mastern (Übergangszustand) sendet jeder, der die Cloud erreicht, nie keiner obwohl erreichbar', () => {
    assert.equal(entscheideSender({ clusterAktiv: true, rolle: 'master', eigenErreichbar: true, partner: partner('master', true) }), 'eigener');
});

const basis = { verfuegbar: true, aktiv: true, cloudErreichbar: true, letzterErfolgMs: 1_000_000, letzterFehler: null, jetztMs: 1_004_000 };

test('berechneAnzeige: ausgeschaltet oder nicht verfügbar ist grau', () => {
    const grau = berechneAnzeige({ ...basis, aktiv: false });
    assert.equal(grau.zustand, 'grau');
    assert.equal(grau.text, 'Teilnehmer-App ausgeschaltet');
    assert.equal(berechneAnzeige({ ...basis, verfuegbar: false }).zustand, 'grau');
});

test('berechneAnzeige: Cloud nicht erreichbar ist rot', () => {
    const rot = berechneAnzeige({ ...basis, cloudErreichbar: false });
    assert.equal(rot.zustand, 'rot');
    assert.equal(rot.text, 'Keine Verbindung zur Cloud – die Teilnehmer-App erhält keine Daten');
});

test('berechneAnzeige: erreichbar, aber Fehler, kein oder alter Erfolg ist gelb', () => {
    const text = 'Cloud erreichbar, aber es können keine Daten gesendet werden';
    assert.deepEqual(berechneAnzeige({ ...basis, letzterFehler: 'Cloud antwortete mit Status 500' }), { zustand: 'gelb', text });
    assert.equal(berechneAnzeige({ ...basis, letzterErfolgMs: null }).zustand, 'gelb');
    assert.equal(berechneAnzeige({ ...basis, jetztMs: basis.letzterErfolgMs + ERFOLG_MAX_ALTER_MS + 1000 }).zustand, 'gelb');
});

test('berechneAnzeige: frischer Erfolg ist grün und nennt das Alter', () => {
    assert.deepEqual(berechneAnzeige(basis), { zustand: 'gruen', text: 'Teilnehmer-App läuft – letzter Abgleich vor 4 s' });
    assert.equal(ERFOLG_MAX_ALTER_MS, 90000);
});
