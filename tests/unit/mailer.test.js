import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Ohne SMTP wird eine Mail nur geloggt. In der Cloud nur Empfänger und Betreff (die Einmal-Links im Text wären
// sonst im Server-Log abgreifbar), in Entwicklung/Test der volle Text, weil Entwickler die Links brauchen.
process.env.SMTP_HOST = '';
const { sendeMail } = await import('../../src/utils/mailer.js');

async function logVon(env) {
    const vorher = { BETRIEBSMODUS: process.env.BETRIEBSMODUS, IS_OFFLINE: process.env.IS_OFFLINE };
    Object.assign(process.env, env);
    const zeilen = [];
    const m = mock.method(console, 'log', (...a) => { zeilen.push(a.join(' ')); });
    try {
        await sendeMail({ to: 'erika@example.de', subject: 'Bitte bestätigen', text: 'Link: https://h.example/bestaetigen.html?token=GEHEIM123' });
    } finally {
        m.mock.restore();
        for (const [k, v] of Object.entries(vorher)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    return zeilen.join('\n');
}

test('Mailer ohne SMTP: Cloud loggt nur Empfänger und Betreff', async () => {
    const log = await logVon({ BETRIEBSMODUS: 'cloud' });
    assert.match(log, /erika@example\.de/);
    assert.match(log, /Bitte bestätigen/);
    assert.doesNotMatch(log, /GEHEIM123/);
    assert.doesNotMatch(log, /bestaetigen\.html/);
});

test('Mailer ohne SMTP: außerhalb der Cloud mit vollem Text', async () => {
    const log = await logVon({ BETRIEBSMODUS: 'server' });
    assert.match(log, /erika@example\.de/);
    assert.match(log, /bestaetigen\.html\?token=GEHEIM123/);
});

// Startgeld-Rechnungen (Task 10): Rückgabewert, Anhänge, Reply-To, Absendername.
const { setzeTestVersand, baueMailOptionen } = await import('../../src/utils/mailer.js');

test('Mailer ohne SMTP meldet { versendet: false, grund: kein_smtp }', async () => {
    const m = mock.method(console, 'log', () => {});
    try {
        const r = await sendeMail({ to: 'a@b.de', subject: 'S', text: 'T' });
        assert.deepEqual(r, { versendet: false, grund: 'kein_smtp' });
    } finally {
        m.mock.restore();
    }
});

test('Testversand bekommt das ganze Objekt samt Anhängen; ohne Rückgabe gilt die Mail als versendet', async () => {
    const mails = [];
    setzeTestVersand((mail) => { mails.push(mail); });
    try {
        const inhalt = Buffer.from('%PDF-1.7');
        const r = await sendeMail({
            to: 'k@x.de', subject: 'Rechnung', text: 'Hallo', replyTo: 'kasse@jc.de', absenderName: 'JC Kasse',
            anhaenge: [{ dateiname: 'JCK-00001.pdf', inhalt, typ: 'application/pdf' }]
        });
        assert.deepEqual(r, { versendet: true, grund: null });
        assert.equal(mails.length, 1);
        assert.equal(mails[0].replyTo, 'kasse@jc.de');
        assert.equal(mails[0].absenderName, 'JC Kasse');
        assert.equal(mails[0].anhaenge[0].dateiname, 'JCK-00001.pdf');
        assert.equal(mails[0].anhaenge[0].inhalt, inhalt);
    } finally {
        setzeTestVersand(null);
    }
});

test('Testversand, der wirft, ergibt { versendet: false, grund: fehler }; eigene Rückgabe wird durchgereicht', async () => {
    const e = mock.method(console, 'error', () => {});
    try {
        setzeTestVersand(() => { throw new Error('SMTP kaputt'); });
        assert.deepEqual(await sendeMail({ to: 'a@b.de', subject: 'S', text: 'T' }), { versendet: false, grund: 'fehler' });
        setzeTestVersand(async () => ({ versendet: false, grund: 'kein_smtp' }));
        assert.deepEqual(await sendeMail({ to: 'a@b.de', subject: 'S', text: 'T' }), { versendet: false, grund: 'kein_smtp' });
    } finally {
        setzeTestVersand(null);
        e.mock.restore();
    }
});

test('baueMailOptionen: Absendername ersetzt nur den Anzeigenamen, Anhänge werden zu attachments', () => {
    const anhang = { dateiname: 'R.pdf', inhalt: new Uint8Array([37, 80, 68, 70]), typ: 'application/pdf' };
    const o = baueMailOptionen({ to: 'k@x.de', subject: 'S', text: 'T', replyTo: 'r@jc.de', absenderName: 'JC "Kasse"', anhaenge: [anhang] },
        '"Hajime Pro" <no-reply@hajime.de>');
    assert.deepEqual(o.from, { name: 'JC "Kasse"', address: 'no-reply@hajime.de' });
    assert.equal(o.replyTo, 'r@jc.de');
    assert.equal(o.attachments.length, 1);
    assert.equal(o.attachments[0].filename, 'R.pdf');
    assert.equal(o.attachments[0].contentType, 'application/pdf');
    assert.ok(Buffer.isBuffer(o.attachments[0].content));
    assert.equal(o.attachments[0].content.toString('latin1'), '%PDF');

    // ohne Absendername bleibt SMTP_FROM unverändert, ohne Reply-To/Anhänge keine Felder
    const ohne = baueMailOptionen({ to: 'k@x.de', subject: 'S', text: 'T' }, '"Hajime Pro" <no-reply@hajime.de>');
    assert.equal(ohne.from, '"Hajime Pro" <no-reply@hajime.de>');
    assert.equal('replyTo' in ohne, false);
    assert.equal('attachments' in ohne, false);
    // nackte Adresse in SMTP_FROM
    assert.deepEqual(baueMailOptionen({ to: 'k', subject: 'S', text: 'T', absenderName: 'X' }, 'mail@hajime.de').from, { name: 'X', address: 'mail@hajime.de' });
});
