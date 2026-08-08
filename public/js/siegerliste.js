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

    // --- PLATZIERUNGEN JE POOL BERECHNEN (portiert aus dem früheren getStandings in pools.js,
    // liefert hier aber die Teilnehmer-Objekte statt fertig formatierter Strings, damit die
    // Vereinswertung unten auf athlet.verein zugreifen kann) ---
    function berechnePoolStandings(pool) {
        const athleteMap = new Map(pool.teilnehmer.map(t => [t.id, t]));
        const fightMap = new Map(pool.kaempfe.map(k => [k.reihenfolge_nummer, k]));

        const isJederGegenJeden = pool.modus === 'Jeder-gegen-Jeden' || pool.modus === 'Jeder gegen Jeden' || pool.teilnehmer.length === 1;
        const isDoppelKo = pool.modus === 'Doppel-KO-8' || pool.modus === 'Doppel-KO-16' || pool.modus === 'Doppel-KO-32';
        const isUeberKreuz = pool.modus === 'Gruppen-Überkreuz' || pool.modus === 'Gruppen-ueberkreuz';

        if (isJederGegenJeden) {
            if (pool.teilnehmer.length === 1) {
                return { platz1: pool.teilnehmer[0] || null, platz2: null, platz3: [] };
            }

            const participants = [...pool.teilnehmer].sort((a, b) => Number(a.gewicht) - Number(b.gewicht));
            const stats = participants.map(athleteI => {
                let wins = 0;
                let points = 0;
                pool.kaempfe.forEach(k => {
                    if (k.status === 'beendet' && k.sieger_id === athleteI.id) {
                        wins += 1;
                        if (k.kaempfer1_id === athleteI.id) points += Number(k.unterbewertung_kaempfer1) || 0;
                        else points += Number(k.unterbewertung_kaempfer2) || 0;
                    }
                });
                return { athlete: athleteI, wins, points };
            });

            stats.sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                return b.points - a.points;
            });

            return {
                platz1: stats[0]?.athlete || null,
                platz2: stats[1]?.athlete || null,
                platz3: [stats[2]?.athlete].filter(Boolean)
            };
        }

        if (isDoppelKo) {
            const isDoppelKo32 = pool.modus === 'Doppel-KO-32';
            const isDoppelKo16 = pool.modus === 'Doppel-KO-16';
            const finalFight = fightMap.get((isDoppelKo16 || isDoppelKo32) ? 'F1' : 'F');
            const bronzeFight1 = fightMap.get(isDoppelKo32 ? 'T27' : (isDoppelKo16 ? 'T11' : 'T3'));
            const bronzeFight2 = fightMap.get(isDoppelKo32 ? 'T28' : (isDoppelKo16 ? 'T12' : 'T4'));

            let platz1 = null;
            let platz2 = null;
            const platz3 = [];

            if (finalFight && (finalFight.status === 'beendet' || finalFight.status === 'freilos')) {
                if (finalFight.sieger_id === finalFight.kaempfer1_id) {
                    platz1 = athleteMap.get(finalFight.kaempfer1_id) || null;
                    platz2 = athleteMap.get(finalFight.kaempfer2_id) || null;
                } else {
                    platz1 = athleteMap.get(finalFight.kaempfer2_id) || null;
                    platz2 = athleteMap.get(finalFight.kaempfer1_id) || null;
                }
            }

            [bronzeFight1, bronzeFight2].forEach(fight => {
                if (fight && (fight.status === 'beendet' || fight.status === 'freilos')) {
                    const athlet = athleteMap.get(fight.sieger_id);
                    if (athlet) platz3.push(athlet);
                }
            });

            return { platz1, platz2, platz3 };
        }

        if (isUeberKreuz) {
            const finalFight = fightMap.get('F1');
            const platz3Fight = fightMap.get('F2');

            let platz1 = null;
            let platz2 = null;
            let platz3Athlet = null;

            if (finalFight && (finalFight.status === 'beendet' || finalFight.status === 'freilos')) {
                if (finalFight.sieger_id === finalFight.kaempfer1_id) {
                    platz1 = athleteMap.get(finalFight.kaempfer1_id) || null;
                    platz2 = athleteMap.get(finalFight.kaempfer2_id) || null;
                } else {
                    platz1 = athleteMap.get(finalFight.kaempfer2_id) || null;
                    platz2 = athleteMap.get(finalFight.kaempfer1_id) || null;
                }
            }

            if (platz3Fight && (platz3Fight.status === 'beendet' || platz3Fight.status === 'freilos')) {
                platz3Athlet = athleteMap.get(platz3Fight.sieger_id) || null;
            }

            return { platz1, platz2, platz3: [platz3Athlet].filter(Boolean) };
        }

        return { platz1: null, platz2: null, platz3: [] };
    }

    function formatiereName(athlet) {
        if (!athlet) return '<span class="no-data" style="padding:0; font-size: inherit;">noch offen</span>';
        return `${athlet.nachname}, ${athlet.vorname} (${athlet.verein || '–'})`;
    }

    // --- VEREINSWERTUNG: 1. Platz = 5 Punkte, 2. Platz = 3 Punkte, 3. Platz = 1 Punkt ---
    function berechneVereinswertung(alleStandings) {
        const punkteProVerein = new Map();

        const addieren = (athlet, punkte) => {
            if (!athlet || !athlet.verein) return;
            punkteProVerein.set(athlet.verein, (punkteProVerein.get(athlet.verein) || 0) + punkte);
        };

        alleStandings.forEach(({ platz1, platz2, platz3 }) => {
            addieren(platz1, 5);
            addieren(platz2, 3);
            platz3.forEach(athlet => addieren(athlet, 1));
        });

        return Array.from(punkteProVerein.entries())
            .map(([verein, punkte]) => ({ verein, punkte }))
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
            platzierungenBody.innerHTML = '<tr><td colspan="5" class="no-data">Noch keine Pools für dieses Turnier vorhanden.</td></tr>';
            return;
        }

        platzierungenBody.innerHTML = pools.map((pool, i) => {
            const { platz1, platz2, platz3 } = alleStandings[i];
            const platz3Text = platz3.length > 0
                ? platz3.map(a => formatiereName(a)).join('<br>')
                : '<span class="no-data" style="padding:0; font-size: inherit;">–</span>';
            const { text: statusText, klasse: statusKlasse } = ermittlePoolStatus(pool);

            return `
                <tr>
                    <td style="font-weight: 700;">${pool.bezeichnung}</td>
                    <td style="text-align: center;"><span class="pool-status-badge ${statusKlasse}">${statusText}</span></td>
                    <td class="siegerliste-platz1">${formatiereName(platz1)}</td>
                    <td class="siegerliste-platz2">${formatiereName(platz2)}</td>
                    <td class="siegerliste-platz3">${platz3Text}</td>
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
            const pools = await response.json();

            if (!response.ok) throw new Error((pools && pools.error) || 'Siegerliste konnte nicht geladen werden.');
            if (!Array.isArray(pools)) throw new Error('Unerwartetes Antwortformat.');

            const alleStandings = pools.map(pool => berechnePoolStandings(pool));

            renderPlatzierungen(pools, alleStandings);
            renderVereinswertung(berechneVereinswertung(alleStandings));
        } catch (error) {
            const fehlerText = `Fehler beim Laden: ${error.message}`;
            platzierungenBody.innerHTML = `<tr><td colspan="5" class="no-data" style="color: #b83232;">${fehlerText}</td></tr>`;
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
