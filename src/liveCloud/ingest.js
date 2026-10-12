// Nimmt die Pakete des Live-Prozesses (src/live/uplink.js) entgegen und hält je Turnier den aktuellen Stand
// (Spec 6.1: "Ingest ersetzt den Stand des Turniers atomar, ältere Pakete werden verworfen").
import { suchtextFuer } from './suchtext.js';

const MAX_TEILNEHMER = 5000;
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;
const BLOCK = 500;

const text = (wert, max = 120) => (wert == null ? '' : String(wert).slice(0, max));
const ganzzahl = (wert) => (Number.isInteger(wert) ? wert : null);

export function pruefePaket(paket) {
    if (!paket || typeof paket !== 'object' || Array.isArray(paket)) return 'Paket ist kein Objekt';
    if (paket.version !== 1) return 'Version nicht unterstützt';
    if (typeof paket.turnierKey !== 'string' || !paket.turnierKey || paket.turnierKey.length > 64) return 'turnierKey fehlt';
    if (!Number.isFinite(paket.sequenz)) return 'sequenz fehlt';
    if (paket.zurueckgezogen === true) return null;
    if (typeof paket.name !== 'string') return 'name fehlt';
    if (typeof paket.datum !== 'string' || !ISO_DATUM.test(paket.datum)) return 'datum fehlt';
    if (Number.isNaN(Date.parse(paket.stand))) return 'stand fehlt';
    for (const feld of ['vereine', 'matten', 'teilnehmer', 'warteschlangen']) {
        if (!Array.isArray(paket[feld])) return `${feld} fehlt`;
    }
    if (paket.teilnehmer.length > MAX_TEILNEHMER) return 'zu viele Teilnehmer';
    for (const t of paket.teilnehmer) {
        if (!t || typeof t.key !== 'string' || !t.key || typeof t.zustand !== 'string') return 'Teilnehmer ungültig';
    }
    return null;
}

function teilnehmerZeilen(turnierKey, liste) {
    const gesehen = new Set();
    const zeilen = [];
    for (const t of liste) {
        const key = text(t.key, 64);
        if (gesehen.has(key)) continue;
        gesehen.add(key);
        zeilen.push({
            turnier_key: turnierKey, key,
            vorname: text(t.vorname), nachname: text(t.nachname), suche: suchtextFuer(t.vorname, t.nachname),
            verein_key: text(t.vereinKey, 64), verein: text(t.verein, 200),
            altersklasse: text(t.altersklasse, 20), gewichtsklasse: text(t.gewichtsklasse, 20), geschlecht: text(t.geschlecht, 5),
            pool_id: ganzzahl(t.poolId), pool_bezeichnung: text(t.poolBezeichnung, 200),
            matte_id: ganzzahl(t.matteId), matte_bezeichnung: text(t.matteBezeichnung, 100),
            zustand: text(t.zustand, 40), abstand: ganzzahl(t.abstand),
            naechster_kampf_id: ganzzahl(t.naechsterKampfId), platz: ganzzahl(t.platz)
        });
    }
    return zeilen;
}

function positionsZeilen(turnierKey, warteschlangen) {
    const gesehen = new Set();
    const zeilen = [];
    for (const schlange of warteschlangen) {
        for (const k of Array.isArray(schlange?.kaempfe) ? schlange.kaempfe : []) {
            if (!Number.isInteger(k?.id) || gesehen.has(k.id)) continue;
            gesehen.add(k.id);
            const keys = Array.isArray(k.teilnehmerKeys) ? k.teilnehmerKeys : [];
            zeilen.push({
                turnier_key: turnierKey, kampf_id: k.id, matte_id: ganzzahl(schlange.matteId),
                status: text(k.status, 30), position: Number.isInteger(k.position) ? k.position : 0,
                teilnehmer_key_1: keys[0] ? text(keys[0], 64) : null, teilnehmer_key_2: keys[1] ? text(keys[1], 64) : null
            });
        }
    }
    return zeilen;
}

async function fuegeEin(trx, tabelle, zeilen) {
    for (let i = 0; i < zeilen.length; i += BLOCK) await trx(tabelle).insert(zeilen.slice(i, i + BLOCK));
}

export async function uebernimmPaket(knex, paket, { jetzt = () => new Date() } = {}) {
    const fehler = pruefePaket(paket);
    if (fehler) throw Object.assign(new Error(fehler), { code: 'UNGUELTIG' });
    const key = paket.turnierKey;

    return knex.transaction(async (trx) => {
        // Gleichzeitige Pakete desselben Turniers laufen nacheinander (auch das allererste Anlegen).
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`live:${key}`]);
        const bestehend = await trx('live_turniere').where({ turnier_key: key }).first();
        if (bestehend && Number(bestehend.sequenz) >= paket.sequenz) return 'veraltet';

        if (paket.zurueckgezogen === true) {
            if (bestehend) {
                await trx('live_teilnehmer').where({ turnier_key: key }).del();
                await trx('live_kampf_positionen').where({ turnier_key: key }).del();
                await trx('live_turniere').where({ turnier_key: key })
                    .update({ zurueckgezogen: true, sequenz: paket.sequenz, empfangen_am: jetzt() });
            } else {
                await trx('live_turniere').insert({
                    turnier_key: key, name: '', datum: null, stand: jetzt(), sequenz: paket.sequenz,
                    empfangen_am: jetzt(), zurueckgezogen: true
                });
            }
            return 'zurueckgezogen';
        }

        const kopf = {
            name: text(paket.name, 200), datum: paket.datum, stand: new Date(paket.stand), sequenz: paket.sequenz,
            empfangen_am: jetzt(), zurueckgezogen: false,
            vereine: JSON.stringify(paket.vereine.map(v => ({ key: text(v?.key, 64), name: text(v?.name, 200) }))),
            matten: JSON.stringify(paket.matten.map(m => ({ id: ganzzahl(m?.id), bezeichnung: text(m?.bezeichnung, 100) })))
        };
        if (bestehend) {
            await trx('live_turniere').where({ turnier_key: key }).update(kopf);
            await trx('live_teilnehmer').where({ turnier_key: key }).del();
            await trx('live_kampf_positionen').where({ turnier_key: key }).del();
        } else {
            await trx('live_turniere').insert({ turnier_key: key, ...kopf });
        }
        await fuegeEin(trx, 'live_teilnehmer', teilnehmerZeilen(key, paket.teilnehmer));
        await fuegeEin(trx, 'live_kampf_positionen', positionsZeilen(key, paket.warteschlangen));
        return 'uebernommen';
    });
}
