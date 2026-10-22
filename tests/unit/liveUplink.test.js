import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { erzeugeUplink } from '../../src/live/uplink.js';

const snap = (key, extra = {}) => ({ version: 1, turnierKey: key, name: 'T', datum: '2026-10-12', vereine: [], matten: [], teilnehmer: [], warteschlangen: [], ...extra });
const still = { warn() {}, log() {} };

function werkzeug({ antworten = [] } = {}) {
    const aufrufe = [];
    let i = 0;
    const fetchFn = async (url, opts) => {
        const body = JSON.parse(zlib.gunzipSync(opts.body).toString('utf8'));
        aufrufe.push({ url, opts, body });
        const a = antworten[i++] ?? { status: 204 };
        if (a.fehler) throw new Error(a.fehler);
        return { ok: a.status >= 200 && a.status < 300, status: a.status, body: { cancel() {} } };
    };
    let t = 1_000_000;
    return { aufrufe, fetchFn, jetzt: () => t, vor: ms => { t += ms; } };
}

test('sendet neu, dann nicht erneut ohne Änderung', async () => {
    const w = werkzeug();
    const u = erzeugeUplink({ url: 'https://cloud/api/live/ingest', token: 'tok', fetchFn: w.fetchFn, jetzt: w.jetzt, log: still });
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 1, zurueckgezogen: 0, fehler: 0 });
    w.vor(5000);
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 0, zurueckgezogen: 0, fehler: 0 });
    assert.equal(w.aufrufe.length, 1);
    assert.equal(w.aufrufe[0].opts.headers.Authorization, 'Bearer tok');
    assert.equal(w.aufrufe[0].opts.headers['Content-Encoding'], 'gzip');
    assert.equal(w.aufrufe[0].body.turnierKey, '1');
    assert.ok(w.aufrufe[0].body.stand);
    assert.ok(w.aufrufe[0].body.sequenz);
});

test('sendet bei Änderung und als Lebenszeichen nach 60 s', async () => {
    const w = werkzeug();
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, log: still });
    await u.sende([snap('1')]);
    w.vor(5000);
    await u.sende([snap('1', { name: 'Neu' })]);
    assert.equal(w.aufrufe.length, 2);
    w.vor(30_000);
    await u.sende([snap('1', { name: 'Neu' })]);
    assert.equal(w.aufrufe.length, 2);
    w.vor(31_000);
    await u.sende([snap('1', { name: 'Neu' })]);
    assert.equal(w.aufrufe.length, 3);
});

test('Fehler: Backoff, Hash bleibt, nächster Versuch nach der Wartezeit sendet erneut', async () => {
    const w = werkzeug({ antworten: [{ status: 503 }, { status: 204 }] });
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, backoffStartMs: 2000, log: still });
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 0, zurueckgezogen: 0, fehler: 1 });
    w.vor(1000);
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 0, zurueckgezogen: 0, fehler: 0 }); // noch im Backoff
    assert.equal(w.aufrufe.length, 1);
    w.vor(1500);
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 1, zurueckgezogen: 0, fehler: 0 });
    assert.equal(w.aufrufe.length, 2);
});

test('Netzwerkfehler (Ausnahme) bricht nicht ab', async () => {
    const w = werkzeug({ antworten: [{ fehler: 'ECONNREFUSED' }] });
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, log: still });
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 0, zurueckgezogen: 0, fehler: 1 });
    assert.match(u.zustand().letzterFehler, /ECONNREFUSED/);
});

test('Rücknahme genau einmal, wenn ein Turnier aus der Auswahl verschwindet', async () => {
    const w = werkzeug();
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, log: still });
    await u.sende([snap('1'), snap('2')]);
    w.vor(5000);
    const r = await u.sende([snap('2')]);
    assert.equal(r.zurueckgezogen, 1);
    const letzte = w.aufrufe.at(-1).body;
    assert.deepEqual([letzte.turnierKey, letzte.zurueckgezogen], ['1', true]);
    w.vor(5000);
    assert.deepEqual(await u.sende([snap('2')]), { gesendet: 0, zurueckgezogen: 0, fehler: 0 });
});

