// Push-Nachrichten der Teilnehmer-App (Spec Phase 3): Anmeldungen, Auswertung nach jedem Snapshot, Versand.
import { poolStarts } from './abfrage.js';
import { baueNachricht, baueTeamNachricht } from './pushText.js';
import { istErlaubterEndpunkt, PUSH_SCHWELLE } from './pushKonfig.js';

const SCHLUESSEL = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_LISTE = 200;
const TAG_MS = 86_400_000;

const fehler = (code, text) => Object.assign(new Error(text), { code });
const liste = (wert) => (Array.isArray(wert)
    ? [...new Set(wert.filter(k => typeof k === 'string' && SCHLUESSEL.test(k)))].slice(0, MAX_LISTE) : []);

// Bedingungen eines Teilnehmers (Spec Entscheidung 3 und 4).
export function bedingungenFuer(t, poolInfo, schwelle = PUSH_SCHWELLE) {
    const treffer = [];
    if (t.pool_id != null && poolInfo && !poolInfo.begonnen && Number.isInteger(poolInfo.startetIn) && poolInfo.startetIn <= schwelle) {
        treffer.push({ art: 'pool', bezug: t.pool_id, abstand: poolInfo.startetIn });
    }
    const abstand = t.zustand === 'als_naechstes' ? 0 : (t.zustand === 'in_n' && Number.isInteger(t.abstand) ? t.abstand : null);
    if (abstand != null && abstand <= schwelle && t.naechster_kampf_id != null) {
        treffer.push({ art: 'kampf', bezug: t.naechster_kampf_id, abstand });
    }
    return treffer;
}

// Team: die Begegnung des Teams läuft oder steht innerhalb der Schwelle an.
export function bedingungenFuerTeam(team, schwelle = PUSH_SCHWELLE) {
    if (team.naechste_begegnung_id == null) return [];
    const abstand = team.zustand === 'laeuft' ? 0
        : (team.zustand === 'als_naechstes' ? 0 : (team.zustand === 'in_n' && Number.isInteger(team.abstand) ? team.abstand : null));
    if (abstand == null || abstand > schwelle) return [];
    return [{ art: 'begegnung', bezug: team.naechste_begegnung_id, abstand }];
}

async function ladeStand(knex, turnierKey) {
    const [kopf, teilnehmer, pools, starts, teams] = await Promise.all([
        knex('live_turniere').where({ turnier_key: turnierKey, zurueckgezogen: false }).first(),
        knex('live_teilnehmer').where({ turnier_key: turnierKey }),
        knex('live_pools').where({ turnier_key: turnierKey }).select('pool_id', 'bezeichnung'),
        poolStarts(knex, turnierKey),
        knex('live_mannschaften').where({ turnier_key: turnierKey })
    ]);
    if (!kopf) return null;
    return {
        kopf, starts,
        mannschaften: new Map(teams.map(t => [t.key, t])),
        teilnehmer: new Map(teilnehmer.map(t => [t.key, t])),
        poolNamen: new Map(pools.map(p => [p.pool_id, p.bezeichnung])),
        matten: new Map((Array.isArray(kopf.matten) ? kopf.matten : []).map(m => [m.id, m.bezeichnung]))
    };
}

// Glockenliste → betroffene Teilnehmer (Vereinsmitglieder zählen zur Laufzeit, Ausnahmen werden abgezogen).
function loeseAuf(stand, g) {
    const ergebnis = new Set(g.teilnehmer);
    const vereine = new Set(g.vereine);
    const ausnahmen = new Set(g.ausnahmen);
    for (const t of stand.teilnehmer.values()) {
        if (vereine.has(t.verein_key) && !ausnahmen.has(t.key)) ergebnis.add(t.key);
    }
    return [...ergebnis].filter(k => stand.teilnehmer.has(k));
}

function loeseTeamsAuf(stand, g) {
    return g.teilnehmer.filter(k => stand.mannschaften.has(k));
}

async function ladeGlocken(knex, aboId) {
    const zeilen = await knex('live_push_glocken').where({ abo_id: aboId });
    const nach = (art) => zeilen.filter(z => z.art === art).map(z => z.schluessel);
    return { teilnehmer: nach('teilnehmer'), vereine: nach('verein'), ausnahmen: nach('ausnahme') };
}

