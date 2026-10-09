import { readFileSync } from 'fs';
import { bestimmeFarbeKaempfer2, gueltigeFarbe } from '../shared/kampfFarbe.js';
import path from 'path';
import { fileURLToPath } from 'url';

// --- ALLE VERFÜGBAREN WETTKAMPFSYSTEM-SERVICES IMPORTIEREN ---
import { JederGegenJedenManager } from '../services/JederGegenJedenManager.js';
import { DoppelKo8Manager } from '../services/DoppelKo8Manager.js';
import { DoppelKo16Manager } from '../services/DoppelKo16Manager.js';
import { DoppelKo32Manager } from '../services/DoppelKo32Manager.js';
import { GruppenUeberKreuzManager } from '../services/GruppenUeberKreuzManager.js';
import { MannschaftJederGegenJedenManager } from '../services/MannschaftJederGegenJedenManager.js';
import { MannschaftDoppelKo8Manager } from '../services/MannschaftDoppelKo8Manager.js';
import { MannschaftDoppelKo16Manager } from '../services/MannschaftDoppelKo16Manager.js';
import { ermittlePausensekunden } from '../shared/pausenRegel.js';
import { verteilePoolsAufMatten } from '../services/mattenVerteilung.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Instanzen der Manager bereitstellen
const jederGegenJeden = new JederGegenJedenManager();
const doppelKo8 = new DoppelKo8Manager();
const doppelKo16 = new DoppelKo16Manager();
const doppelKo32 = new DoppelKo32Manager();
const ueberKreuz = new GruppenUeberKreuzManager();
const mannschaftJederGegenJeden = new MannschaftJederGegenJedenManager();
const mannschaftDoppelKo8 = new MannschaftDoppelKo8Manager();
const mannschaftDoppelKo16 = new MannschaftDoppelKo16Manager();

// Für genau 6 TeilnehmerInnen sind beide Systeme gültig — Gruppen-Überkreuz ist die
// Voreinstellung (siehe waehleWettkampfsystem), Jeder-gegen-Jeden ist nachträglich in
// pools.html wählbar (aendereWettkampfsystem).
const SECHSER_ALTERNATIVEN = new Set(['Gruppen-Überkreuz', 'Jeder-gegen-Jeden']);

const MINDEST_PAUSE_KAEMPFE = 2;
const MAX_PROZENTUALE_GEWICHTSDIFFERENZ = 0.10;
const MAX_ABSOLUTE_DIFFERENZ_ERWACHSENE_U18_KG = 8;
const MAX_ABSOLUTE_DIFFERENZ_U13_U15_KG = 5;
const MAX_ABSOLUTE_DIFFERENZ_KINDERSCHUTZ_KG = 3.5;

function waehleWettkampfsystem(anzahl) {
    if (anzahl < 2) return 'Nicht startbereit';
    if (anzahl <= 5) return 'Jeder-gegen-Jeden';
    if (anzahl === 6) return 'Gruppen-Überkreuz';
    if (anzahl <= 8) return 'Doppel-KO-8';
    if (anzahl <= 16) return 'Doppel-KO-16';
    if (anzahl <= 32) return 'Doppel-KO-32';

    throw new Error(`Für ${anzahl} Teilnehmer ist noch kein Poolsystem konfiguriert. Bitte Pool teilen.`);
}

function schaetzeBruttoKaempfe(modus, anzahlTeilnehmer) {
    if (anzahlTeilnehmer < 2) return 0;

    switch (modus) {
        case 'Jeder-gegen-Jeden':
            return (anzahlTeilnehmer * (anzahlTeilnehmer - 1)) / 2;
        case 'Gruppen-Überkreuz':
            return 9; // 6 Vorrundenkämpfe + HF1/HF2 + F1 (siehe GruppenUeberKreuzManager.js)
        case 'Doppel-KO-8':
            return 11;
        case 'Doppel-KO-16':
            return 27;
        case 'Doppel-KO-32':
            return 59;
        default:
            return 0;
    }
}

