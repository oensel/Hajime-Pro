// Urkunden-Vorlagen (je Verein) und Generierung des Urkunden-PDFs.
// Spec: docs/superpowers/specs/2026-09-29-urkunden-generator-design.md
// Zugriff: requireAuth + requireTournamentEditAccess an der Route (turnierId in Query/Body);
// eine Vorlage darf nur zusammen mit einem Turnier ihres Vereins verwendet werden.
import { findeSchrift } from '../shared/urkundenSchriften.js';
import { leseVorlagenPdf, renderUrkunden, FehlerUngueltigesPdf } from '../services/urkundenRenderer.js';
import { ladeUrkundenDaten, ladeUebersicht } from '../services/urkundenDaten.js';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_FELDER = 50;
const MAX_TEXT = 200;
const PLATZBEREICHE = ['3', '5', '7', 'alle'];
const REIHENFOLGEN = ['siegerehrung', 'aufsteigend'];
const AUSRICHTUNGEN = ['links', 'zentriert', 'rechts'];
const LISTEN_SPALTEN = ['id', 'verein_id', 'name', 'pdf_dateiname', 'seiten_breite_pt', 'seiten_hoehe_pt',
    'felder', 'platzbereich', 'reihenfolge', 'bei_abschluss_anbieten', 'updated_at'];

export function darfVorlageNutzen(turnier, vorlage) {
    return !!(turnier && vorlage && turnier.verein_id && turnier.verein_id === vorlage.verein_id);
}

export function pruefeFelder(felder, seitenBreite, seitenHoehe) {
    if (!Array.isArray(felder)) return 'Feldliste fehlt oder ist ungültig.';
    if (felder.length > MAX_FELDER) return `Höchstens ${MAX_FELDER} Felder pro Vorlage.`;
    for (const f of felder) {
        const zahlen = [f?.x, f?.y, f?.breite, f?.groesse];
        if (!f || typeof f.text !== 'string' || zahlen.some(z => typeof z !== 'number' || !Number.isFinite(z))) return 'Ungültiges Feld.';
        if (f.text.length > MAX_TEXT) return `Feldtext höchstens ${MAX_TEXT} Zeichen.`;
        if (!findeSchrift(f.schrift)) return `Unbekannte Schrift: ${f.schrift}`;
        if (f.groesse < 4 || f.groesse > 200) return 'Schriftgröße muss zwischen 4 und 200 pt liegen.';
        if (!/^#[0-9a-f]{6}$/i.test(f.farbe || '')) return 'Farbe muss im Format #rrggbb angegeben werden.';
        if (!AUSRICHTUNGEN.includes(f.ausrichtung)) return 'Ungültige Ausrichtung.';
        if (f.x < 0 || f.y < 0 || f.breite <= 0 || f.x + f.breite > seitenBreite + 0.5 || f.y + f.groesse > seitenHoehe + 0.5) {
            return 'Ein Feld liegt außerhalb der Seite.';
        }
    }
    return null;
}

function alsVorlage(zeile) {
    let felder = [];
    try { felder = JSON.parse(zeile.felder || '[]'); } catch { felder = []; }
    return { ...zeile, felder, bei_abschluss_anbieten: !!zeile.bei_abschluss_anbieten };
}

function neueId(eingefuegt) {
    return typeof eingefuegt === 'object' ? eingefuegt.id : eingefuegt;
}

async function ladeTurnier(knex, req) {
    if (req.tournament) return req.tournament;
    const turnierId = req.query.turnierId || req.body?.turnierId;
    return turnierId ? knex('turniere').where({ id: parseInt(turnierId) }).first() : null;
}

// Lädt Turnier und Vorlage (per :id oder body.vorlageId) und prüft die Vereinszugehörigkeit.
async function ladeTurnierUndVorlage(knex, req, res, vorlageId) {
    const turnier = await ladeTurnier(knex, req);
    if (!turnier) {
        res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        return null;
    }
    const vorlage = await knex('urkunden_vorlagen').where({ id: parseInt(vorlageId) }).first();
    if (!vorlage) {
        res.status(404).json({ success: false, error: 'Vorlage nicht gefunden.' });
        return null;
    }
    if (!darfVorlageNutzen(turnier, vorlage)) {
        res.status(403).json({ success: false, error: 'Kein Zugriff auf diese Vorlage.' });
        return null;
    }
    return { turnier, vorlage };
}

async function nameVergeben(knex, vereinId, name, ausserId = null) {
    const q = knex('urkunden_vorlagen').where({ verein_id: vereinId, name });
    if (ausserId) q.whereNot({ id: ausserId });
    return !!(await q.first());
}

function fehler500(res, error) {
    console.error('[Urkunden]', error);
    return res.status(500).json({ success: false, error: error.message });
}

export async function listeVorlagen(knex, req, res) {
    try {
        const turnier = await ladeTurnier(knex, req);
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        const zeilen = await knex('urkunden_vorlagen').where({ verein_id: turnier.verein_id || -1 }).select(LISTEN_SPALTEN).orderBy('name');
        return res.json(zeilen.map(alsVorlage));
    } catch (error) { return fehler500(res, error); }
}

export async function holeVorlagenPdf(knex, req, res) {
    try {
        const geladen = await ladeTurnierUndVorlage(knex, req, res, req.params.id);
        if (!geladen) return;
        return res.type('application/pdf').send(Buffer.from(geladen.vorlage.pdf));
    } catch (error) { return fehler500(res, error); }
}

export async function legeVorlageAn(knex, req, res) {
    try {
        const turnier = await ladeTurnier(knex, req);
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        if (!turnier.verein_id) return res.status(400).json({ success: false, error: 'Das Turnier hat keinen ausrichtenden Verein.' });

        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ success: false, error: 'Name fehlt.' });
        const pdf = Buffer.from(String(req.body.pdf_base64 || ''), 'base64');
        if (pdf.length === 0) return res.status(400).json({ success: false, error: 'PDF-Datei fehlt.' });
        if (pdf.length > MAX_PDF_BYTES) return res.status(400).json({ success: false, error: 'Die PDF-Datei ist größer als 10 MB.' });

        let groesse;
        try {
            groesse = await leseVorlagenPdf(pdf);
        } catch (err) {
            if (err instanceof FehlerUngueltigesPdf) return res.status(400).json({ success: false, error: err.message });
            throw err;
        }
        if (await nameVergeben(knex, turnier.verein_id, name)) {
            return res.status(409).json({ success: false, error: 'Eine Vorlage mit diesem Namen gibt es bereits.' });
        }

        const [eingefuegt] = await knex('urkunden_vorlagen').insert({
            verein_id: turnier.verein_id,
            name,
            pdf,
            pdf_dateiname: req.body.pdf_dateiname || null,
            seiten_breite_pt: groesse.breite,
            seiten_hoehe_pt: groesse.hoehe,
            felder: '[]'
        }).returning('id');
        return res.json({ success: true, id: neueId(eingefuegt) });
    } catch (error) { return fehler500(res, error); }
}

