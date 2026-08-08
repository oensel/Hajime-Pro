import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveUserVereinName, hatVereinsZugriffAufTurnier, ladeBenutzerMitAktivemVerein } from '../utils/vereinHelper.js';
import { turnierHatEchteKaempfe, poolHatBereitsEchteKaempfe, regeneriereMannschaftsPool, ermittleGoldenScoreEinstellungen } from './poolController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DJB_ALTERSKLASSEN = JSON.parse(readFileSync(path.join(__dirname, '../config/altersklassen.json'), 'utf-8'));

// Gleiches Zugriffsmuster wie teilnehmerController.js (bewusst KEIN
// requireTournamentEditAccess auf den Mannschafts-Routen): Mitglieder des ausrichtenden
// Vereins dürfen alles, Gastvereine dürfen ausschließlich ihre eigene Mannschaft anlegen/
// pflegen — ein Gastverein braucht sonst keine Bearbeitungsrechte auf das gesamte Turnier.
const TEILNEHMERLISTE_GESPERRT_FEHLER = 'Mannschaften können nicht mehr geändert werden, da für dieses Turnier bereits Kämpfe stattgefunden haben.';

// Ordnet ein Gewicht der passenden Gewichtsklassen-Position EINES KONKRETEN POOLS zu (kleinste
// "-X"-Position, die das Gewicht noch aufnimmt, sonst die "+X"-Schwergewichts-Position) — anders
// als ermittleGewichtsklasse() in teilnehmerController.js (das gegen die DJB-Tabellen-Vorlage
// rechnet) hier direkt gegen die tatsächlichen, ggf. frei editierten Positionen des Pools, damit
// die Gewichtsklasse eines Mitglieds immer eine der wirklich für diesen Pool gültigen Optionen ist.
function ordnePositionZuGewicht(gewicht, gewichtsklassenListe) {
    if (!gewicht || gewicht <= 0 || !Array.isArray(gewichtsklassenListe) || gewichtsklassenListe.length === 0) return null;

    const plusKlasse = gewichtsklassenListe.find(g => g.startsWith('+'));
    const minusKlassen = gewichtsklassenListe
        .filter(g => g.startsWith('-'))
        .map(g => ({ label: g, wert: parseFloat(g.replace('-', '')) }))
        .filter(k => !Number.isNaN(k.wert))
        .sort((a, b) => a.wert - b.wert);

    const passende = minusKlassen.find(k => gewicht <= k.wert);
    if (passende) return passende.label;
    return plusKlasse || gewichtsklassenListe[gewichtsklassenListe.length - 1] || null;
}

function parsePoolGewichtsklassen(pool) {
    if (!pool) return [];
    try {
        const liste = JSON.parse(pool.mannschafts_gewichtsklassen || '[]');
        return Array.isArray(liste) ? liste : [];
    } catch (e) {
        return [];
    }
}

// Ordnet allen Mitgliedern einer Mannschaft die Gewichtsklassen-Position gemäß der übergebenen
// Pool-Positionsliste neu zu (anhand des tatsächlichen Gewichts) — aufgerufen, sobald ein Team
// (neu oder bestehend) einem Pool mit definierten Positionen zugeordnet wird, damit die Position
// immer aus den echten Optionen des Pools stammt statt aus einer Import-Zeitpunkt-Schätzung.
async function aktualisierePositionenFuerMannschaft(knex, mannschaftId, gewichtsklassenListe) {
    if (!Array.isArray(gewichtsklassenListe) || gewichtsklassenListe.length === 0) return;

    const mitglieder = await knex('mannschaft_mitglieder')
        .where({ mannschaft_id: mannschaftId })
        .join('turnier_teilnehmer', 'mannschaft_mitglieder.turnier_teilnehmer_id', '=', 'turnier_teilnehmer.id')
        .select('mannschaft_mitglieder.id', 'turnier_teilnehmer.gewicht');

    for (const m of mitglieder) {
        const position = ordnePositionZuGewicht(parseFloat(m.gewicht), gewichtsklassenListe);
        if (position) {
            await knex('mannschaft_mitglieder').where({ id: m.id }).update({ gewichtsklasse: position, updated_at: knex.fn.now() });
        }
    }
}

