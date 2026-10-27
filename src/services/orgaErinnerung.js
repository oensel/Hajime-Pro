// Orga-Planer: Erinnerungsmail 3 Tage vor Fälligkeit (Spec 2026-10-18-orga-planer-design, "Erinnerung").
// Der Status wird wie in ladeOrga abgeleitet (berechneStatus mit Unteraufgaben und Helferplan-Zählung): wer dort als
// erledigt gilt, wird nicht erinnert. Posten/Mitbringeinträge zählen nach ihrem eigenen erledigt_am. Posten ohne eigene
// Frist erben die Fälligkeit der Elternaufgabe. Je Fälligkeitsdatum wird nur einmal erinnert (erinnert_fuer), das per
// atomarem Claim vor dem Versand gesetzt wird (bei Fehlschlag zurückgesetzt). Je Empfänger geht eine Sammelmail raus.
// Überfällige, weiter als 3 Tage entfernte Fristen und abgesagte Turniere werden nicht gemeldet.
import { sendeMail } from '../utils/mailer.js';
import { normalisiereBasisUrl } from '../utils/basisUrl.js';
import { datumAlsText, heuteBerlin } from './helferPlan.js';
import { ladeZaehlung } from './orgaPlan.js';
import { berechneStatus } from '../shared/orgaStatus.js';

const VORLAUF_TAGE = 3;

