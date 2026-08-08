// Gemeinsame Logik aller Mannschafts-Pool-Manager (Mannschaft*Manager.js): Erzeugen der
// Einzelkämpfe einer Begegnung sobald beide Mannschaften feststehen, Siegpunkte-/
// Wertungspunkte-Auswertung nach jedem beendeten Einzelkampf, automatischer Stichkampf bei
// Gleichstand sowie der generische Fortschritts-Treiber, den jeder Manager aus seinem
// aktualisiereTurnier() aufruft. Bewusst NICHT in bracketTopologie.js/mannschaftsProgression.js
// (die sind absichtlich framework-/DB-frei gehalten) — diese Datei braucht knex.

import { berechneMannschaftsPatches } from '../shared/mannschaftsProgression.js';

export function parseGewichtsklassen(pool) {
    if (!pool.mannschafts_gewichtsklassen) return [];
    try {
        const parsed = JSON.parse(pool.mannschafts_gewichtsklassen);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

async function ladeMitgliederByGewichtsklasse(knex, mannschaftId) {
    const mitglieder = await knex('mannschaft_mitglieder')
        .where({ mannschaft_id: mannschaftId })
        .orderBy('id', 'asc');
    const map = new Map();
    for (const m of mitglieder) {
        if (!map.has(m.gewichtsklasse)) map.set(m.gewichtsklasse, []);
        map.get(m.gewichtsklasse).push(m);
    }
    return map;
}

// Wählt für eine Gewichtsklasse den startenden Kämpfer einer Mannschaft: das zuerst
// zugeordnete Mitglied dieser Position (niedrigste mannschaft_mitglieder.id). Weitere
// Zuordnungen auf derselben Klasse sind Ersatzkämpfer, die aktuell nicht automatisch
// nachrücken — manuelle Nachnominierung ist außerhalb des Scopes dieser Ausbaustufe.
function waehleStarter(mitgliederByGewichtsklasse, gewichtsklasse) {
    const kandidaten = mitgliederByGewichtsklasse.get(gewichtsklasse);
    return kandidaten && kandidaten.length > 0 ? kandidaten[0] : null;
}

// Legt für eine gerade 'bereit' gewordene Begegnung die Einzelkämpfe an: einen pro
// Gewichtsklasse, die von BEIDEN Mannschaften besetzt ist (DJB-WKO 2.9: nicht gemeinsam
// besetzte Klassen entfallen ersatzlos). Idempotent — überspringt, falls bereits
// Einzelkämpfe für diese Begegnung existieren.
export async function erzeugeEinzelkaempfeFuerBegegnung(knex, begegnung, pool) {
    if (!begegnung.mannschaft1_id || !begegnung.mannschaft2_id) return;

    const bestehende = await knex('kaempfe').where({ mannschaftskampf_id: begegnung.id }).first();
    if (bestehende) return;

    const gewichtsklassen = parseGewichtsklassen(pool);
    const [mitglieder1, mitglieder2] = await Promise.all([
        ladeMitgliederByGewichtsklasse(knex, begegnung.mannschaft1_id),
        ladeMitgliederByGewichtsklasse(knex, begegnung.mannschaft2_id)
    ]);

    const neueKaempfe = [];
    for (const klasse of gewichtsklassen) {
        const starter1 = waehleStarter(mitglieder1, klasse);
        const starter2 = waehleStarter(mitglieder2, klasse);
        if (!starter1 || !starter2) continue;

        neueKaempfe.push({
            pool_id: pool.id,
            mannschaftskampf_id: begegnung.id,
            mannschaft_gewichtsklasse: klasse,
            status: 'bereit',
            kaempfer1_id: starter1.turnier_teilnehmer_id,
            kaempfer2_id: starter2.turnier_teilnehmer_id,
            sieger_id: null,
            kampfzeit_in_sekunden: 0,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0
        });
    }

    if (neueKaempfe.length > 0) {
        await knex('kaempfe').insert(neueKaempfe);
    } else {
        // Keine gemeinsame Gewichtsklasse -> keine Begegnung austragbar (Fehler bei der
        // Mannschaftsmeldung). Ergebnislos beenden statt die Matten-Pipeline zu blockieren.
        await knex('mannschaftskaempfe').where({ id: begegnung.id }).update({ status: 'beendet', sieger_mannschaft_id: null });
    }
}

// Wertet eine Begegnung aus, sobald alle ihre Einzelkämpfe beendet/freilos sind: zählt
// Siegpunkte (Anzahl gewonnener Einzelkämpfe) und Wertungspunkte (Summe der
// unterbewertung_kaempferN-Werte je Mannschaft — die im Scoreboard bereits pro Kampf vergebene
// Wertungsstärke 1/5/7/10). Bei vollständigem Gleichstand (Siege UND Wertungspunkte) wird eine
// der bereits gemeinsam bestrittenen Gewichtsklassen für einen Wiederholungskampf ausgelost
// (DJB-WKO Art. 3.12.13.1 "Stichkampf"). Das dort geforderte SOFORTIGE Starten im
// Golden-Score-Modus (ohne reguläre Kampfzeit) ist eine manuelle Tischentscheidung, da
// golden_score_aktiv nur pool-, nicht kampfweise gilt — bei U15/U18-Mannschaftspools ist
// Golden Score aber ohnehin standardmäßig aktiv (siehe ermittleGoldenScoreEinstellungen).
export async function werteBegegnungAus(knex, begegnungId) {
    const begegnung = await knex('mannschaftskaempfe').where({ id: begegnungId }).first();
    if (!begegnung || begegnung.status === 'beendet' || begegnung.status === 'freilos') return;
    if (!begegnung.mannschaft1_id || !begegnung.mannschaft2_id) return;

    const kaempfe = await knex('kaempfe').where({ mannschaftskampf_id: begegnungId });
    if (kaempfe.length === 0) return;
    if (!kaempfe.every(k => k.status === 'beendet' || k.status === 'freilos')) return;

    let siege1 = 0, siege2 = 0, wert1 = 0, wert2 = 0;
    for (const k of kaempfe) {
        if (k.sieger_id && k.sieger_id === k.kaempfer1_id) siege1++;
        else if (k.sieger_id && k.sieger_id === k.kaempfer2_id) siege2++;
        wert1 += k.unterbewertung_kaempfer1 || 0;
        wert2 += k.unterbewertung_kaempfer2 || 0;
    }

    await knex('mannschaftskaempfe').where({ id: begegnungId }).update({
        siegpunkte_mannschaft1: siege1,
        siegpunkte_mannschaft2: siege2,
        wertungspunkte_mannschaft1: wert1,
        wertungspunkte_mannschaft2: wert2
    });

    if (siege1 !== siege2) {
        await knex('mannschaftskaempfe').where({ id: begegnungId }).update({
            status: 'beendet',
            sieger_mannschaft_id: siege1 > siege2 ? begegnung.mannschaft1_id : begegnung.mannschaft2_id
        });
        return;
    }
    if (wert1 !== wert2) {
        await knex('mannschaftskaempfe').where({ id: begegnungId }).update({
            status: 'beendet',
            sieger_mannschaft_id: wert1 > wert2 ? begegnung.mannschaft1_id : begegnung.mannschaft2_id
        });
        return;
    }

    const kontestierteKlassen = [...new Set(kaempfe.map(k => k.mannschaft_gewichtsklasse).filter(Boolean))];
    if (kontestierteKlassen.length === 0) {
        // Keine auslosbare Klasse (praktisch ausgeschlossen) -> echtes Unentschieden.
        await knex('mannschaftskaempfe').where({ id: begegnungId }).update({ status: 'beendet', sieger_mannschaft_id: null });
        return;
    }
    const gewaehlteKlasse = kontestierteKlassen[Math.floor(Math.random() * kontestierteKlassen.length)];

    const [mitglieder1, mitglieder2] = await Promise.all([
        ladeMitgliederByGewichtsklasse(knex, begegnung.mannschaft1_id),
        ladeMitgliederByGewichtsklasse(knex, begegnung.mannschaft2_id)
    ]);
    const starter1 = waehleStarter(mitglieder1, gewaehlteKlasse);
    const starter2 = waehleStarter(mitglieder2, gewaehlteKlasse);

    await knex('mannschaftskaempfe').where({ id: begegnungId }).update({ stichkampf_gewichtsklasse: gewaehlteKlasse });
    await knex('kaempfe').insert({
        pool_id: begegnung.pool_id,
        mannschaftskampf_id: begegnungId,
        mannschaft_gewichtsklasse: gewaehlteKlasse,
        status: 'bereit',
        kaempfer1_id: starter1 ? starter1.turnier_teilnehmer_id : null,
        kaempfer2_id: starter2 ? starter2.turnier_teilnehmer_id : null,
        sieger_id: null,
        kampfzeit_in_sekunden: 0,
        unterbewertung_kaempfer1: 0,
        unterbewertung_kaempfer2: 0
    });
}

// Generischer Fortschritts-Treiber für Mannschafts-Pools, aufgerufen von jedem
// Mannschaft*Manager.aktualisiereTurnier(): kaskadiert das Begegnungs-Bracket
// (mannschaftsProgression.js), erzeugt Einzelkämpfe für neu 'bereit' gewordene Begegnungen,
// wertet abgeschlossene Begegnungen aus (inkl. automatischem Stichkampf) und schließt den Pool
// ab, sobald alle Begegnungen entschieden sind. Funktioniert unverändert für Jeder-gegen-Jeden
// (keine Quelle-Verknüpfungen -> der Kaskade-Schritt ist dort ein No-Op) wie für Doppel-KO.
export async function aktualisiereMannschaftsPool(knex, poolId) {
    const pool = await knex('pools').where({ id: poolId }).first();
    if (!pool) return;

    const begegnungen = await knex('mannschaftskaempfe').where({ pool_id: poolId });
    if (begegnungen.length === 0) return;

    const patches = berechneMannschaftsPatches(begegnungen);
    if (patches.length > 0) {
        for (const patch of patches) {
            const { id, ...updates } = patch;
            await knex('mannschaftskaempfe').where({ id }).update(updates);
        }
        return aktualisiereMannschaftsPool(knex, poolId);
    }

    const bereiteBegegnungen = await knex('mannschaftskaempfe').where({ pool_id: poolId, status: 'bereit' });
    for (const begegnung of bereiteBegegnungen) {
        await erzeugeEinzelkaempfeFuerBegegnung(knex, begegnung, pool);
    }

    const offeneBegegnungen = await knex('mannschaftskaempfe').where({ pool_id: poolId }).whereIn('status', ['bereit', 'gestartet']);
    let hatAenderung = false;
    for (const begegnung of offeneBegegnungen) {
        await werteBegegnungAus(knex, begegnung.id);
        const nachher = await knex('mannschaftskaempfe').where({ id: begegnung.id }).first();
        if (nachher.status !== begegnung.status) hatAenderung = true;
    }
    if (hatAenderung) {
        return aktualisiereMannschaftsPool(knex, poolId);
    }

    const alleBegegnungen = await knex('mannschaftskaempfe').where({ pool_id: poolId });
    const alleBeendet = alleBegegnungen.every(b => b.status === 'beendet' || b.status === 'freilos');
    if (alleBeendet) {
        await knex('pools').where({ id: poolId }).update({ status: 'kaempfe_beendet' });
    }
}

// Manuelle Nachnominierung (siehe Kommentar bei waehleStarter oben): ermittelt für einen
// Einzelkampf einer Begegnung, welche Mitglieder je Mannschaft als Ersatz eingesetzt werden
// dürfen — nur Mitglieder derselben Mannschaft, deren eigene Gewichtsklassen-Position in der
// Gewichtsklassen-Reihenfolge des Pools GLEICH oder KLEINER ist als die des Kampfes (ein
// leichterer Kämpfer darf "hochkämpfen", ein schwererer nicht "runterkämpfen"), UND die gegen
// das gegnerische Team dieser Begegnung noch nicht eingesetzt sind (weder bereits ausgetragen
// noch aktuell einer anderen Gewichtsklasse dieser Begegnung zugeordnet) — ein Judoka darf pro
// Begegnung nur einmal gegen dasselbe Team antreten.
export async function ermittleErsatzKandidaten(knex, kampfId) {
    const kampf = await knex('kaempfe').where({ id: kampfId }).first();
    if (!kampf || !kampf.mannschaftskampf_id) return null;

    const begegnung = await knex('mannschaftskaempfe').where({ id: kampf.mannschaftskampf_id }).first();
    const pool = await knex('pools').where({ id: kampf.pool_id }).first();
    const gewichtsklassen = parseGewichtsklassen(pool);
    const slotIndex = gewichtsklassen.indexOf(kampf.mannschaft_gewichtsklasse);

    // Judokas, die in dieser Begegnung bereits einer (anderen) Gewichtsklasse zugeordnet sind
    // oder dort schon gekämpft haben — unabhängig vom Status, denn auch ein noch nicht
    // gestarteter Kampf bindet den Judoka bereits an diese eine Gewichtsklasse. Der aktuelle
    // Besetzer DIESES Kampfes wird bewusst nicht ausgeschlossen, damit er als bereits gewählte
    // Option in der Liste bleibt.
    const andereKaempfeDerBegegnung = await knex('kaempfe')
        .where({ mannschaftskampf_id: kampf.mannschaftskampf_id })
        .whereNot({ id: kampf.id });
    const bereitsEingesetzteIds = new Set(
        andereKaempfeDerBegegnung.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]).filter(Boolean)
    );

    async function kandidatenFuer(mannschaftId) {
        const mitglieder = await knex('mannschaft_mitglieder')
            .join('turnier_teilnehmer', 'mannschaft_mitglieder.turnier_teilnehmer_id', 'turnier_teilnehmer.id')
            .where('mannschaft_mitglieder.mannschaft_id', mannschaftId)
            .select(
                'mannschaft_mitglieder.turnier_teilnehmer_id',
                'mannschaft_mitglieder.gewichtsklasse',
                'turnier_teilnehmer.vorname',
                'turnier_teilnehmer.nachname',
                'turnier_teilnehmer.gewicht'
            )
            .orderBy('mannschaft_mitglieder.id', 'asc');

        const nichtBereitsEingesetzt = mitglieder.filter(m => !bereitsEingesetzteIds.has(m.turnier_teilnehmer_id));

        if (slotIndex === -1) {
            // Gewichtsklasse des Kampfes ist keine bekannte Pool-Klasse (sollte nicht
            // vorkommen) — als sicheren Fallback nur exakte Übereinstimmungen zulassen.
            return nichtBereitsEingesetzt.filter(m => m.gewichtsklasse === kampf.mannschaft_gewichtsklasse);
        }
        return nichtBereitsEingesetzt.filter(m => {
            const idx = gewichtsklassen.indexOf(m.gewichtsklasse);
            return idx !== -1 && idx <= slotIndex;
        });
    }

    return {
        kampf,
        kaempfer1Optionen: await kandidatenFuer(begegnung.mannschaft1_id),
        kaempfer2Optionen: await kandidatenFuer(begegnung.mannschaft2_id)
    };
}

