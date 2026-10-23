import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.RECHTLICHES_DATEI;

const { ladeRechtliches, pruefeRechtliches, rechtlichesDatei } = await import('../../src/services/rechtliches.js');
const { rendereImpressum, rendereDatenschutz, e } = await import('../../src/services/rechtstexte.js');
const { getRechtlichesSeiten, getRechtlichesApi } = await import('../../src/routes/rechtlichesRoutes.js');
const express = (await import('express')).default;

const BEISPIEL = path.resolve('docs/datenschutz/rechtliches.example.json');
const lade = (daten) => {
    const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-recht-')), 'rechtliches.json');
    fs.writeFileSync(datei, JSON.stringify(daten));
    return ladeRechtliches({ RECHTLICHES_DATEI: datei });
};
const beispiel = () => JSON.parse(fs.readFileSync(BEISPIEL, 'utf8'));

test('Rechtliches: Standardpfad, fehlende Datei und leere Angaben', () => {
    assert.equal(rechtlichesDatei({}), path.resolve('./data/rechtliches.json'));
    const r = ladeRechtliches({ RECHTLICHES_DATEI: path.join(os.tmpdir(), 'gibt-es-bestimmt-nicht.json') });
    assert.equal(r.vollstaendig, false);
    assert.equal(r.fehlend[0].pfad, 'datei');
    assert.match(r.fehlend[0].beschreibung, /fehlt/);
    for (const pfad of ['betreiber.name', 'betreiber.strasse', 'betreiber.plz', 'betreiber.ort', 'betreiber.email', 'betreiber.telefon', 'datenschutz.email', 'hosting.anbieter', 'mail.anbieter', 'datenbank.anbieter']) {
        assert.ok(r.fehlend.some((f) => f.pfad === pfad), pfad);
    }
    const kaputt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-recht-')), 'x.json');
    fs.writeFileSync(kaputt, '{kaputt');
    assert.match(ladeRechtliches({ RECHTLICHES_DATEI: kaputt }).fehlend[0].beschreibung, /nicht lesbar/);
});

test('Rechtliches: die Beispieldatei ist vollständig und stimmig', () => {
    const r = ladeRechtliches({ RECHTLICHES_DATEI: BEISPIEL });
    assert.deepEqual(r.fehlend, []);
    assert.equal(r.vollstaendig, true);
    assert.equal(r.daten.betreiber.art, 'privatperson');
    assert.equal(r.daten.datenschutz.aufsichtsbehoerde.name.includes('Nordrhein-Westfalen'), true);
});

test('Rechtliches: Pflichtangaben je Rechtsform', () => {
    // Verein: Vertretung und Register; ohneRegister befreit vom Register
    let b = beispiel();
    b.betreiber.art = 'verein';
    let r = lade(b);
    assert.deepEqual(r.fehlend.map((f) => f.pfad).sort(), ['betreiber.registergericht', 'betreiber.registernummer', 'betreiber.vertretung']);
    b.betreiber.vertretung = 'Vorstand: A. B.';
    b.betreiber.ohneRegister = true;
    assert.equal(lade(b).vollstaendig, true);
    // GmbH: ohne Register nicht befreit durch Vertretung
    b = beispiel();
    b.betreiber.art = 'gmbh';
    b.betreiber.vertretung = 'Geschäftsführer: A. B.';
    assert.deepEqual(lade(b).fehlend.map((f) => f.pfad).sort(), ['betreiber.registergericht', 'betreiber.registernummer']);
    // zweiter Kontaktweg: Telefon oder Formular
    b = beispiel();
    b.betreiber.telefon = '';
    assert.equal(lade(b).fehlend[0].pfad, 'betreiber.telefon');
    b.betreiber.kontaktformularUrl = 'https://beispiel.de/kontakt';
    assert.equal(lade(b).vollstaendig, true);
    // Backup nur verlangt, wenn aktiv
    b = beispiel();
    b.backup = { aktiv: true };
    assert.deepEqual(lade(b).fehlend.map((f) => f.pfad), ['backup.anbieter']);
    b.backup = { aktiv: false };
    assert.equal(lade(b).vollstaendig, true);
    // unbekannte Rechtsform fällt auf privatperson zurück
    b = beispiel();
    b.betreiber.art = 'unfug';
    assert.equal(lade(b).daten.betreiber.art, 'privatperson');
    assert.ok(pruefeRechtliches(lade(beispiel()).daten).hinweise.some((h) => /Umsatzsteuer/.test(h)));
});