function normalisiereAltersklasse(altersklasse) {
    return String(altersklasse || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
}

function istU13OderU15(altersklasse) {
    const normalisiert = normalisiereAltersklasse(altersklasse);
    return normalisiert.includes('u13') || normalisiert.includes('u15');
}

// DJB-Wettkampfordnung Art. 3.12.9: Golden Score ist altersklassenabhängig — unterhalb der U15
// (U9/U11/U13) gibt es gar keinen Golden Score, sondern sofortige Hantei-Entscheidung bei
// Gleichstand; bei der U15 ist Golden Score auf 3 Minuten (180 s) begrenzt, danach Hantei; ab
// U18 gilt die unbegrenzte IJF-Regel ohne Hantei. Nicht erkannte/freie Klassen (Frauen, Männer,
// Ü30 etc.) fallen auf die unbegrenzte Erwachsenen-Regel zurück.
export function ermittleGoldenScoreEinstellungen(altersklasse) {
    const match = String(altersklasse || '').trim().match(/^U\s*(\d+)$/i);
    if (match) {
        const jahre = parseInt(match[1], 10);
        if (jahre <= 13) return { aktiv: false, maxSekunden: null };
        if (jahre === 15) return { aktiv: true, maxSekunden: 180 };
    }
    return { aktiv: true, maxSekunden: null };
}

function ermittleMaximaleAbsoluteGewichtsdifferenz(leichtester, altersklasse) {
    if (leichtester < 40) {
        return MAX_ABSOLUTE_DIFFERENZ_KINDERSCHUTZ_KG;
    }

    if (istU13OderU15(altersklasse)) {
        return MAX_ABSOLUTE_DIFFERENZ_U13_U15_KG;
    }

    return MAX_ABSOLUTE_DIFFERENZ_ERWACHSENE_U18_KG;
}

function pruefeGewichtsspanne(poolTeilnehmer, altersklasse) {
    if (poolTeilnehmer.length <= 1) {
        return {
            zulaessig: true,
            leichtester: null,
            schwerster: null,
            absoluteDifferenz: 0,
            prozentualeDifferenz: 0,
            maxAbsoluteDifferenz: null,
            gruende: []
        };
    }

    const gewichte = poolTeilnehmer
        .map(t => Number.parseFloat(t.gewicht))
        .filter(gewicht => Number.isFinite(gewicht))
        .sort((a, b) => a - b);

    if (gewichte.length !== poolTeilnehmer.length) {
        return {
            zulaessig: false,
            leichtester: null,
            schwerster: null,
            absoluteDifferenz: null,
            prozentualeDifferenz: null,
            maxAbsoluteDifferenz: null,
            gruende: ['Mindestens ein Teilnehmer hat kein gültiges Gewicht.']
        };
    }

    const leichtester = gewichte[0];
    const schwerster = gewichte[gewichte.length - 1];

    if (leichtester <= 0) {
        return {
            zulaessig: false,
            leichtester,
            schwerster,
            absoluteDifferenz: null,
            prozentualeDifferenz: null,
            maxAbsoluteDifferenz: null,
            gruende: ['Das Gewicht des leichtesten Teilnehmers ist ungültig.']
        };
    }

    const absoluteDifferenz = schwerster - leichtester;
    const prozentualeDifferenz = absoluteDifferenz / leichtester;
    const maxAbsoluteDifferenz = ermittleMaximaleAbsoluteGewichtsdifferenz(leichtester, altersklasse);

    const gruende = [];

    if (absoluteDifferenz > maxAbsoluteDifferenz) {
        gruende.push(
            `Absolute Differenz ${absoluteDifferenz.toFixed(2)} kg überschreitet ${maxAbsoluteDifferenz.toFixed(2)} kg.`
        );
    }

    if (prozentualeDifferenz > MAX_PROZENTUALE_GEWICHTSDIFFERENZ) {
        gruende.push(
            `Prozentuale Differenz ${(prozentualeDifferenz * 100).toFixed(1)} % überschreitet 10 %.`
        );
    }

    return {
        zulaessig: gruende.length === 0,
        leichtester,
        schwerster,
        absoluteDifferenz,
        prozentualeDifferenz,
        maxAbsoluteDifferenz,
        gruende
    };
}

function istGewichtsspanneZulaessig(poolTeilnehmer, altersklasse) {
    return pruefeGewichtsspanne(poolTeilnehmer, altersklasse).zulaessig;
}

function bildeGewichtsnahePools(teilnehmer, altersklasse) {
    const sortierteTeilnehmer = [...teilnehmer].sort((a, b) => {
        return Number.parseFloat(a.gewicht) - Number.parseFloat(b.gewicht);
    });

    const anzahlTeilnehmer = sortierteTeilnehmer.length;

    if (anzahlTeilnehmer === 0) return [];

    const erlaubtePoolGroessen = [5, 4, 3, 2];
    const memo = new Map();

    function bewerteLoesung(pools) {
        const einzelPools = pools.filter(pool => pool.length === 1).length;
        // 2er-Pools sind unerwünscht (Ziel: 3-5 Personen pro Pool) und werden nur akzeptiert,
        // wenn keine Aufteilung in 3-5er-Gruppen möglich ist (z.B. Gesamtgruppe von nur 2 Personen).
        const zweierPools = pools.filter(pool => pool.length === 2).length;
        const poolAnzahl = pools.length;
        const groessenPenalty = pools.reduce((summe, pool) => {
            if (pool.length === 1) return summe + 100;
            return summe + Math.abs(4 - pool.length);
        }, 0);

        return einzelPools * 10000 + zweierPools * 1000 + poolAnzahl * 100 + groessenPenalty;
    }

    function findeBesteLoesung(startIndex) {
        if (startIndex >= anzahlTeilnehmer) return [];

        if (memo.has(startIndex)) {
            return memo.get(startIndex);
        }

        let besteLoesung = null;
        let besterScore = Number.POSITIVE_INFINITY;

        for (const poolGroesse of erlaubtePoolGroessen) {
            const ende = startIndex + poolGroesse;

            if (ende > anzahlTeilnehmer) continue;

            const pool = sortierteTeilnehmer.slice(startIndex, ende);

            if (!istGewichtsspanneZulaessig(pool, altersklasse)) continue;

            const restLoesung = findeBesteLoesung(ende);

            if (!restLoesung) continue;

            const kandidat = [pool, ...restLoesung];
            const score = bewerteLoesung(kandidat);

            if (score < besterScore) {
                besteLoesung = kandidat;
                besterScore = score;
            }
        }

        if (!besteLoesung) {
            const einzelPool = [sortierteTeilnehmer[startIndex]];
            const restLoesung = findeBesteLoesung(startIndex + 1);
            besteLoesung = [einzelPool, ...restLoesung];
        }

        memo.set(startIndex, besteLoesung);
        return besteLoesung;
    }

    return findeBesteLoesung(0);
}

async function initialisiereKaempfeFuerPool(knex, poolId, modus) {
    if (modus === 'Nicht startbereit') {
        // Genau 1 Teilnehmer ist ein gültiges "Kampflos" (siehe JederGegenJedenManager),
        // 0 Teilnehmer bleibt ein leerer Pool ohne Kämpfe.
        const anzahlRow = await knex('turnier_teilnehmer').where({ pool_id: poolId }).count('* as n').first();
        if (parseInt(anzahlRow.n, 10) === 1) {
            await jederGegenJeden.initialisierePool(knex, poolId);
        }
        return;
    }

    if (modus === 'Gruppen-Überkreuz') {
        await ueberKreuz.initialisierePool(knex, poolId);
    } else if (modus === 'Doppel-KO-8') {
        await doppelKo8.initialisierePool(knex, poolId);
    } else if (modus === 'Doppel-KO-16') {
        await doppelKo16.initialisierePool(knex, poolId);
    } else if (modus === 'Doppel-KO-32') {
        await doppelKo32.initialisierePool(knex, poolId);
    } else {
        await jederGegenJeden.initialisierePool(knex, poolId);
    }
}

async function initialisiereBegegnungenFuerMannschaftsPool(knex, poolId, modus) {
    if (modus === 'Doppel-KO-8') {
        await mannschaftDoppelKo8.initialisierePool(knex, poolId);
    } else if (modus === 'Doppel-KO-16') {
        await mannschaftDoppelKo16.initialisierePool(knex, poolId);
    } else {
        await mannschaftJederGegenJeden.initialisierePool(knex, poolId);
    }
}

// Wird von mannschaftController.js nach jeder Änderung der Mannschafts-Zusammensetzung eines
// Pools aufgerufen (Team hinzugefügt/entfernt/umgehängt) — das Mannschafts-Pendant zu
// regeneriereKampfplanFuerPool(). Anders als dort wird der Modus NICHT automatisch aus der
// Teamanzahl neu bestimmt: Jeder-gegen-Jeden vs. Doppel-KO-8/16 ist bei Mannschaften eine
// bewusste Wahl der Turnierleitung beim Pool-Anlegen, keine reine Funktion der Teamanzahl.
// poolHatBereitsEchteKaempfe() funktioniert unverändert auch für Mannschafts-Pools, da die
// Einzelkämpfe einer Begegnung ganz normale kaempfe-Zeilen mit demselben pool_id sind.
export async function regeneriereMannschaftsPool(knex, poolId) {
    if (!poolId) return;
    if (await poolHatBereitsEchteKaempfe(knex, poolId)) return;

    const pool = await knex('pools').where({ id: poolId }).first();
    if (!pool || pool.typ !== 'mannschaft') return;

    // Löscht per CASCADE auch alle zugehörigen kaempfe-Zeilen (kaempfe.mannschaftskampf_id).
    await knex('mannschaftskaempfe').where({ pool_id: poolId }).del();
    await initialisiereBegegnungenFuerMannschaftsPool(knex, poolId, pool.modus);

    // Alle Team-Zuordnungsänderungen (anlegen/entfernen/verschieben eines Mitglieds, Team einem
    // Pool zuordnen) laufen über diese Funktion — deshalb hier zentral auch den frühen Pool-
    // Status nachziehen (siehe aktualisierePoolStatusNachAuslosung), statt das an jeder einzelnen
    // Aufrufstelle in mannschaftController.js zu wiederholen.
    await aktualisierePoolStatusNachAuslosung(knex, poolId);
}

// Setzt den Pool-Status nach einer (Neu-)Auslosung passend zum aktuellen Zustand: Pools ohne
// Kampffläche -> 'teilnehmer_zugewiesen', bereits einer Matte zugeordnete Pools bleiben
// 'matte_zugewiesen' (die Mattenzuordnung selbst wird hier nicht angefasst). Rührt Pools NICHT
// an, die bereits weiter sind (z.B. ein 1-Teilnehmer-"Kampflos", das initialisiereKaempfeFuerPool
// direkt auf 'abgeschlossen' gesetzt hat) — sonst würde dieser Aufruf den Abschluss rückgängig
// machen. Wird nur für Pools aufgerufen, die garantiert noch nicht 'gestartet' waren, BEVOR
// initialisiereKaempfeFuerPool lief (Aufrufer prüfen das per poolHatBereitsEchteKaempfe).
// Gilt gleichermaßen für Einzel- UND Mannschafts-Pools (letztere zählen zugeordnete Mannschaften
// statt Teilnehmer) — ordnePoolZuKampfflaeche/setzeKampfflaecheReihenfolge/verteilePools rufen
// diese Funktion bereits typ-unabhängig für jeden Pool auf.
const FRUEHE_POOL_STATUS = new Set(['angelegt', 'teilnehmer_zugewiesen', 'matte_zugewiesen']);
export async function aktualisierePoolStatusNachAuslosung(knex, poolId) {
    const pool = await knex('pools').where({ id: poolId }).first();
    if (!pool || !FRUEHE_POOL_STATUS.has(pool.status)) return;

    const anzahlRow = pool.typ === 'mannschaft'
        ? await knex('mannschaften').where({ pool_id: poolId }).count('* as n').first()
        : await knex('turnier_teilnehmer').where({ pool_id: poolId }).count('* as n').first();
    const anzahl = parseInt(anzahlRow.n, 10);

    const status = anzahl === 0
        ? 'angelegt'
        : (pool.kampfflaeche_id != null ? 'matte_zugewiesen' : 'teilnehmer_zugewiesen');
    await knex('pools').where({ id: poolId }).update({ status });
}

// Berechnet den automatischen Matten-Status aus der aktuellen Pool-Zuordnung neu:
// mindestens ein zugeordneter Pool ist 'gestartet' -> 'in_austragung'; sonst mindestens ein
// Pool zugeordnet -> 'pools_vorhanden'; sonst 'frei'. Rührt eine manuell 'pausiert'/'gesperrt'e
// Matte NICHT an — manuelle Zustände haben Vorrang vor der automatischen Neuberechnung ("kein
// automatisches Aufwecken"). Wird von jeder Pool-Zuordnungs-/Status-Schreibstelle aufgerufen,
// die diese Matte betreffen könnte.
export async function synchronisiereMattenStatus(knex, kampflaecheId) {
    if (!kampflaecheId) return;
    const matte = await knex('kampfflaechen').where({ id: kampflaecheId }).first();
    if (!matte || matte.status === 'pausiert' || matte.status === 'gesperrt') return;

    const zugeordnetePools = await knex('pools').where({ kampfflaeche_id: kampflaecheId }).select('status');
    let status = 'frei';
    if (zugeordnetePools.length > 0) {
        status = zugeordnetePools.some(p => p.status === 'gestartet') ? 'in_austragung' : 'pools_vorhanden';
    }
    if (status !== matte.status) {
        await knex('kampfflaechen').where({ id: kampflaecheId }).update({ status, updated_at: knex.fn.now() });
    }
}

// altersklassen (optional): nur die Einzel-Pools dieser Altersklassen räumen (Waage in Runden);
// ohne Angabe das ganze Turnier.
// Liefert false (und löscht nichts), wenn einer der Pools inzwischen echte Kämpfe hat: die Prüfung
// läuft in derselben Transaktion unter Zeilensperre auf den Kämpfen, ein parallel gestarteter Kampf
// kann also nicht zwischen Prüfung und Löschen rutschen.
async function loeschePoolZuordnungenFuerTurnier(knex, turnierId, altersklassen = null) {
    // Nur Einzelwettkampf-Pools betroffen: diese Funktion räumt vor einer (Neu-)Auslosung durch
    // generierePools()/loescheAllePools() auf, beides ausschließlich Aktionen der
    // Einzelwettkampf-Seite (pools.html). Mannschafts-Pools werden unabhängig davon auf der
    // Mannschaften-Seite verwaltet und dürfen hierdurch nicht mitgelöscht werden.
    const altePoolsQuery = knex('pools')
        .where({ turnier_id: turnierId })
        .andWhereNot({ typ: 'mannschaft' });
    if (altersklassen) altePoolsQuery.whereIn('altersklasse', altersklassen);
    const altePools = await altePoolsQuery.select('id', 'kampfflaeche_id');

    const altePoolIds = altePools.map(pool => pool.id);
    // Betroffene Matten merken, bevor ihre Pools gleich gelöscht werden — sonst bleibt ihr
    // Status (z.B. "in_austragung"/"pools_vorhanden") stehen, obwohl gar keine Pools mehr
    // zugeordnet sind (siehe QA-Bericht F4).
    const betroffeneMatten = [...new Set(altePools.map(p => p.kampfflaeche_id).filter(Boolean))];

    const geloescht = await knex.transaction(async (trx) => {
        if (altePoolIds.length > 0) {
            const kaempfe = await trx('kaempfe').whereIn('pool_id', altePoolIds).forUpdate().select('status');
            if (kaempfe.some(k => k.status === 'gestartet' || k.status === 'beendet')) return false;
            await trx('kaempfe').whereIn('pool_id', altePoolIds).del();
        }

        if (!altersklassen) {
            await trx('turnier_teilnehmer')
                .where({ turnier_id: turnierId })
                .update({ pool_id: null });
        } else if (altePoolIds.length > 0) {
            await trx('turnier_teilnehmer')
                .whereIn('pool_id', altePoolIds)
                .update({ pool_id: null });
        }

        if (altePoolIds.length > 0) {
            await trx('pools').whereIn('id', altePoolIds).del();
        }
        return true;
    });
    if (!geloescht) return false;

    for (const kampflaecheId of betroffeneMatten) {
        await synchronisiereMattenStatus(knex, kampflaecheId);
    }

    console.log(`[DB] Alte Pool-, Kampf-, Matten- und Teilnehmerzuordnungen für Turnier-ID ${turnierId} gelöscht.`);
    return true;
}

export async function poolHatBereitsEchteKaempfe(knex, poolId) {
    if (!poolId) return false;

    const kampf = await knex('kaempfe')
        .where({ pool_id: poolId })
        .whereIn('status', ['gestartet', 'beendet'])
        .first();

    return Boolean(kampf);
}

// Prüft, ob für ein Turnier bereits IRGENDEIN Pool einen echten (nicht Freilos-)Kampf hatte —
// das ist der Zeitpunkt, ab dem die Teilnehmerliste gesperrt wird (siehe teilnehmerController.js),
// nicht schon bei bloßer Pool-Existenz.
export async function turnierHatEchteKaempfe(knex, turnierId) {
    const kampf = await knex('kaempfe')
        .join('pools', 'pools.id', 'kaempfe.pool_id')
        .where('pools.turnier_id', turnierId)
        .whereIn('kaempfe.status', ['gestartet', 'beendet'])
        .first('kaempfe.id');
    return Boolean(kampf);
}

// Mannschaften sind erst gesperrt (Teams und Mitglieder nicht mehr änderbar), wenn ein Mannschafts-Pool
// des Turniers echte Kämpfe hatte — Einzelkämpfe anderer Pools sperren sie nicht.
export async function mannschaftsPoolsHabenEchteKaempfe(knex, turnierId) {
    const kampf = await knex('kaempfe')
        .join('pools', 'pools.id', 'kaempfe.pool_id')
        .where({ 'pools.turnier_id': turnierId, 'pools.typ': 'mannschaft' })
        .whereIn('kaempfe.status', ['gestartet', 'beendet'])
        .first('kaempfe.id');
    return Boolean(kampf);
}

// Waage in Runden: Zustand je Altersklasse aus den Einzel-Pools abgeleitet.
// ausgelost = es gibt einen Einzel-Pool dieser Altersklasse mit Teilnehmern, gesperrt = einer davon hat echte Kämpfe.
export async function ermittleAltersklassenPoolZustand(knex, turnierId) {
    const pools = await knex('pools')
        .where({ turnier_id: turnierId })
        .andWhereNot({ typ: 'mannschaft' })
        .select('id', 'altersklasse');
    const mitTeilnehmern = new Set(
        await knex('turnier_teilnehmer').where({ turnier_id: turnierId }).whereNotNull('pool_id').pluck('pool_id')
    );
    const poolIdsMitEchtenKaempfen = new Set(
        pools.length === 0 ? [] : await knex('kaempfe')
            .whereIn('pool_id', pools.map(p => p.id))
            .whereIn('status', ['gestartet', 'beendet'])
            .distinct()
            .pluck('pool_id')
    );
    const ausgelost = new Set();
    const gesperrt = new Set();
    for (const pool of pools) {
        if (!pool.altersklasse) continue;
        // Ein von Hand angelegter, noch leerer Pool zählt nicht als Auslosung (Anmeldungen laufen weiter).
        if (mitTeilnehmern.has(pool.id)) ausgelost.add(pool.altersklasse);
        if (poolIdsMitEchtenKaempfen.has(pool.id)) gesperrt.add(pool.altersklasse);
    }
    return { ausgelosteAltersklassen: [...ausgelost].sort(), gesperrteAltersklassen: [...gesperrt].sort() };
}

async function regeneriereKampfplanFuerPool(knex, poolId) {
    if (!poolId) return null;

    const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId });
    const anzahl = teilnehmer.length;
    const neuerModus = waehleWettkampfsystem(anzahl);

    await knex('kaempfe').where({ pool_id: poolId }).del();

    // Status VOR der Neu-Initialisierung auf die zur neuen Teilnehmerzahl passende Basis
    // zurücksetzen (nicht über aktualisierePoolStatusNachAuslosung, dessen Regressions-Schutz
    // hier kontraproduktiv wäre): ein zuvor z.B. 'abgeschlossen'er Einzelpool (Kampflos) darf
    // nach einer Teilnehmerverschiebung mit jetzt mehreren Personen nicht auf 'abgeschlossen'
    // hängen bleiben, da die Kämpfe komplett neu erzeugt werden. initialisiereKaempfeFuerPool
    // setzt bei einer neuen 1-Personen-Konstellation den Status selbst wieder korrekt.
    const bestehenderPool = await knex('pools').where({ id: poolId }).first();
    const basisStatus = anzahl === 0
        ? 'angelegt'
        : (bestehenderPool && bestehenderPool.kampfflaeche_id != null ? 'matte_zugewiesen' : 'teilnehmer_zugewiesen');

    await knex('pools')
        .where({ id: poolId })
        .update({
            modus: neuerModus,
            status: basisStatus
        });

    await initialisiereKaempfeFuerPool(knex, poolId, neuerModus);

    return {
        poolId,
        anzahl_teilnehmer: anzahl,
        modus: neuerModus
    };
}

function holeKampfTeilnehmerIds(kampf) {
    return [kampf.kaempfer1_id, kampf.kaempfer2_id].filter(Boolean);
}

function darfKampfJetztGeplantWerden(kampf, position, letztePositionProTeilnehmer) {
    const teilnehmerIds = holeKampfTeilnehmerIds(kampf);

    return teilnehmerIds.every(id => {
        const letztePosition = letztePositionProTeilnehmer.get(id);

        if (!letztePosition) return true;

        return position - letztePosition > MINDEST_PAUSE_KAEMPFE;
    });
}

