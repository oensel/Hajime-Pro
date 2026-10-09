import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { erzeugeVideoSpeicher } from '../../src/video/videoSpeicher.js';

const META = { turnierId: 7, matteId: 2, matteName: 'Matte 2', kampfId: 41, pool: 'U15 männlich -50kg', kaempfer1: 'Adler, Anna', kaempfer2: 'Busch, Berta', farbe2: 'rot', mime: 'video/webm;codecs=vp8' };

test('Speicher: Clip anlegen, schreiben, Marken, schließen, listen, löschen', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'video-'));
    try {
        const speicher = erzeugeVideoSpeicher({ wurzel: dir });
        const clip = speicher.oeffneClip(META);
        clip.schreibe(Buffer.from([1, 2, 3]));
        clip.schreibe(Buffer.from([4, 5]));
        clip.marke('geladen', 0);
        clip.marke('start', 12345.6);
        clip.marke('ungueltig', 5); // unbekannter Typ wird ignoriert
        clip.marke('ergebnis', 99000, 'Sieger Weiß');
        clip.schliesse({ ergebnis: 'Sieger Weiß' });

        assert.deepEqual([...readFileSync(clip.videoPfad)], [1, 2, 3, 4, 5]);
        const liste = speicher.liste();
        assert.equal(liste.length, 1);
        assert.equal(liste[0].kampfId, 41);
        assert.equal(liste[0].groesse, 5);
        assert.equal(liste[0].abgebrochen, false);
        assert.equal(liste[0].ergebnis, 'Sieger Weiß');
        assert.equal(liste[0].farbe2, 'rot');
        assert.deepEqual(liste[0].marken.map(m => [m.typ, m.ms]), [['geladen', 0], ['start', 12346], ['ergebnis', 99000]]);
        assert.equal(speicher.liste({ matteId: 3 }).length, 0);
        assert.equal(speicher.speicher().clips, 1);
        assert.equal(speicher.speicher().belegt, 5);

        assert.equal(speicher.hole('../../etc/passwd'), null); // Pfadtricks werden abgewiesen
        assert.ok(speicher.hole(liste[0].id));
        assert.equal(speicher.loesche(liste[0].id), true);
        assert.equal(existsSync(clip.videoPfad), false);
        assert.equal(speicher.liste().length, 0);
        assert.equal(speicher.loesche('gibts-nicht'), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Speicher: mp4 bekommt die Endung .mp4, loescheAlle räumt auf', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'video-'));
    try {
        const speicher = erzeugeVideoSpeicher({ wurzel: dir });
        const a = speicher.oeffneClip({ ...META, mime: 'video/mp4;codecs=avc1' });
        a.schliesse();
        speicher.oeffneClip({ ...META, kampfId: 42 }).schliesse();
        assert.match(a.videoPfad, /\.mp4$/);
        assert.equal(speicher.loescheAlle(), 2);
        assert.equal(speicher.liste().length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