function plusTage(datum, tage) {
    const d = new Date(`${datum}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + tage);
    return d.toISOString().slice(0, 10);
}

function turnierText(t) {
    const datum = datumAlsText(t.datum);
    return datum ? `${t.bezeichnung} (${datum})` : t.bezeichnung;
}

const datumDeutsch = (iso) => (iso ? iso.split('-').reverse().join('.') : '');

// Mailtext für alle fälligen Einträge eines Empfängers: je Turnier ein Block, Posten unter ihrer Aufgabe.
function baueMail(eintraege, basisUrl) {
    const konto = eintraege.some((e) => e.istKonto);
    const name = eintraege[0].name;
    const turniere = new Map();
    for (const e of eintraege) {
        if (!turniere.has(e.turnier_id)) turniere.set(e.turnier_id, { text: turnierText(e), eintraege: [] });
        turniere.get(e.turnier_id).eintraege.push(e);
    }
    const bloecke = [];
    for (const t of turniere.values()) {
        const zeilen = [];
        const posten = new Map();
        for (const e of t.eintraege) {
            if (e.eltern_id == null) continue;
            if (!posten.has(e.eltern_id)) posten.set(e.eltern_id, { titel: e.eltern_titel, liste: [] });
            posten.get(e.eltern_id).liste.push(e);
        }
        const ausgegeben = new Set();
        for (const e of t.eintraege) {
            if (e.eltern_id != null) continue;
            zeilen.push(`- ${e.titel} (fällig am ${datumDeutsch(e.faellig)})`);
            for (const k of posten.get(e.id)?.liste ?? []) zeilen.push(`    - ${k.titel} (fällig am ${datumDeutsch(k.faellig)})`);
            ausgegeben.add(e.id);
        }
        for (const [elternId, g] of posten) {
            if (ausgegeben.has(elternId)) continue;
            zeilen.push(`- ${g.titel ?? 'Aufgabe'}`);
            for (const k of g.liste) zeilen.push(`    - ${k.titel} (fällig am ${datumDeutsch(k.faellig)})`);
        }
        bloecke.push(`Turnier ${t.text}:\n${zeilen.join('\n')}`);
    }
    const link = konto && basisUrl ? `\n\nIhre Aufgaben sehen Sie in der Helfer-App:\n${basisUrl}/helfer.html#aufgaben` : '';
    const einzeln = eintraege.length === 1 ? eintraege[0] : null;
    return {
        subject: einzeln
            ? `Hajime Pro: Erinnerung "${einzeln.titel}" für ${einzeln.bezeichnung}`
            : `Hajime Pro: Erinnerung an ${eintraege.length} fällige Aufgaben`,
        text: `${name ? `Hallo ${name},` : 'Hallo,'}

zur Erinnerung: ${einzeln ? 'Folgende Aufgabe ist' : 'Folgende Aufgaben sind'} in den nächsten Tagen fällig.

${bloecke.join('\n\n')}${link}`
    };
}

/**
 * Sendet je Empfänger eine Mail mit allen seinen fälligen Einträgen. Doppelversand durch mehrere Instanzen verhindert
 * ein atomarer Claim: erinnert_fuer wird VOR dem Versand per UPDATE ... WHERE erinnert_fuer IS DISTINCT FROM ... gesetzt,
 * nur die tatsächlich übernommenen Zeilen werden gemeldet; scheitert der Versand, wird der vorherige Wert zurückgesetzt.
 * @returns {Promise<{gesendet:number, eintraege:number}>} gesendet = Anzahl Mails, eintraege = Anzahl gemeldeter Einträge
 */
export async function sendeFaelligeErinnerungen(knex, { jetzt = new Date(), sende = sendeMail, basisUrl } = {}) {
    const heute = heuteBerlin(jetzt);
    const bis = plusTage(heute, VORLAUF_TAGE);
    const b = typeof basisUrl === 'string' ? basisUrl.trim().replace(/\/+$/, '') : '';

    const zeilen = await knex('orga_aufgaben as a')
        .leftJoin('orga_aufgaben as p', 'p.id', 'a.eltern_id')
        .leftJoin('benutzer as u', 'u.id', 'a.benutzer_id')
        .join('turniere as t', 't.id', 'a.turnier_id')
        .whereNull('a.erledigt_am')
        .where((q) => q.whereNull('t.status').orWhereNot('t.status', 'abgesagt'))
        .where((q) => q.whereNotNull('u.email').orWhere((r) => r.whereNull('a.benutzer_id').whereNotNull('a.email_frei')))
        .whereRaw('COALESCE(a.faellig_am, p.faellig_am) BETWEEN ?::date AND ?::date', [heute, bis])
        .whereRaw('a.erinnert_fuer IS DISTINCT FROM COALESCE(a.faellig_am, p.faellig_am)')
        .select('a.id', 'a.turnier_id', 'a.art', 'a.eltern_id', 'a.auto_art', 'a.auto_ref', 'a.erledigt_am', 'a.titel', 'a.faellig_am', 'a.erinnert_fuer',
            'p.faellig_am as eltern_faellig_am', 'p.titel as eltern_titel', 'a.benutzer_id',
            'u.email as konto_email', 'u.vorname', 'a.name_frei', 'a.email_frei',
            't.bezeichnung', 't.datum')
        .orderBy('a.id');

    // Abgeleiteter Status: Kinder in einer Abfrage, Helferplan-Zählung einmal je Turnier.
    const hauptIds = zeilen.filter((z) => z.eltern_id == null).map((z) => z.id);
    const kinderVon = new Map();
    if (hauptIds.length) {
        for (const k of await knex('orga_aufgaben').whereIn('eltern_id', hauptIds).select('eltern_id', 'art', 'erledigt_am')) {
            if (!kinderVon.has(k.eltern_id)) kinderVon.set(k.eltern_id, []);
            kinderVon.get(k.eltern_id).push(k);
        }
    }
    const zaehlungen = new Map();
    for (const tid of new Set(zeilen.map((z) => z.turnier_id))) zaehlungen.set(tid, await ladeZaehlung(knex, tid));

    const kandidaten = [];
    for (const z of zeilen) {
        const istHaupt = z.eltern_id == null && (z.art === 'aufgabe' || z.art === 'kategorie');
        const status = berechneStatus(z, istHaupt ? (kinderVon.get(z.id) ?? []) : [], istHaupt ? zaehlungen.get(z.turnier_id) : {});
        if (status.status === 'erledigt') continue;
        const istKonto = !!z.benutzer_id;
        kandidaten.push({
            ...z,
            faellig: datumAlsText(z.faellig_am) ?? datumAlsText(z.eltern_faellig_am),
            vorher: z.erinnert_fuer == null ? null : datumAlsText(z.erinnert_fuer),
            istKonto,
            an: istKonto ? z.konto_email : z.email_frei,
            name: istKonto ? z.vorname : z.name_frei
        });
    }

    // Atomarer Claim je Fälligkeitsdatum: nur die Zeilen, die dieser Lauf wirklich übernommen hat.
    const nachDatum = new Map();
    for (const k of kandidaten) {
        if (!nachDatum.has(k.faellig)) nachDatum.set(k.faellig, []);
        nachDatum.get(k.faellig).push(k);
    }
    const uebernommen = [];
    for (const [datum, liste] of nachDatum) {
        const erhalten = await knex('orga_aufgaben')
            .whereIn('id', liste.map((k) => k.id))
            .whereRaw('erinnert_fuer IS DISTINCT FROM ?::date', [datum])
            .update({ erinnert_fuer: datum })
            .returning('id');
        const ids = new Set(erhalten.map((r) => (typeof r === 'object' ? r.id : r)));
        uebernommen.push(...liste.filter((k) => ids.has(k.id)));
    }

    const nachEmpfaenger = new Map();
    for (const k of uebernommen) {
        const schluessel = String(k.an).toLowerCase();
        if (!nachEmpfaenger.has(schluessel)) nachEmpfaenger.set(schluessel, []);
        nachEmpfaenger.get(schluessel).push(k);
    }

    let gesendet = 0;
    for (const eintraege of nachEmpfaenger.values()) {
        eintraege.sort((x, y) => String(x.faellig).localeCompare(String(y.faellig)) || x.id - y.id);
        try {
            await sende({ to: eintraege[0].an, ...baueMail(eintraege, b) });
            gesendet += 1;
        } catch (err) {
            console.error('[Orga-Planer] Erinnerung fehlgeschlagen:', err.message);
            for (const k of eintraege) {
                try {
                    await knex('orga_aufgaben').where({ id: k.id, erinnert_fuer: k.faellig }).update({ erinnert_fuer: k.vorher });
                } catch (fehler) {
                    console.error('[Orga-Planer] erinnert_fuer nicht zurückgesetzt:', fehler.message);
                }
            }
        }
    }
    return { gesendet, eintraege: uebernommen.length };
}

/** Startet den stündlichen Erinnerungslauf (einmal kurz nach dem Start, danach per Intervall); blockiert das Beenden nicht. */
export function startOrgaErinnerung(knex, { intervallMs = 3600000, basisUrl = normalisiereBasisUrl(process.env.PUBLIC_BASE_URL) } = {}) {
    const lauf = async () => {
        try {
            await sendeFaelligeErinnerungen(knex, { basisUrl });
        } catch (err) {
            console.error('[Orga-Planer] Erinnerungslauf fehlgeschlagen:', err.message);
        }
    };
    const erster = setTimeout(lauf, 30000);
    erster.unref();
    const timer = setInterval(lauf, intervallMs);
    timer.unref();
    return () => { clearTimeout(erster); clearInterval(timer); };
}