async function planeUebergeordneteMattenReihenfolge(knex, turnierId) {
    const pools = await knex('pools')
        .where({ turnier_id: turnierId })
        .orderBy('id', 'asc')
        .select('id');

    const poolQueues = [];

    await knex('kaempfe')
        .whereIn('pool_id', pools.map(pool => pool.id))
        .update({ matten_reihenfolge: null });

    for (const pool of pools) {
        const kaempfe = await knex('kaempfe')
            .where({ pool_id: pool.id, status: 'wartet' })
            .orderBy('id', 'asc');

        if (kaempfe.length > 0) {
            poolQueues.push({
                poolId: pool.id,
                kaempfe
            });
        }
    }

    const letztePositionProTeilnehmer = new Map();
    const updates = [];
    let position = 1;
    let poolCursor = 0;

    while (poolQueues.some(queue => queue.kaempfe.length > 0)) {
        let gewaehlterQueueIndex = -1;

        for (let versuch = 0; versuch < poolQueues.length; versuch++) {
            const queueIndex = (poolCursor + versuch) % poolQueues.length;
            const naechsterKampf = poolQueues[queueIndex].kaempfe[0];

            if (!naechsterKampf) continue;

            if (darfKampfJetztGeplantWerden(naechsterKampf, position, letztePositionProTeilnehmer)) {
                gewaehlterQueueIndex = queueIndex;
                break;
            }
        }

        if (gewaehlterQueueIndex === -1) {
            gewaehlterQueueIndex = poolQueues.findIndex(queue => queue.kaempfe.length > 0);
        }

        if (gewaehlterQueueIndex === -1) break;

        const [kampf] = poolQueues[gewaehlterQueueIndex].kaempfe.splice(0, 1);

        if (!kampf) break;

        updates.push({
            id: kampf.id,
            matten_reihenfolge: position
        });

        for (const teilnehmerId of holeKampfTeilnehmerIds(kampf)) {
            letztePositionProTeilnehmer.set(teilnehmerId, position);
        }

        poolCursor = (gewaehlterQueueIndex + 1) % poolQueues.length;
        position++;
    }

    for (const update of updates) {
        await knex('kaempfe')
            .where({ id: update.id })
            .update({ matten_reihenfolge: update.matten_reihenfolge });
    }
}

// Single Pool Manual CRUD Operations
const MANNSCHAFTS_MODI = new Set(['Jeder-gegen-Jeden', 'Doppel-KO-8', 'Doppel-KO-16']);

