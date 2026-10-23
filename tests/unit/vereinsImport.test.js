import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { parseVereinsListe, bewerteVereinsImport, importiereVereine, MAX_IMPORT_ZEILEN } from '../../src/services/vereinsImport.js';
import { findeBundesland } from '../../src/shared/bundeslaender.js';

test('findeBundesland: Name, Schreibweise und Kürzel', () => {
    assert.equal(findeBundesland('nordrhein-westfalen'), 'Nordrhein-Westfalen');
    assert.equal(findeBundesland(' NRW '), 'Nordrhein-Westfalen');
    assert.equal(findeBundesland('NW'), 'Nordrhein-Westfalen');
    assert.equal(findeBundesland('Thüringen'), 'Thüringen');
    assert.equal(findeBundesland('Atlantis'), null);
    assert.equal(findeBundesland(''), null);
});

test('parseVereinsListe: Trenner, Kopfzeile, Anführungszeichen, Pflichtfelder', () => {
    const zeilen = parseVereinsListe([
        '﻿Name;Bundesland',
        'JC Senden;Nordrhein-Westfalen',
        '"TSV Muster, Abt. Judo";NRW',
        'SV Tab\tHessen',
        'Komma-Verein,Bayern',
        'Ohne Land',
        'Falsches Land;Mordor',
        ';Hessen',
        '',
        '  JC   Leerzeichen  ;berlin'
    ].join('\r\n'));
    assert.deepEqual(zeilen.map((z) => [z.name, z.bundesland, z.fehler === null]), [
        ['JC Senden', 'Nordrhein-Westfalen', true],
        ['TSV Muster, Abt. Judo', 'Nordrhein-Westfalen', true],
        ['SV Tab', 'Hessen', true],
        ['Komma-Verein', 'Bayern', true],
        ['Ohne Land', null, false],
        ['Falsches Land', null, false],
        [null, 'Hessen', false],
        ['JC Leerzeichen', 'Berlin', true]
    ]);
    assert.match(zeilen[4].fehler, /Bundesland fehlt/);
    assert.match(zeilen[5].fehler, /Unbekanntes Bundesland/);
    assert.equal(zeilen[0].zeile, 2, 'Zeilennummer zählt die Kopfzeile mit');
});

test('Vereinsimport: Vorschau und Anlegen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        await knex('vereine').insert({ name: 'JC Vorhanden', bundesland: 'Hessen' });
        const text = [
            'JC Neu;NRW',
            'jc  vorhanden;Bayern',
            'JC Neu;Hessen',
            'JC Zwei;Niedersachsen',
            'JC Kaputt'
        ].join('\n');

        const vorschau = await bewerteVereinsImport(knex, text);
        assert.equal(vorschau.ok, true);
        assert.deepEqual(vorschau.zeilen.map((z) => z.status), ['neu', 'vorhanden', 'doppelt', 'neu', 'ungueltig']);
        assert.deepEqual(vorschau.anzahl, { neu: 2, vorhanden: 1, doppelt: 1, ungueltig: 1 });
        assert.equal((await knex('vereine').where({ name: 'JC Neu' })).length, 0, 'Vorschau schreibt nichts');

        const ergebnis = await importiereVereine(knex, text);
        assert.deepEqual(ergebnis, { ok: true, angelegt: 2, uebersprungen: 3 });
        const neu = await knex('vereine').where({ name: 'JC Neu' }).first();
        assert.equal(neu.bundesland, 'Nordrhein-Westfalen');
        assert.equal((await knex('vereine').where({ name: 'JC Zwei' }).first()).bundesland, 'Niedersachsen');
        assert.equal((await knex('vereine').where({ name: 'JC Vorhanden' }).first()).bundesland, 'Hessen', 'Bestand bleibt unverändert');

        // zweiter Lauf: alles vorhanden
        const nochmal = await importiereVereine(knex, text);
        assert.deepEqual(nochmal, { ok: true, angelegt: 0, uebersprungen: 5 });

        assert.equal((await bewerteVereinsImport(knex, '  ')).status, 400);
        assert.equal((await bewerteVereinsImport(knex, 'Name;Bundesland')).status, 400);
        const zuLang = Array.from({ length: MAX_IMPORT_ZEILEN + 1 }, (_, i) => `V${i};Hessen`).join('\n');
        assert.equal((await bewerteVereinsImport(knex, zuLang)).status, 400);
    } finally {
        await db.stoppe();
    }
});