// Führt eine manuelle Nachnominierung aus: ersetzt kaempfer1_id/kaempfer2_id eines noch nicht
// gestarteten Mannschaftskampf-Einzelkampfes durch ein anderes, gewichtsklassenkonformes
// Mitglied derselben Mannschaft (siehe ermittleErsatzKandidaten).
export async function wechsleKaempfer(knex, kampfId, seite, neuerTeilnehmerId) {
    if (seite !== 'kaempfer1' && seite !== 'kaempfer2') {
        throw new Error('Ungültige Seite — erwartet "kaempfer1" oder "kaempfer2".');
    }

    const kampf = await knex('kaempfe').where({ id: kampfId }).first();
    if (!kampf || !kampf.mannschaftskampf_id) {
        throw new Error('Dies ist kein Mannschaftskampf-Einzelkampf.');
    }
    if (kampf.status !== 'bereit') {
        throw new Error('Ein Kämpfer kann nur ausgewechselt werden, solange der Kampf noch nicht gestartet ist.');
    }

    const ergebnis = await ermittleErsatzKandidaten(knex, kampfId);
    const optionen = seite === 'kaempfer1' ? ergebnis.kaempfer1Optionen : ergebnis.kaempfer2Optionen;
    const istGueltig = optionen.some(o => o.turnier_teilnehmer_id === neuerTeilnehmerId);
    if (!istGueltig) {
        throw new Error('Dieser Kämpfer darf für diese Position nicht eingesetzt werden (falsche Mannschaft oder zu schwere Gewichtsklasse).');
    }

    await knex('kaempfe').where({ id: kampfId }).update({ [`${seite}_id`]: neuerTeilnehmerId });
}