export async function createPool(knex, req, res) {
    try {
        const {
            turnier_id, bezeichnung, modus, altersklasse, geschlecht, gewichtsklasse,
            kampfzeit_sekunden, golden_score_aktiv, golden_score_max_sekunden,
            typ, mannschafts_gewichtsklassen
        } = req.body;

        const istMannschaftsPool = typ === 'mannschaft';

        if (!turnier_id || !bezeichnung || !altersklasse || !geschlecht || (!istMannschaftsPool && !gewichtsklasse)) {
            return res.status(400).json({ success: false, error: 'Pflichtfelder fehlen (turnier_id, bezeichnung, altersklasse, geschlecht, gewichtsklasse).' });
        }
        if (istMannschaftsPool && !MANNSCHAFTS_MODI.has(modus)) {
            return res.status(400).json({ success: false, error: 'Für Mannschaftspools ist nur Jeder-gegen-Jeden oder Doppel-KO-8/16 wählbar.' });
        }

        // Ohne explizite Angabe gilt die altersklassenabhängige DJB-Vorgabe (Art. 3.12.9) statt
        // pauschal "aktiv, unbegrenzt" für jede Altersklasse.
        const gsDefaults = ermittleGoldenScoreEinstellungen(altersklasse);

        const [idObj] = await knex('pools').insert({
            turnier_id: parseInt(turnier_id),
            bezeichnung,
            modus: modus || 'Jeder-gegen-Jeden',
            altersklasse,
            geschlecht,
            gewichtsklasse: istMannschaftsPool ? null : gewichtsklasse,
            typ: istMannschaftsPool ? 'mannschaft' : 'einzel',
            mannschafts_gewichtsklassen: istMannschaftsPool && Array.isArray(mannschafts_gewichtsklassen)
                ? JSON.stringify(mannschafts_gewichtsklassen)
                : null,
            kampfzeit_sekunden: parseInt(kampfzeit_sekunden) || 240,
            golden_score_aktiv: golden_score_aktiv !== undefined ? !!golden_score_aktiv : gsDefaults.aktiv,
            golden_score_max_sekunden: golden_score_max_sekunden !== undefined
                ? (golden_score_max_sekunden ? parseInt(golden_score_max_sekunden, 10) : null)
                : gsDefaults.maxSekunden
        }).returning('id');

        const poolId = typeof idObj === 'object' ? idObj.id : idObj;
        return res.status(201).json({ success: true, poolId });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getPool(knex, req, res) {
    try {
        const { id } = req.params;
        const pool = await knex('pools').where({ id }).first();
        if (!pool) {
            return res.status(404).json({ success: false, error: 'Pool nicht gefunden.' });
        }

        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: id });
        const kaempfe = await knex('kaempfe').where({ pool_id: id }).orderBy('reihenfolge_nummer', 'asc');

        return res.json({
            ...pool,
            teilnehmer,
            kaempfe
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Ermittelt die vom Turnier tatsächlich ausgetragenen Altersklassen-Schlüssel (identische
// Herleitung zu ladeTurnierAltersklassen() in public/js/teilnehmer.js) — null = keine
// Einschränkung hinterlegt.
function ermittleTurnierAltersklassenKeys(turnier) {
    let ak = turnier.altersklassen;
    if (typeof ak === 'string') {
        try { ak = JSON.parse(ak); } catch (e) { ak = {}; }
    }
    let keys = null;
    if (Array.isArray(ak)) keys = ak;
    else if (ak && typeof ak === 'object') keys = Object.keys(ak);
    return keys && keys.length > 0 ? keys : null;
}

function istAltersklasseAusgetragenServer(athlet, turnierAltersklassenKeys) {
    if (!turnierAltersklassenKeys) return true;
    const key = `${athlet.geschlecht}_${athlet.altersklasse}`;
    const mixedKey = `mixed_${athlet.altersklasse}`;
    return turnierAltersklassenKeys.includes(key) || turnierAltersklassenKeys.includes(mixedKey) || turnierAltersklassenKeys.includes(athlet.altersklasse);
}

// Server-seitiges Gegenstück zu berechneStatus() in public/js/teilnehmer.js — muss exakt
// dieselben fünf Kriterien prüfen, damit "rot in der Teilnehmerliste" und "blockiert die
// Pool-Generierung" immer übereinstimmen. Die Judopass-Nummer selbst ist keine eigene
// Voraussetzung mehr — die Lizenzprüfung (lizenzGueltig) deckt das ab, da sie an den Judopass
// gebunden ist (siehe aendereStatusFelder in teilnehmerController.js).
function istTeilnehmerStartberechtigt(athlet, turnier, turnierAltersklassenKeys) {
    const heuteStr = new Date().toISOString().split('T')[0];
    const turnierKostenlos = (parseFloat(turnier.startgeld) || 0) === 0;

    const lizenzGueltig = !!athlet.lizenz_ablauf && athlet.lizenz_ablauf >= heuteStr;
    const startgeldBezahlt = turnierKostenlos || !!athlet.startgeld_bezahlt;
    const gewichtEingetragen = !!athlet.gewicht && parseFloat(athlet.gewicht) > 0;
    const gewogen = !!athlet.gewogen;
    const altersklasseGueltig = istAltersklasseAusgetragenServer(athlet, turnierAltersklassenKeys);

    return lizenzGueltig && startgeldBezahlt && gewichtEingetragen && gewogen && altersklasseGueltig;
}

export async function generierePools(knex, req, res) {
    try {
        const { turnierId, neuGenerieren } = req.body;
        // Waage in Runden: nur die gewählten Altersklassen auslosen; ohne Angabe alle (wie bisher).
        const gewaehlteAltersklassen = Array.isArray(req.body.altersklassen) ? req.body.altersklassen.map(String) : null;
        if (gewaehlteAltersklassen && gewaehlteAltersklassen.length === 0) {
            return res.status(400).json({ success: false, error: 'Bitte mindestens eine Altersklasse wählen.' });
        }

        const turnier = await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });

        // Zurückgezogene Anmeldungen sind für die Auslosung irrelevant und dürfen sie nicht blockieren.
        let teilnehmer = await knex('turnier_teilnehmer').where({ turnier_id: turnierId }).whereNot({ status: 'zurueckgezogen' });
        if (gewaehlteAltersklassen) {
            teilnehmer = teilnehmer.filter(t => gewaehlteAltersklassen.includes(t.altersklasse));
        }
        if (teilnehmer.length === 0) {
            return res.status(400).json({ success: false, error: 'Keine Teilnehmer für dieses Turnier vorhanden.' });
        }

        const turnierAltersklassenKeys = ermittleTurnierAltersklassenKeys(turnier);

        // Wer bereits konkret einer Mannschaft zugeordnet ist (mannschaft_mitglieder-Eintrag,
        // nicht nur das reine Import-Merkmal fuer_mannschaft — siehe teilnehmer.js), nimmt an der
        // Einzelwettkampf-Auslosung nur teil, wenn ausdrücklich "auch Einzelwettkampf" aktiviert
        // wurde (Opt-in, siehe aendereStatusFelder in teilnehmerController.js). Ohne diesen Schalter
        // würde derselbe Kämpfer sonst versehentlich doppelt eingeteilt (Pool UND Mannschaft).
        const mannschaftsMitgliedIds = new Set(
            await knex('mannschaft_mitglieder')
                .join('mannschaften', 'mannschaft_mitglieder.mannschaft_id', 'mannschaften.id')
                .where('mannschaften.turnier_id', turnierId)
                .pluck('mannschaft_mitglieder.turnier_teilnehmer_id')
        );

        // Nur kampfbereite Teilnehmer gehen in die eigentliche Poolbildung ein — nicht (mehr)
        // bestätigte Anmeldungen dürfen die Auslosung der übrigen nicht blockieren, sie werden
        // stattdessen einfach ignoriert (siehe nicht_erschienen-Übergang weiter unten). Vor jedem
        // destruktiven Schritt geprüft, damit kein zu kleiner Teilnehmerkreis bestehende Pools wegräumt.
        const kampfbereiteTeilnehmer = teilnehmer.filter(t =>
            t.status === 'kampfbereit' && (!mannschaftsMitgliedIds.has(t.id) || t.auch_einzelwettkampf)
        );
        if (kampfbereiteTeilnehmer.length < 2) {
            return res.status(400).json({ success: false, error: 'Mindestens 2 Teilnehmer müssen als kampfbereit bestätigt sein, bevor Pools generiert werden können.' });
        }

        // Startberechtigt-Prüfung (Lizenz/Startgeld/Gewicht/Altersklasse) gilt nur noch für
        // kampfbereite Teilnehmer, da nur diese tatsächlich in einen Pool einziehen.
        const nichtStartberechtigt = kampfbereiteTeilnehmer.filter(t => !istTeilnehmerStartberechtigt(t, turnier, turnierAltersklassenKeys));

        if (nichtStartberechtigt.length > 0) {
            const namen = nichtStartberechtigt.slice(0, 5).map(t => `${t.vorname} ${t.nachname}`).join(', ');
            const rest = nichtStartberechtigt.length > 5 ? ` und ${nichtStartberechtigt.length - 5} weitere` : '';
            return res.status(400).json({
                success: false,
                error: `${nichtStartberechtigt.length} kampfbereite Teilnehmer sind noch nicht startberechtigt (rot markiert): ${namen}${rest}. Bitte zuerst in der Teilnehmerliste beheben.`
            });
        }

        // Schutz: bestehende echte Kampfergebnisse dürfen durch eine Neu-Generierung nicht
        // verloren gehen (Freilose zählen dabei nicht als "echter Kampf"). Je Altersklasse:
        // bereits ausgeloste Klassen anderer Runden bleiben unberührt.
        const poolZustand = await ermittleAltersklassenPoolZustand(knex, turnierId);
        const betroffeneAltersklassen = gewaehlteAltersklassen
            || [...new Set(teilnehmer.map(t => t.altersklasse))];
        const gesperrtBetroffen = poolZustand.gesperrteAltersklassen.filter(a => gewaehlteAltersklassen
            ? gewaehlteAltersklassen.includes(a)
            : true);
        if (gesperrtBetroffen.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'Pools können nicht neu generiert werden, da mindestens ein Pool bereits echte Kampfergebnisse enthält.'
            });
        }
        if (gewaehlteAltersklassen && !neuGenerieren) {
            const schonAusgelost = poolZustand.ausgelosteAltersklassen.filter(a => gewaehlteAltersklassen.includes(a));
            if (schonAusgelost.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Altersklasse schon ausgelost: ${schonAusgelost.join(', ')}.`
                });
            }
        }

        const aufgeraeumt = await loeschePoolZuordnungenFuerTurnier(knex, turnierId, gewaehlteAltersklassen ? betroffeneAltersklassen : null);
        if (!aufgeraeumt) {
            return res.status(409).json({
                success: false,
                error: 'Pools können nicht neu generiert werden, da mindestens ein Pool bereits echte Kampfergebnisse enthält.'
            });
        }

        // Zustand "nicht_erschienen": wer bis zum Start der Pool-Zuteilung nicht am Wiegetisch
        // als kampfbereit bestätigt wurde, nimmt nicht an der Auslosung teil. Mit Altersklassen-
        // Auswahl nur für die gewählten Klassen — die übrigen wiegen noch.
        const nichtErschienenQuery = knex('turnier_teilnehmer')
            .where({ turnier_id: turnierId, status: 'angemeldet' });
        if (gewaehlteAltersklassen) nichtErschienenQuery.whereIn('altersklasse', gewaehlteAltersklassen);
        await nichtErschienenQuery.update({ status: 'nicht_erschienen', updated_at: knex.fn.now() });

        let djbKlassen = { weiblich: [], männlich: [], mixed: [] };
        try {
            djbKlassen = JSON.parse(readFileSync(path.join(__dirname, '../config/altersklassen.json'), 'utf-8'));
        } catch (e) {
            console.warn("config/altersklassen.json nicht gefunden, verwende Standard-Kampfzeiten.");
        }

        const holeKampfzeit = (geschlecht, altersklasse) => {
            const liste = djbKlassen[geschlecht] || djbKlassen.männlich;
            const klasse = (liste || []).find(k => k.id === altersklasse);
            return klasse ? parseInt(klasse.kampfzeit, 10) : 240;
        };

        // Ist eine Altersklasse im Turnier explizit als "Mixed" angelegt (Checkbox "mixed_<AK>"
        // in den Turniereinstellungen), werden männliche und weibliche Teilnehmer dieser
        // Altersklasse in EINER gemeinsamen Gruppe zusammengefasst statt getrennt gepoolt.
        const gruppen = {};
        kampfbereiteTeilnehmer.forEach(t => {
            const istMixedAltersklasse = !!(turnierAltersklassenKeys && turnierAltersklassenKeys.includes(`mixed_${t.altersklasse}`));
            const geschlechtFuerGruppe = istMixedAltersklasse ? 'mixed' : t.geschlecht;
            const key = `${geschlechtFuerGruppe}_${t.altersklasse}`;
            if (!gruppen[key]) gruppen[key] = [];
            gruppen[key].push(t);
        });

        // Check database value for altersklassen
        let akConfig = {};
        if (turnier.altersklassen) {
            let ak = turnier.altersklassen;
            if (typeof ak === 'string') {
                try {
                    ak = JSON.parse(ak);
                } catch (e) {
                    ak = {};
                }
            }
            if (Array.isArray(ak)) {
                // Convert array to object mapping to global default
                const globalDefault = Number(turnier.nutze_gewichtsklassen) === 1 ? 'gewichtsnahe' : 'djb';
                akConfig = {};
                ak.forEach(item => {
                    akConfig[item] = globalDefault;
                });
            } else if (typeof ak === 'object') {
                akConfig = ak;
            }
        }

        for (const key in gruppen) {
            const [geschlecht, altersklasse] = key.split('_');
            const liste = gruppen[key];

            // Determine strategy for this specific group (gender + altersklasse)
            let modus = akConfig[key] || akConfig[altersklasse];
            if (!modus) {
                modus = Number(turnier.nutze_gewichtsklassen) === 1 ? 'gewichtsnahe' : 'djb';
            }

            if (modus === 'gewichtsnahe') {
                // --- STRATEGIE A: GEWICHTSNAHE POOLS ---
                const berechnetePools = bildeGewichtsnahePools(liste, altersklasse);

                for (const poolTeilnehmer of berechnetePools) {
                    const anzahl = poolTeilnehmer.length;
                    const gewaehlterModus = waehleWettkampfsystem(anzahl);

                    const sortiertePoolTeilnehmer = [...poolTeilnehmer].sort((a, b) => {
                        return Number.parseFloat(a.gewicht) - Number.parseFloat(b.gewicht);
                    });

                    const leichtester = sortiertePoolTeilnehmer[0];
                    const schwerster = sortiertePoolTeilnehmer[sortiertePoolTeilnehmer.length - 1];

                    const leichtestesGewicht = Number.parseFloat(leichtester.gewicht);
                    const schwerstesGewicht = Number.parseFloat(schwerster.gewicht);

                    // 1. Geschlechts-Kürzel bestimmen, aber bei "Männer", "Frauen", "Mixed" und "mixed" leer lassen
                    let gKuerzel = ' m';
                    if (geschlecht === 'weiblich') gKuerzel = ' w';
                    else if (geschlecht === 'mixed') gKuerzel = '';

                    if (altersklasse === 'Männer' || altersklasse === 'Frauen' || altersklasse === 'Mixed') {
                        gKuerzel = '';
                    }

                    // 2. Gewicht sauber formatieren (ganzzahlig wenn möglich, sonst 1 Dezimale)
                    const formatGewicht = (g) => Number.isInteger(g) ? `${g}` : `${parseFloat(g.toFixed(1))}`;

                    // 3. Bezeichnung generieren: Altersklasse + Geschlecht m/w + -schwerstesGewichtkg
                    const bezeichnung = `${altersklasse}${gKuerzel} -${formatGewicht(schwerstesGewicht)}kg`;

                    const kampfzeit = holeKampfzeit(geschlecht, altersklasse);
                    const gsDefaults = ermittleGoldenScoreEinstellungen(altersklasse);

                    // 4. Datenbank-Eintrag schreiben
                    const [idObj] = await knex('pools').insert({
                        turnier_id: turnierId,
                        bezeichnung,
                        modus: gewaehlterModus,
                        altersklasse,
                        geschlecht,
                        gewichtsklasse: `-${formatGewicht(schwerstesGewicht)}`,
                        kampfzeit_sekunden: kampfzeit,
                        golden_score_aktiv: gsDefaults.aktiv,
                        golden_score_max_sekunden: gsDefaults.maxSekunden
                    }).returning('id');

                    const poolId = typeof idObj === 'object' ? idObj.id : idObj;

                    const teilnehmerIds = poolTeilnehmer.map(pt => pt.id);
                    await knex('turnier_teilnehmer')
                        .whereIn('id', teilnehmerIds)
                        .update({ pool_id: poolId });

                    await initialisiereKaempfeFuerPool(knex, poolId, gewaehlterModus);
                    await aktualisierePoolStatusNachAuslosung(knex, poolId);

                    const gewichtPruefung = pruefeGewichtsspanne(poolTeilnehmer, altersklasse);

                    if (!gewichtPruefung.zulaessig) {
                        console.warn(
                            `[DB] WARNUNG: Pool ${poolId} verletzt Gewichtsspannen-Regeln: ${gewichtPruefung.gruende.join(' ')}`
                        );
                    } else if (anzahl > 1) {
                        console.log(
                            `[DB] Pool ${poolId} erstellt: ${bezeichnung}, Differenz: ${gewichtPruefung.absoluteDifferenz.toFixed(2)} kg, ${(gewichtPruefung.prozentualeDifferenz * 100).toFixed(1)} %.`
                        );
                    } else {
                        console.log(`[DB] Einzelpool ${poolId} erstellt: ${bezeichnung}.`);
                    }
                }
            } else {
                // --- STRATEGIE B: STARRE DJB-GEWICHTSKLASSEN ---
                const gewichtsGruppen = {};
                liste.forEach(t => {
                    if (!gewichtsGruppen[t.gewichtsklasse]) gewichtsGruppen[t.gewichtsklasse] = [];
                    gewichtsGruppen[t.gewichtsklasse].push(t);
                });

                for (const gKlasse in gewichtsGruppen) {
                    const poolTeilnehmer = gewichtsGruppen[gKlasse];
                    const anzahl = poolTeilnehmer.length;

                    const gewaehlterModus = waehleWettkampfsystem(anzahl);

                    let gKuerzel = ' m';
                    if (geschlecht === 'weiblich') gKuerzel = ' w';
                    else if (geschlecht === 'mixed') gKuerzel = '';

                    if (altersklasse === 'Männer' || altersklasse === 'Frauen' || altersklasse === 'Mixed') {
                        gKuerzel = '';
                    }
                    const bezeichnung = `${altersklasse}${gKuerzel} ${gKlasse}kg`;
                    const kampfzeit = holeKampfzeit(geschlecht, altersklasse);
                    const gsDefaultsB = ermittleGoldenScoreEinstellungen(altersklasse);

                    const [idObj] = await knex('pools').insert({
                        turnier_id: turnierId,
                        bezeichnung,
                        modus: gewaehlterModus,
                        altersklasse,
                        geschlecht,
                        gewichtsklasse: gKlasse,
                        kampfzeit_sekunden: kampfzeit,
                        golden_score_aktiv: gsDefaultsB.aktiv,
                        golden_score_max_sekunden: gsDefaultsB.maxSekunden
                    }).returning('id');

                    const poolId = typeof idObj === 'object' ? idObj.id : idObj;
                    const teilnehmerIds = poolTeilnehmer.map(pt => pt.id);
                    await knex('turnier_teilnehmer').whereIn('id', teilnehmerIds).update({ pool_id: poolId });

                    if (gewaehlterModus === 'Gruppen-Überkreuz') await ueberKreuz.initialisierePool(knex, poolId);
                    else if (gewaehlterModus === 'Doppel-KO-8') await doppelKo8.initialisierePool(knex, poolId);
                    else if (gewaehlterModus === 'Doppel-KO-16') await doppelKo16.initialisierePool(knex, poolId);
                    else if (gewaehlterModus === 'Doppel-KO-32') await doppelKo32.initialisierePool(knex, poolId);
                    else await jederGegenJeden.initialisierePool(knex, poolId);
                    await aktualisierePoolStatusNachAuslosung(knex, poolId);
                }
            }
        }

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Leichtgewichtiger Check, welche Altersklassen eines Turniers gesperrt (= mind. ein Pool der
// Altersklasse hatte bereits einen echten, nicht Freilos-Kampf) bzw. ausgelost sind — bewusst OHNE
// requireTournamentEditAccess (siehe poolRoutes.js), da auch Nicht-Ausrichter-Vereinsmitglieder
// (die z.B. nur eigene Teilnehmer anmelden) das wissen müssen, ohne selbst Bearbeitungsrechte
// auf die Pools zu haben. `gesperrt` bleibt als Alias für ältere Clients.
export async function pruefeTeilnehmerlisteGesperrt(knex, req, res) {
    try {
        const { turnierId } = req.query;
        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'turnierId ist erforderlich.' });
        }
        const { gesperrteAltersklassen, ausgelosteAltersklassen } = await ermittleAltersklassenPoolZustand(knex, turnierId);
        return res.json({
            gesperrt: gesperrteAltersklassen.length > 0,
            gesperrteAltersklassen,
            ausgelosteAltersklassen,
            mannschaftenGesperrt: await mannschaftsPoolsHabenEchteKaempfe(knex, turnierId)
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Waage in Runden: je Altersklasse mit Einzel-Teilnehmern die Zahlen für den Generieren-Dialog.
export async function getAltersklassenStatus(knex, req, res) {
    try {
        const { turnierId } = req.query;
        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'turnierId ist erforderlich.' });
        }
        const teilnehmer = await knex('turnier_teilnehmer')
            .where({ turnier_id: turnierId })
            .whereNot({ status: 'zurueckgezogen' })
            .select('id', 'altersklasse', 'status', 'auch_einzelwettkampf');
        const mannschaftsMitgliedIds = new Set(
            await knex('mannschaft_mitglieder')
                .join('mannschaften', 'mannschaft_mitglieder.mannschaft_id', 'mannschaften.id')
                .where('mannschaften.turnier_id', turnierId)
                .pluck('mannschaft_mitglieder.turnier_teilnehmer_id')
        );
        const { gesperrteAltersklassen, ausgelosteAltersklassen } = await ermittleAltersklassenPoolZustand(knex, turnierId);

        const proKlasse = new Map();
        for (const t of teilnehmer) {
            if (!t.altersklasse) continue;
            if (mannschaftsMitgliedIds.has(t.id) && !t.auch_einzelwettkampf) continue;
            if (!proKlasse.has(t.altersklasse)) {
                proKlasse.set(t.altersklasse, { altersklasse: t.altersklasse, kampfbereit: 0, angemeldet: 0, gesamt: 0 });
            }
            const eintrag = proKlasse.get(t.altersklasse);
            eintrag.gesamt++;
            if (t.status === 'kampfbereit') eintrag.kampfbereit++;
            if (t.status === 'angemeldet') eintrag.angemeldet++;
        }
        // Ausgeloste Klassen ohne (aktive) Teilnehmer sollen im Neu-Generieren-Dialog nicht fehlen.
        for (const ak of ausgelosteAltersklassen) {
            if (!proKlasse.has(ak)) proKlasse.set(ak, { altersklasse: ak, kampfbereit: 0, angemeldet: 0, gesamt: 0 });
        }

        const status = [...proKlasse.values()]
            .map(e => ({
                ...e,
                ausgelost: ausgelosteAltersklassen.includes(e.altersklasse),
                hatEchteKaempfe: gesperrteAltersklassen.includes(e.altersklasse)
            }))
            .sort((a, b) => a.altersklasse.localeCompare(b.altersklasse, 'de', { numeric: true }));
        return res.json({ success: true, altersklassen: status });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Pools auslesen und Metadaten (Kampfanzahl, Gesamtdauer) live berechnen

export async function getPoolsMitDetails(knex, req, res) {
    try {
        const { turnierId } = req.query;
        // Mannschafts-Pools bewusst ausgeblendet: diese Ansicht (und pools.js — Drag&Drop
        // einzelner Teilnehmer, Kämpfer-Bracket-Baum) ist strukturell auf Einzelwettkampf-Pools
        // zugeschnitten. Mannschafts-Pools werden vollständig auf der eigenen
        // Mannschaften-Seite (mannschaften.html) verwaltet und angezeigt.
        const pools = await knex('pools').where({ turnier_id: turnierId }).andWhereNot({ typ: 'mannschaft' });

        const ergebnis = await Promise.all(pools.map(async (pool) => {
            const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: pool.id });
            const kaempfe = await knex('kaempfe').where({ pool_id: pool.id });
            const n = teilnehmer.length;

            const freilose = kaempfe.filter(kampf => kampf.status === 'freilos').length;

            const bruttoKaempfe = schaetzeBruttoKaempfe(pool.modus, n);
            const gesamtKaempfe = Math.max(0, bruttoKaempfe - freilose);

            // Dauer in Minuten berechnen (Kämpfe * Kampfzeit in Sekunden / 60)
            const dauerMinuten = Math.ceil((gesamtKaempfe * pool.kampfzeit_sekunden) / 60);

            return {
                ...pool,
                teilnehmer,
                kaempfe,
                anzahl_teilnehmer: n,
                gesamt_kaempfe: gesamtKaempfe,
                freilose,
                dauer_minuten: dauerMinuten
            };
        }));

        return res.json(ergebnis);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Drag&Drop: Teilnehmer in einen anderen Pool verschieben mit Kampfplan-Reorganisation
export async function verschiebeTeilnehmer(knex, req, res) {
    try {
        const { teilnehmerId, zielPoolId } = req.body;

        if (!teilnehmerId) {
            return res.status(400).json({
                success: false,
                error: 'Teilnehmer-ID fehlt.'
            });
        }

        const athlet = await knex('turnier_teilnehmer')
            .where({ id: teilnehmerId })
            .first();

        if (!athlet) {
            return res.status(404).json({
                success: false,
                error: 'Teilnehmer nicht gefunden.'
            });
        }

        const alterPoolId = athlet.pool_id || null;
        const neuerPoolId = zielPoolId || null;

        if (alterPoolId && Number(alterPoolId) === Number(neuerPoolId)) {
            return res.json({
                success: true,
                unchanged: true
            });
        }

        if (neuerPoolId) {
            const zielPool = await knex('pools')
                .where({ id: neuerPoolId })
                .first();

            if (!zielPool) {
                return res.status(404).json({
                    success: false,
                    error: 'Ziel-Pool nicht gefunden.'
                });
            }

            if (Number(zielPool.turnier_id) !== Number(athlet.turnier_id)) {
                return res.status(400).json({
                    success: false,
                    error: 'Teilnehmer und Ziel-Pool gehören nicht zum selben Turnier.'
                });
            }
        }

        const betroffenePoolIds = Array.from(
            new Set([alterPoolId, neuerPoolId].filter(Boolean).map(Number))
        );

        for (const poolId of betroffenePoolIds) {
            const istGesperrt = await poolHatBereitsEchteKaempfe(knex, poolId);

            if (istGesperrt) {
                return res.status(409).json({
                    success: false,
                    error: 'Der Teilnehmer kann nicht verschoben werden, weil in einem betroffenen Pool bereits Kämpfe gestartet oder beendet wurden.'
                });
            }
        }

        const aktualisiertePools = await knex.transaction(async (trx) => {
            await trx('turnier_teilnehmer')
                .where({ id: teilnehmerId })
                .update({
                    pool_id: neuerPoolId
                });

            const ergebnisse = [];

            for (const poolId of betroffenePoolIds) {
                const ergebnis = await regeneriereKampfplanFuerPool(trx, poolId);
                if (ergebnis) ergebnisse.push(ergebnis);
            }

            return ergebnisse;
        });

        return res.json({
            success: true,
            aktualisiertePools
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Name, Kampfzeit und Golden-Score-Einstellungen eines Pools live anpassen
export async function updatePoolStammdaten(knex, req, res) {
    try {
        const { id } = req.params;
        const { bezeichnung, kampfzeit_sekunden, golden_score_aktiv, golden_score_max_sekunden, farbe_kaempfer2 } = req.body;

        const updateData = {
            bezeichnung,
            kampfzeit_sekunden: parseInt(kampfzeit_sekunden, 10)
        };
        if (golden_score_aktiv !== undefined) {
            updateData.golden_score_aktiv = !!golden_score_aktiv;
        }
        if (golden_score_max_sekunden !== undefined) {
            updateData.golden_score_max_sekunden = golden_score_max_sekunden ? parseInt(golden_score_max_sekunden, 10) : null;
        }

        // null/'' = vom Turnier übernehmen
        if (farbe_kaempfer2 !== undefined) {
            updateData.farbe_kaempfer2 = gueltigeFarbe(farbe_kaempfer2);
        }

        await knex('pools').where({ id }).update(updateData);

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Leeren Pool unwiderruflich löschen. Nur erlaubt, solange der Pool noch nicht 'gestartet' ist
// (Zustand 7 der Pool-Spezifikation: "geloescht nur möglich vor dem Zustand gestartet").
export async function deletePool(knex, req, res) {
    try {
        const { id } = req.params;

        // Absicherung: Prüfen, ob der Pool wirklich leer ist
        const insassen = await knex('turnier_teilnehmer').where({ pool_id: id });
        if (insassen.length > 0) {
            return res.status(400).json({ success: false, error: 'Pool ist nicht leer und kann nicht gelöscht werden!' });
        }

        if (await poolHatBereitsEchteKaempfe(knex, id)) {
            return res.status(409).json({ success: false, error: 'Ein bereits gestarteter Pool kann nicht mehr gelöscht werden.' });
        }

        await knex('pools').where({ id }).del();
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Bestätigt die am Tisch geprüften Ergebnisse eines Pools ("kaempfe_beendet" -> "abgeschlossen"):
// Platzierungen stehen fest, Pool ist bereit für Urkundendruck/Siegerehrung. Manueller,
// menschlicher Bestätigungsschritt — kein automatischer Übergang.
export async function schliessePoolAb(knex, req, res) {
    try {
        const { id } = req.params;
        const pool = await knex('pools').where({ id }).first();
        if (!pool) {
            return res.status(404).json({ success: false, error: 'Pool nicht gefunden.' });
        }
        if (pool.status !== 'kaempfe_beendet') {
            return res.status(400).json({ success: false, error: 'Nur Pools mit beendeten Kämpfen können abgeschlossen werden.' });
        }

        await knex('pools').where({ id }).update({ status: 'abgeschlossen' });
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Alle Pools eines Turniers auf einmal löschen (ohne Neu-Generierung) — gibt die Teilnehmerliste
// wieder zur Bearbeitung frei. Blockiert, falls irgendein Pool bereits echte Kampfergebnisse
// enthält (Freilose zählen nicht als "echter Kampf").
export async function loescheAllePools(knex, req, res) {
    try {
        const { turnierId } = req.body;
        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'turnierId ist erforderlich.' });
        }

        const pools = await knex('pools').where({ turnier_id: turnierId }).andWhereNot({ typ: 'mannschaft' }).select('id');
        for (const p of pools) {
            if (await poolHatBereitsEchteKaempfe(knex, p.id)) {
                return res.status(409).json({
                    success: false,
                    error: 'Pools können nicht gelöscht werden, da mindestens ein Pool bereits echte Kampfergebnisse enthält.'
                });
            }
        }

        const geloescht = await loeschePoolZuordnungenFuerTurnier(knex, turnierId);
        if (!geloescht) {
            return res.status(409).json({
                success: false,
                error: 'Pools können nicht gelöscht werden, da mindestens ein Pool bereits echte Kampfergebnisse enthält.'
            });
        }
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Wettkampfsystem eines 6er-Pools nachträglich wechseln (Gruppen-Überkreuz <-> Jeder-gegen-Jeden).
// Nur erlaubt, solange noch keine echten Kampfergebnisse existieren.
export async function aendereWettkampfsystem(knex, req, res) {
    try {
        const { id } = req.params;
        const { modus } = req.body;

        const pool = await knex('pools').where({ id }).first();
        if (!pool) {
            return res.status(404).json({ success: false, error: 'Pool nicht gefunden.' });
        }

        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: id });
        if (teilnehmer.length !== 6) {
            return res.status(400).json({ success: false, error: 'Das Wettkampfsystem kann nur für Pools mit genau 6 Teilnehmern gewechselt werden.' });
        }

        if (!SECHSER_ALTERNATIVEN.has(modus)) {
            return res.status(400).json({ success: false, error: 'Ungültiges Wettkampfsystem für 6 Teilnehmer.' });
        }

        const istGesperrt = await poolHatBereitsEchteKaempfe(knex, id);
        if (istGesperrt) {
            return res.status(409).json({ success: false, error: 'Das System kann nicht mehr gewechselt werden, da in diesem Pool bereits Kämpfe gestartet oder beendet wurden.' });
        }

        await knex('kaempfe').where({ pool_id: id }).del();
        await knex('pools').where({ id }).update({ modus });
        await initialisiereKaempfeFuerPool(knex, id, modus);

        return res.json({ success: true, modus });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Alle Kampfflächen mit zugeordneten Pools laden
export async function getKampfflaechenMitPools(knex, req, res) {
    try {
        const { turnierId } = req.query;
        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'turnierId ist erforderlich' });
        }

        const kampfflaechen = await knex('kampfflaechen')
            .where({ turnier_id: turnierId })
            .orderBy('id');

        const pools = await knex('pools')
            .select(
                'pools.*',
                knex.raw('(SELECT COUNT(*) FROM turnier_teilnehmer WHERE turnier_teilnehmer.pool_id = pools.id) as anzahl_teilnehmer'),
                knex.raw('(SELECT COUNT(*) FROM kaempfe WHERE kaempfe.pool_id = pools.id) as gesamt_kaempfe'),
                // 'beendete_kaempfe' zählt alle abgeschlossenen Kämpfe inkl. Freilos (für Fortschritts-
                // anzeigen), 'echte_beendete_kaempfe' nur reguläre Kämpfe ohne Freilos.
                knex.raw("(SELECT COUNT(*) FROM kaempfe WHERE kaempfe.pool_id = pools.id AND kaempfe.status IN ('beendet', 'freilos')) as beendete_kaempfe"),
                knex.raw("(SELECT COUNT(*) FROM kaempfe WHERE kaempfe.pool_id = pools.id AND kaempfe.status = 'beendet') as echte_beendete_kaempfe"),
                knex.raw("(SELECT COUNT(*) FROM kaempfe WHERE kaempfe.pool_id = pools.id AND kaempfe.status = 'gestartet') as laufende_kaempfe" )
            )
            .where('pools.turnier_id', turnierId);

        const poolsMitDauer = pools.map((p) => ({
            ...p,
            kampflaeche_id: p.kampfflaeche_id, // Map double 'ff' to single 'f' for frontend compatibility
            reihenfolge: p.matte_reihenfolge,  // Map matte_reihenfolge to reihenfolge for frontend compatibility
            dauer_minuten: Math.ceil((p.gesamt_kaempfe * p.kampfzeit_sekunden) / 60),
            // Verbleibende Dauer: nur die noch nicht beendeten Kämpfe (laufende zählen voll mit)
            restdauer_minuten: Math.ceil((Math.max(0, p.gesamt_kaempfe - p.beendete_kaempfe) * p.kampfzeit_sekunden) / 60)
        }));

        const kampflaechenMitPools = kampfflaechen.map((kf) => ({
            ...kf,
            pools: poolsMitDauer
                .filter((p) => p.kampfflaeche_id === kf.id)
                .sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0))
        }));

        const unzugeordnet = poolsMitDauer.filter((p) => p.kampfflaeche_id == null);

        return res.json({ 
            kampfflaechen: kampflaechenMitPools, 
            unzugeordnet,
            pools: poolsMitDauer
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Einzelnen Pool einer Kampffläche zuordnen oder entfernen
export async function ordnePoolZuKampfflaeche(knex, req, res) {
    try {
        const { poolId, kampflaecheId, position } = req.body;

        // Ein Pool mit bereits gestarteten/beendeten echten Kämpfen darf nicht mehr per
        // Drag&Drop von seiner Matte gelöst oder auf eine andere Matte verschoben werden — sonst
        // verlieren bereits ausgetragene Kämpfe stillschweigend ihre Mattenzuordnung (siehe
        // QA-Bericht F4). Konsistent mit generierePools/deletePool/verschiebeTeilnehmer.
        if (await poolHatBereitsEchteKaempfe(knex, poolId)) {
            return res.status(409).json({
                success: false,
                error: 'Der Pool kann nicht mehr umgehängt werden, da bereits Kämpfe gestartet oder beendet wurden.'
            });
        }

        const oldPool = await knex('pools').where({ id: poolId }).first();
        const oldMatId = oldPool ? oldPool.kampfflaeche_id : null;

        if (kampflaecheId == null) {
            await knex('pools').where({ id: poolId }).update({
                kampfflaeche_id: null,
                matte_reihenfolge: null
            });

            // Fights ebenfalls von der Matte lösen
            await knex('kaempfe').where({ pool_id: poolId }).update({
                matten_reihenfolge: null
            });

            if (oldMatId) {
                await planeKaempfeFuerKampfflaeche(knex, oldMatId);
            }
        } else {
            await knex('pools').where({ id: poolId }).update({
                kampfflaeche_id: kampflaecheId,
                matte_reihenfolge: position
            });

            await planeKaempfeFuerKampfflaeche(knex, kampflaecheId);

            // Die ALTE Matte muss ebenfalls neu geplant werden: ihre verbleibenden Pools waren
            // beim letzten Planungslauf noch mit dem jetzt weggezogenen Pool interleaved (siehe
            // "aktives Fenster"-Logik dort) — ohne diesen erneuten Aufruf behalten sie ihre alte,
            // jetzt lückenhafte matten_reihenfolge und können die Mindestpausenregel zwischen zwei
            // Kämpfen desselben Kämpfers/derselben Kämpferin verletzen (analog zum null-Zweig oben,
            // der die alte Matte beim reinen Entfernen bereits korrekt neu plant).
            if (oldMatId && oldMatId !== kampflaecheId) {
                await planeKaempfeFuerKampfflaeche(knex, oldMatId);
            }
        }

        await aktualisierePoolStatusNachAuslosung(knex, poolId);
        if (oldMatId && oldMatId !== kampflaecheId) {
            await synchronisiereMattenStatus(knex, oldMatId);
        }
        await synchronisiereMattenStatus(knex, kampflaecheId);

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Löst alle Pool-zu-Kampffläche-Zuordnungen eines Turniers auf einmal (z.B. um die Verteilung
// komplett neu zu planen).
export async function entferneAlleMattenzuordnungen(knex, req, res) {
    try {
        const { turnierId } = req.body;
        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'turnierId ist erforderlich.' });
        }

        const pools = await knex('pools').where({ turnier_id: turnierId }).select('id', 'kampfflaeche_id');

        // Blockiert wird nur bei BEENDETEN Kämpfen (echte Ergebnisse, siehe QA-Bericht F4). Ein bloß
        // "gestarteter" Kampf ohne Ergebnis — das Scoreboard markiert jeden geladenen Kampf automatisch
        // so — hindert die Aktion nicht; er wird unten wieder auf "bereit" gesetzt.
        const poolIdsAlle = pools.map(p => p.id);
        const beendet = poolIdsAlle.length
            ? await knex('kaempfe').whereIn('pool_id', poolIdsAlle).where({ status: 'beendet' }).first('id')
            : null;
        if (beendet) {
            return res.status(409).json({
                success: false,
                error: 'Die Mattenzuordnungen können nicht entfernt werden, da mindestens ein Pool bereits echte Kampfergebnisse enthält.'
            });
        }

        const poolIds = pools.map(p => p.id);
        const betroffeneMatten = [...new Set(pools.map(p => p.kampfflaeche_id).filter(Boolean))];

        await knex('pools').where({ turnier_id: turnierId }).update({
            kampfflaeche_id: null,
            matte_reihenfolge: null
        });

        if (poolIds.length > 0) {
            await knex('kaempfe').whereIn('pool_id', poolIds).update({ matten_reihenfolge: null });
            // Angefangene, aber nicht beendete Kämpfe zurück auf "bereit"; Pools, die nur deshalb "gestartet"
            // waren, zurück in den Zustand ohne Matte.
            await knex('kaempfe').whereIn('pool_id', poolIds).where({ status: 'gestartet' })
                .update({ status: 'bereit', updated_at: knex.fn.now() });
            await knex('pools').whereIn('id', poolIds).where({ status: 'gestartet' }).update({ status: 'teilnehmer_zugewiesen' });
            for (const poolId of poolIds) {
                await aktualisierePoolStatusNachAuslosung(knex, poolId);
            }
        }

        for (const kampflaecheId of betroffeneMatten) {
            await synchronisiereMattenStatus(knex, kampflaecheId);
        }

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Reihenfolge aller Pools auf einer Kampffläche setzen
export async function setzeKampfflaecheReihenfolge(knex, req, res) {
    try {
        const { kampflaecheId, poolIds } = req.body;

        await knex.transaction(async (trx) => {
            for (let i = 0; i < poolIds.length; i++) {
                await trx('pools').where({ id: poolIds[i] }).update({
                    kampfflaeche_id: kampflaecheId,
                    matte_reihenfolge: i
                });
            }
        });

        await planeKaempfeFuerKampfflaeche(knex, kampflaecheId);
        for (const poolId of poolIds) {
            await aktualisierePoolStatusNachAuslosung(knex, poolId);
        }
        await synchronisiereMattenStatus(knex, kampflaecheId);

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Kennzahlen aller Pools in zwei Abfragen (statt mehrerer je Pool): Kämpfe je Status gruppiert und
// Teilnehmer je Pool. `echt` = gestartet/beendet, `offen` = weder beendet noch Freilos.
async function ladePoolKennzahlen(knex, poolIds) {
    const kennzahlen = new Map(poolIds.map(id => [id, { gesamt: 0, freilose: 0, offen: 0, echt: 0, teilnehmer: 0 }]));
    if (poolIds.length === 0) return kennzahlen;

    const kampfZeilen = await knex('kaempfe')
        .whereIn('pool_id', poolIds)
        .groupBy('pool_id', 'status')
        .select('pool_id', 'status')
        .count({ anzahl: '*' });
    for (const z of kampfZeilen) {
        const k = kennzahlen.get(z.pool_id);
        const anzahl = Number(z.anzahl);
        k.gesamt += anzahl;
        if (z.status === 'freilos') k.freilose += anzahl;
        if (z.status !== 'beendet' && z.status !== 'freilos') k.offen += anzahl;
        if (z.status === 'gestartet' || z.status === 'beendet') k.echt += anzahl;
    }

    const teilnehmerZeilen = await knex('turnier_teilnehmer')
        .whereIn('pool_id', poolIds)
        .groupBy('pool_id')
        .select('pool_id')
        .count({ anzahl: '*' });
    for (const z of teilnehmerZeilen) kennzahlen.get(z.pool_id).teilnehmer = Number(z.anzahl);

    return kennzahlen;
}

// Pools automatisch auf Kampfflächen verteilen (Bin Packing, Algorithmus in services/mattenVerteilung.js).
// modus 'neue' (Standard): nur Pools ohne Matte, an die bestehenden Zuordnungen angehängt (Waage in
// Runden); modus 'alle': alle Pools ohne echte Kämpfe neu verteilen.
export async function verteilePools(knex, req, res) {
    try {
        const { turnierId } = req.body;
        const modus = req.body.modus === 'alle' ? 'alle' : 'neue';

        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'turnierId ist erforderlich.' });
        }

        const mats = await knex('kampfflaechen')
            .where({ turnier_id: parseInt(turnierId) })
            .orderBy('id', 'asc');

        if (mats.length === 0) {
            return res.status(400).json({ success: false, error: 'Es wurden keine Kampfflächen für dieses Turnier angelegt.' });
        }

        const pools = await knex('pools').where({ turnier_id: parseInt(turnierId) });

        // Pools mit bereits gestarteten/beendeten echten Kämpfen dürfen von der automatischen
        // Verteilung nicht angerührt werden — ihre aktuelle Mattenzuordnung bleibt unverändert
        // stehen (siehe QA-Bericht F4). Ohne diesen Ausschluss wurden sie weiter unten trotzdem
        // erst von ihrer Matte gelöst und danach, weil aus activePools ausgeschlossen, nie wieder
        // zugeordnet — bereits ausgetragene Kämpfe verloren so stillschweigend ihre Matte.
        const kennzahlen = await ladePoolKennzahlen(knex, pools.map(p => p.id));
        const gesperrtePoolIds = new Set(pools.filter(p => kennzahlen.get(p.id).echt > 0).map(p => p.id));
        // Modus 'neue': bereits zugeordnete Pools bleiben unberührt, ihre Restdauer belastet die Matte.
        const verteilbarePools = pools.filter(p => !gesperrtePoolIds.has(p.id)
            && (modus === 'alle' || !p.kampfflaeche_id));

        // Anfangslast je Matte: Restdauer (nicht beendete Kämpfe mal Kampfzeit) und Anzahl/nächste
        // Reihenfolge der Pools, die auf der Matte stehen bleiben ('neue': alle zugeordneten Pools,
        // 'alle': die gesperrten, die nicht neu verteilt werden). So kollidieren neue Positionen nie
        // mit bestehenden matte_reihenfolge-Werten.
        const startLasten = {};
        const bleibendePools = pools.filter(p => p.kampfflaeche_id
            && (modus === 'neue' || gesperrtePoolIds.has(p.id)));
        for (const pool of bleibendePools) {
            const dauer = Math.ceil((kennzahlen.get(pool.id).offen * pool.kampfzeit_sekunden) / 60);
            const last = startLasten[pool.kampfflaeche_id] || { dauer: 0, anzahl: 0 };
            last.dauer += dauer;
            last.anzahl = pool.matte_reihenfolge == null
                ? last.anzahl + 1
                : Math.max(last.anzahl, Number(pool.matte_reihenfolge) + 1);
            startLasten[pool.kampfflaeche_id] = last;
        }

        // Pools mit min. 1 Kampf. Einzelwettkampf-Pools: Kämpfe aus der Teilnehmerzahl geschätzt.
        // Mannschafts-Pools: keine Teilnehmerzahl-Schätzung (Einzelkämpfer hängen nie direkt per
        // pool_id an einem Mannschafts-Pool, sondern über mannschaften.pool_id) — stattdessen die
        // zu diesem Zeitpunkt bereits erzeugten echten Einzelkämpfe der Begegnungen zählen (siehe
        // mannschaftsBegegnungEngine.js, läuft bereits bei Team-Zuordnung/Automatisch verteilen).
        const aktivePools = [];
        for (const pool of verteilbarePools) {
            const { gesamt, freilose, teilnehmer } = kennzahlen.get(pool.id);
            const gesamtKaempfe = pool.typ === 'mannschaft'
                ? Math.max(0, gesamt - freilose)
                : Math.max(0, schaetzeBruttoKaempfe(pool.modus, teilnehmer) - freilose);

            if (gesamtKaempfe > 0) {
                pool.gesamt_kaempfe = gesamtKaempfe;
                pool.dauer_minuten = Math.ceil((gesamtKaempfe * pool.kampfzeit_sekunden) / 60);
                aktivePools.push(pool);
            }
        }

        if (aktivePools.length === 0) {
            return res.status(400).json({
                success: false,
                keineNeuenPools: modus === 'neue',
                error: modus === 'neue'
                    ? 'Es sind keine weiteren Pools zur Verteilung bereit.'
                    : 'Es gibt keine aktiven Pools mit Kämpfen zum Verteilen.'
            });
        }

        const zuordnung = verteilePoolsAufMatten({ pools: aktivePools, matten: mats, startLasten });

        // Zuordnungen in der Datenbank aktualisieren (Transaktion)
        await knex.transaction(async (trx) => {
            if (modus === 'alle') {
                // Zuerst alle noch verteilbaren (nicht gesperrten) Pools dieses Turniers von den
                // Matten lösen — gesperrte Pools (echte Kämpfe bereits gestartet/beendet) bleiben
                // unangetastet auf ihrer bisherigen Matte stehen.
                let wipeQuery = trx('pools').where({ turnier_id: parseInt(turnierId) });
                if (gesperrtePoolIds.size > 0) {
                    wipeQuery = wipeQuery.whereNotIn('id', Array.from(gesperrtePoolIds));
                }
                await wipeQuery.update({
                    kampfflaeche_id: null,
                    matte_reihenfolge: null
                });
            }

            for (const mat of zuordnung) {
                for (let i = 0; i < mat.pools.length; i++) {
                    await trx('pools').where({ id: mat.pools[i].id }).update({
                        kampfflaeche_id: mat.id,
                        matte_reihenfolge: mat.startReihenfolge + i
                    });
                }
            }
        });

        // Nach der Verteilung die Kämpfe der betroffenen Matten neu planen!
        for (const mat of zuordnung) {
            if (mat.pools.length === 0 && modus === 'neue') continue;
            await planeKaempfeFuerKampfflaeche(knex, mat.id);
            for (const p of mat.pools) {
                await aktualisierePoolStatusNachAuslosung(knex, p.id);
            }
            await synchronisiereMattenStatus(knex, mat.id);
        }

        const anzahl = aktivePools.length;
        return res.json({
            success: true,
            verteiltePools: anzahl,
            message: `${anzahl} ${anzahl === 1 ? 'Pool' : 'Pools'} erfolgreich auf Kampfflächen aufgeteilt.`
        });
    } catch (error) {
        console.error('[Pool-Aufteilungs-Fehler]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Sucht unter den gegebenen Pool-IDs den DRINGENDSTEN noch offenen Kampf, der das Prädikat
// erfüllt: pro Pool zählt dabei nur dessen jeweils ERSTER Kampf, der das Prädikat erfüllt (Anders
// als eine reine Queue wird dafür JEDER noch offene Kampf eines Pools geprüft, nicht nur der
// vorderste — nur so lässt sich auch innerhalb eines einzelnen Pools frei umsortieren, wenn dessen
// eigene Grundreihenfolge, z.B. die feste Jeder-gegen-Jeden-Paarungstabelle, bereits
// Pausenkonflikte enthält). Unter den so ermittelten Kandidaten (höchstens einer pro Pool) gewinnt
// dann NICHT einfach der zuerst in Pool-Rotationsreihenfolge gefundene, sondern der mit dem
// kleinsten dringlichkeitFn()-Wert (kleinster verbleibender Pausenpuffer, siehe pausenPuffer()) —
// sonst würde ein "unkritischer" Kandidat eines Pools (z.B. zwei ganz frische Kämpfer) einen
// tatsächlich dringenderen Kandidaten eines anderen aktiven Pools blockieren, nur weil er zuerst an
// der Reihe war. dringlichkeitFn ist optional: ohne sie verhält sich die Funktion wie zuvor
// (erster Treffer in Pool-Rotationsreihenfolge gewinnt).
function sucheKandidat(poolIdsZuPruefen, poolQueues, rotationsStart, praedikat, dringlichkeitFn) {
    let bester = null;
    let besteDringlichkeit = Infinity;

    for (let offset = 0; offset < poolIdsZuPruefen.length; offset++) {
        const poolId = poolIdsZuPruefen[(rotationsStart + offset) % poolIdsZuPruefen.length];
        const queue = poolQueues[poolId];

        for (const kampf of queue) {
            if (!praedikat(kampf, poolId)) continue;

            if (!dringlichkeitFn) {
                return { kampf, poolId, gewaehlterOffset: offset };
            }

            const dringlichkeit = dringlichkeitFn(kampf);
            if (bester === null || dringlichkeit < besteDringlichkeit) {
                besteDringlichkeit = dringlichkeit;
                bester = { kampf, poolId, gewaehlterOffset: offset };
            }
            break; // nur der jeweils erste passende Kampf pro Pool ist dessen Kandidat
        }
    }

    return bester;
}

// Hilfsfunktion: Ordnet alle noch ausstehenden ('bereit') Kämpfe einer Kampffläche optimal an.
//
// Ziel (siehe Betriebsregeln der Turnierleitung): kein/e Kämpfer/in soll weniger Pause haben als
// ihre/seine Altersklasse vorschreibt (6 Minuten bis U15, sonst 10 Minuten — ermittlePausensekunden
// in pausenRegel.js), geschätzt über die Kampfzeit der dazwischen geplanten Kämpfe. Es werden
// AUSSCHLIESSLICH Pools dieser einen Kampffläche herangezogen (nie eine andere Matte) und dabei
// nach Möglichkeit nicht mehr als zwei Pools gleichzeitig „aktiv" gehalten — ein dritter,
// wartender Pool dieser Matte wird nur testweise für einen einzelnen Kampf hinzugezogen, wenn die
// zwei aktiven Pools allein keinen pausenkonformen Kandidaten mehr liefern. Bereits
// 'gestartet'e/'beendet'e/'freilos'-Kämpfe werden nicht umsortiert (ihre matten_reihenfolge
// bleibt unangetastet), dienen aber weiterhin als Referenz für die Pausen-Uhr der beteiligten
// Kämpfer. Lässt sich die Regel für keinen verbleibenden Kandidaten einhalten (z.B. gegen Ende
// eines kleinen Pools unvermeidbar), wird der Kampf mit dem geringsten Pausen-Defizit gewählt —
// die Steuerung zeigt in diesem Fall zur Kampfzeit anhand ECHTER Zeitstempel eine Warnung an
// (siehe berechnePausenwarnung in pausenRegel.js) und erlaubt einen manuellen Tausch.
export async function planeKaempfeFuerKampfflaeche(knex, kampfflaecheId) {
    if (!kampfflaecheId) return;

    // 1. Lade alle Pools, die dieser Kampffläche zugeordnet sind
    const pools = await knex('pools')
        .where({ kampfflaeche_id: kampfflaecheId })
        .orderBy('matte_reihenfolge', 'asc')
        .orderBy('id', 'asc');

    if (pools.length === 0) return;

    const poolIds = pools.map(p => p.id);
    const poolById = new Map(pools.map(p => [p.id, p]));

    // 2. Lade alle Kämpfe dieser Pools
    const alleKaempfe = await knex('kaempfe')
        .whereIn('pool_id', poolIds)
        .orderBy('id', 'asc');

    // 'freilos' verbraucht keine Mattenzeit und ist keine echte Belastung -> ignorieren.
    // 'angelegt' hat noch keine feststehenden Kämpfer und ist noch nicht einplanbar.
    const fixierteKaempfe = alleKaempfe
        .filter(k => k.status === 'gestartet' || k.status === 'beendet')
        .sort((a, b) => (a.matten_reihenfolge ?? Number.MAX_SAFE_INTEGER) - (b.matten_reihenfolge ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);
    // Von Hand einsortierte Kämpfe (Drag&Drop, Zurücksetzen) behalten ihre Position: der Planer
    // fasst sie nicht an und hängt neu freigegebene Kämpfe dahinter an.
    const manuelleKaempfe = alleKaempfe
        .filter(k => k.status === 'bereit' && k.reihenfolge_manuell && k.matten_reihenfolge != null)
        .sort((a, b) => a.matten_reihenfolge - b.matten_reihenfolge || a.id - b.id);
    const planbareKaempfe = alleKaempfe.filter(k => k.status === 'bereit' && !manuelleKaempfe.includes(k));

    if (planbareKaempfe.length === 0) {
        // Nichts neu einzuplanen — vorhandene Reihenfolge bleibt wie sie ist.
        return;
    }

    // 3. Pausen-Uhr mit den bereits feststehenden Kämpfen (in ihrer bisherigen Reihenfolge)
    // vorspulen, damit die Pausenhistorie der Kämpfer beim Einplanen der neuen Kämpfe korrekt
    // fortgesetzt wird. Bei 'beendet'en Kämpfen zählt die ECHTE Kampfzeit, sonst die nominale
    // Kampfzeit des Pools als Schätzung.
    let laufendeZeit = 0;
    const letzteZeitProKaempfer = new Map();
    for (const kampf of [...fixierteKaempfe, ...manuelleKaempfe]) {
        const pool = poolById.get(kampf.pool_id);
        const dauer = kampf.kampfzeit_in_sekunden > 0 ? kampf.kampfzeit_in_sekunden : (pool?.kampfzeit_sekunden || 240);
        laufendeZeit += dauer;
        if (kampf.kaempfer1_id) letzteZeitProKaempfer.set(kampf.kaempfer1_id, laufendeZeit);
        if (kampf.kaempfer2_id) letzteZeitProKaempfer.set(kampf.kaempfer2_id, laufendeZeit);
    }

    function pausenDefizit(kampf) {
        const pool = poolById.get(kampf.pool_id);
        const benoetigt = ermittlePausensekunden(pool.altersklasse);
        let defizit = 0;
        for (const kaempferId of [kampf.kaempfer1_id, kampf.kaempfer2_id]) {
            if (!kaempferId) continue;
            const letzte = letzteZeitProKaempfer.get(kaempferId);
            if (letzte === undefined) continue;
            defizit = Math.max(defizit, benoetigt - (laufendeZeit - letzte));
        }
        return defizit; // <= 0 bedeutet: Pausenregel eingehalten
    }

    // Wie DRINGEND ist es, GENAU DIESEN Kampf JETZT einzuplanen? Je kleiner der verbleibende
    // Pausenpuffer eines Kämpfers (0 = gerade noch zulässig, größer = noch Luft bis zur Grenze),
    // desto eher würde eine spätere Position die Pausenregel verletzen. Kämpfer ohne Vorkampf auf
    // dieser Matte liefern keinen Beitrag (Infinity = beliebig verschiebbar) — ein Kampf zwischen
    // zwei ganz frischen Kämpfern gilt daher als am wenigsten dringend und darf getrost warten,
    // während ein knapp zulässiger Kandidat bevorzugt sofort verplant wird. Ohne diese Priorisierung
    // (reine Pool-Rotationsreihenfolge wie zuvor) kann ein kleiner "Füll"-Pool mit lauter frischen
    // Kämpfern fälschlich VOR einem dringenderen Kandidaten des anderen aktiven Pools gezogen
    // werden und ist dann schon aufgebraucht, wenn er später als Lückenfüller gebraucht würde.
    function pausenPuffer(kampf) {
        const pool = poolById.get(kampf.pool_id);
        const benoetigt = ermittlePausensekunden(pool.altersklasse);
        let minPuffer = Infinity;
        for (const kaempferId of [kampf.kaempfer1_id, kampf.kaempfer2_id]) {
            if (!kaempferId) continue;
            const letzte = letzteZeitProKaempfer.get(kaempferId);
            if (letzte === undefined) continue;
            minPuffer = Math.min(minPuffer, (laufendeZeit - letzte) - benoetigt);
        }
        return minPuffer;
    }

    // Mannschafts-Pools nehmen NICHT an der pausenoptimierten Umsortierung teil: DJB-Mannschafts-
    // wettkämpfe laufen in einer festen, nach Gewichtsklassen geordneten Reihenfolge je Begegnung
    // (siehe erzeugeEinzelkaempfeFuerBegegnung — legt die Kämpfe schon in dieser Reihenfolge an,
    // ihre aufsteigende id spiegelt das also bereits wider). Sie werden weiter unten unverändert
    // in dieser Reihenfolge ans Ende angehängt, statt wie Einzelwettkampf-Kämpfe frei nach
    // Pausenlage zwischen Pools verschoben zu werden.
    const einzelPoolIds = poolIds.filter(id => poolById.get(id)?.typ !== 'mannschaft');
    const planbareMannschaftsKaempfe = planbareKaempfe
        .filter(k => poolById.get(k.pool_id)?.typ === 'mannschaft')
        .sort((a, b) => (poolById.get(a.pool_id)?.matte_reihenfolge ?? 0) - (poolById.get(b.pool_id)?.matte_reihenfolge ?? 0) || a.id - b.id);

    // 4. Verbleibende Kämpfe pro (Einzelwettkampf-)Pool gruppieren (frei durchsuchbar, keine
    // strikte FIFO-Queue)
    const poolQueues = {};
    einzelPoolIds.forEach(id => { poolQueues[id] = planbareKaempfe.filter(k => k.pool_id === id); });

    // "Wenn möglich nicht mehr als zwei Pools gleichzeitig": aktives Fenster startet mit
    // höchstens 2 Pools, die tatsächlich noch offene Kämpfe haben; alle weiteren bleiben
    // zunächst "wartend" und werden nur bei Bedarf einzeln testweise herangezogen.
    const poolIdsMitOffenenKaempfen = einzelPoolIds.filter(id => poolQueues[id].length > 0);
    let aktivePoolIds = poolIdsMitOffenenKaempfen.slice(0, 2);
    let wartendePoolIds = poolIdsMitOffenenKaempfen.slice(2);

    const neuGeplant = [];
    let rotationsCursor = 0;

    while (aktivePoolIds.some(id => poolQueues[id].length > 0) || wartendePoolIds.length > 0) {
        // Sicherstellen, dass das aktive Fenster (bis zu 2 Pools) tatsächlich noch offene Kämpfe hat
        aktivePoolIds = aktivePoolIds.filter(id => poolQueues[id].length > 0);
        while (aktivePoolIds.length < 2 && wartendePoolIds.length > 0) {
            aktivePoolIds.push(wartendePoolIds.shift());
        }
        if (aktivePoolIds.length === 0) break;

        // Schritt 1: dringendster pausenkonformer Kandidat unter den (bis zu 2) aktiven Pools
        let treffer = sucheKandidat(aktivePoolIds, poolQueues, rotationsCursor, k => pausenDefizit(k) <= 0, pausenPuffer);

        // Schritt 2: reicht das nicht, testweise EINEN weiteren (wartenden) Pool dieser Matte
        // für diesen einen Kampf hinzuziehen — "Kämpfe aus einem weiteren Pool heranziehen".
        if (!treffer && wartendePoolIds.length > 0) {
            const erweitert = [...aktivePoolIds, wartendePoolIds[0]];
            treffer = sucheKandidat(erweitert, poolQueues, rotationsCursor, k => pausenDefizit(k) <= 0, pausenPuffer);
        }

        // Schritt 3: immer noch nichts -> geringstes Pausen-Defizit wählen (Restfall, den die
        // Steuerung zur Laufzeit mit echten Zeitstempeln erkennt und per Tausch auflösen kann).
        if (!treffer) {
            const kandidatenPools = wartendePoolIds.length > 0 ? [...aktivePoolIds, wartendePoolIds[0]] : aktivePoolIds;
            let bestesDefizit = Infinity;
            for (const poolId of kandidatenPools) {
                for (const kampf of poolQueues[poolId]) {
                    const defizit = pausenDefizit(kampf);
                    if (defizit < bestesDefizit) {
                        bestesDefizit = defizit;
                        treffer = { kampf, poolId };
                    }
                }
            }
        }

        if (!treffer) break; // sollte nur passieren, wenn wirklich keine offenen Kämpfe mehr da sind

        const { kampf, poolId } = treffer;
        poolQueues[poolId] = poolQueues[poolId].filter(k => k.id !== kampf.id);
        neuGeplant.push(kampf);

        const pool = poolById.get(poolId);
        laufendeZeit += (pool.kampfzeit_sekunden || 240);
        if (kampf.kaempfer1_id) letzteZeitProKaempfer.set(kampf.kaempfer1_id, laufendeZeit);
        if (kampf.kaempfer2_id) letzteZeitProKaempfer.set(kampf.kaempfer2_id, laufendeZeit);

        if (poolQueues[poolId].length === 0) {
            aktivePoolIds = aktivePoolIds.filter(id => id !== poolId);
            wartendePoolIds = wartendePoolIds.filter(id => id !== poolId);
        } else {
            const indexImAktivenFenster = aktivePoolIds.indexOf(poolId);
            if (indexImAktivenFenster !== -1) {
                rotationsCursor = (indexImAktivenFenster + 1) % Math.max(aktivePoolIds.length, 1);
            }
        }
    }

    // Mannschafts-Pool-Kämpfe dürfen erst dann überhaupt in die Warteschlange dieser Matte
    // aufgenommen werden, wenn ALLE Einzelwettkampf-Pools dieser Matte fertig ausgekämpft sind
    // ('kaempfe_beendet'/'abgeschlossen') — nicht nur, wenn gerade zufällig kein Einzelkampf
    // 'bereit' ist (z.B. eine kurze Lücke zwischen zwei KO-Runden). Ohne diese explizite Sperre
    // könnte eine solche Lücke einen Mannschaftskampf als "nächsten Kampf" einreihen, obwohl der
    // Einzelwettkampf-Pool noch nicht fertig ist.
    const einzelPools = pools.filter(p => p.typ !== 'mannschaft');
    const alleEinzelPoolsAbgeschlossen = einzelPools.every(p => p.status === 'kaempfe_beendet' || p.status === 'abgeschlossen');

    if (alleEinzelPoolsAbgeschlossen) {
        // Mannschafts-Pool-Kämpfe unverändert in ihrer festen Reihenfolge ans Ende anhängen
        // (siehe Kommentar oben) — sie nehmen an Schritt 4 (pausenoptimierte Umsortierung)
        // nicht teil, die Pausen-Uhr wird aber der Vollständigkeit halber trotzdem weitergeführt.
        for (const kampf of planbareMannschaftsKaempfe) {
            neuGeplant.push(kampf);
            const pool = poolById.get(kampf.pool_id);
            laufendeZeit += (pool?.kampfzeit_sekunden || 240);
            if (kampf.kaempfer1_id) letzteZeitProKaempfer.set(kampf.kaempfer1_id, laufendeZeit);
            if (kampf.kaempfer2_id) letzteZeitProKaempfer.set(kampf.kaempfer2_id, laufendeZeit);
        }
    } else {
        // Noch nicht dran: eine bereits vorher vergebene matten_reihenfolge zurücksetzen, damit
        // sie sicher nicht als "nächster Kampf" vor einem noch offenen Einzelwettkampf-Pool
        // erscheinen.
        const zurueckzusetzen = planbareMannschaftsKaempfe.filter(k => k.matten_reihenfolge != null).map(k => k.id);
        if (zurueckzusetzen.length > 0) {
            await knex('kaempfe').whereIn('id', zurueckzusetzen).update({ matten_reihenfolge: null });
        }
    }

    // 5. In der Datenbank die matten_reihenfolge für die neu geplanten Kämpfe fortlaufend NACH
    // der höchsten bereits vergebenen Position anhängen (die feststehenden Kämpfe werden nicht
    // umnummeriert, ihre bisherigen — ggf. lückenhaften, z.B. durch einen manuellen Tausch
    // entstandenen — Werte bleiben also gültige, kollisionsfreie Referenzpunkte).
    const bisherigeMaxPosition = alleKaempfe.reduce(
        (max, k) => (k.matten_reihenfolge != null && k.matten_reihenfolge > max ? k.matten_reihenfolge : max),
        -1
    );
    const startPosition = bisherigeMaxPosition + 1;
    await knex.transaction(async (trx) => {
        for (let i = 0; i < neuGeplant.length; i++) {
            await trx('kaempfe')
                .where({ id: neuGeplant[i].id })
                .update({ matten_reihenfolge: startPosition + i });
        }
    });
}

// Exponierte Controller-Funktion, um Kämpfe eines Turniers manuell anzuordnen
export async function planeKaempfe(knex, req, res) {
    try {
        const { turnierId } = req.body;
        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'turnierId ist erforderlich.' });
        }

        const mats = await knex('kampfflaechen').where({ turnier_id: parseInt(turnierId) });
        for (const mat of mats) {
            await planeKaempfeFuerKampfflaeche(knex, mat.id);
        }

        return res.json({ success: true, message: 'Kämpfe erfolgreich für alle Kampfflächen geplant.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getDashboardData(knex, req, res) {
    try {
        const { turnierId } = req.query;
        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'turnierId ist erforderlich.' });
        }

        // 1. Alle Kampfflächen laden
        const kampfflaechen = await knex('kampfflaechen')
            .where({ turnier_id: parseInt(turnierId) })
            .orderBy('id', 'asc');

        // 2. Alle Pools des Turniers laden
        const pools = await knex('pools')
            .select(
                'pools.*',
                knex.raw('(SELECT COUNT(*) FROM kaempfe WHERE kaempfe.pool_id = pools.id) as gesamt_kaempfe'),
                knex.raw("(SELECT COUNT(*) FROM kaempfe WHERE kaempfe.pool_id = pools.id AND kaempfe.status IN ('beendet', 'freilos')) as beendete_kaempfe")
            )
            .where('pools.turnier_id', parseInt(turnierId));

        const resultMats = [];

        // 3. Für jede Kampffläche die Fights laden
        for (const kf of kampfflaechen) {
            // Alle Kämpfe dieser Kampffläche, die noch nicht beendet sind (bereit oder laufend), sortiert nach matten_reihenfolge
            let fights = await knex('kaempfe')
                .join('pools', 'kaempfe.pool_id', '=', 'pools.id')
                .leftJoin('turnier_teilnehmer as t1', 'kaempfe.kaempfer1_id', '=', 't1.id')
                .leftJoin('turnier_teilnehmer as t2', 'kaempfe.kaempfer2_id', '=', 't2.id')
                .where('pools.kampfflaeche_id', kf.id)
                .whereNotIn('kaempfe.status', ['beendet', 'freilos'])
                .select(
                    'kaempfe.*',
                    'pools.bezeichnung as pool_bezeichnung',
                    't1.vorname as kaempfer1_vorname',
                    't1.nachname as kaempfer1_nachname',
                    't1.verein as kaempfer1_verein',
                    't2.vorname as kaempfer2_vorname',
                    't2.nachname as kaempfer2_nachname',
                    't2.verein as kaempfer2_verein'
                )
                .orderBy('kaempfe.matten_reihenfolge', 'asc')
                .orderBy('kaempfe.id', 'asc');

            // Mannschaftskampf-Einzelkämpfe dürfen erst als "bereit"/anspielbar erscheinen, wenn
            // alle Einzelwettkampf-Pools dieser Matte fertig ausgekämpft sind (gleiche Regel wie
            // in poolController.planeKaempfeFuerKampfflaeche und kampfController.getKaempfe).
            const einzelPoolsAufMatte = pools.filter(p => p.kampfflaeche_id === kf.id && p.typ !== 'mannschaft');
            const alleEinzelPoolsAbgeschlossen = einzelPoolsAufMatte.every(p => p.status === 'kaempfe_beendet' || p.status === 'abgeschlossen');
            if (!alleEinzelPoolsAbgeschlossen) {
                fights = fights.filter(f => !f.mannschaftskampf_id);
            }

            // Mannschaftskampf-Einzelkämpfe zeigen statt des reinen Pool-Namens "<Poolname>
            // <Gewichtsklasse>" (siehe gleiche Logik in kampfController.getKaempfe).
            for (const fight of fights) {
                if (fight.mannschaft_gewichtsklasse) {
                    const gewichtsklasse = String(fight.mannschaft_gewichtsklasse);
                    fight.pool_bezeichnung = `${fight.pool_bezeichnung} ${/kg$/i.test(gewichtsklasse) ? gewichtsklasse : gewichtsklasse + ' kg'}`;
                }
            }

            // Aktueller Kampf (der erste mit status='gestartet' oder falls keiner, evtl null)
            const currentFight = fights.find(f => f.status === 'gestartet') || null;
            if (currentFight) {
                global.liveColors = global.liveColors || {};
                const turnierZeile = await knex('turniere').where({ id: parseInt(turnierId) }).first('farbe_kaempfer2');
                currentFight.fighter2Color = bestimmeFarbeKaempfer2({
                    kampf: { live_farbe: global.liveColors[currentFight.id] },
                    pool: pools.find(p => p.id === currentFight.pool_id),
                    turnier: turnierZeile
                });
            }

            // Nächste Kämpfe (die ersten 3, die nicht 'gestartet' sind)
            const nextFights = fights.filter(f => f.status !== 'gestartet').slice(0, 3);

            // Pools, die dieser Kampffläche zugeordnet sind
            const matPools = pools
                .filter(p => p.kampfflaeche_id === kf.id)
                .sort((a, b) => (a.matte_reihenfolge ?? 0) - (b.matte_reihenfolge ?? 0));

            // Aktive Pools auf dieser Matte (mit mindestens einem nicht beendeten Kampf)
            const mappedPools = matPools.map(p => {
                const gesamt = parseInt(p.gesamt_kaempfe, 10) || 0;
                const beendet = parseInt(p.beendete_kaempfe, 10) || 0;
                const progress = gesamt > 0 ? Math.round((beendet / gesamt) * 100) : 0;

                // Echter Pool-Status (pools.status) auf die 3 UI-Buckets dieser Ansicht abgebildet.
                let poolStatus = 'bereit';
                if (p.status === 'kaempfe_beendet' || p.status === 'abgeschlossen') {
                    poolStatus = 'beendet';
                } else if (p.status === 'gestartet') {
                    poolStatus = 'aktiv';
                }

                return {
                    id: p.id,
                    bezeichnung: p.bezeichnung,
                    progress,
                    gesamt_kaempfe: gesamt,
                    beendete_kaempfe: beendet,
                    status: poolStatus,
                    status_pool: p.status,
                    reihenfolge: p.matte_reihenfolge
                };
            });

            // Sortieren: aktiv -> bereit (nach reihenfolge) -> beendet
            mappedPools.sort((a, b) => {
                const statusOrder = { 'aktiv': 1, 'bereit': 2, 'beendet': 3 };
                const orderA = statusOrder[a.status] || 99;
                const orderB = statusOrder[b.status] || 99;
                
                if (orderA !== orderB) {
                    return orderA - orderB;
                }
                return (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0);
            });

            // Der "als nächstes hinzuzuholende Pool" auf dieser Matte ist der erste Pool in der Reihenfolge, der den Status 'bereit' hat (noch 0% Fortschritt)
            const nextPool = mappedPools.find(p => p.status === 'bereit') || null;

            resultMats.push({
                id: kf.id,
                bezeichnung: kf.bezeichnung,
                pools: mappedPools,
                currentFight,
                nextFights,
                nextPool
            });
        }

        // Unzugeordnete Pools
        const unassignedPools = pools
            .filter(p => p.kampfflaeche_id == null)
            .map(p => ({
                id: p.id,
                bezeichnung: p.bezeichnung
            }));

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return res.json({
            mats: resultMats,
            unassignedPools
        });
    } catch (error) {
        console.error('[Dashboard-Data-Fehler]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Öffentliche Übersicht (für Anzeige-Bildschirme/TV in der Halle): pro Kampffläche die
// zugeordneten Pools mit vollständiger Teilnehmerliste, damit Teilnehmer nachschauen können,
// in welchem Pool sie sind und auf welcher Matte sie kämpfen. Bewusst ohne Auth (siehe
// getDashboardData), da die Anzeige ohne Login auf einem Fernseher laufen soll.
export async function getPoolUebersicht(knex, req, res) {
    try {
        const { turnierId } = req.query;
        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'turnierId ist erforderlich.' });
        }

        const kampfflaechen = await knex('kampfflaechen')
            .where({ turnier_id: parseInt(turnierId) })
            .orderBy('id', 'asc');

        const pools = await knex('pools')
            .where({ turnier_id: parseInt(turnierId) })
            .orderBy('id', 'asc');

        const teilnehmer = await knex('turnier_teilnehmer')
            .where({ turnier_id: parseInt(turnierId) })
            .whereNotNull('pool_id')
            .select('id', 'pool_id', 'vorname', 'nachname', 'verein')
            .orderBy('nachname', 'asc')
            .orderBy('vorname', 'asc');

        const teilnehmerNachPool = new Map();
        teilnehmer.forEach(t => {
            if (!teilnehmerNachPool.has(t.pool_id)) teilnehmerNachPool.set(t.pool_id, []);
            teilnehmerNachPool.get(t.pool_id).push({ id: t.id, vorname: t.vorname, nachname: t.nachname, verein: t.verein });
        });

        const poolsMitTeilnehmern = pools.map(p => ({
            id: p.id,
            bezeichnung: p.bezeichnung,
            altersklasse: p.altersklasse,
            geschlecht: p.geschlecht,
            gewichtsklasse: p.gewichtsklasse,
            modus: p.modus,
            kampfflaeche_id: p.kampfflaeche_id,
            reihenfolge: p.matte_reihenfolge,
            teilnehmer: teilnehmerNachPool.get(p.id) || []
        }));

        const mats = kampfflaechen.map(kf => ({
            id: kf.id,
            bezeichnung: kf.bezeichnung,
            pools: poolsMitTeilnehmern
                .filter(p => p.kampfflaeche_id === kf.id)
                .sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0))
        }));

        const unzugeordnetePools = poolsMitTeilnehmern.filter(p => p.kampfflaeche_id == null);

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return res.json({ mats, unzugeordnetePools });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
