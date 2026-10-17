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
