import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEml, extrahiereKaempfer, kaempferZuZeilen, tabelleZuCsv, teileName, htmlZuText, MAIL_SPALTEN } from '../../src/shared/mailExtraktion.js';

const bytes = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));

test('teileName: Vorname Nachname, Nachname Komma Vorname, Namenszusätze', () => {
    assert.deepEqual(teileName('Max Mustermann'), { vorname: 'Max', nachname: 'Mustermann' });
    assert.deepEqual(teileName('Mustermann, Max'), { vorname: 'Max', nachname: 'Mustermann' });
    assert.deepEqual(teileName('Jan van der Berg'), { vorname: 'Jan', nachname: 'van der Berg' });
    assert.equal(teileName('Einzelwort'), null);
});

test('Freitext-Liste mit Jahrgang, Geschlecht, Gewicht, Kyu und Vereinskontext', () => {
    const text = [
        'Hallo zusammen,',
        'anbei unsere Meldung zum Turnier 2026.',
        'Verein: JC Senden',
        '',
        'Jungen:',
        '1. Max Mustermann, *2012, 34,5 kg, 5. Kyu',
        '2. Ben Schulz 03.07.2011 38 kg',
        'Mädchen',
        'Müller, Anna (JK Münster) Jg. 2013 -28 kg',
        '',
        'Viele Grüße',
        'Tel. 0251 123456'
    ].join('\n');
    const s = extrahiereKaempfer(text);
    assert.equal(s.length, 3);
    assert.deepEqual(
        { v: s[0].vorname, n: s[0].nachname, g: s[0].geburtsjahr, sex: s[0].geschlecht, kg: s[0].gewicht, grad: s[0].graduierung, verein: s[0].verein },
        { v: 'Max', n: 'Mustermann', g: '2012', sex: 'männlich', kg: '34,5', grad: '5. Kyu', verein: 'JC Senden' }
    );
    assert.equal(s[1].geburtsjahr, '03.07.2011');
    assert.equal(s[1].geschlecht, 'männlich');
    assert.equal(s[2].vorname, 'Anna');
    assert.equal(s[2].nachname, 'Müller');
    assert.equal(s[2].geschlecht, 'weiblich');
    assert.equal(s[2].verein, 'JK Münster');
});

test('Tabelle mit Kopfzeile (Tab-getrennt)', () => {
    const text = 'Vorname\tNachname\tGeburtsdatum\tGeschlecht\tVerein\tGewicht\nLena\tMusterfrau\t12.05.2010\tw\tJC Senden\t45 kg\nTom\tSchmidt\t2009\tm\tJC Senden\t52';
    const s = extrahiereKaempfer(text);
    assert.equal(s.length, 2);
    assert.equal(s[0].geburtsjahr, '12.05.2010');
    assert.equal(s[0].geschlecht, 'weiblich');
    assert.equal(s[0].gewicht, '45');
    assert.equal(s[1].geburtsjahr, '2009');
    assert.equal(s[1].verein, 'JC Senden');
});

test('Zeilen ohne Geburtsangabe oder mit unplausiblem Namen werden ignoriert', () => {
    const text = 'Rufen Sie uns an: 0251 123456\nTurnier am 14.11.2026 in Senden\nAnmeldeschluss 2026';
    assert.equal(extrahiereKaempfer(text).length, 0);
    assert.equal(extrahiereKaempfer('Anmeldeschluss 2026').length, 0);
});

test('Doppelte Kämpfer werden zusammengefasst', () => {
    const text = 'Max Mustermann 2012 m\nMax Mustermann 2012 m';
    assert.equal(extrahiereKaempfer(text).length, 1);
});

test('parseEml: multipart/alternative, Quoted-Printable, Umlaute', () => {
    const eml = [
        'From: =?UTF-8?Q?J=C3=BCrgen_Trainer?= <j@example.org>',
        'Subject: =?UTF-8?B?TWVsZHVuZyBUdXJuaWVy?=',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'Verein: JC M=C3=BCnster',
        'Max M=C3=BCller, *2012, m, 34 kg',
        '--b1',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>html</p>',
        '--b1--',
        ''
    ].join('\r\n');
    const mail = parseEml(bytes(eml));
    assert.equal(mail.betreff, 'Meldung Turnier');
    assert.match(mail.von, /Jürgen Trainer/);
    const s = extrahiereKaempfer(mail.text);
    assert.equal(s.length, 1);
    assert.equal(s[0].nachname, 'Müller');
    assert.equal(s[0].verein, 'JC Münster');
});

test('parseEml: nur HTML mit Tabelle, base64, Anhang', () => {
    const html = '<table><tr><th>Vorname</th><th>Name</th><th>Jahrgang</th><th>Geschlecht</th></tr>'
        + '<tr><td>Eva</td><td>Klein</td><td>2011</td><td>weiblich</td></tr></table>';
    const eml = [
        'Content-Type: multipart/mixed; boundary="m"',
        '',
        '--m',
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(html).toString('base64'),
        '--m',
        'Content-Type: application/vnd.ms-excel; name="meldung.xlsx"',
        'Content-Disposition: attachment; filename="meldung.xlsx"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('abc').toString('base64'),
        '--m--',
        ''
    ].join('\n');
    const mail = parseEml(bytes(eml));
    assert.equal(mail.anhaenge.length, 1);
    assert.equal(mail.anhaenge[0].name, 'meldung.xlsx');
    const s = extrahiereKaempfer(mail.text);
    assert.equal(s.length, 1);
    assert.equal(s[0].vorname, 'Eva');
    assert.equal(s[0].geschlecht, 'weiblich');
});

test('htmlZuText: Entities und Zeilenumbrüche', () => {
    assert.equal(htmlZuText('a&nbsp;&amp;&auml;<br>b').replace(/ /g, ' '), 'a &ä\nb');
});

test('Tabelle -> Zeilen -> CSV', () => {
    const s = extrahiereKaempfer('Max Mustermann, 2012, m, JC "Senden"');
    const zeilen = kaempferZuZeilen(s);
    assert.equal(zeilen[0].length, MAIL_SPALTEN.length);
    const csv = tabelleZuCsv(MAIL_SPALTEN, zeilen);
    assert.match(csv.split('\n')[0], /^Vorname,Name,Passnr,Geburtsdatum/);
});
