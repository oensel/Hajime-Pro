import { randomUUID } from 'node:crypto';
import { createTurnierRepository } from '../../db/repositories/turnierRepository.js';
import { createTurnierTeilnehmerRepository } from '../../db/repositories/turnierTeilnehmerRepository.js';
import { createKampfflaechenRepository } from '../../db/repositories/kampfflaechenRepository.js';
import { createPoolsRepository } from '../../db/repositories/poolsRepository.js';
import { createKaempfeRepository } from '../../db/repositories/kaempfeRepository.js';
import { pruefeHatEchteKaempfe } from '../../db/offline/turnierStatusPruefung.js';
import { ermittleEffektivenStatus, validiereZahlungsdaten } from '../../shared/turnierRegeln.js';
import { entfernungZuPlzInKm } from '../../utils/entfernungHelper.js';

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
        const mattenZuLoeschen = aktuelleMatten.slice(anzahl);
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

        await createTurnierRepository(db).save({ ...felder, status: 'entwurf' });
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
        const db = await turnierDbRegistry.openTurnierDb(id);
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
        const db = await turnierDbRegistry.openTurnierDb(req.params.id);
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
            const db = await turnierDbRegistry.openTurnierDb(turnierId);
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
        const db = await turnierDbRegistry.openTurnierDb(id);
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
        const db = await turnierDbRegistry.openTurnierDb(req.params.id);
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
        const db = await turnierDbRegistry.openTurnierDb(req.params.id);
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
        const db = await turnierDbRegistry.openTurnierDb(req.params.id);
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
