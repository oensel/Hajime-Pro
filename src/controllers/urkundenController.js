// Urkunden-Vorlagen (je Verein) und Generierung des Urkunden-PDFs.
// Spec: docs/specs/2026-09-29-urkunden-generator-design.md
// Zugriff: requireAuth + requireTournamentEditAccess an der Route (turnierId in Query/Body);
// eine Vorlage darf nur zusammen mit einem Turnier ihres Vereins verwendet werden.
import fs from 'node:fs/promises';
import { findeSchrift } from '../shared/urkundenSchriften.js';
import { findeRahmen } from '../shared/urkundenRahmen.js';
import { LINIEN_STILE } from '../shared/urkundenLinien.js';
import { leseVorlagenPdf, renderUrkunden, teilePdf, FehlerUngueltigesPdf } from '../services/urkundenRenderer.js';
import { ladeUrkundenDatenJePool, ladeUebersicht, zaehleUrkunden, BEISPIEL } from '../services/urkundenDaten.js';
import {
    MAX_BILDER, erkenneBildTyp, leseBilder, neueBildId, bereinigeBilder, pruefeBild
} from '../services/urkundenBilder.js';
import { baueVorlagenDatei, leseVorlagenDatei, legeVorlagenAn, FehlerUngueltigeDatei } from '../services/urkundenVorlagenDatei.js';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const RAHMEN_VERZEICHNIS = new URL('../../public/urkunden-rahmen/', import.meta.url);
const MAX_FELDER = 50;
const MAX_TEXT = 200;
const PLATZBEREICHE = ['3', '5', '7', 'alle'];
// 'siegerehrung' ist der frühere Name von 'absteigend' (letzter Platz zuerst) und wird weiter angenommen.
const REIHENFOLGEN = ['absteigend', 'aufsteigend', 'siegerehrung'];
const AUSRICHTUNGEN = ['links', 'zentriert', 'rechts'];
const LISTEN_SPALTEN = ['id', 'verein_id', 'name', 'pdf_dateiname', 'seiten_breite_pt', 'seiten_hoehe_pt',
    'felder', 'platzbereich', 'reihenfolge', 'bei_abschluss_anbieten', 'updated_at'];

export function darfVorlageNutzen(turnier, vorlage) {
    return !!(turnier && vorlage && turnier.verein_id && turnier.verein_id === vorlage.verein_id);
}

const FARBE = /^#[0-9a-f]{6}$/i;
const FARB_FEHLER = 'Farbe muss im Format #rrggbb angegeben werden.';
const istZahl = z => typeof z === 'number' && Number.isFinite(z);

// Feldtypen: 'text' (Standard, auch ohne typ), 'linie' (waagerecht, y = Mitte der Linie) und
// 'bild' (Rechteck x/y/breite/hoehe, Bilddaten in urkunden_vorlagen.bilder). Jede Prüfung liefert
// { fehler } oder die Unterkante des Feldes für die Prüfung gegen die Seitenhöhe.
function pruefeTextFeld(f) {
    if (typeof f.text !== 'string') return { fehler: 'Ungültiges Feld.' };
    if (f.text.length > MAX_TEXT) return { fehler: `Feldtext höchstens ${MAX_TEXT} Zeichen.` };
    if (!findeSchrift(f.schrift)) return { fehler: `Unbekannte Schrift: ${f.schrift}` };
    if (!istZahl(f.groesse)) return { fehler: 'Ungültiges Feld.' };
    if (f.groesse < 4 || f.groesse > 200) return { fehler: 'Schriftgröße muss zwischen 4 und 200 pt liegen.' };
    if (!AUSRICHTUNGEN.includes(f.ausrichtung)) return { fehler: 'Ungültige Ausrichtung.' };
    if (!FARBE.test(f.farbe || '')) return { fehler: FARB_FEHLER };
    return { unten: f.y + f.groesse };
}

function pruefeLinie(f) {
    if (!istZahl(f.staerke)) return { fehler: 'Ungültiges Feld.' };
    if (f.staerke < 0.5 || f.staerke > 10) return { fehler: 'Linienstärke muss zwischen 0,5 und 10 pt liegen.' };
    if (!LINIEN_STILE.some(s => s.id === f.stil)) return { fehler: 'Ungültiger Linienstil.' };
    if (!FARBE.test(f.farbe || '')) return { fehler: FARB_FEHLER };
    return { unten: f.y + f.staerke / 2 };
}

function pruefeBildFeld(f, bildIds) {
    if (!istZahl(f.hoehe) || f.hoehe <= 0) return { fehler: 'Ungültiges Feld.' };
    if (typeof f.bild_id !== 'string' || (bildIds && !bildIds.has(f.bild_id))) return { fehler: 'Bild nicht gefunden.' };
    return { unten: f.y + f.hoehe };
}