export async function createMannschaft(knex, req, res) {
    try {
        const { turnier_id, pool_id, verein, bezeichnung } = req.body;

        const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
        if (!user) {
            return res.status(401).json({ success: false, error: 'Benutzerprofil nicht gefunden.' });
        }

        const turnier = await knex('turniere').where({ id: parseInt(turnier_id) }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnier.id);
        if (hatEchteKaempfe) {
            return res.status(409).json({ success: false, error: TEILNEHMERLISTE_GESPERRT_FEHLER });
        }

        const istGastgeberVerein = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);
        const userVereinName = await resolveUserVereinName(knex, user);

        if (!turnier_id || !bezeichnung || (!istGastgeberVerein && !verein)) {
            return res.status(400).json({ success: false, error: 'Fehlende Pflichtfelder (Turnier-ID, Bezeichnung, Verein).' });
        }

        if (!istGastgeberVerein) {
            if (!userVereinName) {
                return res.status(400).json({ success: false, error: 'Bitte tragen Sie zuerst Ihren Verein im Profil ein.' });
            }
            if (verein !== userVereinName) {
                return res.status(403).json({ success: false, error: `Sie dürfen nur Mannschaften für Ihren eigenen Verein (${userVereinName}) anmelden.` });
            }
        }

        const [idObj] = await knex('mannschaften').insert({
            turnier_id: parseInt(turnier_id),
            pool_id: pool_id ? parseInt(pool_id) : null,
            verein: verein || userVereinName,
            bezeichnung
        }).returning('id');

        const mannschaftId = typeof idObj === 'object' ? idObj.id : idObj;

        if (pool_id) {
            await regeneriereMannschaftsPool(knex, parseInt(pool_id));
        }

        return res.status(201).json({ success: true, mannschaftId });
    } catch (error) {
        console.error('[Backend-Fehler Mannschaft anlegen]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getMannschaftenByTurnier(knex, req, res) {
    try {
        const { turnierId, poolId } = req.query;
        if (!turnierId && !poolId) {
            return res.status(400).json({ success: false, error: 'Parameter turnierId oder poolId wird benötigt.' });
        }

        let query = knex('mannschaften');
        if (poolId) query = query.where({ pool_id: parseInt(poolId) });
        else query = query.where({ turnier_id: parseInt(turnierId) });

        const mannschaften = await query.orderBy('id', 'asc');
        const mannschaftIds = mannschaften.map(m => m.id);
        const mitglieder = mannschaftIds.length > 0
            ? await knex('mannschaft_mitglieder')
                .whereIn('mannschaft_id', mannschaftIds)
                .join('turnier_teilnehmer', 'mannschaft_mitglieder.turnier_teilnehmer_id', '=', 'turnier_teilnehmer.id')
                .select(
                    'mannschaft_mitglieder.*',
                    'turnier_teilnehmer.vorname', 'turnier_teilnehmer.nachname',
                    'turnier_teilnehmer.gewicht', 'turnier_teilnehmer.judopass_id',
                    'turnier_teilnehmer.status as teilnehmer_status'
                )
            : [];

        const mitgliederByMannschaft = new Map();
        for (const m of mitglieder) {
            if (!mitgliederByMannschaft.has(m.mannschaft_id)) mitgliederByMannschaft.set(m.mannschaft_id, []);
            mitgliederByMannschaft.get(m.mannschaft_id).push(m);
        }

        const ergebnis = mannschaften.map(m => ({ ...m, mitglieder: mitgliederByMannschaft.get(m.id) || [] }));
        return res.json(ergebnis);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getMannschaftById(knex, req, res) {
    try {
        const { id } = req.params;
        const mannschaft = await knex('mannschaften').where({ id }).first();
        if (!mannschaft) {
            return res.status(404).json({ success: false, error: 'Mannschaft nicht gefunden.' });
        }
        const mitglieder = await knex('mannschaft_mitglieder')
            .where({ mannschaft_id: id })
            .join('turnier_teilnehmer', 'mannschaft_mitglieder.turnier_teilnehmer_id', '=', 'turnier_teilnehmer.id')
            .select(
                'mannschaft_mitglieder.*',
                'turnier_teilnehmer.vorname', 'turnier_teilnehmer.nachname',
                'turnier_teilnehmer.gewicht', 'turnier_teilnehmer.judopass_id',
                'turnier_teilnehmer.status as teilnehmer_status'
            );
        return res.json({ ...mannschaft, mitglieder });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

async function pruefeMannschaftZugriff(knex, req, mannschaft) {
    if (!mannschaft) return { erlaubt: false, status: 404, error: 'Mannschaft nicht gefunden.' };
    if (process.env.IS_OFFLINE === 'true') return { erlaubt: true };

    const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
    const turnier = await knex('turniere').where({ id: mannschaft.turnier_id }).first();
    if (hatVereinsZugriffAufTurnier(user, turnier)) return { erlaubt: true };

    const userVereinName = await resolveUserVereinName(knex, user);
    if (userVereinName && userVereinName === mannschaft.verein) return { erlaubt: true };

    return { erlaubt: false, status: 403, error: 'Kein Zugriff auf diese Mannschaft.' };
}

export async function updateMannschaft(knex, req, res) {
    try {
        const { id } = req.params;
        const mannschaft = await knex('mannschaften').where({ id }).first();
        const zugriff = await pruefeMannschaftZugriff(knex, req, mannschaft);
        if (!zugriff.erlaubt) return res.status(zugriff.status).json({ success: false, error: zugriff.error });

        const { bezeichnung, pool_id, status } = req.body;
        const neuerPoolId = pool_id !== undefined ? (pool_id ? parseInt(pool_id) : null) : mannschaft.pool_id;
        await knex('mannschaften').where({ id }).update({
            bezeichnung: bezeichnung !== undefined ? bezeichnung : mannschaft.bezeichnung,
            pool_id: neuerPoolId,
            status: status !== undefined ? status : mannschaft.status,
            updated_at: knex.fn.now()
        });

        // Bracket der betroffenen Pool(s) neu erzeugen — sowohl der alte (Team hat ihn
        // verlassen) als auch der neue (Team ist beigetreten), falls sich pool_id geändert hat.
        if (neuerPoolId !== mannschaft.pool_id) {
            if (mannschaft.pool_id) await regeneriereMannschaftsPool(knex, mannschaft.pool_id);

            if (neuerPoolId) {
                // Gewichtsklassen-Positionen der Mitglieder anhand der Optionen des NEUEN Pools
                // neu bestimmen (siehe ordnePositionZuGewicht) — eine zuvor z.B. beim Import
                // geschätzte Position soll nie stehen bleiben, sobald der echte Pool bekannt ist.
                const neuerPool = await knex('pools').where({ id: neuerPoolId }).first();
                await aktualisierePositionenFuerMannschaft(knex, parseInt(id), parsePoolGewichtsklassen(neuerPool));
                await regeneriereMannschaftsPool(knex, neuerPoolId);
            }
        }

        return res.json({ success: true, message: 'Mannschaft aktualisiert.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function deleteMannschaft(knex, req, res) {
    try {
        const { id } = req.params;
        const mannschaft = await knex('mannschaften').where({ id }).first();
        const zugriff = await pruefeMannschaftZugriff(knex, req, mannschaft);
        if (!zugriff.erlaubt) return res.status(zugriff.status).json({ success: false, error: zugriff.error });

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, mannschaft.turnier_id);
        if (hatEchteKaempfe) {
            return res.status(409).json({ success: false, error: TEILNEHMERLISTE_GESPERRT_FEHLER });
        }

        await knex('mannschaften').where({ id }).del();
        if (mannschaft.pool_id) await regeneriereMannschaftsPool(knex, mannschaft.pool_id);
        return res.json({ success: true, message: 'Mannschaft gelöscht.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function fuegeMitgliedHinzu(knex, req, res) {
    try {
        const { id } = req.params;
        const { turnier_teilnehmer_id } = req.body;

        const mannschaft = await knex('mannschaften').where({ id }).first();
        const zugriff = await pruefeMannschaftZugriff(knex, req, mannschaft);
        if (!zugriff.erlaubt) return res.status(zugriff.status).json({ success: false, error: zugriff.error });

        if (!turnier_teilnehmer_id) {
            return res.status(400).json({ success: false, error: 'Fehlendes Pflichtfeld (turnier_teilnehmer_id).' });
        }

        const athlet = await knex('turnier_teilnehmer').where({ id: turnier_teilnehmer_id }).first();
        if (!athlet || athlet.turnier_id !== mannschaft.turnier_id) {
            return res.status(400).json({ success: false, error: 'Der Teilnehmer gehört nicht zu diesem Turnier.' });
        }

        // Verhindert einen doppelten Eintrag (z.B. durch einen Doppelklick) mit einer
        // verständlichen Meldung, statt den rohen DB-Fehler des Unique-Index
        // uq_mannschaft_mitglieder_kein_doppel (siehe Migration) durchzureichen.
        const bereitsMitglied = await knex('mannschaft_mitglieder')
            .where({ mannschaft_id: id, turnier_teilnehmer_id })
            .first();
        if (bereitsMitglied) {
            return res.status(409).json({ success: false, error: `${athlet.vorname} ${athlet.nachname} ist bereits Mitglied dieser Mannschaft.` });
        }

        // Gewichtsklasse wird nicht manuell gewählt, sondern immer automatisch aus dem
        // tatsächlichen Gewicht des Judoka gegen die Positionen des Pools bestimmt (siehe
        // ordnePositionZuGewicht) — ohne Pool (noch) ein Platzhalter, der beim Zuordnen zu
        // einem Pool automatisch korrigiert wird (siehe updateMannschaft).
        let gewichtsklassenListe = [];
        if (mannschaft.pool_id) {
            const pool = await knex('pools').where({ id: mannschaft.pool_id }).first();
            gewichtsklassenListe = parsePoolGewichtsklassen(pool);
        }
        const gewichtsklasse = ordnePositionZuGewicht(parseFloat(athlet.gewicht), gewichtsklassenListe) || 'Ohne Pool-Gewichtsklasse';

        const [idObj] = await knex('mannschaft_mitglieder').insert({
            mannschaft_id: parseInt(id),
            turnier_teilnehmer_id: parseInt(turnier_teilnehmer_id),
            gewichtsklasse
        }).returning('id');

        const mitgliedId = typeof idObj === 'object' ? idObj.id : idObj;

        // Bracket neu erzeugen: eine Begegnung kann erst dann Einzelkämpfe bekommen, wenn beide
        // Mannschaften ihre Positionen besetzt haben (siehe erzeugeEinzelkaempfeFuerBegegnung) —
        // ohne diesen Trigger bliebe eine Begegnung, deren Bracket-Platzhalter VOR der
        // Mitgliederzuordnung generiert wurde, fälschlich ergebnislos "beendet" stehen. No-op,
        // sobald der Pool bereits echte Kämpfe hatte (regeneriereMannschaftsPool-Guard).
        if (mannschaft.pool_id) await regeneriereMannschaftsPool(knex, mannschaft.pool_id);

        return res.status(201).json({ success: true, mitgliedId });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function entferneMitglied(knex, req, res) {
    try {
        const { id, mitgliedId } = req.params;
        const mannschaft = await knex('mannschaften').where({ id }).first();
        const zugriff = await pruefeMannschaftZugriff(knex, req, mannschaft);
        if (!zugriff.erlaubt) return res.status(zugriff.status).json({ success: false, error: zugriff.error });

        await knex('mannschaft_mitglieder').where({ id: mitgliedId, mannschaft_id: id }).del();
        if (mannschaft.pool_id) await regeneriereMannschaftsPool(knex, mannschaft.pool_id);
        return res.json({ success: true, message: 'Mitglied entfernt.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Verschiebt ein Mitglied per Drag&Drop (siehe mannschaften.js) in eine andere Gewichtsklassen-
// Position desselben Pools. Ein Judoka darf immer nach "oben" (in eine Position, die sein
// tatsächliches Gewicht noch aufnimmt oder eine schwerere), aber nie in eine Position verschoben
// werden, die für sein Gewicht zu klein ist — die "+X"-Schwergewichts-Position ist dabei immer
// groß genug. Serverseitig geprüft, unabhängig von der clientseitigen Vorab-Prüfung.
export async function verschiebeMitglied(knex, req, res) {
    try {
        const { id, mitgliedId } = req.params;
        const { gewichtsklasse } = req.body;

        const mannschaft = await knex('mannschaften').where({ id }).first();
        const zugriff = await pruefeMannschaftZugriff(knex, req, mannschaft);
        if (!zugriff.erlaubt) return res.status(zugriff.status).json({ success: false, error: zugriff.error });

        if (!gewichtsklasse) {
            return res.status(400).json({ success: false, error: 'Fehlendes Pflichtfeld (gewichtsklasse).' });
        }

        if (mannschaft.pool_id && await poolHatBereitsEchteKaempfe(knex, mannschaft.pool_id)) {
            return res.status(409).json({ success: false, error: TEILNEHMERLISTE_GESPERRT_FEHLER });
        }

        const mitglied = await knex('mannschaft_mitglieder').where({ id: mitgliedId, mannschaft_id: id }).first();
        if (!mitglied) {
            return res.status(404).json({ success: false, error: 'Mitglied nicht gefunden.' });
        }

        const athlet = await knex('turnier_teilnehmer').where({ id: mitglied.turnier_teilnehmer_id }).first();
        const gewicht = parseFloat(athlet?.gewicht) || 0;

        let gewichtsklassenListe = [];
        if (mannschaft.pool_id) {
            const pool = await knex('pools').where({ id: mannschaft.pool_id }).first();
            gewichtsklassenListe = parsePoolGewichtsklassen(pool);
        }
        if (gewichtsklassenListe.length > 0 && !gewichtsklassenListe.includes(gewichtsklasse)) {
            return res.status(400).json({ success: false, error: 'Diese Gewichtsklasse gehört nicht zu den Optionen dieses Pools.' });
        }

        if (gewichtsklasse.startsWith('-')) {
            const grenze = parseFloat(gewichtsklasse.replace('-', ''));
            if (!Number.isNaN(grenze) && gewicht > grenze) {
                return res.status(400).json({
                    success: false,
                    error: `Die Gewichtsklasse ${gewichtsklasse} ist kleiner als das Gewicht des Judoka (${gewicht} kg).`
                });
            }
        }

        await knex('mannschaft_mitglieder').where({ id: mitgliedId }).update({ gewichtsklasse, updated_at: knex.fn.now() });
        if (mannschaft.pool_id) await regeneriereMannschaftsPool(knex, mannschaft.pool_id);

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Mannschafts-Pools eines Turniers (typ='mannschaft') — das Gegenstück zu
// poolController.js::getPoolsMitDetails, das diese Pools bewusst ausblendet (siehe dortiger
// Kommentar). Eigene, schlanke Liste statt die Einzelwettkampf-Ansicht zu verkomplizieren.
export async function getMannschaftsPoolsByTurnier(knex, req, res) {
    try {
        const { turnierId } = req.query;
        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'Parameter turnierId wird benötigt.' });
        }
        const pools = await knex('pools')
            .where({ turnier_id: parseInt(turnierId), typ: 'mannschaft' })
            .orderBy('id', 'asc');
        return res.json(pools);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Begegnungen (Team vs. Team) eines Mannschafts-Pools, analog zu kampfController.js::getKaempfe
// (poolId-Zweig) — inkl. Mannschaftsnamen für die Bracket-/Ergebnisanzeige.
export async function getMannschaftskaempfeByPool(knex, req, res) {
    try {
        const { poolId } = req.query;
        if (!poolId) {
            return res.status(400).json({ success: false, error: 'Parameter poolId wird benötigt.' });
        }

        const begegnungen = await knex('mannschaftskaempfe')
            .leftJoin('mannschaften as m1', 'mannschaftskaempfe.mannschaft1_id', '=', 'm1.id')
            .leftJoin('mannschaften as m2', 'mannschaftskaempfe.mannschaft2_id', '=', 'm2.id')
            .where({ 'mannschaftskaempfe.pool_id': parseInt(poolId) })
            .select(
                'mannschaftskaempfe.*',
                'm1.bezeichnung as mannschaft1_bezeichnung', 'm1.verein as mannschaft1_verein',
                'm2.bezeichnung as mannschaft2_bezeichnung', 'm2.verein as mannschaft2_verein'
            )
            .orderBy('mannschaftskaempfe.id', 'asc');

        return res.json(begegnungen);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Gewichtsklassen-Positionen für einen automatisch angelegten Mannschafts-Pool: bevorzugt die
// offizielle DJB-Mannschafts-Vorlage (aktuell nur U15/U18 männlich/weiblich hinterlegt), sonst
// Rückfall auf die Einzelwettkampf-Gewichtsklassen derselben Altersklasse/desselben Geschlechts —
// identische Herleitung wie ermittleGewichtsklassenVorschlag() in public/js/mannschaften.js.
function ermittleMannschaftsGewichtsklassenVorlage(geschlecht, altersklasse) {
    const mannschaftListe = DJB_ALTERSKLASSEN.mannschaft && DJB_ALTERSKLASSEN.mannschaft[geschlecht];
    const mannschaftEintrag = Array.isArray(mannschaftListe) ? mannschaftListe.find(k => k.id === altersklasse) : null;
    if (mannschaftEintrag) return mannschaftEintrag.gewichtsklassen || [];

    const einzelListe = DJB_ALTERSKLASSEN[geschlecht];
    const einzelEintrag = Array.isArray(einzelListe) ? einzelListe.find(k => k.id === altersklasse) : null;
    return (einzelEintrag && einzelEintrag.gewichtsklassen) || [];
}

// Kampfzeit für einen automatisch angelegten Mannschafts-Pool: die Mannschafts-Vorlage in
// altersklassen.json führt (anders als die Einzelwettkampf-Einträge) keine eigene Kampfzeit,
// daher Rückfall auf die Einzelwettkampf-Kampfzeit derselben Altersklasse, sonst 180s (3 Min.,
// der Standard-Vorschlag im manuellen "Mannschafts-Pool anlegen"-Formular).
function ermittleMannschaftsKampfzeit(geschlecht, altersklasse) {
    const einzelListe = DJB_ALTERSKLASSEN[geschlecht];
    const einzelEintrag = Array.isArray(einzelListe) ? einzelListe.find(k => k.id === altersklasse) : null;
    return (einzelEintrag && parseInt(einzelEintrag.kampfzeit, 10)) || 180;
}

// Legt für alle noch keinem Pool zugeordneten Mannschaften (siehe teilnehmerController.js::
// importTeilnehmer, das Mannschaften ohne Pool anlegt, sowie manuell über mannschaften.html
// angelegte Teams) automatisch je Geschlecht+Altersklasse-Kombination einen Mannschafts-Pool an
// (sofern noch keiner existiert) und ordnet die Mannschaften diesem zu. Geschlecht/Altersklasse
// einer Mannschaft werden mehrheitlich aus ihren bereits zugeordneten Mitgliedern hergeleitet —
// eine Mannschaft ohne Mitglieder kann dadurch nicht automatisch eingeordnet werden.
export async function verteileMannschaftenAutomatisch(knex, req, res) {
    try {
        const { turnier_id } = req.body;
        if (!turnier_id) {
            return res.status(400).json({ success: false, error: 'Turnier-ID ist erforderlich.' });
        }

        const turnier = await knex('turniere').where({ id: parseInt(turnier_id) }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnier.id);
        if (hatEchteKaempfe) {
            return res.status(409).json({ success: false, error: TEILNEHMERLISTE_GESPERRT_FEHLER });
        }

        const nichtZugeordnet = await knex('mannschaften')
            .where({ turnier_id: parseInt(turnier_id) })
            .whereNull('pool_id');

        if (nichtZugeordnet.length === 0) {
            return res.status(400).json({ success: false, error: 'Keine nicht zugeordneten Mannschaften vorhanden.' });
        }

        const teamIds = nichtZugeordnet.map(t => t.id);
        const mitglieder = await knex('mannschaft_mitglieder')
            .whereIn('mannschaft_id', teamIds)
            .join('turnier_teilnehmer', 'mannschaft_mitglieder.turnier_teilnehmer_id', '=', 'turnier_teilnehmer.id')
            .select('mannschaft_mitglieder.mannschaft_id', 'turnier_teilnehmer.geschlecht', 'turnier_teilnehmer.altersklasse');

        const mitgliederProTeam = new Map();
        mitglieder.forEach(m => {
            if (!mitgliederProTeam.has(m.mannschaft_id)) mitgliederProTeam.set(m.mannschaft_id, []);
            mitgliederProTeam.get(m.mannschaft_id).push(m);
        });

        // Gruppierung nach Geschlecht+Altersklasse; Zuordnung je Team über die Mehrheit seiner
        // Mitglieder (im Regelfall sind ohnehin alle Mitglieder eines importierten Teams gleich
        // eingeordnet, siehe verarbeiteImportZeile/ermittleAltersklasse).
        const gruppen = new Map();
        const uebersprungen = [];

        for (const team of nichtZugeordnet) {
            const mgl = mitgliederProTeam.get(team.id) || [];
            if (mgl.length === 0) {
                uebersprungen.push({ team: team.bezeichnung, grund: 'Keine Mitglieder zugeordnet — Geschlecht/Altersklasse unbekannt.' });
                continue;
            }

            const zaehler = new Map();
            mgl.forEach(m => {
                const key = `${m.geschlecht}_${m.altersklasse}`;
                zaehler.set(key, (zaehler.get(key) || 0) + 1);
            });
            const [mehrheitsKey] = [...zaehler.entries()].sort((a, b) => b[1] - a[1])[0];
            const idx = mehrheitsKey.indexOf('_');
            const geschlecht = mehrheitsKey.slice(0, idx);
            const altersklasse = mehrheitsKey.slice(idx + 1);

            if (!gruppen.has(mehrheitsKey)) gruppen.set(mehrheitsKey, { geschlecht, altersklasse, teams: [] });
            gruppen.get(mehrheitsKey).teams.push(team);
        }

        if (gruppen.size === 0) {
            return res.status(400).json({
                success: false,
                error: 'Keine der nicht zugeordneten Mannschaften hat Mitglieder — Geschlecht/Altersklasse können nicht ermittelt werden.'
            });
        }

        let poolsErstellt = 0;
        let mannschaftenZugeordnet = 0;
        const betroffenePoolIds = new Set();

        for (const { geschlecht, altersklasse, teams } of gruppen.values()) {
            // Bestehenden, passenden Mannschafts-Pool wiederverwenden statt Duplikat anzulegen —
            // außer er hat bereits echte (nicht nur Freilos-)Kämpfe: eine laufende/abgeschlossene
            // Auslosung darf durch automatisch nachgeschobene Teams nicht verändert werden, dann
            // lieber einen neuen, separaten Pool für diese Gruppe anlegen.
            let pool = await knex('pools')
                .where({ turnier_id: parseInt(turnier_id), typ: 'mannschaft', geschlecht, altersklasse })
                .first();

            if (pool && await poolHatBereitsEchteKaempfe(knex, pool.id)) {
                pool = null;
            }

            let poolGewichtsklassenListe;

            if (!pool) {
                const gewichtsklassen = ermittleMannschaftsGewichtsklassenVorlage(geschlecht, altersklasse);
                const kampfzeit = ermittleMannschaftsKampfzeit(geschlecht, altersklasse);
                const gsDefaults = ermittleGoldenScoreEinstellungen(altersklasse);
                const gKuerzel = geschlecht === 'weiblich' ? 'w' : 'm';

                const [idObj] = await knex('pools').insert({
                    turnier_id: parseInt(turnier_id),
                    bezeichnung: `${altersklasse}${gKuerzel} Team`,
                    // Jeder-gegen-Jeden als sicherer Standard ohne Teilnehmerzahl-Obergrenze —
                    // Doppel-KO-8/16 bleibt bewusst eine manuelle Wahl (siehe
                    // regeneriereMannschaftsPool: Modus ist keine reine Funktion der Teamanzahl).
                    modus: 'Jeder-gegen-Jeden',
                    altersklasse,
                    geschlecht,
                    typ: 'mannschaft',
                    mannschafts_gewichtsklassen: JSON.stringify(gewichtsklassen),
                    kampfzeit_sekunden: kampfzeit,
                    golden_score_aktiv: gsDefaults.aktiv,
                    golden_score_max_sekunden: gsDefaults.maxSekunden
                }).returning('id');

                pool = { id: typeof idObj === 'object' ? idObj.id : idObj };
                poolGewichtsklassenListe = gewichtsklassen;
                poolsErstellt++;
            } else {
                poolGewichtsklassenListe = parsePoolGewichtsklassen(pool);
            }

            const teamIdsGruppe = teams.map(t => t.id);
            await knex('mannschaften').whereIn('id', teamIdsGruppe).update({ pool_id: pool.id, updated_at: knex.fn.now() });
            mannschaftenZugeordnet += teamIdsGruppe.length;
            betroffenePoolIds.add(pool.id);

            // Gewichtsklassen-Positionen der Mitglieder anhand der echten Optionen dieses Pools
            // neu bestimmen (siehe ordnePositionZuGewicht) — ersetzt die Import-Zeitpunkt-Schätzung.
            for (const team of teams) {
                await aktualisierePositionenFuerMannschaft(knex, team.id, poolGewichtsklassenListe);
            }
        }

        for (const poolId of betroffenePoolIds) {
            await regeneriereMannschaftsPool(knex, poolId);
        }

        return res.json({ success: true, poolsErstellt, mannschaftenZugeordnet, uebersprungen });
    } catch (error) {
        console.error('[Mannschaften-Auto-Verteilung-Fehler]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Löscht alle Mannschafts-Pools eines Turniers auf einmal — das Gegenstück zu
// poolController.js::loescheAllePools (das Mannschafts-Pools bewusst ausklammert, siehe
// dortiger Kommentar). Die Mannschaften selbst bleiben erhalten und werden lediglich von ihrem
// Pool entzogen (pool_id -> NULL per ON DELETE SET NULL, siehe create_mannschaften-Migration).
export async function loescheAlleMannschaftsPools(knex, req, res) {
    try {
        const { turnier_id } = req.body;
        if (!turnier_id) {
            return res.status(400).json({ success: false, error: 'Turnier-ID ist erforderlich.' });
        }

        const pools = await knex('pools').where({ turnier_id: parseInt(turnier_id), typ: 'mannschaft' }).select('id');

        for (const p of pools) {
            if (await poolHatBereitsEchteKaempfe(knex, p.id)) {
                return res.status(409).json({
                    success: false,
                    error: 'Mannschafts-Pools können nicht gelöscht werden, da mindestens einer bereits echte Kampfergebnisse enthält.'
                });
            }
        }

        await knex('pools').where({ turnier_id: parseInt(turnier_id), typ: 'mannschaft' }).del();
        return res.json({ success: true, geloescht: pools.length });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
