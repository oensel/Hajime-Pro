// Zugangscode der Teilnehmer-App für E2E-Tests: legt (falls nötig) den Code des Turniers direkt in der Test-Datenbank an
// und liefert ihn zurück. Die App öffnet man damit über `/live/#z=<Code>`, API-Aufrufe senden ihn im Kopf X-Live-Zugang.
import crypto from 'node:crypto';
import knexLib from 'knex';
import { testDbVerbindung } from '../test-env.js';

export async function zugangsCode(turnierKey) {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('live_zugang').insert({ turnier_key: String(turnierKey), code: crypto.randomBytes(16).toString('base64url') })
            .onConflict('turnier_key').ignore();
        return (await db('live_zugang').where({ turnier_key: String(turnierKey) }).first()).code;
    } finally {
        await db.destroy();
    }
}

export const zugangsKopf = async (turnierKey) => ({ 'X-Live-Zugang': await zugangsCode(turnierKey) });
export const qrAdresse = async (turnierKey) => `/live/#z=${await zugangsCode(turnierKey)}`;

/** Setzt den Zugang eines Turniers auf gesperrt bzw. entsperrt. */
export async function setzeSperre(turnierKey, gesperrt) {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('live_zugang').where({ turnier_key: String(turnierKey) }).update({ gesperrt_am: gesperrt ? db.fn.now() : null });
    } finally {
        await db.destroy();
    }
}

/** Legt den Zugangscode des Turniers im Browser ab, als hätte das Gerät den Aushang schon gescannt (vor jedem Seitenaufruf). */
export async function merkeZugang(page, turnierKey, { name = '', datum = '' } = {}) {
    const code = await zugangsCode(turnierKey);
    await page.addInitScript(([k, c, n, d]) => {
        try { if (!localStorage.getItem(`hajime-live-zugang:${k}`)) localStorage.setItem(`hajime-live-zugang:${k}`, JSON.stringify({ code: c, name: n, datum: d })); } catch { /* ohne Speicher */ }
    }, [turnierKey, code, name, datum]);
    return code;
}
