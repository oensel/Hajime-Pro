// Orga-Planer: HTTP-Schicht (Spec 2026-10-18-orga-planer-design). Orga-Routen unter /api/orga laufen hinter
// requireTournamentEditAccess (rolle benutzer+ im ausrichtenden Verein, Super-Admin, Einzelbenutzerbetrieb); die
// Aufgaben-ID im Pfad bestimmt dort das Turnier (auth.js). Die Service-Funktionen prüfen die Zugehörigkeit nicht,
// deshalb löst jede Route mit Aufgaben-ID das Turnier der Aufgabe auf und vergleicht es mit dem autorisierten.
// Helfer-Routen unter /api/helfer/orga prüfen selbst (Eigentümer bzw. Mitgliedschaft).
import { FachFehler } from '../utils/fachFehler.js';
import { sendeFehler } from './helferPlanController.js';
import { ermittleBasisUrl } from '../utils/basisUrl.js';
import { ermittleOrgaTurnierId } from '../middleware/auth.js';
import { hatHelferZugriffAufVerein, ladeVereinIdsMitRolle, MITGLIED_ROLLEN } from '../utils/vereinHelper.js';
import { berechneStatus } from '../shared/orgaStatus.js';
import {
    ladeOrga, legeAusVorlageAn, legeAufgabeAn, aendereAufgabe, loescheAufgabe, setzeErledigt, ladeZaehlung,
    MITBRINGLISTEN_KEYS
} from '../services/orgaPlan.js';
import { weiseZu, sendeEinladungNeu } from '../services/orgaZuweisung.js';
import { datumAlsText } from '../services/helferPlan.js';
import betriebsmodus from '../config/betriebsmodus.cjs';
const { istEinzelbenutzerBetrieb } = betriebsmodus;

// ganze Zahl im int4-Bereich (größere Werte würden in PostgreSQL einen Fehler statt 404 auslösen)
const ganzzahl = (w) => (/^\d+$/.test(String(w)) && Number(w) <= 2147483647 ? parseInt(w, 10) : null);

/** Vor dem Gate: unbekannte Aufgaben-ID als 404 statt "Turnier-ID konnte nicht ermittelt werden". */
export function pruefeAufgabeVorhanden(knex) {
    return async (req, res, next) => {
        try {
            if ((await ermittleOrgaTurnierId(knex, req.params.id)) == null) {
                return res.status(404).json({ success: false, error: 'Aufgabe nicht gefunden.' });
            }
            next();
        } catch (error) {
            sendeFehler(res, error, 'Orga-Vorhanden');
        }
    };
}

// Das autorisierte Turnier: vom Gate (req.tournament), sonst (Einzelbenutzerbetrieb) das der Aufgabe bzw. aus Query/Body.
async function autorisiertesTurnierId(knex, req) {
    if (req.tournament) return req.tournament.id;
    if (req.params.id != null) return ermittleOrgaTurnierId(knex, req.params.id);
    return ganzzahl(req.query.turnierId ?? req.body?.turnierId ?? req.body?.turnier_id);
}

// Stellt sicher, dass die Aufgabe zum autorisierten Turnier gehört (sonst 404, gleiche Meldung wie "unbekannt").
async function pruefeZugehoerigkeit(knex, req) {
    const turnierId = await autorisiertesTurnierId(knex, req);
    const tatsaechlich = await ermittleOrgaTurnierId(knex, req.params.id);
    if (turnierId == null || tatsaechlich == null || Number(tatsaechlich) !== Number(turnierId)) {
        throw new FachFehler(404, 'Aufgabe nicht gefunden.');
    }
    return turnierId;
}

async function ladeTurnier(knex, req, turnierId) {
    const turnier = req.tournament || await knex('turniere').where({ id: turnierId }).first();
    if (!turnier) throw new FachFehler(404, 'Turnier nicht gefunden.');
    return turnier;
}