export async function dupliziereVorlage(knex, req, res) {
    try {
        const geladen = await ladeTurnierUndVorlage(knex, req, res, req.params.id);
        if (!geladen) return;
        const { vorlage } = geladen;
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ success: false, error: 'Name fehlt.' });
        if (await nameVergeben(knex, vorlage.verein_id, name)) {
            return res.status(409).json({ success: false, error: 'Eine Vorlage mit diesem Namen gibt es bereits.' });
        }
        const { id, created_at, updated_at, ...kopie } = vorlage;
        const [eingefuegt] = await knex('urkunden_vorlagen')
            .insert({ ...kopie, name, bei_abschluss_anbieten: false }).returning('id');
        return res.json({ success: true, id: neueId(eingefuegt) });
    } catch (error) { return fehler500(res, error); }
}

export async function aktualisiereVorlage(knex, req, res) {
    try {
        const geladen = await ladeTurnierUndVorlage(knex, req, res, req.params.id);
        if (!geladen) return;
        const { vorlage } = geladen;
        const { name, felder, platzbereich, reihenfolge, bei_abschluss_anbieten } = req.body;
        const aenderung = {};

        if (name !== undefined) {
            const neuerName = String(name).trim();
            if (!neuerName) return res.status(400).json({ success: false, error: 'Name fehlt.' });
            if (await nameVergeben(knex, vorlage.verein_id, neuerName, vorlage.id)) {
                return res.status(409).json({ success: false, error: 'Eine Vorlage mit diesem Namen gibt es bereits.' });
            }
            aenderung.name = neuerName;
        }
        if (felder !== undefined) {
            const fehler = pruefeFelder(felder, vorlage.seiten_breite_pt, vorlage.seiten_hoehe_pt);
            if (fehler) return res.status(400).json({ success: false, error: fehler });
            aenderung.felder = JSON.stringify(felder);
        }
        if (platzbereich !== undefined) {
            if (!PLATZBEREICHE.includes(String(platzbereich))) return res.status(400).json({ success: false, error: 'Ungültiger Platzbereich.' });
            aenderung.platzbereich = String(platzbereich);
        }
        if (reihenfolge !== undefined) {
            if (!REIHENFOLGEN.includes(reihenfolge)) return res.status(400).json({ success: false, error: 'Ungültige Reihenfolge.' });
            aenderung.reihenfolge = reihenfolge;
        }
        if (bei_abschluss_anbieten !== undefined) aenderung.bei_abschluss_anbieten = !!bei_abschluss_anbieten;

        await knex.transaction(async trx => {
            // Höchstens eine Vorlage je Verein bietet den Druck beim Pool-Abschluss an.
            if (aenderung.bei_abschluss_anbieten) {
                await trx('urkunden_vorlagen').where({ verein_id: vorlage.verein_id }).whereNot({ id: vorlage.id })
                    .update({ bei_abschluss_anbieten: false });
            }
            await trx('urkunden_vorlagen').where({ id: vorlage.id }).update({ ...aenderung, updated_at: trx.fn.now() });
        });
        return res.json({ success: true });
    } catch (error) { return fehler500(res, error); }
}