export async function meldeAn(knex, turnierKey, { abo, glocken } = {}, { konfig, jetzt = () => new Date() } = {}) {
    if (!abo || !istErlaubterEndpunkt(abo.endpoint) || typeof abo.keys?.p256dh !== 'string' || typeof abo.keys?.auth !== 'string'
        || abo.keys.p256dh.length > 200 || abo.keys.auth.length > 100) {
        throw fehler('UNGUELTIG', 'Anmeldung ungültig');
    }
    const g = { teilnehmer: liste(glocken?.teilnehmer), vereine: liste(glocken?.vereine), ausnahmen: liste(glocken?.ausnahmen) };
    const leer = !g.teilnehmer.length && !g.vereine.length;

    return knex.transaction(async (trx) => {
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`livepush:${turnierKey}`]);
        const turnier = await trx('live_turniere').where({ turnier_key: turnierKey, zurueckgezogen: false }).first();
        if (!turnier) return { status: 'unbekannt' };
        const bestehend = await trx('live_push_abos').where({ turnier_key: turnierKey, endpoint: abo.endpoint }).first();
        if (leer) {
            if (bestehend) await trx('live_push_abos').where({ id: bestehend.id }).del();
            return { status: 'geloescht' };
        }
        if (!bestehend) {
            const [{ anzahl }] = await trx('live_push_abos').where({ turnier_key: turnierKey }).count('* as anzahl');
            if (Number(anzahl) >= konfig.maxAbos) throw fehler('ZU_VIELE', 'Zu viele Anmeldungen');
        }
        // Die Spalte datum ist ein DATE: der pg-Treiber liefert sie als lokales Mitternacht-Date.
        const d = turnier.datum;
        const datum = d instanceof Date
            ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d;
        const basis = datum ? new Date(`${datum}T12:00:00Z`) : jetzt();
        const laeuftAb = new Date(basis.getTime() + konfig.tage * TAG_MS);
        let aboId;
        if (bestehend) {
            aboId = bestehend.id;
            await trx('live_push_abos').where({ id: aboId }).update({
                p256dh: abo.keys.p256dh, auth: abo.keys.auth, aktualisiert_am: jetzt(), laeuft_ab_am: laeuftAb
            });
            await trx('live_push_glocken').where({ abo_id: aboId }).del();
        } else {
            [{ id: aboId }] = await trx('live_push_abos').insert({
                turnier_key: turnierKey, endpoint: abo.endpoint, p256dh: abo.keys.p256dh, auth: abo.keys.auth,
                erstellt_am: jetzt(), aktualisiert_am: jetzt(), laeuft_ab_am: laeuftAb
            }).returning('id');
        }
        const zeilen = [
            ...g.teilnehmer.map(k => ({ abo_id: aboId, art: 'teilnehmer', schluessel: k })),
            ...g.vereine.map(k => ({ abo_id: aboId, art: 'verein', schluessel: k })),
            ...g.ausnahmen.map(k => ({ abo_id: aboId, art: 'ausnahme', schluessel: k }))
        ];
        if (zeilen.length) await trx('live_push_glocken').insert(zeilen);

        // Bereits erfüllte Bedingungen gelten als gesendet (Spec Entscheidung 5).
        const stand = await ladeStand(trx, turnierKey);
        if (stand) {
            const vermerke = [];
            for (const key of loeseAuf(stand, g)) {
                const t = stand.teilnehmer.get(key);
                for (const b of bedingungenFuer(t, stand.starts.get(t.pool_id))) {
                    vermerke.push({ abo_id: aboId, teilnehmer_key: key, art: b.art, bezug_id: b.bezug });
                }
            }
            for (const key of loeseTeamsAuf(stand, g)) {
                for (const b of bedingungenFuerTeam(stand.mannschaften.get(key))) {
                    vermerke.push({ abo_id: aboId, teilnehmer_key: key, art: b.art, bezug_id: b.bezug });
                }
            }
            if (vermerke.length) await trx('live_push_gesendet').insert(vermerke).onConflict(['abo_id', 'teilnehmer_key', 'art', 'bezug_id']).ignore();
        }
        return { status: 'ok' };
    });
}

