import { hatVereinsZugriffAufTurnier } from '../utils/vereinHelper.js';
import { turnierHatEchteKaempfe } from './poolController.js';

// Anmeldeschluss wird als reines Datum (ohne Uhrzeit) gespeichert; die Frist gilt bis
// einschließlich 24:00 Uhr Ortszeit dieses Tages (identische Logik zu teilnehmerController.js).
// setHours (lokale Zeit) statt setUTCHours, da UTC-Mitternacht je nach Zeitzone des Servers
// mehrere Stunden von der tatsächlichen deutschen Ortszeit abweicht.
function berechneAnmeldefrist(anmeldeschluss) {
    const deadline = new Date(anmeldeschluss);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(anmeldeschluss).trim())) {
        deadline.setHours(23, 59, 59, 999);
    }
    return deadline;
}

// Export und Ergebnis-Upload sind erst sinnvoll, wenn sich die Anmeldungen nicht mehr ändern
// können — ohne hinterlegte Frist gilt sie als noch nicht abgelaufen (sicherer Default).
function istAnmeldefristAbgelaufen(turnier) {
    if (!turnier.anmeldeschluss) return false;
    return new Date() > berechneAnmeldefrist(turnier.anmeldeschluss);
}

// Nur 'entwurf' | 'veroeffentlicht' | 'abgeschlossen' | 'abgesagt' werden physisch gespeichert.
// 'anmeldung_geschlossen' und 'in_durchfuehrung' sind reine Ableitungen (kein Cronjob nötig).
// "Keine Online-Aktionen" während der Durchführung betrifft die vereinsübergreifende Anmeldung/
// Stammdaten-Bearbeitung (bereits durch dieselbe Prüfung gesperrt) — Pools/Matten/Kampf-Seiten
// sind ohnehin schon auf den ausrichtenden Verein beschränkt und bleiben davon unberührt.
function ermittleEffektivenStatus(turnier, { hatEchteKaempfe = false } = {}) {
    if (turnier.status !== 'veroeffentlicht') return turnier.status;

    const heuteStr = new Date().toISOString().slice(0, 10);
    const wettkampftagErreicht = turnier.datum && String(turnier.datum).slice(0, 10) <= heuteStr;
    if (wettkampftagErreicht || hatEchteKaempfe) return 'in_durchfuehrung';
    if (istAnmeldefristAbgelaufen(turnier)) return 'anmeldung_geschlossen';
    return 'veroeffentlicht';
}

const GUELTIGE_STATUS_WERTE = ['entwurf', 'veroeffentlicht', 'abgeschlossen', 'abgesagt'];

// Wird ein Startgeld verlangt, müssen die Zahlungsdaten vollständig sein, sonst kann später
// niemand zuverlässig bezahlen (fehlende IBAN/Kontoinhaber/Verwendungszweck).
function validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck) {
    const startgeldWert = startgeld !== undefined && startgeld !== '' ? parseInt(startgeld, 10) : 0;
    if (startgeldWert > 0) {
        if (!iban || !iban.trim() || !kontoinhaber || !kontoinhaber.trim() || !verwendungszweck || !verwendungszweck.trim()) {
            return 'Wenn ein Startgeld verlangt wird, müssen IBAN, Kontoinhaber und Verwendungszweck ausgefüllt sein.';
        }
    }
    return null;
}