const FELD_PRUEFUNGEN = { text: pruefeTextFeld, linie: pruefeLinie, bild: pruefeBildFeld };

// bildIds (optional): vorhandene Bilder der Vorlage — Bildfelder müssen auf eines davon verweisen.
export function pruefeFelder(felder, seitenBreite, seitenHoehe, bildIds = null) {
    if (!Array.isArray(felder)) return 'Feldliste fehlt oder ist ungültig.';
    if (felder.length > MAX_FELDER) return `Höchstens ${MAX_FELDER} Felder pro Vorlage.`;
    for (const f of felder) {
        if (!f || ![f.x, f.y, f.breite].every(istZahl)) return 'Ungültiges Feld.';
        const pruefe = FELD_PRUEFUNGEN[f.typ ?? 'text'];
        if (!pruefe) return 'Unbekannter Feldtyp.';
        const { fehler, unten } = pruefe(f, bildIds);
        if (fehler) return fehler;
        if (f.x < 0 || f.y < 0 || f.breite <= 0 || f.x + f.breite > seitenBreite + 0.5 || unten > seitenHoehe + 0.5) {
            return 'Ein Feld liegt außerhalb der Seite.';
        }
    }
    return null;
}

export function normalisiereReihenfolge(reihenfolge) {
    return reihenfolge === 'aufsteigend' ? 'aufsteigend' : 'absteigend';
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
        // Entweder ein hochgeladenes PDF oder einer der mitgelieferten Standard-Rahmen.
        let pdf;
        let pdfDateiname = req.body.pdf_dateiname || null;
        if (req.body.rahmen_id !== undefined) {
            const rahmen = findeRahmen(req.body.rahmen_id);
            if (!rahmen) return res.status(400).json({ success: false, error: 'Unbekanntes Standard-Design.' });
            pdf = await fs.readFile(new URL(rahmen.datei, RAHMEN_VERZEICHNIS));
            pdfDateiname = rahmen.datei;
        } else {
            pdf = Buffer.from(String(req.body.pdf_base64 || ''), 'base64');
        }
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
            pdf_dateiname: pdfDateiname,
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

// Export als Datei (Format: services/urkundenVorlagenDatei.js). Ohne ids alle Vorlagen des Vereins.
export async function exportiereVorlagenDatei(knex, req, res) {
    try {
        const turnier = await ladeTurnier(knex, req);
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        const q = knex('urkunden_vorlagen').where({ verein_id: turnier.verein_id || -1 }).orderBy('name');
        if (req.query.ids) {
            const ids = String(req.query.ids).split(',').map(Number).filter(Number.isInteger);
            q.whereIn('id', ids);
        }
        const zeilen = await q;
        if (zeilen.length === 0) return res.status(404).json({ success: false, error: 'Keine Vorlage zum Exportieren gefunden.' });
        const dateiname = zeilen.length === 1
            ? zeilen[0].name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'vorlage'
            : 'urkunden-vorlagen';
        res.set({
            'Content-Disposition': `attachment; filename="${dateiname}.hajime-urkunde.json"; filename*=UTF-8''${encodeURIComponent(dateiname)}.hajime-urkunde.json`,
            'Cache-Control': 'no-store'
        });
        return res.type('application/json').send(JSON.stringify(baueVorlagenDatei(zeilen)));
    } catch (error) { return fehler500(res, error); }
}

// Import aus einer Datei (body.datei = geparstes JSON). Überschreibt nie: Namenskonflikte bekommen
// einen Zähler. Ungültige Vorlagen der Datei werden mit Grund gemeldet, gültige trotzdem angelegt.
export async function importiereVorlagenDatei(knex, req, res) {
    try {
        const turnier = await ladeTurnier(knex, req);
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        if (!turnier.verein_id) return res.status(400).json({ success: false, error: 'Das Turnier hat keinen ausrichtenden Verein.' });
        let gelesen;
        try {
            gelesen = await leseVorlagenDatei(req.body.datei);
        } catch (err) {
            if (err instanceof FehlerUngueltigeDatei) return res.status(400).json({ success: false, error: err.message });
            throw err;
        }
        const angelegt = await legeVorlagenAn(knex, turnier.verein_id, gelesen.gueltig);
        return res.json({ success: true, angelegt, abgelehnt: gelesen.abgelehnt });
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
            const bilder = leseBilder(vorlage.bilder);
            const fehler = pruefeFelder(felder, vorlage.seiten_breite_pt, vorlage.seiten_hoehe_pt, new Set(Object.keys(bilder)));
            if (fehler) return res.status(400).json({ success: false, error: fehler });
            aenderung.felder = JSON.stringify(felder);
            aenderung.bilder = JSON.stringify(bereinigeBilder(bilder, felder));
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

// Lädt ein Bild (PNG/JPEG, Base64) zur Vorlage hoch. Es bleibt nur erhalten, wenn beim nächsten
// Speichern der Felder ein Bildfeld darauf verweist.
export async function ladeBildHoch(knex, req, res) {
    try {
        const geladen = await ladeTurnierUndVorlage(knex, req, res, req.params.id);
        if (!geladen) return;
        const { vorlage } = geladen;
        const daten = String(req.body.daten_base64 || '');
        const bild = { typ: erkenneBildTyp(Buffer.from(daten, 'base64')), daten };
        const fehler = pruefeBild(bild);
        if (fehler) return res.status(400).json({ success: false, error: fehler });

        const bilder = leseBilder(vorlage.bilder);
        if (Object.keys(bilder).length >= MAX_BILDER) {
            return res.status(400).json({ success: false, error: `Höchstens ${MAX_BILDER} Bilder pro Vorlage.` });
        }
        const bildId = neueBildId();
        bilder[bildId] = bild;
        await knex('urkunden_vorlagen').where({ id: vorlage.id }).update({ bilder: JSON.stringify(bilder) });
        return res.json({ success: true, bild_id: bildId });
    } catch (error) { return fehler500(res, error); }
}

export async function holeBild(knex, req, res) {
    try {
        const geladen = await ladeTurnierUndVorlage(knex, req, res, req.params.id);
        if (!geladen) return;
        const bild = leseBilder(geladen.vorlage.bilder)[req.params.bildId];
        if (!bild) return res.status(404).json({ success: false, error: 'Bild nicht gefunden.' });
        return res.type(bild.typ).send(Buffer.from(bild.daten, 'base64'));
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

// Einseitige Beispiel-Urkunde für die Mini-Ansicht in der Vorlagen-Auswahl.
export async function holeVorlagenVorschau(knex, req, res) {
    try {
        const geladen = await ladeTurnierUndVorlage(knex, req, res, req.params.id);
        if (!geladen) return;
        const { bytes } = await renderUrkunden({
            pdfBytes: geladen.vorlage.pdf, felder: alsVorlage(geladen.vorlage).felder,
            bilder: leseBilder(geladen.vorlage.bilder), datensaetze: [BEISPIEL]
        });
        res.set('Cache-Control', 'no-store');
        return res.type('application/pdf').send(Buffer.from(bytes));
    } catch (error) {
        if (error instanceof FehlerUngueltigesPdf) return res.status(400).json({ success: false, error: error.message });
        return fehler500(res, error);
    }
}

// Nach "Pool abschließen": Vorlagen des Ausrichter-Vereins und die Zahl der Urkunden des Pools je
// Platzbereich. Ohne Vorlage bietet das Frontend nichts an.
export async function holeAbschlussAngebot(knex, req, res) {
    try {
        const turnier = await ladeTurnier(knex, req);
        const pool = await knex('pools').where({ id: parseInt(req.query.poolId) }).first();
        if (!turnier || !pool || pool.turnier_id !== turnier.id) {
            return res.status(404).json({ success: false, error: 'Pool nicht gefunden.' });
        }
        const vorlagen = turnier.verein_id
            ? await knex('urkunden_vorlagen').where({ verein_id: turnier.verein_id }).select('id', 'name').orderBy('name')
            : [];
        if (vorlagen.length === 0) return res.json({ vorlagen: [], anzahl: {} });
        return res.json({ vorlagen, anzahl: await zaehleUrkunden(knex, turnier.id, pool.id) });
    } catch (error) { return fehler500(res, error); }
}

export async function generiereUrkunden(knex, req, res) {
    try {
        const { vorlageId, platzbereich = '3', poolIds, reihenfolge = 'absteigend' } = req.body;
        if (!PLATZBEREICHE.includes(String(platzbereich))) return res.status(400).json({ success: false, error: 'Ungültiger Platzbereich.' });
        if (!REIHENFOLGEN.includes(reihenfolge)) return res.status(400).json({ success: false, error: 'Ungültige Reihenfolge.' });
        if (!Array.isArray(poolIds)) return res.status(400).json({ success: false, error: 'poolIds fehlt.' });

        const geladen = await ladeTurnierUndVorlage(knex, req, res, vorlageId);
        if (!geladen) return;
        const { turnier, vorlage } = geladen;

        const einstellungen = { platzbereich: String(platzbereich), reihenfolge: normalisiereReihenfolge(reihenfolge) };
        const jePool = poolIds.length === 0 ? [] : await ladeUrkundenDatenJePool(knex, turnier.id,
            { ...einstellungen, poolIds: poolIds.map(Number) });
        const datensaetze = jePool.flatMap(p => p.datensaetze);
        if (datensaetze.length === 0) {
            return res.status(422).json({ success: false, error: 'Für diese Auswahl gibt es keine Urkunden.' });
        }

        const { bytes, warnungen } = await renderUrkunden({
            pdfBytes: vorlage.pdf, felder: alsVorlage(vorlage).felder, bilder: leseBilder(vorlage.bilder), datensaetze
        });
        const gespeichert = await speicherePoolPdfs(knex, req, { vorlage, einstellungen, jePool, bytes });
        const datum = new Date().toISOString().slice(0, 10);
        res.set({
            'Content-Disposition': `inline; filename="urkunden_${turnier.id}_${datum}.pdf"`,
            'X-Urkunden-Anzahl': String(datensaetze.length),
            'X-Urkunden-Warnungen': encodeURIComponent(JSON.stringify(warnungen.slice(0, 50))),
            'X-Urkunden-Gespeichert': gespeichert ? '1' : '0',
            'Access-Control-Expose-Headers': 'X-Urkunden-Anzahl, X-Urkunden-Warnungen, X-Urkunden-Gespeichert'
        });
        return res.type('application/pdf').send(Buffer.from(bytes));
    } catch (error) { return fehler500(res, error); }
}

// Legt das erzeugte PDF je Pool ab (ersetzt das bisherige des Pools). Am Secondary ist die DB nur
// lesbar: dort wird nichts gespeichert, gedruckt werden kann trotzdem. Ein Fehler beim Speichern
// verhindert den Druck nicht.
async function speicherePoolPdfs(knex, req, { vorlage, einstellungen, jePool, bytes }) {
    const cluster = req.app.get('cluster');
    if (cluster && !cluster.darfSchreiben()) return false;
    try {
        const teile = jePool.length === 1 ? [bytes] : await teilePdf(bytes, jePool.map(p => p.datensaetze.length));
        const erzeugtAm = new Date().toISOString();
        await knex.transaction(async trx => {
            await trx('urkunden_pdfs').whereIn('pool_id', jePool.map(p => p.poolId)).del();
            for (const [i, { poolId, datensaetze }] of jePool.entries()) {
                await trx('urkunden_pdfs').insert({
                    pool_id: poolId, vorlage_id: vorlage.id, vorlage_name: vorlage.name, ...einstellungen,
                    anzahl: datensaetze.length, pdf: Buffer.from(teile[i]), erzeugt_am: erzeugtAm
                });
            }
        });
        return true;
    } catch (error) {
        console.error('[Urkunden] PDF konnte nicht gespeichert werden:', error);
        return false;
    }
}

async function ladePoolPdf(knex, req, res, spalten) {
    const turnier = await ladeTurnier(knex, req);
    const pool = await knex('pools').where({ id: parseInt(req.params.poolId) || -1 }).first();
    if (!turnier || !pool || pool.turnier_id !== turnier.id) {
        res.status(404).json({ success: false, error: 'Pool nicht gefunden.' });
        return null;
    }
    const zeile = await knex('urkunden_pdfs').where({ pool_id: pool.id }).select(spalten).first();
    if (!zeile) {
        res.status(404).json({ success: false, error: 'Für diesen Pool liegt kein Urkunden-PDF vor.' });
        return null;
    }
    return { turnier, pool, zeile };
}

export async function holePoolPdf(knex, req, res) {
    try {
        const geladen = await ladePoolPdf(knex, req, res, ['pdf', 'anzahl']);
        if (!geladen) return;
        res.set({
            'Content-Disposition': `inline; filename="urkunden_${geladen.turnier.id}_pool_${geladen.pool.id}.pdf"`,
            'Cache-Control': 'no-store',
            'X-Urkunden-Anzahl': String(geladen.zeile.anzahl),
            'Access-Control-Expose-Headers': 'X-Urkunden-Anzahl'
        });
        return res.type('application/pdf').send(Buffer.from(geladen.zeile.pdf));
    } catch (error) { return fehler500(res, error); }
}

export async function loeschePoolPdf(knex, req, res) {
    try {
        const geladen = await ladePoolPdf(knex, req, res, ['id']);
        if (!geladen) return;
        await knex('urkunden_pdfs').where({ id: geladen.zeile.id }).del();
        return res.json({ success: true });
    } catch (error) { return fehler500(res, error); }
}
