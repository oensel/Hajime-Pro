/**
 * Baut die Kampfliste einer Matte in genau der Form, die GET /api/kaempfe?kampfflaecheId=
 * liefert (Scoreboard, Mattenleitung, Anzeige). Rein und knex-/DOM-frei: der Server füttert sie
 * mit SQL-Zeilen (kampfController.getKaempfe), das Frontend im Sync-Modus mit Dokumenten der
 * Dokument-DB (public/js/datenzugriff.js) — beide Wege liefern dadurch garantiert dieselbe Ansicht.
 */
import { bestimmeFarbeKaempfer2 } from './kampfFarbe.js';
import { letztesKampfEndeProTeilnehmer, pruefeKampfPause } from './pausenRegel.js';

function nachId(liste) {
    const map = new Map();
    for (const eintrag of liste || []) map.set(Number(eintrag.id), eintrag);
    return map;
}

export function baueMattenAnsicht({ kaempfe, pools, teilnehmer, mannschaftskaempfe, mannschaften, turnier }, kampfflaecheId, jetzt) {
    const mattenId = Number(kampfflaecheId);
    const poolsDerMatte = (pools || []).filter(p => Number(p.kampfflaeche_id) === mattenId);
    const poolById = nachId(poolsDerMatte);
    const teilnehmerById = nachId(teilnehmer);
    const begegnungById = nachId(mannschaftskaempfe);
    const mannschaftById = nachId(mannschaften);

    const kaempfeDerMatte = (kaempfe || [])
        .filter(k => poolById.has(Number(k.pool_id)))
        .sort((a, b) => {
            // NULL-Reihenfolgen (noch nicht eingeplante Kämpfe) ans Ende, dann nach ID.
            const ra = a.matten_reihenfolge == null ? Infinity : Number(a.matten_reihenfolge);
            const rb = b.matten_reihenfolge == null ? Infinity : Number(b.matten_reihenfolge);
            return ra !== rb ? ra - rb : Number(a.id) - Number(b.id);
        })
        .map(k => {
            const pool = poolById.get(Number(k.pool_id));
            const t1 = teilnehmerById.get(Number(k.kaempfer1_id));
            const t2 = teilnehmerById.get(Number(k.kaempfer2_id));
            const mk = k.mannschaftskampf_id ? begegnungById.get(Number(k.mannschaftskampf_id)) : null;
            const m1 = mk ? mannschaftById.get(Number(mk.mannschaft1_id)) : null;
            const m2 = mk ? mannschaftById.get(Number(mk.mannschaft2_id)) : null;
            return {
                ...k,
                // wirksame Farbe von Kämpfer 2: Kampf (live_farbe) > Pool > Turnier
                farbe_kaempfer2: bestimmeFarbeKaempfer2({ kampf: k, pool, turnier }),
                pool_bezeichnung: pool.bezeichnung,
                pool_modus: pool.modus,
                pool_status: pool.status,
                pool_kampfzeit: pool.kampfzeit_sekunden,
                pool_altersklasse: pool.altersklasse,
                pool_golden_score_aktiv: pool.golden_score_aktiv,
                pool_golden_score_max_sekunden: pool.golden_score_max_sekunden,
                kaempfer1_vorname: t1 ? t1.vorname : null,
                kaempfer1_nachname: t1 ? t1.nachname : null,
                kaempfer1_verein: t1 ? t1.verein : null,
                kaempfer2_vorname: t2 ? t2.vorname : null,
                kaempfer2_nachname: t2 ? t2.nachname : null,
                kaempfer2_verein: t2 ? t2.verein : null,
                siegpunkte_mannschaft1: mk ? mk.siegpunkte_mannschaft1 : null,
                siegpunkte_mannschaft2: mk ? mk.siegpunkte_mannschaft2 : null,
                mannschaft1_bezeichnung: m1 ? m1.bezeichnung : null,
                mannschaft1_verein: m1 ? m1.verein : null,
                mannschaft2_bezeichnung: m2 ? m2.bezeichnung : null,
                mannschaft2_verein: m2 ? m2.verein : null
            };
        });

    // Mannschaftskampf-Einzelkämpfe dürfen erst dann als "nächster Kampf" gelten, wenn alle
    // Einzel-Pools der Matte fertig sind (gleiche Regel wie poolController.planeKaempfeFuerKampfflaeche)
    // — sie bleiben aber sichtbar (kampf.js sortiert sie per Flag ans Ende der Warteliste).
    const einzelPools = poolsDerMatte.filter(p => p.typ !== 'mannschaft');
    const alleEinzelPoolsAbgeschlossen = einzelPools.every(p => p.status === 'kaempfe_beendet' || p.status === 'abgeschlossen');
    for (const kampf of kaempfeDerMatte) {
        if (!alleEinzelPoolsAbgeschlossen && kampf.mannschaftskampf_id) kampf.wartet_auf_einzelpools = true;
        // Einzelkämpfe einer Begegnung zeigen "<Poolname> <Gewichtsklasse>".
        if (kampf.mannschaft_gewichtsklasse) {
            const gk = String(kampf.mannschaft_gewichtsklasse);
            kampf.pool_bezeichnung = `${kampf.pool_bezeichnung} ${/kg$/i.test(gk) ? gk : gk + ' kg'}`;
        }
    }

    // Pausenwarnung mit ECHTEN Zeitstempeln (nicht der Schätzung der Matten-Planung), siehe
    // pausenRegel.js — Grundlage für die Warnanzeige und den Tausch-Button in der Steuerung.
    const letztesEnde = letztesKampfEndeProTeilnehmer(kaempfeDerMatte);
    return kaempfeDerMatte.map(kampf => {
        if (kampf.status !== 'bereit') return { ...kampf, pausenwarnung: null };
        const pruefung = pruefeKampfPause(kampf, kampf.pool_altersklasse, letztesEnde, jetzt);
        return { ...kampf, pausenwarnung: pruefung.ok ? null : pruefung };
    });
}