export async function createTurnier(knex, req, res) {
    try {
        const { bezeichnung, ort, datum, ausrichter, anzahl_kampfflaechen, nutze_gewichtsklassen, bundesland, altersklassen, anmeldeschluss, startgeld, iban, kontoinhaber, verwendungszweck } = req.body;
        const userId = req.user.id; // Logged in user ID from middleware

        const zahlungsFehler = validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck);
        if (zahlungsFehler) {
            return res.status(400).json({ success: false, error: zahlungsFehler });
        }

        // Turnier wird an den Verein des anlegenden Benutzers gekoppelt (nicht mehr an
        // den Benutzer selbst) — requireVereinFreigabe stellt sicher, dass verein_id gesetzt ist.
        const user = await knex('benutzer').where({ id: userId }).first();
        const vereinId = user ? user.verein_id : null;

        // Sicherer Check: Akzeptiert die Zahl 1, den String "1" oder das Boolean true
        const wertFuerDB = (nutze_gewichtsklassen === 1 || nutze_gewichtsklassen === true || nutze_gewichtsklassen === '1' || nutze_gewichtsklassen === 'true') ? 1 : 0;

        const altersklassenDB = typeof altersklassen === 'string' ? altersklassen : JSON.stringify(altersklassen || {});

        const [idObj] = await knex('turniere').insert({
            bezeichnung,
            ort,
            datum,
            ausrichter,
            anzahl_kampfflaechen: parseInt(anzahl_kampfflaechen) || 1,
            nutze_gewichtsklassen: wertFuerDB,
            verein_id: vereinId,
            bundesland: bundesland || null,
            altersklassen: altersklassenDB,
            status: 'entwurf', // neue Turniere starten immer im Entwurf (Zustand 1 der Spezifikation)
            anmeldeschluss: anmeldeschluss || null,
            startgeld: startgeld !== undefined && startgeld !== '' ? parseInt(startgeld, 10) : null,
            iban: iban || null,
            kontoinhaber: kontoinhaber || null,
            verwendungszweck: verwendungszweck || null
        }).returning('id');

        const turnierId = typeof idObj === 'object' ? idObj.id : idObj;
        await synchronisiereKampfflaechen(knex, turnierId, parseInt(anzahl_kampfflaechen) || 1);
        res.status(201).json({ success: true, turnierId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function updateTurnier(knex, req, res) {
    try {
        const { id } = req.params;
        const { bezeichnung, ort, datum, ausrichter, anzahl_kampfflaechen, nutze_gewichtsklassen, bundesland, altersklassen, anmeldeschluss, startgeld, iban, kontoinhaber, verwendungszweck } = req.body;

        const zahlungsFehler = validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck);
        if (zahlungsFehler) {
            return res.status(400).json({ success: false, error: zahlungsFehler });
        }

        const bestehendesTurnier = await knex('turniere').where({ id }).first();
        if (!bestehendesTurnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        // 'abgeschlossen' wird nie abgeleitet, sondern immer direkt gespeichert -> Statusvergleich reicht.
        if (bestehendesTurnier.status === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein abgeschlossenes Turnier befindet sich im schreibgeschützten Archiv-Zustand.' });
        }

        // Sicherer Check: Akzeptiert die Zahl 1, den String "1" oder das Boolean true
        const wertFuerDB = (nutze_gewichtsklassen === 1 || nutze_gewichtsklassen === true || nutze_gewichtsklassen === '1' || nutze_gewichtsklassen === 'true') ? 1 : 0;

        const altersklassenDB = typeof altersklassen === 'string' ? altersklassen : JSON.stringify(altersklassen || {});

        // verein_id wird hier absichtlich nicht angefasst — die Vereinszuordnung ist nach der
        // Anlage unveränderlich, damit kein Mitglied das Turnier einem anderen Verein zuordnen
        // und sich selbst (und den eigenen Verein) aussperren kann. "ausrichter" ist nur noch
        // ein Anzeigetext und darf frei bearbeitet werden.
        await knex('turniere').where({ id }).update({
            bezeichnung,
            ort,
            datum,
            ausrichter,
            anzahl_kampfflaechen: parseInt(anzahl_kampfflaechen) || 1,
            nutze_gewichtsklassen: wertFuerDB,
            bundesland: bundesland || null,
            altersklassen: altersklassenDB,
            anmeldeschluss: anmeldeschluss || null,
            startgeld: startgeld !== undefined && startgeld !== '' ? parseInt(startgeld, 10) : null,
            iban: iban || null,
            kontoinhaber: kontoinhaber || null,
            verwendungszweck: verwendungszweck || null,
            updated_at: knex.fn.now()
        });

        await synchronisiereKampfflaechen(knex, parseInt(id), parseInt(anzahl_kampfflaechen) || 1);

        res.json({ success: true, message: 'Turnier erfolgreich aktualisiert.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function getTurnier(knex, req, res) {
    try {
        const turnier = await knex('turniere').where({ id: req.params.id }).first();
        if (!turnier) return res.status(404).json({ error: 'Turnier nicht gefunden.' });

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnier.id);
        const statusEffektiv = ermittleEffektivenStatus(turnier, { hatEchteKaempfe });

        // Entwurf: nur für Mitglieder des ausrichtenden Vereins sichtbar (Zustand 1: "Nur für
        // den Ersteller sichtbar"). Offline-Betrieb ist Single-Tenant und bleibt ausgenommen.
        if (statusEffektiv === 'entwurf' && process.env.IS_OFFLINE !== 'true') {
            const user = await knex('benutzer').where({ id: req.user.id }).first();
            if (!hatVereinsZugriffAufTurnier(user, turnier)) {
                return res.status(403).json({ error: 'Dieses Turnier befindet sich noch im Entwurf und ist nicht sichtbar.' });
            }
        }

        // Altersklassen parsen
        let ak = turnier.altersklassen;
        if (typeof ak === 'string') {
            try {
                ak = JSON.parse(ak);
            } catch (e) {
                ak = ak ? ak.split(',') : [];
            }
        }
        turnier.altersklassen = ak || [];
        turnier.status_effektiv = statusEffektiv;
        turnier.teilnehmer_anzahl = await knex('turnier_teilnehmer').where({ turnier_id: turnier.id }).count('* as anzahl').first().then(r => parseInt(r.anzahl, 10));

        res.json(turnier);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getTurniere(knex, req, res) {
    try {
        const userId = req.user.id;
        const { mine, zukuenftig } = req.query;
        const user = await knex('benutzer').where({ id: userId }).first();

        let query = knex('turniere');

        if (mine === 'true') {
            // "Eigene" Turniere = Turniere des eigenen Vereins
            if (user && user.verein_id) {
                query = query.where({ verein_id: user.verein_id });
            } else {
                query = query.whereNull('id'); // kein Verein -> keine eigenen Turniere
            }
        } else if (process.env.IS_OFFLINE !== 'true') {
            // Entwurf: nur für den ausrichtenden Verein sichtbar (Zustand 1 der Spezifikation).
            // Offline-Betrieb ist Single-Tenant und bleibt ausgenommen.
            if (user && user.verein_id) {
                query = query.where(function () {
                    this.whereNot({ status: 'entwurf' }).orWhere({ verein_id: user.verein_id });
                });
            } else {
                query = query.whereNot({ status: 'entwurf' });
            }
        }

        if (zukuenftig === 'true') {
            const jetzt = new Date();
            const heuteStr = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`;
            query = query.where('datum', '>=', heuteStr);
        }

        const turniere = await query.orderBy('datum', 'desc');

        const ids = turniere.map(t => t.id);
        const counts = ids.length > 0
            ? await knex('turnier_teilnehmer').whereIn('turnier_id', ids).groupBy('turnier_id').select('turnier_id').count('* as anzahl')
            : [];
        const countMap = {};
        counts.forEach(c => { countMap[c.turnier_id] = parseInt(c.anzahl, 10); });

        // Altersklassen parsen
        const turniereMitParsen = turniere.map(t => {
            let ak = t.altersklassen;
            if (typeof ak === 'string') {
                try {
                    ak = JSON.parse(ak);
                } catch (e) {
                    ak = ak ? ak.split(',') : [];
                }
            }
            // Listen-Badge: ohne hatEchteKaempfe berechnet, um N+1-Abfragen zu vermeiden (siehe
            // Plan) — kann "in_durchfuehrung" in einem schmalen Edge-Fall kurz verzögert zeigen;
            // die exakte, gate-relevante Berechnung erfolgt in getTurnier (Einzelabruf).
            return {
                ...t,
                altersklassen: ak || [],
                teilnehmer_anzahl: countMap[t.id] || 0,
                status_effektiv: ermittleEffektivenStatus(t)
            };
        });

        res.json(turniereMitParsen);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// "Gelöscht" ist kein gespeicherter Status, sondern echtes Entfernen der Zeile (Zustand 7 der
// Spezifikation): nur erlaubt, solange das Turnier nicht in Durchführung/abgeschlossen ist UND
// bislang kein einziger Teilnehmer registriert wurde.
export async function deleteTurnier(knex, req, res) {
    try {
        const { id } = req.params;
        const turnier = await knex('turniere').where({ id }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, id);
        const statusEffektiv = ermittleEffektivenStatus(turnier, { hatEchteKaempfe });
        if (statusEffektiv === 'in_durchfuehrung' || statusEffektiv === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein Turnier in Durchführung oder abgeschlossenes Turnier kann nicht gelöscht werden.' });
        }

        const teilnehmerAnzahl = await knex('turnier_teilnehmer').where({ turnier_id: id }).count('* as anzahl').first().then(r => parseInt(r.anzahl, 10));
        if (teilnehmerAnzahl > 0) {
            return res.status(409).json({ success: false, error: 'Ein Turnier mit angemeldeten Teilnehmern kann nicht gelöscht werden.' });
        }

        await knex('turniere').where({ id }).del();
        res.json({ success: true, message: 'Turnier erfolgreich gelöscht.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Zustand 1 -> 2: gibt das Turnier für externe Vereine frei (Anmeldung beginnt).
export async function veroeffentlicheTurnier(knex, req, res) {
    try {
        const { id } = req.params;
        const turnier = await knex('turniere').where({ id }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        if (turnier.status !== 'entwurf') {
            return res.status(400).json({ success: false, error: 'Nur Turniere im Entwurf können veröffentlicht werden.' });
        }

        await knex('turniere').where({ id }).update({ status: 'veroeffentlicht', updated_at: knex.fn.now() });
        res.json({ success: true, message: 'Turnier erfolgreich veröffentlicht.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Zustand 6: jederzeit möglich, außer das Turnier ist bereits abgeschlossen oder gelöscht.
export async function sageTurnierAb(knex, req, res) {
    try {
        const { id } = req.params;
        const turnier = await knex('turniere').where({ id }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        if (turnier.status === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein bereits abgeschlossenes Turnier kann nicht mehr abgesagt werden.' });
        }

        await knex('turniere').where({ id }).update({ status: 'abgesagt', updated_at: knex.fn.now() });
        res.json({ success: true, message: 'Turnier erfolgreich abgesagt.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Zustand 4 -> 5 manuell, per Button "Durchführung beendet" (Gegenstück zum automatischen
// Übergang durch importTurnierErgebnisse).
export async function beendeDurchfuehrung(knex, req, res) {
    try {
        const { id } = req.params;
        const turnier = await knex('turniere').where({ id }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, id);
        const statusEffektiv = ermittleEffektivenStatus(turnier, { hatEchteKaempfe });
        if (statusEffektiv !== 'in_durchfuehrung') {
            return res.status(403).json({ success: false, error: 'Nur ein Turnier in Durchführung kann als beendet markiert werden.' });
        }

        await knex('turniere').where({ id }).update({ status: 'abgeschlossen', updated_at: knex.fn.now() });
        res.json({ success: true, message: 'Durchführung erfolgreich beendet.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Übersetzt den alten 3-Werte-Kampf-Status (wartet/laufend/beendet) aus vor dieser Migration
// exportierten Dateien in das neue 6-Werte-Vokabular; bereits neue Werte bleiben unverändert.
function normalisiereKampfStatus(status, kaempfer1Id, kaempfer2Id) {
    if (status === 'laufend') return 'gestartet';
    if (status === 'wartet') return (kaempfer1Id != null && kaempfer2Id != null) ? 'bereit' : 'angelegt';
    if (status === 'beendet' && (kaempfer1Id == null || kaempfer2Id == null)) return 'freilos';
    return status || 'angelegt';
}

// Fügt Kampfflächen/Pools/Teilnehmer/Kämpfe aus einer Export-JSON in ein Turnier ein, mit
// frischen IDs (nie die alten Export-IDs wiederverwenden) und korrekt umgeschriebenen
// Fremdschlüsseln (kampfflaeche_id, pool_id, kaempfer1/2_id, sieger_id, sowie die
// selbstreferenzierenden Kampf-Quelle-Verknüpfungen). Gemeinsam genutzt von importTurnier
// (komplette Neuanlage, offline) und importTurnierErgebnisse (Ergebnisse eines bestehenden
// Turniers ersetzen, online).
async function importWettkampfdaten(trx, turnierId, { kampfflaechen, pools, teilnehmer, kaempfe }) {
    const kampfflaecheIdMap = new Map();
    for (const kf of kampfflaechen) {
        const [neueIdObj] = await trx('kampfflaechen').insert({
            turnier_id: turnierId,
            bezeichnung: kf.bezeichnung,
            status: kf.status || 'frei'
        }).returning('id');
        kampfflaecheIdMap.set(kf.id, typeof neueIdObj === 'object' ? neueIdObj.id : neueIdObj);
    }

    const poolIdMap = new Map();
    for (const p of pools) {
        const [neueIdObj] = await trx('pools').insert({
            turnier_id: turnierId,
            kampfflaeche_id: p.kampfflaeche_id != null ? (kampfflaecheIdMap.get(p.kampfflaeche_id) ?? null) : null,
            bezeichnung: p.bezeichnung,
            modus: p.modus || 'Jeder-gegen-Jeden',
            altersklasse: p.altersklasse,
            geschlecht: p.geschlecht,
            gewichtsklasse: p.gewichtsklasse,
            kampfzeit_sekunden: p.kampfzeit_sekunden || 240,
            matte_reihenfolge: p.matte_reihenfolge ?? null,
            status: p.status || 'angelegt'
        }).returning('id');
        poolIdMap.set(p.id, typeof neueIdObj === 'object' ? neueIdObj.id : neueIdObj);
    }

    const teilnehmerIdMap = new Map();
    for (const teil of teilnehmer) {
        const [neueIdObj] = await trx('turnier_teilnehmer').insert({
            turnier_id: turnierId,
            pool_id: teil.pool_id != null ? (poolIdMap.get(teil.pool_id) ?? null) : null,
            judopass_id: teil.judopass_id || '',
            vorname: teil.vorname,
            nachname: teil.nachname,
            geburtsdatum: teil.geburtsdatum,
            lizenz_ablauf: teil.lizenz_ablauf || '1970-01-01',
            geschlecht: teil.geschlecht,
            verein: teil.verein,
            gewicht: teil.gewicht || 0,
            altersklasse: teil.altersklasse,
            gewichtsklasse: teil.gewichtsklasse,
            startgeld_bezahlt: teil.startgeld_bezahlt ? 1 : 0,
            graduierung: teil.graduierung || null,
            status: teil.status || 'angemeldet'
        }).returning('id');
        teilnehmerIdMap.set(teil.id, typeof neueIdObj === 'object' ? neueIdObj.id : neueIdObj);
    }

    // Erster Durchlauf ohne die selbstreferenzierenden Quelle-Felder (deren Zielkämpfe evtl.
    // noch gar nicht eingefügt sind), zweiter Durchlauf trägt sie nach.
    const kampfIdMap = new Map();
    for (const k of kaempfe) {
        const neuerKaempfer1Id = k.kaempfer1_id != null ? (teilnehmerIdMap.get(k.kaempfer1_id) ?? null) : null;
        const neuerKaempfer2Id = k.kaempfer2_id != null ? (teilnehmerIdMap.get(k.kaempfer2_id) ?? null) : null;
        const [neueIdObj] = await trx('kaempfe').insert({
            pool_id: poolIdMap.get(k.pool_id),
            kaempfer1_id: neuerKaempfer1Id,
            kaempfer2_id: neuerKaempfer2Id,
            sieger_id: k.sieger_id != null ? (teilnehmerIdMap.get(k.sieger_id) ?? null) : null,
            kampfzeit_in_sekunden: k.kampfzeit_in_sekunden || 0,
            unterbewertung_kaempfer1: k.unterbewertung_kaempfer1 || 0,
            unterbewertung_kaempfer2: k.unterbewertung_kaempfer2 || 0,
            status: normalisiereKampfStatus(k.status, neuerKaempfer1Id, neuerKaempfer2Id),
            reihenfolge_nummer: k.reihenfolge_nummer ?? null,
            matten_reihenfolge: k.matten_reihenfolge ?? null,
            gruppe: k.gruppe ?? null
        }).returning('id');
        kampfIdMap.set(k.id, typeof neueIdObj === 'object' ? neueIdObj.id : neueIdObj);
    }

    for (const k of kaempfe) {
        if (k.kaempfer1_quelle_kampf_id == null && k.kaempfer2_quelle_kampf_id == null) continue;

        await trx('kaempfe').where({ id: kampfIdMap.get(k.id) }).update({
            kaempfer1_quelle_kampf_id: k.kaempfer1_quelle_kampf_id != null ? (kampfIdMap.get(k.kaempfer1_quelle_kampf_id) ?? null) : null,
            kaempfer1_quelle_typ: k.kaempfer1_quelle_typ ?? null,
            kaempfer2_quelle_kampf_id: k.kaempfer2_quelle_kampf_id != null ? (kampfIdMap.get(k.kaempfer2_quelle_kampf_id) ?? null) : null,
            kaempfer2_quelle_typ: k.kaempfer2_quelle_typ ?? null
        });
    }
}

// Gegenstück zu exportTurnier: importiert eine zuvor exportierte Turnier-JSON-Datei als
// komplett NEUES Turnier mit frischen IDs. Ausschließlich im Offline-Modus verfügbar. Löscht
// dabei ALLE bestehenden Turniere (samt Pools/Kämpfe/Teilnehmer/Kampfflächen) aus der lokalen
// SQLite-DB, da der Offline-Kiosk-Betrieb von genau einem aktiven Turnier ausgeht — der
// Aufrufer muss das vorher bestätigen lassen (siehe Bestätigungsdialog in turniere.html).
export async function importTurnier(knex, req, res) {
    try {
        if (process.env.IS_OFFLINE !== 'true') {
            return res.status(403).json({ success: false, error: 'Der Turnier-Import ist nur im Offline-Modus verfügbar.' });
        }

        const { contentBase64 } = req.body;
        if (!contentBase64) {
            return res.status(400).json({ success: false, error: 'Dateiinhalt ist erforderlich.' });
        }

        let daten;
        try {
            const jsonStr = Buffer.from(contentBase64, 'base64').toString('utf-8');
            daten = JSON.parse(jsonStr);
        } catch (e) {
            return res.status(400).json({ success: false, error: 'Datei konnte nicht gelesen werden: ' + e.message });
        }

        const t = daten && daten.turnier;
        const kampfflaechen = (daten && daten.kampfflaechen) || [];
        const pools = (daten && daten.pools) || [];
        const teilnehmer = (daten && daten.teilnehmer) || [];
        const kaempfe = (daten && daten.kaempfe) || [];

        if (!t || !t.bezeichnung || !t.ort || !t.datum || !t.ausrichter) {
            return res.status(400).json({ success: false, error: 'Ungültiges Import-Format: Turnier-Pflichtfelder (Bezeichnung, Ort, Datum, Ausrichter) fehlen.' });
        }

        let ak = t.altersklassen;
        if (typeof ak === 'string') {
            try { ak = JSON.parse(ak); } catch (e) { ak = []; }
        }

        const neuesTurnierId = await knex.transaction(async (trx) => {
            // Der Offline-Kiosk-Betrieb geht von genau einem aktiven Turnier aus (siehe
            // automatische Turnier-Auswahl in turniere.html) — vor dem Import wird die
            // SQLite-Datenbank daher komplett von alten Turnierdaten geleert.
            await trx('kaempfe').del();
            await trx('turnier_teilnehmer').del();
            await trx('pools').del();
            await trx('kampfflaechen').del();
            await trx('turniere').del();

            // Verein anhand des Ausrichter-Namens wiederverwenden/anlegen (analog zur
            // rückwirkenden Verknüpfung in link_turniere_zu_vereine-Migration).
            let verein = await trx('vereine').where({ name: t.ausrichter }).first();
            if (!verein) {
                const [insertedId] = await trx('vereine').insert({ name: t.ausrichter }).returning('id');
                verein = { id: typeof insertedId === 'object' ? insertedId.id : insertedId };
            }

            const [turnierIdObj] = await trx('turniere').insert({
                bezeichnung: t.bezeichnung,
                ort: t.ort,
                datum: t.datum,
                ausrichter: t.ausrichter,
                nutze_gewichtsklassen: t.nutze_gewichtsklassen ? 1 : 0,
                anzahl_kampfflaechen: kampfflaechen.length || parseInt(t.anzahl_kampfflaechen, 10) || 1,
                bundesland: t.bundesland || null,
                altersklassen: JSON.stringify(ak || {}),
                status: GUELTIGE_STATUS_WERTE.includes(t.status) ? t.status : 'entwurf',
                anmeldeschluss: t.anmeldeschluss || null,
                startgeld: t.startgeld !== undefined && t.startgeld !== '' ? parseFloat(t.startgeld) : null,
                iban: t.iban || null,
                kontoinhaber: t.kontoinhaber || null,
                verwendungszweck: t.verwendungszweck || null,
                verein_id: verein.id
            }).returning('id');
            const turnierId = typeof turnierIdObj === 'object' ? turnierIdObj.id : turnierIdObj;

            await importWettkampfdaten(trx, turnierId, { kampfflaechen, pools, teilnehmer, kaempfe });

            return turnierId;
        });

        return res.status(201).json({
            success: true,
            turnierId: neuesTurnierId,
            imported: {
                kampfflaechen: kampfflaechen.length,
                pools: pools.length,
                teilnehmer: teilnehmer.length,
                kaempfe: kaempfe.length
            }
        });
    } catch (error) {
        console.error('[Turnier-Import-Fehler]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Lädt die Ergebnisse eines Turniers hoch, das offline durchgeführt wurde, und ersetzt DAMIT
// NUR die Wettkampfdaten (Kampfflächen/Pools/Teilnehmer/Kämpfe) DIESES EINEN, bereits online
// bestehenden Turniers. Ausschließlich online und nur für Mitglieder des ausrichtenden Vereins
// (Gegenteil von importTurnier: rührt turniere/benutzer/vereine nicht an, löscht nichts
// anderes). Schützt per Turnier-ID-Abgleich davor, versehentlich die falsche Datei hochzuladen.
export async function importTurnierErgebnisse(knex, req, res) {
    try {
        if (process.env.IS_OFFLINE === 'true') {
            return res.status(403).json({ success: false, error: 'Der Ergebnis-Upload ist nur im Online-Modus verfügbar.' });
        }

        const turnierId = parseInt(req.params.id, 10);
        const turnier = await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfeVorUpload = await turnierHatEchteKaempfe(knex, turnierId);
        const statusVorUpload = ermittleEffektivenStatus(turnier, { hatEchteKaempfe: hatEchteKaempfeVorUpload });
        if (!['anmeldung_geschlossen', 'in_durchfuehrung'].includes(statusVorUpload)) {
            return res.status(403).json({ success: false, error: 'Ergebnisse können erst hochgeladen werden, wenn die Anmeldefrist abgelaufen ist. Ein bereits abgeschlossenes Turnier ist schreibgeschützt.' });
        }

        const user = await knex('benutzer').where({ id: req.user.id }).first();
        if (!user || !hatVereinsZugriffAufTurnier(user, turnier)) {
            return res.status(403).json({ success: false, error: 'Nur freigegebene Mitglieder des ausrichtenden Vereins dürfen Ergebnisse hochladen.' });
        }

        const { contentBase64 } = req.body;
        if (!contentBase64) {
            return res.status(400).json({ success: false, error: 'Dateiinhalt ist erforderlich.' });
        }

        let daten;
        try {
            const jsonStr = Buffer.from(contentBase64, 'base64').toString('utf-8');
            daten = JSON.parse(jsonStr);
        } catch (e) {
            return res.status(400).json({ success: false, error: 'Datei konnte nicht gelesen werden: ' + e.message });
        }

        const t = daten && daten.turnier;
        if (!t || t.id == null) {
            return res.status(400).json({ success: false, error: 'Ungültiges Import-Format: Turnier-ID fehlt in der Datei.' });
        }
        if (parseInt(t.id, 10) !== turnierId) {
            return res.status(400).json({
                success: false,
                error: `Die Datei gehört zu Turnier-ID ${t.id}, nicht zum ausgewählten Turnier (ID ${turnierId}).`
            });
        }

        const kampfflaechen = (daten && daten.kampfflaechen) || [];
        const pools = (daten && daten.pools) || [];
        const teilnehmer = (daten && daten.teilnehmer) || [];
        const kaempfe = (daten && daten.kaempfe) || [];

        await knex.transaction(async (trx) => {
            // Nur die Wettkampfdaten DIESES Turniers ersetzen — turniere/benutzer/vereine
            // bleiben unangetastet, andere Turniere sind von dieser Löschung nicht betroffen.
            const altePools = await trx('pools').where({ turnier_id: turnierId }).select('id');
            const altePoolIds = altePools.map(p => p.id);
            if (altePoolIds.length > 0) {
                await trx('kaempfe').whereIn('pool_id', altePoolIds).del();
            }
            await trx('turnier_teilnehmer').where({ turnier_id: turnierId }).del();
            await trx('pools').where({ turnier_id: turnierId }).del();
            await trx('kampfflaechen').where({ turnier_id: turnierId }).del();

            await importWettkampfdaten(trx, turnierId, { kampfflaechen, pools, teilnehmer, kaempfe });

            // Automatischer Übergang in den Archiv-Zustand (Zustand 5: "wird automatisch durch
            // den Upload der Ergebnisdaten ... ausgelöst").
            await trx('turniere').where({ id: turnierId }).update({ status: 'abgeschlossen', updated_at: trx.fn.now() });
        });

        return res.json({
            success: true,
            turnierId,
            imported: {
                kampfflaechen: kampfflaechen.length,
                pools: pools.length,
                teilnehmer: teilnehmer.length,
                kaempfe: kaempfe.length
            }
        });
    } catch (error) {
        console.error('[Turnier-Ergebnisse-Upload-Fehler]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function exportTurnier(knex, req, res) {
    try {
        const turnierId = parseInt(req.params.id);
        const turnier = await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnierId);
        const statusEffektiv = ermittleEffektivenStatus(turnier, { hatEchteKaempfe });
        if (!['anmeldung_geschlossen', 'in_durchfuehrung', 'abgeschlossen'].includes(statusEffektiv)) {
            return res.status(403).json({ success: false, error: 'Das Turnier kann erst exportiert werden, wenn die Anmeldefrist abgelaufen ist.' });
        }

        const user = await knex('benutzer').where({ id: req.user.id }).first();
        const hatZugriff = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);

        if (!hatZugriff) {
            return res.status(403).json({ success: false, error: 'Nur freigegebene Mitglieder des ausrichtenden Vereins dürfen das Turnier exportieren.' });
        }

        const kampfflaechen = await knex('kampfflaechen').where({ turnier_id: turnierId }).orderBy('id', 'asc');
        const pools = await knex('pools').where({ turnier_id: turnierId }).orderBy('id', 'asc');
        const teilnehmer = await knex('turnier_teilnehmer').where({ turnier_id: turnierId }).orderBy('id', 'asc');

        const poolIds = pools.map(p => p.id);
        const kaempfe = poolIds.length > 0
            ? await knex('kaempfe').whereIn('pool_id', poolIds).orderBy('id', 'asc')
            : [];

        let ak = turnier.altersklassen;
        if (typeof ak === 'string') {
            try {
                ak = JSON.parse(ak);
            } catch (e) {
                ak = ak ? ak.split(',') : [];
            }
        }

        const exportData = {
            exportiert_am: new Date().toISOString(),
            turnier: { ...turnier, altersklassen: ak || [] },
            kampfflaechen,
            pools,
            teilnehmer,
            kaempfe
        };

        const dateiname = `turnier_${turnierId}_export_${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
        res.send(JSON.stringify(exportData, null, 2));
    } catch (error) {
        console.error('[Turnier-Export-Fehler]:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

async function synchronisiereKampfflaechen(knex, turnierId, anzahl) {
    const aktuelleMatten = await knex('kampfflaechen')
        .where({ turnier_id: turnierId })
        .orderBy('id', 'asc');

    const aktuelleAnzahl = aktuelleMatten.length;

    if (aktuelleAnzahl < anzahl) {
        for (let i = aktuelleAnzahl + 1; i <= anzahl; i++) {
            await knex('kampfflaechen').insert({
                turnier_id: turnierId,
                bezeichnung: `Matte ${i}`
            });
        }
    } else if (aktuelleAnzahl > anzahl) {
        const mattenZuLoeschen = aktuelleMatten.slice(anzahl);
        const idsZuLoeschen = mattenZuLoeschen.map(m => m.id);
        await knex('kampfflaechen')
            .whereIn('id', idsZuLoeschen)
            .del();
    }
}
