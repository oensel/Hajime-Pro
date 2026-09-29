import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import knexLib from 'knex';
import { exportiereVorlagen, importiereVorlagen } from '../../src/services/urkundenVorlagenTransfer.js';

test('Vorlagen-Rundreise: Export → Import überschreibt gleichnamige, lässt andere stehen', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hajime-urk-'));
    const knex = knexLib({
        client: 'sqlite3',
        connection: { filename: path.join(dir, 't.sqlite') },
        useNullAsDefault: true,
        migrations: { directory: path.resolve('migrations') }
    });
    try {
        await knex.migrate.latest();
        const [a] = await knex('vereine').insert({ name: 'JC Quelle' }).returning('id');
        const [b] = await knex('vereine').insert({ name: 'JC Ziel' }).returning('id');
        const quelle = typeof a === 'object' ? a.id : a;
        const ziel = typeof b === 'object' ? b.id : b;
        const felder = [{ id: 'f1', text: '{Name}', x: 1, y: 2, breite: 3, schrift: 'noto-sans', groesse: 20, farbe: '#000000', ausrichtung: 'links' }];
        await knex('urkunden_vorlagen').insert({ verein_id: quelle, name: 'Standard', pdf: Buffer.from('%PDF-quelle'), pdf_dateiname: 'q.pdf',
            seiten_breite_pt: 595, seiten_hoehe_pt: 842, felder: JSON.stringify(felder), platzbereich: '5', reihenfolge: 'aufsteigend', bei_abschluss_anbieten: true });
        await knex('urkunden_vorlagen').insert({ verein_id: ziel, name: 'Standard', pdf: Buffer.from('%PDF-alt'), seiten_breite_pt: 1, seiten_hoehe_pt: 1 });
        await knex('urkunden_vorlagen').insert({ verein_id: ziel, name: 'Andere', pdf: Buffer.from('%PDF-andere'), seiten_breite_pt: 1, seiten_hoehe_pt: 1, bei_abschluss_anbieten: true });

        const exportiert = JSON.parse(JSON.stringify(await exportiereVorlagen(knex, quelle)));
        assert.equal(exportiert.length, 1);
        assert.deepEqual(exportiert[0].felder, felder);

        await importiereVorlagen(knex, ziel, exportiert);
        const zeilen = await knex('urkunden_vorlagen').where({ verein_id: ziel }).orderBy('name');
        assert.deepEqual(zeilen.map(z => z.name), ['Andere', 'Standard']);
        const standard = zeilen[1];
        assert.equal(Buffer.from(standard.pdf).toString(), '%PDF-quelle');
        assert.deepEqual(JSON.parse(standard.felder), felder);
        assert.deepEqual([standard.platzbereich, standard.reihenfolge, !!standard.bei_abschluss_anbieten], ['5', 'aufsteigend', true]);
        assert.equal(!!zeilen[0].bei_abschluss_anbieten, false);

        await importiereVorlagen(knex, ziel, undefined);
        assert.equal((await knex('urkunden_vorlagen').where({ verein_id: ziel })).length, 2);

        // Ungültige Einträge (z. B. handbearbeitete Exportdatei): Felder kaputt → Vorlage übersprungen,
        // unbekannter Platzbereich/Reihenfolge → Standardwerte.
        await importiereVorlagen(knex, ziel, [
            { ...exportiert[0], name: 'Kaputt', felder: [{ ...felder[0], text: 42 }] },
            { ...exportiert[0], name: 'Werte', platzbereich: '10', reihenfolge: 'zufall' },
            { ...exportiert[0], name: 'OhnePdf', pdf_base64: '' }
        ]);
        const namen = (await knex('urkunden_vorlagen').where({ verein_id: ziel })).map(z => z.name).sort();
        assert.deepEqual(namen, ['Andere', 'Standard', 'Werte']);
        const werte = await knex('urkunden_vorlagen').where({ verein_id: ziel, name: 'Werte' }).first();
        assert.deepEqual([werte.platzbereich, werte.reihenfolge], ['3', 'siegerehrung']);
    } finally {
        await knex.destroy();
        rmSync(dir, { recursive: true, force: true });
    }
});