async function istFreigegebenesMitglied(knex, benutzerId, vereinId) {
    return !!(await knex('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId, freigegeben: 1 }).first());
}

// ---- Orga (/api/orga) ----

/** GET /?turnierId= — Checkliste; ein Turnier ohne Aufgaben bekommt vorher die Standardvorlage (idempotent). */
export async function ladeOrgaRoute(knex, req, res) {
    try {
        const turnierId = await autorisiertesTurnierId(knex, req);
        if (turnierId == null) throw new FachFehler(400, 'Turnier-ID fehlt.');
        const turnier = await ladeTurnier(knex, req, turnierId);
        // nurLesen=1 (Seitenmenü): keine Vorlage anlegen, kein Schreibzugriff
        const nurLesen = req.query.nurLesen === '1';
        const vorhanden = await knex('orga_aufgaben').where({ turnier_id: turnierId }).first('id');
        if (!vorhanden && !nurLesen) {
            try {
                await legeAusVorlageAn(knex, turnierId);
            } catch (err) {
                // z. B. Secondary im Cluster (Standby nur lesend): leere Liste anzeigen
                if (err instanceof FachFehler) throw err;
                console.error('[Orga-Vorlage]:', err.message);
            }
        }
        const orga = await ladeOrga(knex, turnierId);
        res.json({
            success: true,
            turnier: {
                id: turnier.id, bezeichnung: turnier.bezeichnung, datum: datumAlsText(turnier.datum),
                anmeldeschluss: datumAlsText(turnier.anmeldeschluss), status: turnier.status
            },
            ...orga
        });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Laden');
    }
}

/** POST /aufgaben — Body { turnierId, titel, phase?, eltern_id?, art?, notiz?, menge?, link?, frist_anker?, frist_tage?, faellig_am? } */
export async function legeAufgabeAnRoute(knex, req, res) {
    try {
        const turnierId = await autorisiertesTurnierId(knex, req);
        if (turnierId == null) throw new FachFehler(400, 'Turnier-ID fehlt.');
        const b = req.body || {};
        if (b.eltern_id != null && ganzzahl(b.eltern_id) == null) throw new FachFehler(404, 'Übergeordnete Aufgabe nicht gefunden.');
        const ergebnis = await legeAufgabeAn(knex, turnierId, {
            titel: b.titel, phase: b.phase, eltern_id: b.eltern_id ?? null, art: b.art, notiz: b.notiz, menge: b.menge,
            link: b.link, frist_anker: b.frist_anker, frist_tage: b.frist_tage, faellig_am: b.faellig_am,
            benutzerId: req.user?.id ?? null
        });
        res.status(201).json({ success: true, id: ergebnis.id });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Anlegen');
    }
}

// Zuständige (benutzer_id, name_frei, email_frei) gehen bewusst nur über /zuweisen, das sie prüft.
const PUT_FELDER = ['titel', 'notiz', 'menge', 'phase', 'link', 'reihenfolge', 'faellig_am', 'frist_anker', 'frist_tage'];

/** PUT /aufgaben/:id — Felder aus PUT_FELDER (keine Zuständigen); frist_anker:null löscht die Frist, faellig_am:null berechnet neu. */
export async function aendereAufgabeRoute(knex, req, res) {
    try {
        await pruefeZugehoerigkeit(knex, req);
        const b = req.body || {};
        const felder = {};
        for (const k of PUT_FELDER) if (k in b) felder[k] = b[k];
        await aendereAufgabe(knex, parseInt(req.params.id, 10), felder);
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Aendern');
    }
}

/** DELETE /aufgaben/:id */
export async function loescheAufgabeRoute(knex, req, res) {
    try {
        await pruefeZugehoerigkeit(knex, req);
        await loescheAufgabe(knex, parseInt(req.params.id, 10));
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Loeschen');
    }
}

/** POST /aufgaben/:id/erledigt — Body { erledigt: boolean } */
export async function setzeErledigtRoute(knex, req, res) {
    try {
        await pruefeZugehoerigkeit(knex, req);
        if (typeof req.body?.erledigt !== 'boolean') throw new FachFehler(400, 'erledigt muss true oder false sein.');
        await setzeErledigt(knex, parseInt(req.params.id, 10), { erledigt: req.body.erledigt, benutzerId: req.user?.id ?? null });
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Erledigt');
    }
}

/** POST /aufgaben/:id/zuweisen — Body { benutzerId } | { name, email? } | { frei: false } */
export async function weiseZuRoute(knex, req, res, { sende } = {}) {
    try {
        await pruefeZugehoerigkeit(knex, req);
        const b = req.body || {};
        const ziel = b.frei === false ? { frei: false } : b.benutzerId ? { benutzerId: String(b.benutzerId) } : { name: b.name, email: b.email };
        // Hallen-Server (Einzelbenutzerbetrieb): keine Einladungen, keine Mails, kein Host-Header-Link.
        // Wer sich selbst zuweist, bekommt keine Mail (sonst eine je Posten bei "Alle auf mich"); die Antwort
        // trägt dann modus 'konto' mit ohneMail: true.
        const selbst = ziel.benutzerId != null && ziel.benutzerId === String(req.user?.id);
        const ergebnis = await weiseZu(knex, parseInt(req.params.id, 10), ziel, {
            basisUrl: ermittleBasisUrl(req), mitMail: !istEinzelbenutzerBetrieb() && !selbst, ...(sende ? { sende } : {})
        });
        res.json({ success: true, modus: ergebnis.modus, ...(selbst && ergebnis.modus === 'konto' ? { ohneMail: true } : {}) });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Zuweisen');
    }
}

/** POST /aufgaben/:id/einladung-erneut */
export async function einladungErneutRoute(knex, req, res, { sende } = {}) {
    try {
        await pruefeZugehoerigkeit(knex, req);
        if (istEinzelbenutzerBetrieb()) throw new FachFehler(409, 'Einladungen gibt es nur in der Cloud.');
        const ergebnis = await sendeEinladungNeu(knex, parseInt(req.params.id, 10), ermittleBasisUrl(req), sende ? { sende } : {});
        res.json({ success: true, modus: ergebnis.modus });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Einladung-Erneut');
    }
}

/** POST /vorlage-nachladen — Body { turnierId }; legt fehlende Vorlagen-Aufgaben an. */
export async function vorlageNachladenRoute(knex, req, res) {
    try {
        const turnierId = await autorisiertesTurnierId(knex, req);
        if (turnierId == null) throw new FachFehler(400, 'Turnier-ID fehlt.');
        const ergebnis = await legeAusVorlageAn(knex, turnierId);
        res.json({ success: true, angelegt: ergebnis.angelegt });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Vorlage-Nachladen');
    }
}

/** GET /mitglieder?turnierId= — freigegebene Mitglieder des ausrichtenden Vereins (zum Zuweisen). */
export async function ladeMitgliederRoute(knex, req, res) {
    try {
        const turnierId = await autorisiertesTurnierId(knex, req);
        if (turnierId == null) throw new FachFehler(400, 'Turnier-ID fehlt.');
        const turnier = await ladeTurnier(knex, req, turnierId);
        const zeilen = await knex('benutzer_vereine as bv')
            .join('benutzer as b', 'b.id', 'bv.benutzer_id')
            .where({ 'bv.verein_id': turnier.verein_id, 'bv.freigegeben': 1 })
            .whereIn('bv.rolle', MITGLIED_ROLLEN)
            .orderBy([{ column: 'b.nachname' }, { column: 'b.vorname' }])
            .select('b.id', 'b.vorname', 'b.nachname', 'b.email');
        res.json(zeilen);
    } catch (error) {
        sendeFehler(res, error, 'Orga-Mitglieder');
    }
}

// ---- Helfer-App (/api/helfer/orga) ----

/** GET /meine — eigene Aufgaben/Posten über alle Turniere; Gruppierung (Überfällig/Diese Woche/Später) im Client. */
export async function ladeMeineRoute(knex, req, res) {
    try {
        const benutzerId = req.user.id;
        const zeilen = await knex('orga_aufgaben as a')
            .join('turniere as t', 't.id', 'a.turnier_id')
            .leftJoin('orga_aufgaben as p', 'p.id', 'a.eltern_id')
            .where('a.benutzer_id', benutzerId)
            .whereNot('a.art', 'mitbringen')
            .whereNot('t.status', 'abgesagt')
            .orderBy([{ column: 't.datum' }, { column: 'a.reihenfolge' }, { column: 'a.id' }])
            .select('a.*', 't.bezeichnung as turnier_name', 't.datum as turnier_datum',
                'p.titel as eltern_titel', 'p.faellig_am as eltern_faellig_am');
        const ids = zeilen.map((z) => z.id);
        const kinder = ids.length ? await knex('orga_aufgaben').whereIn('eltern_id', ids) : [];
        const zaehlungen = new Map();
        for (const tid of new Set(zeilen.map((z) => z.turnier_id))) zaehlungen.set(tid, await ladeZaehlung(knex, tid));
        res.json({
            success: true,
            aufgaben: zeilen.map((z) => ({
                id: z.id,
                turnier_id: z.turnier_id,
                turnier: z.turnier_name,
                turnier_datum: datumAlsText(z.turnier_datum),
                titel: z.titel,
                phase: z.phase,
                art: z.art,
                notiz: z.notiz,
                menge: z.menge,
                link: z.link,
                eltern_id: z.eltern_id,
                eltern_titel: z.eltern_titel,
                faellig_am: datumAlsText(z.faellig_am ?? z.eltern_faellig_am),
                status: berechneStatus(z, kinder.filter((k) => k.eltern_id === z.id), zaehlungen.get(z.turnier_id))
            }))
        });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Meine');
    }
}

/** POST /aufgaben/:id/erledigt — nur für die eigene Aufgabe. Body { erledigt: boolean } */
export async function meineErledigtRoute(knex, req, res) {
    try {
        const id = ganzzahl(req.params.id);
        const aufgabe = id == null ? null : await knex('orga_aufgaben').where({ id }).first('id', 'benutzer_id');
        if (!aufgabe) throw new FachFehler(404, 'Aufgabe nicht gefunden.');
        if (aufgabe.benutzer_id == null || aufgabe.benutzer_id !== req.user.id) {
            throw new FachFehler(403, 'Du kannst nur deine eigenen Aufgaben abhaken.');
        }
        if (typeof req.body?.erledigt !== 'boolean') throw new FachFehler(400, 'erledigt muss true oder false sein.');
        await setzeErledigt(knex, id, { erledigt: req.body.erledigt, benutzerId: req.user.id });
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Meine-Erledigt');
    }
}

// Orga-Recht im Verein: rolle benutzer+ (Mitgliedschaft), Super-Admin, Einzelbenutzerbetrieb.
async function istOrgaImVerein(knex, benutzerId, vereinId) {
    if (istEinzelbenutzerBetrieb()) return true;
    const benutzer = await knex('benutzer').where({ id: benutzerId }).first('ist_super_admin');
    if (benutzer?.ist_super_admin) return true;
    return (await ladeVereinIdsMitRolle(knex, benutzerId, 'benutzer')).includes(vereinId);
}

async function darfMitbringen(knex, benutzerId, vereinId) {
    if (istEinzelbenutzerBetrieb()) return true;
    return hatHelferZugriffAufVerein(knex, benutzerId, vereinId);
}

async function anzeigename(knex, benutzerId) {
    const b = await knex('benutzer').where({ id: benutzerId }).first('vorname', 'nachname');
    return b ? [b.vorname, b.nachname].filter(Boolean).join(' ').trim() || null : null;
}

// Lädt einen Mitbringeintrag samt Turnier; 404 für alles, was kein Mitbringeintrag ist.
async function ladeEintrag(knex, idText) {
    const id = ganzzahl(idText);
    const eintrag = id == null ? null : await knex('orga_aufgaben').where({ id, art: 'mitbringen' }).first();
    if (!eintrag) throw new FachFehler(404, 'Eintrag nicht gefunden.');
    const turnier = await knex('turniere').where({ id: eintrag.turnier_id }).first('id', 'verein_id', 'status');
    return { eintrag, turnier };
}

/** POST /mitbringliste — Body { turnierId, titel, menge? }; legt einen Eintrag unter dem Catering des Turniers an. */
export async function mitbringlisteAnlegenRoute(knex, req, res) {
    try {
        const turnierId = ganzzahl(req.body?.turnierId);
        if (turnierId == null) throw new FachFehler(req.body?.turnierId == null ? 400 : 404, req.body?.turnierId == null ? 'Turnier-ID fehlt.' : 'Turnier nicht gefunden.');
        const turnier = await knex('turniere').where({ id: turnierId }).first('id', 'verein_id', 'status');
        if (!turnier || !(await darfMitbringen(knex, req.user.id, turnier.verein_id))) {
            throw new FachFehler(403, 'Kein Zugriff auf dieses Turnier.');
        }
        if (turnier.status === 'abgesagt' || turnier.status === 'abgeschlossen') {
            throw new FachFehler(403, 'Dieses Turnier ist abgesagt oder abgeschlossen.');
        }
        const eltern = await knex('orga_aufgaben').where({ turnier_id: turnierId, eltern_id: null })
            .whereIn('vorlage_key', [...MITBRINGLISTEN_KEYS]).orderBy('id').first('id');
        if (!eltern) throw new FachFehler(404, 'Für dieses Turnier gibt es keine Mitbringliste.');
        const ergebnis = await legeAufgabeAn(knex, turnierId, {
            eltern_id: eltern.id, art: 'mitbringen', titel: req.body?.titel, menge: req.body?.menge ?? null,
            name_frei: await anzeigename(knex, req.user.id), benutzerId: req.user.id
        });
        res.status(201).json({ success: true, id: ergebnis.id });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Mitbringliste-Anlegen');
    }
}

/** PUT /mitbringliste/:id — Body { titel?, menge? }; nur der eigene Eintrag. */
export async function mitbringlisteAendernRoute(knex, req, res) {
    try {
        const { eintrag, turnier } = await ladeEintrag(knex, req.params.id);
        if (eintrag.erstellt_von !== req.user.id || !(await darfMitbringen(knex, req.user.id, turnier.verein_id))) {
            throw new FachFehler(403, 'Du kannst nur deine eigenen Einträge ändern.');
        }
        const b = req.body || {};
        const felder = {};
        if ('titel' in b) felder.titel = b.titel;
        if ('menge' in b) felder.menge = b.menge;
        await aendereAufgabe(knex, eintrag.id, felder);
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Mitbringliste-Aendern');
    }
}

/** DELETE /mitbringliste/:id — der eigene Eintrag; die Orga (rolle benutzer+) darf jeden löschen. */
export async function mitbringlisteLoeschenRoute(knex, req, res) {
    try {
        const { eintrag, turnier } = await ladeEintrag(knex, req.params.id);
        const eigener = eintrag.erstellt_von === req.user.id && await darfMitbringen(knex, req.user.id, turnier.verein_id);
        if (!eigener && !(await istOrgaImVerein(knex, req.user.id, turnier.verein_id))) {
            throw new FachFehler(403, 'Du kannst nur deine eigenen Einträge löschen.');
        }
        await loescheAufgabe(knex, eintrag.id);
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Orga-Mitbringliste-Loeschen');
    }
}
