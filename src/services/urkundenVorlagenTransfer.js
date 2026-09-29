// Urkunden-Vorlagen im Turnier-Export/-Import (Cloud → Hallen-Server). Der Rückweg
// (importTurnierErgebnisse) überträgt bewusst keine Vorlagen.
import { pruefeFelder } from '../controllers/urkundenController.js';

const PLATZBEREICHE = ['3', '5', '7', 'alle'];
const REIHENFOLGEN = ['siegerehrung', 'aufsteigend'];

function normalisiereVorlage(v) {
    if (!v || typeof v.name !== 'string' || !v.name.trim() || typeof v.pdf_base64 !== 'string' || !v.pdf_base64) return null;
    const breite = Number(v.seiten_breite_pt);
    const hoehe = Number(v.seiten_hoehe_pt);
    if (!(breite > 0) || !(hoehe > 0)) return null;
    const felder = v.felder ?? [];
    if (pruefeFelder(felder, breite, hoehe)) return null;
    return {
        ...v,
        name: v.name.trim(),
        seiten_breite_pt: breite,
        seiten_hoehe_pt: hoehe,
        felder,
        platzbereich: PLATZBEREICHE.includes(String(v.platzbereich)) ? String(v.platzbereich) : '3',
        reihenfolge: REIHENFOLGEN.includes(v.reihenfolge) ? v.reihenfolge : 'siegerehrung'
    };
}
export async function exportiereVorlagen(knex, vereinId) {
    if (!vereinId) return [];
    const zeilen = await knex('urkunden_vorlagen').where({ verein_id: vereinId }).orderBy('name');
    return zeilen.map(v => ({
        name: v.name,
        pdf_base64: Buffer.from(v.pdf).toString('base64'),
        pdf_dateiname: v.pdf_dateiname,
        seiten_breite_pt: v.seiten_breite_pt,
        seiten_hoehe_pt: v.seiten_hoehe_pt,
        felder: JSON.parse(v.felder || '[]'),
        platzbereich: v.platzbereich,
        reihenfolge: v.reihenfolge,
        bei_abschluss_anbieten: !!v.bei_abschluss_anbieten
    }));
}

// Legt die Vorlagen beim Verein an; gleichnamige Vorlagen des Vereins werden überschrieben.
// Die Exportdatei kann von Hand bearbeitet oder beschädigt sein: Vorlagen ohne Name/PDF oder mit
// ungültigen Feldern werden übersprungen, unbekannte Voreinstellungen auf den Standard gesetzt.
export async function importiereVorlagen(knex, vereinId, vorlagen) {
    if (!Array.isArray(vorlagen) || vorlagen.length === 0) return;
    for (const roh of vorlagen) {
        const v = normalisiereVorlage(roh);
        if (!v) continue;
        await knex('urkunden_vorlagen').where({ verein_id: vereinId, name: v.name }).del();
        if (v.bei_abschluss_anbieten) {
            await knex('urkunden_vorlagen').where({ verein_id: vereinId }).update({ bei_abschluss_anbieten: false });
        }
        await knex('urkunden_vorlagen').insert({
            verein_id: vereinId,
            name: v.name,
            pdf: Buffer.from(v.pdf_base64, 'base64'),
            pdf_dateiname: v.pdf_dateiname || null,
            seiten_breite_pt: v.seiten_breite_pt,
            seiten_hoehe_pt: v.seiten_hoehe_pt,
            felder: JSON.stringify(v.felder),
            platzbereich: v.platzbereich,
            reihenfolge: v.reihenfolge,
            bei_abschluss_anbieten: !!v.bei_abschluss_anbieten
        });
    }
}
