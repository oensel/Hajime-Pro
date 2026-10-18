// Orga-Planer: Erinnerungsmail 3 Tage vor Fälligkeit (Spec 2026-10-18-orga-planer-design, "Erinnerung").
// Vereinfachung: erinnert wird jede Zeile mit Zuständigem (Konto oder freie Person mit E-Mail), die nicht
// erledigt_am hat; ein automatischer Status oder Kinder werden nicht ausgewertet. Posten ohne eigene Frist
// erben die Fälligkeit der Elternaufgabe. Je Fälligkeitsdatum wird nur einmal erinnert (erinnert_fuer),
// erst nach erfolgreichem Versand gesetzt. Überfällige und weiter als 3 Tage entfernte Fristen werden nicht gemeldet.
import { sendeMail } from '../utils/mailer.js';
import { normalisiereBasisUrl } from '../utils/basisUrl.js';
import { datumAlsText } from './helferPlan.js';

const VORLAUF_TAGE = 3;

function heuteBerlin(jetzt = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(jetzt);
}

function plusTage(datum, tage) {
    const d = new Date(`${datum}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + tage);
    return d.toISOString().slice(0, 10);
}

function turnierText(t) {
    const datum = datumAlsText(t.datum);
    return datum ? `${t.bezeichnung} (${datum})` : t.bezeichnung;
}

export async function sendeFaelligeErinnerungen(knex, { jetzt = new Date(), sende = sendeMail, basisUrl } = {}) {
    const heute = heuteBerlin(jetzt);
    const bis = plusTage(heute, VORLAUF_TAGE);
    const b = typeof basisUrl === 'string' ? basisUrl.trim().replace(/\/+$/, '') : '';

    const zeilen = await knex('orga_aufgaben as a')
        .leftJoin('orga_aufgaben as p', 'p.id', 'a.eltern_id')
        .leftJoin('benutzer as u', 'u.id', 'a.benutzer_id')
        .join('turniere as t', 't.id', 'a.turnier_id')
        .whereNull('a.erledigt_am')
        .where((q) => q.whereNotNull('u.email').orWhere((r) => r.whereNull('a.benutzer_id').whereNotNull('a.email_frei')))
        .whereRaw('COALESCE(a.faellig_am, p.faellig_am) BETWEEN ?::date AND ?::date', [heute, bis])
        .whereRaw('a.erinnert_fuer IS DISTINCT FROM COALESCE(a.faellig_am, p.faellig_am)')
        .select('a.id', 'a.titel', 'a.faellig_am', 'p.faellig_am as eltern_faellig_am', 'a.benutzer_id',
            'u.email as konto_email', 'u.vorname', 'a.name_frei', 'a.email_frei',
            't.bezeichnung', 't.datum');

    let gesendet = 0;
    for (const z of zeilen) {
        const faellig = datumAlsText(z.faellig_am) ?? datumAlsText(z.eltern_faellig_am);
        const istKonto = !!z.benutzer_id;
        const an = istKonto ? z.konto_email : z.email_frei;
        const name = istKonto ? z.vorname : z.name_frei;
        const link = istKonto && b ? `\n\nIhre Aufgaben sehen Sie in der Helfer-App:\n${b}/helfer.html#aufgaben` : '';
        try {
            await sende({
                to: an,
                subject: `Hajime Pro: Erinnerung "${z.titel}" für ${z.bezeichnung}`,
                text: `Hallo ${name || ''},

zur Erinnerung: Ihre Aufgabe "${z.titel}" beim Turnier ${turnierText(z)} ist am ${faellig} fällig.${link}`
            });
        } catch (err) {
            console.error('[Orga-Planer] Erinnerung fehlgeschlagen:', err.message);
            continue;
        }
        await knex('orga_aufgaben').where({ id: z.id }).update({ erinnert_fuer: faellig });
        gesendet += 1;
    }
    return { gesendet };
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