export async function meldeAb(knex, turnierKey, endpoint) {
    if (typeof endpoint !== 'string') return false;
    return (await knex('live_push_abos').where({ turnier_key: turnierKey, endpoint }).del()) > 0;
}

export async function loescheAbgelaufeneAbos(knex, { jetzt = () => new Date() } = {}) {
    return knex('live_push_abos').where('laeuft_ab_am', '<', jetzt()).del();
}

// Nach jedem übernommenen Snapshot: neue Treffer ermitteln, eintragen (genau einmal) und senden.
export async function pruefeUndSende(knex, turnierKey, { sender, jetzt = () => new Date(), log = console } = {}) {
    const nachrichten = await knex.transaction(async (trx) => {
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`livepush:${turnierKey}`]);
        const abos = await trx('live_push_abos').where({ turnier_key: turnierKey }).where('laeuft_ab_am', '>=', jetzt());
        if (!abos.length) return [];
        const stand = await ladeStand(trx, turnierKey);
        if (!stand) return [];
        const aus = [];
        for (const a of abos) {
            const g = await ladeGlocken(trx, a.id);
            for (const key of loeseAuf(stand, g)) {
                const t = stand.teilnehmer.get(key);
                const neu = [];
                for (const b of bedingungenFuer(t, stand.starts.get(t.pool_id))) {
                    const eingetragen = await trx('live_push_gesendet')
                        .insert({ abo_id: a.id, teilnehmer_key: key, art: b.art, bezug_id: b.bezug })
                        .onConflict(['abo_id', 'teilnehmer_key', 'art', 'bezug_id']).ignore().returning('abo_id');
                    if (eingetragen.length) neu.push(b);
                }
                if (!neu.length) continue;
                aus.push({
                    abo: { id: a.id, endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
                    nachricht: baueNachricht({
                        turnierKey, turnierName: stand.kopf.name, name: `${t.vorname} ${t.nachname}`.trim(),
                        poolBezeichnung: stand.poolNamen.get(t.pool_id) || t.pool_bezeichnung,
                        matte: stand.matten.get(t.matte_id) || t.matte_bezeichnung || '',
                        pool: neu.find(b => b.art === 'pool') || null, kampf: neu.find(b => b.art === 'kampf') || null
                    })
                });
            }
            // Teams: Glocke am Team meldet die Begegnung des Teams (nur das Team, nicht seine Kämpfer).
            for (const key of loeseTeamsAuf(stand, g)) {
                const team = stand.mannschaften.get(key);
                for (const b of bedingungenFuerTeam(team)) {
                    const eingetragen = await trx('live_push_gesendet')
                        .insert({ abo_id: a.id, teilnehmer_key: key, art: b.art, bezug_id: b.bezug })
                        .onConflict(['abo_id', 'teilnehmer_key', 'art', 'bezug_id']).ignore().returning('abo_id');
                    if (!eingetragen.length) continue;
                    aus.push({
                        abo: { id: a.id, endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
                        nachricht: baueTeamNachricht({
                            turnierKey, turnierName: stand.kopf.name, team: team.bezeichnung, gegner: team.gegner,
                            matte: stand.matten.get(team.matte_id) || team.matte_bezeichnung || '', abstand: b.abstand
                        })
                    });
                }
            }
        }
        return aus;
    });
    return sendeNachrichten(knex, nachrichten, { sender, log });
}

async function sendeNachrichten(knex, nachrichten, { sender, log }) {
    let gesendet = 0;
    for (const { abo, nachricht } of nachrichten) {
        try {
            await sender(abo, nachricht);
            gesendet += 1;
        } catch (f) {
            if (f && (f.statusCode === 404 || f.statusCode === 410)) await knex('live_push_abos').where({ id: abo.id }).del();
            else log.warn(`[LivePush] Senden fehlgeschlagen: ${f && f.message}`);
        }
    }
    return { gesendet };
}