test('Impressum: Pflichtangaben, Maskierung, bedingte Abschnitte', () => {
    let html = rendereImpressum(ladeRechtliches({ RECHTLICHES_DATEI: BEISPIEL }));
    assert.match(html, /<h1>Impressum<\/h1>/);
    assert.match(html, /§ 5 Digitale-Dienste-Gesetz/);
    assert.match(html, /Vorname Nachname/);
    assert.match(html, /Musterstraße 1/);
    assert.match(html, /mailto:kontakt@beispiel\.de/);
    assert.match(html, /Telefon: \+49 123 456789/);
    assert.equal(html.includes('ANGABE FEHLT'), false, 'vollständig: keine Platzhalter');
    assert.equal(html.includes('Achtung, unvollständige Angaben'), false);
    assert.equal(html.includes('Registereintrag'), false, 'Privatperson hat keinen Registereintrag');

    // Maskierung gegen eingeschleustes HTML
    const b = beispiel();
    b.betreiber.name = '<script>alert(1)</script>';
    b.betreiber.zusatz = '"><img src=x onerror=alert(2)>';
    html = rendereImpressum(lade(b));
    assert.equal(html.includes('<script>alert'), false);
    assert.equal(html.includes('<img src=x'), false);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(e(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');

    // Verein mit Register, USt-ID, Verbraucherstreit und redaktionell Verantwortlichem
    const v = beispiel();
    Object.assign(v.betreiber, { art: 'verein', name: 'JC Beispiel e. V.', vertretung: 'Vorstand: A. B.', registergericht: 'Amtsgericht Musterstadt', registernummer: 'VR 123', umsatzsteuerId: 'DE123456789' });
    v.redaktionell = { name: 'A. B.', anschrift: 'Musterstraße 1, 12345 Musterstadt' };
    v.verbraucherstreit = 'nicht-bereit';
    html = rendereImpressum(lade(v));
    for (const teil of ['Vertreten durch', 'Vereinsregister', 'Amtsgericht Musterstadt', 'VR 123', 'DE123456789', '§ 27a Umsatzsteuergesetz', '§ 18 Abs. 2 MStV', 'nicht bereit und nicht verpflichtet']) {
        assert.ok(html.includes(teil), teil);
    }

    // unvollständig: sichtbare Warnung und rote Markierungen
    html = rendereImpressum(ladeRechtliches({ RECHTLICHES_DATEI: path.join(os.tmpdir(), 'gibt-es-nicht-2.json') }));
    assert.match(html, /Achtung, unvollständige Angaben/);
    assert.ok((html.match(/ANGABE FEHLT/g) || []).length >= 5);
});

test('Datenschutzerklärung: Inhalt, Fristen aus der Konfiguration, bedingte Abschnitte', () => {
    let html = rendereDatenschutz(ladeRechtliches({ RECHTLICHES_DATEI: BEISPIEL }), {});
    for (const abschnitt of ['Verantwortlicher und Rollen', 'Registrierung und Benutzerkonto', 'Aktionsprotokoll', 'Teilnehmer-App', 'Datensicherung', 'Empfänger und Auftragsverarbeiter',
        'Lokaler Speicher im Browser', 'Speicherdauer im Überblick', 'Ihre Rechte', 'Beschwerde'.replace('Beschwerde', 'Datenschutz-Aufsichtsbehörde')]) {
        assert.ok(html.includes(abschnitt), abschnitt);
    }
    assert.match(html, /<strong>keine Cookies<\/strong>/);
    assert.match(html, /Auftragsverarbeiter<\/strong> nach Art\. 28 DSGVO/);
    assert.match(html, /STRATO AG/);
    assert.match(html, /Supabase/);
    assert.match(html, /Übermittlung in Drittländer/);
    assert.match(html, /nach 7 Tagen gelöscht/);
    assert.match(html, /Konten, deren E-Mail-Adresse nicht bestätigt wird, werden nach 30 Tagen automatisch gelöscht/);
    assert.match(html, /Landesbeauftragte für Datenschutz/);
    assert.equal(html.includes('ANGABE FEHLT'), false);
    // die Judopass-Nummer wird nicht veröffentlicht: genau das steht im Text
    assert.match(html, /Judopass-Nummer und das genaue Gewicht werden <strong>nicht<\/strong> veröffentlicht/);

    // Fristen kommen aus der Umgebung
    html = rendereDatenschutz(ladeRechtliches({ RECHTLICHES_DATEI: BEISPIEL }), { PROTOKOLL_AUFBEWAHRUNG_TAGE: '180', FEHLER_AUFBEWAHRUNG_TAGE: '14', LIVE_AUFBEWAHRUNG_TAGE: '3' });
    assert.match(html, /Speicherdauer: 180 Tage/);
    assert.match(html, /Speicherdauer: 14 Tage/);
    assert.match(html, /3 Tage nach dem Turnier/);

    // ohne Teilnehmer-App, ohne Backup-Kopie, ohne Drittland
    const b = beispiel();
    b.teilnehmerApp = { aktiv: false };
    b.backup = { aktiv: false };
    b.datenbank.drittland = false;
    html = rendereDatenschutz(lade(b), {});
    assert.equal(html.includes('Teilnehmer-App und öffentliche Anzeige'), false);
    assert.equal(html.includes('Übermittlung in Drittländer'), false);
    assert.match(html, /ohne zusätzliche Kopie bei einem Dritten/);

    // Datenschutzbeauftragter erscheint, wenn eingetragen; HTML wird maskiert
    const d = beispiel();
    d.datenschutz.beauftragter = { name: 'Dr. <b>Schutz</b>', email: 'dsb@beispiel.de' };
    html = rendereDatenschutz(lade(d), {});
    assert.match(html, /Datenschutzbeauftragter ist Dr\. &lt;b&gt;Schutz&lt;\/b&gt;/);
    assert.match(html, /mailto:dsb@beispiel\.de/);

    // unvollständig: Warnung und rote Stellen, nie stille Lücken
    html = rendereDatenschutz(ladeRechtliches({ RECHTLICHES_DATEI: path.join(os.tmpdir(), 'gibt-es-nicht-3.json') }), {});
    assert.match(html, /unvollständige Angaben/);
    assert.ok(html.includes('[ANGABE FEHLT: Hosting-Anbieter]'));
});

test('Rechtliches: Routen liefern die Seiten ohne Anmeldung, Status nur für Super-Admins', async () => {
    process.env.RECHTLICHES_DATEI = BEISPIEL;
    const app = express();
    app.use(getRechtlichesSeiten());
    app.use('/api/rechtliches', getRechtlichesApi({}));
    const server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const basis = `http://127.0.0.1:${server.address().port}`;
    try {
        for (const pfad of ['/impressum.html', '/impressum', '/datenschutz.html', '/datenschutz']) {
            const r = await fetch(basis + pfad);
            assert.equal(r.status, 200, pfad);
            assert.match(r.headers.get('content-type'), /text\/html; charset=utf-8/);
            assert.equal(r.headers.get('cache-control'), 'no-cache');
            const text = await r.text();
            assert.match(text, /<nav aria-label="Rechtliches">/);
            assert.match(text, /<meta name="robots" content="index,follow">/);
        }
        assert.deepEqual(await (await fetch(`${basis}/api/rechtliches/aktiv`)).json(), { aktiv: true });
        assert.equal((await fetch(`${basis}/api/rechtliches/status`)).status, 401);

        // Änderungen an der Datei gelten sofort, ohne Neustart
        const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-recht-')), 'r.json');
        const b = beispiel();
        b.betreiber.name = 'Erster Name';
        fs.writeFileSync(datei, JSON.stringify(b));
        process.env.RECHTLICHES_DATEI = datei;
        assert.match(await (await fetch(`${basis}/impressum.html`)).text(), /Erster Name/);
        b.betreiber.name = 'Zweiter Name';
        fs.writeFileSync(datei, JSON.stringify(b));
        assert.match(await (await fetch(`${basis}/impressum.html`)).text(), /Zweiter Name/);
    } finally {
        delete process.env.RECHTLICHES_DATEI;
        await new Promise((r) => server.close(r));
    }
});