test('Antwortinhalt wird nicht gelesen, nur der Statuscode zählt', async () => {
    let gelesen = false;
    const fetchFn = async () => ({ ok: true, status: 200, body: { cancel() {} }, json: async () => { gelesen = true; return {}; }, text: async () => { gelesen = true; return ''; } });
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn, log: still });
    await u.sende([snap('1')]);
    assert.equal(gelesen, false);
});

test('Rücknahme überlebt einen Neustart: zuletzt gesendete Turniere werden persistiert', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-live-'));
    const datei = path.join(dir, 'gesendet.json');
    try {
        const w1 = werkzeug();
        const u1 = erzeugeUplink({ url: 'u', token: 't', fetchFn: w1.fetchFn, jetzt: w1.jetzt, zustandDatei: datei, log: still });
        await u1.sende([snap('1')]);
        assert.deepEqual(JSON.parse(fs.readFileSync(datei, 'utf8')), ['1']);

        // Neustart: neue Instanz, Turnier ist inzwischen nicht mehr freigegeben
        const w2 = werkzeug();
        const u2 = erzeugeUplink({ url: 'u', token: 't', fetchFn: w2.fetchFn, jetzt: w2.jetzt, zustandDatei: datei, log: still });
        const r = await u2.sende([]);
        assert.equal(r.zurueckgezogen, 1);
        assert.deepEqual([w2.aufrufe[0].body.turnierKey, w2.aufrufe[0].body.zurueckgezogen], ['1', true]);
        assert.deepEqual(JSON.parse(fs.readFileSync(datei, 'utf8')), []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Zustandsdatei nicht beschreibbar: Uplink läuft weiter', async () => {
    const w = werkzeug();
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, zustandDatei: path.join(os.tmpdir(), 'gibt-es-nicht', 'x', 'y.json'), log: still });
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 1, zurueckgezogen: 0, fehler: 0 });
});

test('Sequenz ist streng monoton, auch wenn die Uhr stehen bleibt oder zurückspringt', async () => {
    const w = werkzeug();
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, log: still });
    await u.sende([snap('1'), snap('2')]);
    w.vor(-5000);
    await u.sende([snap('1', { name: 'neu' }), snap('2')]);
    const folge = w.aufrufe.map(a => a.body.sequenz);
    assert.equal(folge.length, 3);
    assert.ok(folge[1] > folge[0] && folge[2] > folge[1], `Sequenzen ${folge}`);
});

test('Rücknahme auf Zuruf: genau einmal je Prozess, danach wieder sendbar', async () => {
    const w = werkzeug();
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, log: still });
    assert.deepEqual(await u.sende([], { zurueckzunehmen: ['42'] }), { gesendet: 0, zurueckgezogen: 1, fehler: 0 });
    assert.equal(w.aufrufe[0].body.turnierKey, '42');
    assert.equal(w.aufrufe[0].body.zurueckgezogen, true);
    w.vor(5000);
    assert.deepEqual(await u.sende([], { zurueckzunehmen: ['42'] }), { gesendet: 0, zurueckgezogen: 0, fehler: 0 });
    assert.equal(w.aufrufe.length, 1);
    // Wird das Turnier wieder freigegeben, ist es kein Rücknahme-Kandidat mehr und lässt sich später erneut zurücknehmen.
    w.vor(5000);
    await u.sende([snap('42')], { zurueckzunehmen: ['42'] });
    assert.equal(w.aufrufe.at(-1).body.zurueckgezogen, undefined);
    w.vor(5000);
    assert.equal((await u.sende([], { zurueckzunehmen: ['42'] })).zurueckgezogen, 1);
});

test('Rücknahme auf Zuruf: bei Fehler wird nach dem Backoff erneut versucht', async () => {
    const w = werkzeug({ antworten: [{ status: 500 }, { status: 204 }] });
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, log: still });
    assert.equal((await u.sende([], { zurueckzunehmen: ['9'] })).fehler, 1);
    assert.equal((await u.sende([], { zurueckzunehmen: ['9'] })).fehler, 0);
    w.vor(3000);
    assert.equal((await u.sende([], { zurueckzunehmen: ['9'] })).zurueckgezogen, 1);
    assert.equal(w.aufrufe.length, 2);
});