export async function loescheVorlage(knex, req, res) {
    try {
        const geladen = await ladeTurnierUndVorlage(knex, req, res, req.params.id);
        if (!geladen) return;
        await knex('urkunden_vorlagen').where({ id: geladen.vorlage.id }).del();
        return res.json({ success: true });
    } catch (error) { return fehler500(res, error); }
}

export async function holeUebersicht(knex, req, res) {
    try {
        const turnier = await ladeTurnier(knex, req);
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        return res.json(await ladeUebersicht(knex, turnier.id));
    } catch (error) { return fehler500(res, error); }
}

export async function holeAbschlussAngebot(knex, req, res) {
    try {
        const turnier = await ladeTurnier(knex, req);
        const pool = await knex('pools').where({ id: parseInt(req.query.poolId) }).first();
        if (!turnier || !pool || pool.turnier_id !== turnier.id) {
            return res.status(404).json({ success: false, error: 'Pool nicht gefunden.' });
        }
        const vorlage = turnier.verein_id
            ? await knex('urkunden_vorlagen').where({ verein_id: turnier.verein_id, bei_abschluss_anbieten: true })
                .select('id', 'name', 'platzbereich', 'reihenfolge').first()
            : null;
        if (!vorlage) return res.json({ vorlage: null, anzahl: 0 });
        const datensaetze = await ladeUrkundenDaten(knex, turnier.id,
            { platzbereich: vorlage.platzbereich, poolIds: [pool.id], reihenfolge: vorlage.reihenfolge });
        return res.json({ vorlage, anzahl: datensaetze.length });
    } catch (error) { return fehler500(res, error); }
}

export async function generiereUrkunden(knex, req, res) {
    try {
        const { vorlageId, platzbereich = '3', poolIds, reihenfolge = 'siegerehrung' } = req.body;
        if (!PLATZBEREICHE.includes(String(platzbereich))) return res.status(400).json({ success: false, error: 'Ungültiger Platzbereich.' });
        if (!REIHENFOLGEN.includes(reihenfolge)) return res.status(400).json({ success: false, error: 'Ungültige Reihenfolge.' });
        if (!Array.isArray(poolIds)) return res.status(400).json({ success: false, error: 'poolIds fehlt.' });

        const geladen = await ladeTurnierUndVorlage(knex, req, res, vorlageId);
        if (!geladen) return;
        const { turnier, vorlage } = geladen;

        const datensaetze = poolIds.length === 0 ? [] : await ladeUrkundenDaten(knex, turnier.id,
            { platzbereich: String(platzbereich), poolIds: poolIds.map(Number), reihenfolge });
        if (datensaetze.length === 0) {
            return res.status(422).json({ success: false, error: 'Für diese Auswahl gibt es keine Urkunden.' });
        }

        const { bytes, warnungen } = await renderUrkunden({
            pdfBytes: vorlage.pdf, felder: alsVorlage(vorlage).felder, datensaetze
        });
        const datum = new Date().toISOString().slice(0, 10);
        res.set({
            'Content-Disposition': `inline; filename="urkunden_${turnier.id}_${datum}.pdf"`,
            'X-Urkunden-Anzahl': String(datensaetze.length),
            'X-Urkunden-Warnungen': encodeURIComponent(JSON.stringify(warnungen.slice(0, 50))),
            'Access-Control-Expose-Headers': 'X-Urkunden-Anzahl, X-Urkunden-Warnungen'
        });
        return res.type('application/pdf').send(Buffer.from(bytes));
    } catch (error) { return fehler500(res, error); }
}
