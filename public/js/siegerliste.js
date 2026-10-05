import { berechnePlatzierungen } from '/js/shared/platzierungen.js';

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const turnierId = urlParams.get('turnierId') || urlParams.get('id');

    if (!turnierId) {
        alert('Fehler: Kein aktives Turnier ausgewählt!');
        window.location.href = '/turnier.html';
        return;
    }

    const platzierungenBody = document.getElementById('platzierungenTableBody');
    const vereinswertungBody = document.getElementById('vereinswertungTableBody');
    const mannschaftsErgebnisseSection = document.getElementById('mannschaftsErgebnisseSection');
    const mannschaftsErgebnisseBody = document.getElementById('mannschaftsErgebnisseTableBody');

    // --- PLATZIERUNGEN JE POOL (gemeinsame Berechnung in src/shared/platzierungen.js, auch für die
    // Urkunden genutzt); die Siegerliste zeigt Platz 1-5, Platz 7 bleibt den Urkunden vorbehalten.
    // Platz 4 gibt es nur bei Jeder-gegen-Jeden und älteren Überkreuz-Pools mit kleinem Finale, er
    // teilt sich deshalb eine Spalte mit Platz 5 (eintraege ist bereits nach Platz sortiert) ---
    function berechnePoolStandings(pool) {
        const { eintraege } = berechnePlatzierungen(pool, pool.kaempfe, pool.teilnehmer);
        const mitPlatz = p => eintraege.filter(e => e.platz === p).map(e => e.teilnehmer);
        return {
            platz1: mitPlatz(1)[0] || null,
            platz2: mitPlatz(2)[0] || null,
            platz3: mitPlatz(3),
            platz4und5: eintraege.filter(e => e.platz === 4 || e.platz === 5)
        };
    }

    function formatiereName(athlet) {
        if (!athlet) return '<span class="no-data" style="padding:0; font-size: inherit;">noch offen</span>';
        return `${athlet.nachname}, ${athlet.vorname}`;
    }

    // --- VEREINSWERTUNG: 1. Platz = 5 Punkte, 2. Platz = 3 Punkte, 3. Platz = 1 Punkt ---
    // Vereinsnamen sind freier Text (Anmeldung, CSV-Import): "TSV Foo", "TSV  Foo", "tsv foo" oder
    // "TSV Foo e.V." sind derselbe Verein und müssen in der Wertung EINE Zeile ergeben. Der Schlüssel
    // ignoriert Groß-/Kleinschreibung, Leerraum, Punkte/Bindestriche und ein angehängtes "e.V.".
    function vereinsSchluessel(name) {
        return String(name)
            .normalize('NFC')
            .toLowerCase()
            .replace(/[.,]/g, '')
            .replace(/[-_/]/g, ' ')
            .replace(/[\s]+/g, ' ')
            .trim()
            .replace(/(^|[\s])e[\s]?v$/, '')
            .trim();
    }

    function berechneVereinswertung(alleStandings) {
        // Schlüssel -> { punkte, namen: Map(Schreibweise -> Häufigkeit) }
        const proVerein = new Map();

        const addieren = (athlet, punkte) => {
            if (!athlet || !athlet.verein) return;
            const schluessel = vereinsSchluessel(athlet.verein);
            if (!schluessel) return;
            const eintrag = proVerein.get(schluessel) || { punkte: 0, namen: new Map() };
            const anzeigename = String(athlet.verein).normalize('NFC').replace(/\s+/g, ' ').trim();
            eintrag.punkte += punkte;
            eintrag.namen.set(anzeigename, (eintrag.namen.get(anzeigename) || 0) + 1);
            proVerein.set(schluessel, eintrag);
        };

        alleStandings.forEach(({ platz1, platz2, platz3 }) => {
            addieren(platz1, 5);
            addieren(platz2, 3);
            platz3.forEach(athlet => addieren(athlet, 1));
        });

        // Angezeigt wird die am häufigsten verwendete Schreibweise.
        return Array.from(proVerein.values())
            .map(({ punkte, namen }) => ({
                verein: Array.from(namen.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'))[0][0],
                punkte
            }))
            .sort((a, b) => b.punkte - a.punkte || a.verein.localeCompare(b.verein, 'de'));
    }

    // Identische Herleitung wie POOL_STATUS_LABELS/renderPoolRow in pools.js, damit derselbe
    // Pool hier und dort denselben Status anzeigt.
    const POOL_STATUS_LABELS = {
        angelegt: { text: 'In Vorbereitung', klasse: 'vorbereitung' },
        teilnehmer_zugewiesen: { text: 'Bereit', klasse: 'bereit' },
        matte_zugewiesen: { text: 'Bereit', klasse: 'bereit' },
        gestartet: { text: 'Laufend', klasse: 'laufend' },
        kaempfe_beendet: { text: 'Ergebnisse prüfen', klasse: 'beendet' },
        abgeschlossen: { text: 'Abgeschlossen', klasse: 'beendet' }
    };

    function ermittlePoolStatus(pool) {
        let { text, klasse } = POOL_STATUS_LABELS[pool.status] || { text: 'Bereit', klasse: 'bereit' };
        if (pool.anzahl_teilnehmer === 0) {
            text = 'In Vorbereitung';
            klasse = 'vorbereitung';
        } else if (pool.anzahl_teilnehmer === 1) {
            text = 'Kampflos';
            klasse = 'kampflos';
        }
        return { text, klasse };
    }

    function renderPlatzierungen(pools, alleStandings) {
        if (pools.length === 0) {
            platzierungenBody.innerHTML = '<tr><td colspan="6" class="no-data">Noch keine Pools abgeschlossen.</td></tr>';
            return;
        }

        const keinEintrag = '<span class="no-data" style="padding:0; font-size: inherit;">–</span>';

        platzierungenBody.innerHTML = pools.map((pool, i) => {
            const { platz1, platz2, platz3, platz4und5 } = alleStandings[i];
            const platz3Text = platz3.length > 0
                ? platz3.map(a => formatiereName(a)).join('<br>')
                : keinEintrag;
            const platz5Text = platz4und5.length > 0
                ? platz4und5.map(e => `<div class="siegerliste-eintrag">${e.platz}. ${formatiereName(e.teilnehmer)}</div>`).join('')
                : keinEintrag;
            const { text: statusText, klasse: statusKlasse } = ermittlePoolStatus(pool);

            return `
                <tr>
                    <td style="font-weight: 700;">${pool.bezeichnung}</td>
                    <td style="text-align: center;"><span class="pool-status-badge ${statusKlasse}">${statusText}</span></td>
                    <td class="siegerliste-platz1">${formatiereName(platz1)}</td>
                    <td class="siegerliste-platz2">${formatiereName(platz2)}</td>
                    <td class="siegerliste-platz3">${platz3Text}</td>
                    <td class="siegerliste-platz5">${platz5Text}</td>
                </tr>
            `;
        }).join('');
    }

    function renderVereinswertung(wertung) {
        if (wertung.length === 0) {
            vereinswertungBody.innerHTML = '<tr><td colspan="3" class="no-data">Noch keine Platzierungen für eine Vereinswertung vorhanden.</td></tr>';
            return;
        }

        vereinswertungBody.innerHTML = wertung.map((eintrag, index) => {
            const rang = index + 1;
            const rangKlasse = rang <= 3 ? ` rang-${rang}` : '';
            return `
                <tr>
                    <td class="siegerliste-rang${rangKlasse}">${rang}</td>
                    <td style="font-weight: 700;">${eintrag.verein}</td>
                    <td style="text-align: center; font-weight: 700;">${eintrag.punkte}</td>
                </tr>
            `;
        }).join('');
    }

    async function ladeSiegerliste() {
        try {
            const response = await fetch(`/api/pools/details?turnierId=${turnierId}`);
            const allePools = await response.json();
            const pools = allePools.filter(pool => pool.status === 'abgeschlossen');

            if (!response.ok) throw new Error((pools && pools.error) || 'Siegerliste konnte nicht geladen werden.');
            if (!Array.isArray(pools)) throw new Error('Unerwartetes Antwortformat.');

            const alleStandings = pools.map(pool => berechnePoolStandings(pool));

            renderPlatzierungen(pools, alleStandings);
            renderVereinswertung(berechneVereinswertung(alleStandings));
        } catch (error) {
            const fehlerText = `Fehler beim Laden: ${error.message}`;
            platzierungenBody.innerHTML = `<tr><td colspan="6" class="no-data" style="color: #b83232;">${fehlerText}</td></tr>`;
            vereinswertungBody.innerHTML = `<tr><td colspan="3" class="no-data" style="color: #b83232;">${fehlerText}</td></tr>`;
        }
    }

    // --- MANNSCHAFTSERGEBNISSE (eigene Tabellen, siehe pools/details-Ausblendung von
    // typ='mannschaft' in poolController.js::getPoolsMitDetails) ---
    async function ladeMannschaftsErgebnisse() {
        if (!mannschaftsErgebnisseSection || !mannschaftsErgebnisseBody) return;
        try {
            const poolsRes = await fetch(`/api/mannschaften/pools?turnierId=${turnierId}`);
            const pools = await poolsRes.json();
            if (!Array.isArray(pools) || pools.length === 0) return;

            const zeilen = [];
            for (const pool of pools) {
                const begegnungenRes = await fetch(`/api/mannschaftskaempfe?poolId=${pool.id}`);
                const begegnungen = await begegnungenRes.json();
                if (!Array.isArray(begegnungen)) continue;

                for (const b of begegnungen) {
                    if (!b.mannschaft1_id || !b.mannschaft2_id) continue; // noch offene Bracket-Platzhalter
                    const team1 = b.mannschaft1_bezeichnung ? `${b.mannschaft1_bezeichnung} (${b.mannschaft1_verein})` : '–';
                    const team2 = b.mannschaft2_bezeichnung ? `${b.mannschaft2_bezeichnung} (${b.mannschaft2_verein})` : '–';
                    const siegerName = b.sieger_mannschaft_id
                        ? (b.sieger_mannschaft_id === b.mannschaft1_id ? b.mannschaft1_bezeichnung : b.mannschaft2_bezeichnung)
                        : (b.status === 'beendet' ? 'Unentschieden' : '–');
                    zeilen.push(`
                        <tr>
                            <td style="font-weight: 700;">${pool.bezeichnung}</td>
                            <td>${team1} vs. ${team2}</td>
                            <td style="text-align: center;">${b.siegpunkte_mannschaft1}:${b.siegpunkte_mannschaft2}</td>
                            <td>${siegerName}</td>
                        </tr>
                    `);
                }
            }

            if (zeilen.length > 0) {
                mannschaftsErgebnisseBody.innerHTML = zeilen.join('');
                mannschaftsErgebnisseSection.style.display = 'block';
            }
        } catch (error) {
            console.error('Fehler beim Laden der Mannschaftsergebnisse:', error);
        }
    }

    const printBtn = document.getElementById('printBtn');
    if (printBtn) {
        printBtn.addEventListener('click', () => window.print());
    }

    await ladeSiegerliste();
    await ladeMannschaftsErgebnisse();
});
