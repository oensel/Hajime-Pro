import { randomUUID } from 'node:crypto';
import { createTurnierRepository } from '../../db/repositories/turnierRepository.js';
import { createTurnierTeilnehmerRepository } from '../../db/repositories/turnierTeilnehmerRepository.js';
import { createKampfflaechenRepository } from '../../db/repositories/kampfflaechenRepository.js';
import { createPoolsRepository } from '../../db/repositories/poolsRepository.js';
import { createKaempfeRepository } from '../../db/repositories/kaempfeRepository.js';
import { pruefeHatEchteKaempfe } from '../../db/offline/turnierStatusPruefung.js';
import { ermittleEffektivenStatus, validiereZahlungsdaten, GUELTIGE_STATUS_WERTE } from '../../shared/turnierRegeln.js';
import { OFFLINE_VEREIN_ID } from '../../db/offline/offlineAccounts.js';
import { entfernungZuPlzInKm } from '../../utils/entfernungHelper.js';
import { createMannschaftenRepository } from '../../db/repositories/mannschaftenRepository.js';
import { createMannschaftMitgliederRepository } from '../../db/repositories/mannschaftMitgliederRepository.js';
import { importiereWettkampfdaten, exportiereWettkampfdaten } from '../../db/offline/turnierWettkampfdaten.js';

async function ladeStatusEffektiv(db, turnier) {
    const hatEchteKaempfe = await pruefeHatEchteKaempfe(createPoolsRepository(db), createKaempfeRepository(db));
    return ermittleEffektivenStatus(turnier, { hatEchteKaempfe });
}

// Analog zur bisherigen Knex-Logik in turnierController.js: gleicht die Anzahl der
// Kampfflächen-Dokumente an die gewünschte Anzahl an (auffüllen mit "Matte N" oder die
// überzähligen letzten Matten entfernen).
async function synchronisiereKampfflaechen(db, anzahl) {
    const kampfflaechenRepository = createKampfflaechenRepository(db);
    const aktuelleMatten = await kampfflaechenRepository.findAll();
    const aktuelleAnzahl = aktuelleMatten.length;

    if (aktuelleAnzahl < anzahl) {
        for (let i = aktuelleAnzahl + 1; i <= anzahl; i++) {
            await kampfflaechenRepository.create({ bezeichnung: `Matte ${i}` });
        }
    } else if (aktuelleAnzahl > anzahl) {
        // Nach der Matten-Nummer sortieren statt der von findAll() gelieferten
        // created_at-Reihenfolge zu vertrauen -- bei sehr schnell aufeinanderfolgenden
        // Erstellungen (gleiche Millisekunde) wäre die Zeitstempel-Reihenfolge sonst nicht
        // eindeutig.
        const nachNummerSortiert = [...aktuelleMatten].sort((a, b) => {
            const nummerA = parseInt((a.bezeichnung || '').replace(/\D/g, ''), 10) || 0;
            const nummerB = parseInt((b.bezeichnung || '').replace(/\D/g, ''), 10) || 0;
            return nummerA - nummerB;
        });
        const mattenZuLoeschen = nachNummerSortiert.slice(anzahl);
        for (const matte of mattenZuLoeschen) {
            await kampfflaechenRepository.remove(matte._id);
        }
    }
}

function leseFormularFelder(body) {
    const { bezeichnung, ort, datum, ausrichter, anzahl_kampfflaechen, nutze_gewichtsklassen, bundesland, plz, altersklassen, mannschafts_altersklassen, anmeldeschluss, startgeld, iban, kontoinhaber, verwendungszweck } = body;
    return {
        bezeichnung, ort, datum, ausrichter,
        anzahl_kampfflaechen: parseInt(anzahl_kampfflaechen) || 1,
        // Sicherer Check: Akzeptiert die Zahl 1, den String "1" oder das Boolean true
        nutze_gewichtsklassen: nutze_gewichtsklassen === 1 || nutze_gewichtsklassen === true || nutze_gewichtsklassen === '1' || nutze_gewichtsklassen === 'true',
        bundesland: bundesland || null,
        plz: plz || null,
        altersklassen: altersklassen || {},
        mannschafts_altersklassen: mannschafts_altersklassen || [],
        anmeldeschluss: anmeldeschluss || null,
        startgeld: startgeld !== undefined && startgeld !== '' ? parseInt(startgeld, 10) : null,
        iban: iban || null,
        kontoinhaber: kontoinhaber || null,
        verwendungszweck: verwendungszweck || null
    };
}

