// Urkunden-Vorlagen im Turnier-Export/-Import (Cloud → Hallen-Server). Der Rückweg
// (importTurnierErgebnisse) überträgt bewusst keine Vorlagen.
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
export async function importiereVorlagen(knex, vereinId, vorlagen) {
    if (!Array.isArray(vorlagen) || vorlagen.length === 0) return;
    for (const v of vorlagen) {
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
            felder: JSON.stringify(v.felder || []),
            platzbereich: v.platzbereich || '3',
            reihenfolge: v.reihenfolge || 'siegerehrung',
            bei_abschluss_anbieten: !!v.bei_abschluss_anbieten
        });
    }
}