export async function createTurnier(turnierDbRegistry, req, res) {
    try {
        const { startgeld, iban, kontoinhaber, verwendungszweck } = req.body;
        const zahlungsFehler = validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck);
        if (zahlungsFehler) {
            return res.status(400).json({ success: false, error: zahlungsFehler });
        }

        const felder = leseFormularFelder(req.body);
        const turnierId = randomUUID();
        const db = await turnierDbRegistry.openTurnierDb(turnierId);

        await createTurnierRepository(db).save({ ...felder, status: 'entwurf', verein_id: OFFLINE_VEREIN_ID });
        await synchronisiereKampfflaechen(db, felder.anzahl_kampfflaechen);

        res.status(201).json({ success: true, turnierId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function updateTurnier(turnierDbRegistry, req, res) {
    try {
        const { startgeld, iban, kontoinhaber, verwendungszweck } = req.body;
        const zahlungsFehler = validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck);
        if (zahlungsFehler) {
            return res.status(400).json({ success: false, error: zahlungsFehler });
        }

        const { id } = req.params;
        const db = turnierDbRegistry.useTurnierDb(id);
        const turnierRepository = createTurnierRepository(db);
        const bestehendesTurnier = await turnierRepository.get();
        if (!bestehendesTurnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        if (bestehendesTurnier.status === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein abgeschlossenes Turnier befindet sich im schreibgeschützten Archiv-Zustand.' });
        }

        const felder = leseFormularFelder(req.body);
        // verein_id wird hier absichtlich nicht angefasst -- spread von bestehendesTurnier
        // VOR den neuen Feldern erhält es unverändert (analog zur bisherigen Knex-Logik).
        await turnierRepository.save({ ...bestehendesTurnier, ...felder, updated_at: new Date().toISOString() });
        await synchronisiereKampfflaechen(db, felder.anzahl_kampfflaechen);

        res.json({ success: true, message: 'Turnier erfolgreich aktualisiert.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function getTurnier(turnierDbRegistry, req, res) {
    try {
        const db = turnierDbRegistry.useTurnierDb(req.params.id);
        const turnier = await createTurnierRepository(db).get();
        if (!turnier) return res.status(404).json({ error: 'Turnier nicht gefunden.' });

        const statusEffektiv = await ladeStatusEffektiv(db, turnier);
        const teilnehmerAnzahl = (await createTurnierTeilnehmerRepository(db).findAll()).length;

        res.json({ ...turnier, id: req.params.id, status_effektiv: statusEffektiv, teilnehmer_anzahl: teilnehmerAnzahl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getTurniere(turnierDbRegistry, req, res) {
    try {
        const { zukuenftig, lat, lon } = req.query;
        const turnierIds = await turnierDbRegistry.listTurnierIds();

        const turniere = [];
        for (const turnierId of turnierIds) {
            const db = turnierDbRegistry.useTurnierDb(turnierId);
            const turnier = await createTurnierRepository(db).get();
            if (!turnier) continue;
            const teilnehmerAnzahl = (await createTurnierTeilnehmerRepository(db).findAll()).length;
            // Listen-Badge: ohne hatEchteKaempfe berechnet, um N+1-Abfragen zu vermeiden --
            // pruefeHatEchteKaempfe lädt pro Turnier erst alle Pools und dann alle Kämpfe je
            // Pool, was bei dieser Listenansicht für JEDES Turnier einmal anfallen würde.
            // Kann "in_durchfuehrung" in einem schmalen Edge-Fall (Wettkampftag noch nicht
            // erreicht, aber schon echte Kämpfe gestartet) kurz verzögert zeigen; die exakte,
            // gate-relevante Berechnung erfolgt in getTurnier (Einzelabruf).
            turniere.push({
                ...turnier,
                id: turnierId,
                teilnehmer_anzahl: teilnehmerAnzahl,
                status_effektiv: ermittleEffektivenStatus(turnier),
                entfernung_km: entfernungZuPlzInKm(turnier.plz, lat, lon)
            });
        }

        let ergebnis = turniere;
        if (zukuenftig === 'true') {
            const jetzt = new Date();
            const heuteStr = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`;
            ergebnis = ergebnis.filter((t) => (t.datum && t.datum >= heuteStr) || t.status === 'entwurf');
        }

        ergebnis.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
        res.json(ergebnis);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function deleteTurnier(turnierDbRegistry, req, res) {
    try {
        const { id } = req.params;
        const db = turnierDbRegistry.useTurnierDb(id);
        const turnier = await createTurnierRepository(db).get();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const statusEffektiv = await ladeStatusEffektiv(db, turnier);
        if (statusEffektiv === 'in_durchfuehrung' || statusEffektiv === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein Turnier in Durchführung oder abgeschlossenes Turnier kann nicht gelöscht werden.' });
        }

        const teilnehmerAnzahl = (await createTurnierTeilnehmerRepository(db).findAll()).length;
        if (teilnehmerAnzahl > 0) {
            return res.status(409).json({ success: false, error: 'Ein Turnier mit angemeldeten Teilnehmern kann nicht gelöscht werden.' });
        }

        await turnierDbRegistry.deleteTurnierDb(id);
        res.json({ success: true, message: 'Turnier erfolgreich gelöscht.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function veroeffentlicheTurnier(turnierDbRegistry, req, res) {
    try {
        const db = turnierDbRegistry.useTurnierDb(req.params.id);
        const turnierRepository = createTurnierRepository(db);
        const turnier = await turnierRepository.get();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        if (turnier.status !== 'entwurf') {
            return res.status(400).json({ success: false, error: 'Nur Turniere im Entwurf können veröffentlicht werden.' });
        }

        await turnierRepository.save({ ...turnier, status: 'veroeffentlicht', updated_at: new Date().toISOString() });
        res.json({ success: true, message: 'Turnier erfolgreich veröffentlicht.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function sageTurnierAb(turnierDbRegistry, req, res) {
    try {
        const db = turnierDbRegistry.useTurnierDb(req.params.id);
        const turnierRepository = createTurnierRepository(db);
        const turnier = await turnierRepository.get();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        if (turnier.status === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein bereits abgeschlossenes Turnier kann nicht mehr abgesagt werden.' });
        }

        await turnierRepository.save({ ...turnier, status: 'abgesagt', updated_at: new Date().toISOString() });
        res.json({ success: true, message: 'Turnier erfolgreich abgesagt.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function beendeDurchfuehrung(turnierDbRegistry, req, res) {
    try {
        const db = turnierDbRegistry.useTurnierDb(req.params.id);
        const turnierRepository = createTurnierRepository(db);
        const turnier = await turnierRepository.get();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const statusEffektiv = await ladeStatusEffektiv(db, turnier);
        if (statusEffektiv !== 'in_durchfuehrung') {
            return res.status(403).json({ success: false, error: 'Nur ein Turnier in Durchführung kann als beendet markiert werden.' });
        }

        await turnierRepository.save({ ...turnier, status: 'abgeschlossen', updated_at: new Date().toISOString() });
        res.json({ success: true, message: 'Durchführung erfolgreich beendet.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

function baueWettkampfdatenRepos(db) {
    return {
        kampfflaechenRepository: createKampfflaechenRepository(db),
        poolsRepository: createPoolsRepository(db),
        turnierTeilnehmerRepository: createTurnierTeilnehmerRepository(db),
        kaempfeRepository: createKaempfeRepository(db),
        mannschaftenRepository: createMannschaftenRepository(db),
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db)
    };
}

// Gegenstück zu importTurnier in src/controllers/turnierController.js: importiert eine
// zuvor exportierte Turnier-JSON als komplett NEUES Turnier mit frischen IDs. Der
// Offline-Kiosk-Betrieb geht von genau einem aktiven Turnier aus -- alle anderen lokal
// vorhandenen Turnier-Datenbanken werden entfernt, aber ERST NACHDEM das neue Turnier
// erfolgreich angelegt und befüllt wurde (Rollback-Analogon zur SQL-Transaktion des
// Knex-Originals): ein fehlerhaftes Import-File darf das bestehende, funktionierende
// Turnier nicht antasten.
export async function importTurnier(turnierDbRegistry, req, res) {
    try {
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
        if (!t || !t.bezeichnung || !t.ort || !t.datum || !t.ausrichter) {
            return res.status(400).json({ success: false, error: 'Ungültiges Import-Format: Turnier-Pflichtfelder (Bezeichnung, Ort, Datum, Ausrichter) fehlen.' });
        }

        for (const feld of ['kampfflaechen', 'pools', 'teilnehmer', 'kaempfe', 'mannschaften', 'mannschaft_mitglieder']) {
            if (daten[feld] !== undefined && !Array.isArray(daten[feld])) {
                return res.status(400).json({ success: false, error: `Ungültiges Import-Format: "${feld}" muss ein Array sein.` });
            }
        }

        let ak = t.altersklassen;
        if (typeof ak === 'string') {
            try { ak = JSON.parse(ak); } catch (e) { ak = []; }
        }
        let mak = t.mannschafts_altersklassen;
        if (typeof mak === 'string') {
            try { mak = JSON.parse(mak); } catch (e) { mak = []; }
        }

        const kampfflaechen = (daten && daten.kampfflaechen) || [];
        const pools = (daten && daten.pools) || [];
        const teilnehmer = (daten && daten.teilnehmer) || [];
        const kaempfe = (daten && daten.kaempfe) || [];
        const mannschaften = (daten && daten.mannschaften) || [];
        const mannschaftMitglieder = (daten && daten.mannschaft_mitglieder) || [];

        const turnierId = randomUUID();
        const db = await turnierDbRegistry.openTurnierDb(turnierId);

        let importiert;
        try {
            await createTurnierRepository(db).save({
                bezeichnung: t.bezeichnung,
                ort: t.ort,
                datum: t.datum,
                ausrichter: t.ausrichter,
                nutze_gewichtsklassen: !!t.nutze_gewichtsklassen,
                anzahl_kampfflaechen: kampfflaechen.length || parseInt(t.anzahl_kampfflaechen, 10) || 1,
                bundesland: t.bundesland || null,
                plz: t.plz || null,
                ausschreibung_pdf_base64: t.ausschreibung_pdf_base64 || null,
                ausschreibung_dateiname: t.ausschreibung_pdf_base64 ? (t.ausschreibung_dateiname || 'Ausschreibung.pdf') : null,
                altersklassen: ak || {},
                mannschafts_altersklassen: mak || [],
                status: GUELTIGE_STATUS_WERTE.includes(t.status) ? t.status : 'entwurf',
                anmeldeschluss: t.anmeldeschluss || null,
                startgeld: t.startgeld !== undefined && t.startgeld !== '' ? parseFloat(t.startgeld) : null,
                iban: t.iban || null,
                kontoinhaber: t.kontoinhaber || null,
                verwendungszweck: t.verwendungszweck || null,
                verein_id: OFFLINE_VEREIN_ID,
                urspruengliche_id: t.urspruengliche_id ?? t.id ?? null
            });

            importiert = await importiereWettkampfdaten(baueWettkampfdatenRepos(db), { kampfflaechen, pools, teilnehmer, kaempfe, mannschaften, mannschaft_mitglieder: mannschaftMitglieder });
        } catch (importFehler) {
            // Rollback: die neu angelegte, aber unvollständige Turnier-Datenbank entfernen --
            // bestehende Turniere dürfen bei einem fehlerhaften Import nicht angetastet
            // werden (Verhaltensparität mit der SQL-Transaktion des Knex-Originals).
            await turnierDbRegistry.deleteTurnierDb(turnierId);
            throw importFehler;
        }

        // Der Offline-Kiosk-Betrieb geht von genau einem aktiven Turnier aus -- erst NACH
        // erfolgreichem Import werden alle ANDEREN bestehenden Turnier-Datenbanken entfernt.
        const bestehendeIds = await turnierDbRegistry.listTurnierIds();
        for (const id of bestehendeIds) {
            if (id !== turnierId) {
                await turnierDbRegistry.deleteTurnierDb(id);
            }
        }

        return res.status(201).json({ success: true, turnierId, imported: importiert });
    } catch (error) {
        console.error('[Offline-Turnier-Import-Fehler]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Gegenstück zu exportTurnier in src/controllers/turnierController.js: liefert die
// Wettkampfdaten eines Turniers als JSON-Datei-Download. Kein Vereinszugriffs-Check
// (Offline ist Single-Tenant) -- nur die Anmeldefrist-Sperre bleibt bestehen.
export async function exportTurnier(turnierDbRegistry, req, res) {
    try {
        const turnierId = req.params.id;
        const db = await turnierDbRegistry.useTurnierDb(turnierId);
        const turnier = await createTurnierRepository(db).get();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const statusEffektiv = await ladeStatusEffektiv(db, turnier);
        if (!['anmeldung_geschlossen', 'in_durchfuehrung', 'abgeschlossen'].includes(statusEffektiv)) {
            return res.status(403).json({ success: false, error: 'Das Turnier kann erst exportiert werden, wenn die Anmeldefrist abgelaufen ist.' });
        }

        const wettkampfdaten = await exportiereWettkampfdaten(baueWettkampfdatenRepos(db));

        const exportData = {
            exportiert_am: new Date().toISOString(),
            turnier: { ...turnier, id: turnierId },
            ...wettkampfdaten
        };

        const dateiname = `turnier_${turnierId}_export_${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
        res.send(JSON.stringify(exportData, null, 2));
    } catch (error) {
        console.error('[Offline-Turnier-Export-Fehler]:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}
