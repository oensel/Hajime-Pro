document.addEventListener('DOMContentLoaded', () => {
    // --- TURNIER-ID INITIALISIERUNG ---
    const urlParams = new URLSearchParams(window.location.search);
    let turnierId = urlParams.get('turnierId') || urlParams.get('id');

    if (turnierId) {
        localStorage.setItem('aktiveTurnierId', turnierId);
    } else {
        turnierId = localStorage.getItem('aktiveTurnierId');
    }

    if (!turnierId) {
        alert('Fehler: Kein aktives Turnier ausgewählt!');
        window.location.href = '/turnier.html';
        return;
    }

    // --- DOM ELEMENTE ---
    const generatePoolsBtn = document.getElementById('generatePoolsBtn');
    const regeneratePoolsBtn = document.getElementById('regeneratePoolsBtn');
    const drawActionArea = document.getElementById('drawActionArea');
    const regenerateActionArea = document.getElementById('regenerateActionArea');
    const poolsContainer = document.getElementById('poolsContainer');
    let activePoolModus = null;

    // --- UTILITIES (ZENTRALE DIALOGE & MAPPER) ---
    const mapWettkampfsystem = (modus, anzahlTeilnehmer) => {
        const count = Number(anzahlTeilnehmer) || 0;
        if (count === 1) return 'kampflos';
        if (modus === 'Jeder-gegen-Jeden' || modus === 'Jeder gegen Jeden') {
            return `Pool-${count}`;
        }
        if (modus === 'Gruppen-Überkreuz' || modus === 'Gruppen-ueberkreuz') {
            return 'Pool+Ko';
        }
        if (modus === 'Doppel-KO-8') {
            return 'DKO-8';
        }
        if (modus === 'Doppel-KO-16') {
            return 'DKO-16';
        }
        if (modus === 'Doppel-KO-32') {
            return 'DKO-32';
        }
        return modus || '?';
    };

    // Sortierung der Pool-Liste nach Altersklasse, Geschlecht, Gewichtsklasse (jeweils aufsteigend)
    const altersklasseRang = (ac) => {
        const cleaned = String(ac || '').toLowerCase();
        const match = cleaned.match(/\d+/);
        if (match) return parseInt(match[0], 10);
        if (cleaned.includes('sen') || cleaned.includes('männer') || cleaned.includes('frauen') || cleaned.includes('erwachsene')) return 100;
        return 999;
    };
    const geschlechtRang = (g) => {
        const cleaned = String(g || '').toLowerCase();
        if (cleaned === 'weiblich') return 0;
        if (cleaned === 'männlich') return 1;
        if (cleaned === 'mixed') return 2;
        return 3;
    };
    const gewichtsklasseWert = (gk) => parseFloat(String(gk || '').replace(/[^0-9.]/g, '')) || 0;
    const vergleichePools = (a, b) => {
        return altersklasseRang(a.altersklasse) - altersklasseRang(b.altersklasse)
            || geschlechtRang(a.geschlecht) - geschlechtRang(b.geschlecht)
            || gewichtsklasseWert(a.gewichtsklasse) - gewichtsklasseWert(b.gewichtsklasse);
    };

    const zeigeNotification = (nachricht, typ = 'info') => {
        if (typeof window.zeigeNotification === 'function') {
            window.zeigeNotification(nachricht, typ);
            return;
        }
        console.log(`[${typ}] ${nachricht}`);
    };

    const zeigeBestaetigung = async (nachricht, titel = 'Aktion bestätigen', icon = 'help_outline') => {
        if (typeof window.zeigeZentraleBestaetigung === 'function') {
            return window.zeigeZentraleBestaetigung(nachricht, titel, icon);
        }
        return confirm(nachricht);
    };

    // --- MAIN LOADER ---
    async function ladePools() {
        if (!poolsContainer) return;

        // Der Lade-Platzhalter ist viel niedriger als die eigentliche Pool-Tabelle — ohne diese
        // Rettung würde der Browser die Scroll-Position beim Leeren des Containers auf die neue,
        // kurzzeitig kleinere Dokumenthöhe zurücksetzen und nach dem Neu-Rendern oben stehen bleiben
        // (sichtbar z.B. nach Drag & Drop eines Teilnehmers in einen anderen Pool).
        const vorherigeScrollY = window.scrollY;

        try {
            poolsContainer.innerHTML = `<div class="pools-loading-banner">Pools werden geladen...</div>`;

            const response = await fetch(`/api/pools/details?turnierId=${encodeURIComponent(turnierId)}`);
            const responseText = await response.text();

            let pools;
            try {
                pools = JSON.parse(responseText);
            } catch (parseError) {
                throw new Error(`Ungültige Serverantwort: ${responseText}`);
            }

            if (!response.ok) {
                throw new Error(pools.error || 'Pool-Daten konnten nicht geladen werden.');
            }

            if (!Array.isArray(pools)) {
                throw new Error(`Unerwartetes Antwortformat: ${JSON.stringify(pools)}`);
            }

            // ladePools() läuft nach jedem Anlegen/Löschen von Pools (Generieren, Neu generieren,
            // Alle löschen, Einzel-Löschen), daher hier zentral die abhängigen Menüpunkte
            // (Matten, Kampf) live neu bewerten statt an jeder einzelnen Aktion.
            if (window.hajimeAktualisiereMenueSperren) {
                window.hajimeAktualisiereMenueSperren(['matten', 'kampf']);
            }

            if (pools.length === 0) {
                if (drawActionArea) drawActionArea.style.display = 'block';
                if (regenerateActionArea) regenerateActionArea.style.display = 'none';
                poolsContainer.innerHTML = `
                    <div class="pools-empty-banner">
                        Noch keine Pools für dieses Turnier berechnet. Klicken Sie oben auf "Pools jetzt generieren".
                    </div>`;
                return;
            }

            if (drawActionArea) drawActionArea.style.display = 'none';
            if (regenerateActionArea) regenerateActionArea.style.display = 'flex';

            // Rendert das HTML-Tabellengerüst (Schnittstelle zu Teil 2)
            const sortierteNachAK = [...pools].sort(vergleichePools);
            renderPoolsHTML(sortierteNachAK);

        } catch (error) {
            console.error('[Pools] Fehler beim Laden:', error);
            if (drawActionArea) drawActionArea.style.display = 'block';
            if (regenerateActionArea) regenerateActionArea.style.display = 'none';
            poolsContainer.innerHTML = `<p class="pools-error-banner">Fehler beim Laden: ${error.message}</p>`;
        } finally {
            window.scrollTo(0, vorherigeScrollY);
        }
    }
    // --- DYNAMISCHES HTML-TEMPLATE RENDERING ---
    function renderPoolsHTML(pools) {
        poolsContainer.innerHTML = `
            <div class="pools-table-wrapper">
                <table class="pools-table">
                    <thead>
                        <tr class="pools-table-header">
                            <th class="pool-cell">Pool</th>
                            <th class="pool-cell">System</th>
                            <th class="pool-cell">Status</th>
                            <th class="pool-cell">Teilnehmer</th>
                            <th class="pool-cell">Kämpfe</th>
                            <th class="pool-cell">Dauer</th>
                            <th class="pool-cell">Kampfzeit</th>
                            <th class="pool-cell">Golden Score</th>
                            <th class="pool-cell">Athleten</th>
                            <th class="pool-cell">Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pools.map(pool => renderPoolRow(pool)).join('')}
                    </tbody>
                </table>
            </div>
        `;

        // Event-Handler direkt nach dem DOM-Aufbau anbinden (Schnittstelle zu Teil 3)
        initialisiereStammdatenEvents();
        initialisiereDragAndDrop();
        initialisiereDeleteEvents();
        initialisiereFightplanEvents();
        initialisiereSystemWechselEvents();
    }

    // Rendert genau eine Pool-Zeile als HTML-String. Wird sowohl beim vollständigen
    // Tabellenaufbau als auch beim gezielten Nachladen einzelner Zeilen (nach Drag & Drop,
    // ohne Ruckeln durch Neuladen der ganzen Tabelle) verwendet.
    function renderPoolRow(pool) {
        const dauerText = pool.gesamt_kaempfe > 0 ? `${pool.dauer_minuten} Min.` : '0 Min.';
            const istLeer = pool.anzahl_teilnehmer === 0;
            const kampfzeitMinuten = Math.min(
                5,
                Math.max(1, Math.round((Number(pool.kampfzeit_sekunden) || 240) / 60))
            );
            // Golden Score: pro Pool ein-/ausschaltbar (manche Altersklassen sollen bei
            // Gleichstand direkt zur Hantei-Entscheidung, ohne Golden Score). Ist Golden Score
            // aktiv, kann zusätzlich ein Zeitlimit gesetzt werden — leer/0 bedeutet "unbegrenzt"
            // (Golden Score läuft nach aktuellen IJF-Regeln ohne Zeitlimit bis zur ersten Wertung).
            const goldenScoreAktiv = pool.golden_score_aktiv === undefined ? true : !!pool.golden_score_aktiv;
            const goldenScoreMaxSekunden = pool.golden_score_max_sekunden;

            // Status-Badge basiert direkt auf pools.status (Server-Wahrheit). anzahlTeilnehmer
            // 0/1 bleiben visuelle Sonderfälle ("In Vorbereitung"/"Kampflos").
            const POOL_STATUS_LABELS = {
                angelegt: { text: 'In Vorbereitung', klasse: 'vorbereitung' },
                teilnehmer_zugewiesen: { text: 'Bereit', klasse: 'bereit' },
                matte_zugewiesen: { text: 'Bereit', klasse: 'bereit' },
                gestartet: { text: 'Laufend', klasse: 'laufend' },
                kaempfe_beendet: { text: 'Ergebnisse prüfen', klasse: 'beendet' },
                abgeschlossen: { text: 'Abgeschlossen', klasse: 'beendet' }
            };
            let { text: statusText, klasse: statusClass } = POOL_STATUS_LABELS[pool.status] || { text: 'Bereit', klasse: 'bereit' };
            if (pool.anzahl_teilnehmer === 0) {
                statusText = 'In Vorbereitung';
                statusClass = 'vorbereitung';
            } else if (pool.anzahl_teilnehmer === 1) {
                statusText = 'Kampflos';
                statusClass = 'kampflos';
            }

            // Freilose zählen nicht als Turnierbeginn — sonst wären z.B. Doppel-KO-Pools mit
            // Freilosen sofort gesperrt, obwohl noch kein echter Kampf stattgefunden hat.
            const hatBegonnen = pool.kaempfe && pool.kaempfe.some(k =>
                k.status === 'gestartet' || k.status === 'beendet'
            );

            // Für genau 6 TeilnehmerInnen sind Gruppen-Überkreuz und Jeder-gegen-Jeden beide
            // gültige Systeme — solange noch keine echten Kämpfe existieren, darf umgeschaltet werden.
            const sechserZielModus = pool.modus === 'Gruppen-Überkreuz' ? 'Jeder-gegen-Jeden' : 'Gruppen-Überkreuz';
            const kannSystemWechseln = pool.anzahl_teilnehmer === 6 && !hatBegonnen &&
                (pool.modus === 'Gruppen-Überkreuz' || pool.modus === 'Jeder-gegen-Jeden');

            return `
                                <tr class="pool-section" data-pool-id="${pool.id}">
                                    <!-- Spalte 1: Pool Name -->
                                    <td class="pool-cell pool-name-cell">
                                        <input type="text" class="pool-name-input" data-id="${pool.id}" value="${pool.bezeichnung}">
                                    </td>

                                    <!-- Spalte 2: Turniersystem -->
                                    <td class="pool-cell pool-align-top">
                                        <span class="pool-system-text">${mapWettkampfsystem(pool.modus, pool.anzahl_teilnehmer)}</span>
                                        ${kannSystemWechseln ? `
                                            <button type="button" class="btn-switch-system material-icons" data-id="${pool.id}" data-ziel-modus="${sechserZielModus}" title="Auf ${sechserZielModus === 'Jeder-gegen-Jeden' ? 'Jeder-gegen-Jeden' : 'Gruppen-Überkreuz'} umstellen" style="color: var(--text-muted); background: none; border: none; cursor: pointer; font-size: 15px; padding: 2px; vertical-align: middle;">swap_horiz</button>
                                        ` : ''}
                                    </td>

                                    <!-- Spalte: Status -->
                                    <td class="pool-cell pool-align-top">
                                        <span class="pool-status-badge ${statusClass}">${statusText}</span>
                                    </td>

                                    <!-- Spalte 3-5: Statistiken -->
                                    <td class="pool-cell pool-number-cell pool-stat-cell"><span class="pool-system-text">${pool.anzahl_teilnehmer}</span></td>
                                    <td class="pool-cell pool-number-cell pool-stat-cell"><span class="pool-system-text">${pool.gesamt_kaempfe}</span></td>
                                    <td class="pool-cell pool-number-cell pool-stat-cell"><span class="pool-system-text">${dauerText}</span></td>

                                    <!-- Spalte 6: Kampfzeit-Auswahl -->
                                    <td class="pool-cell pool-align-top">
                                        <div class="pool-time-box">
                                            <select class="pool-time-select" data-id="${pool.id}">
                                                <option value="1" ${kampfzeitMinuten === 1 ? 'selected' : ''}>1 Min.</option>
                                                <option value="2" ${kampfzeitMinuten === 2 ? 'selected' : ''}>2 Min.</option>
                                                <option value="3" ${kampfzeitMinuten === 3 ? 'selected' : ''}>3 Min.</option>
                                                <option value="4" ${kampfzeitMinuten === 4 ? 'selected' : ''}>4 Min.</option>
                                                <option value="5" ${kampfzeitMinuten === 5 ? 'selected' : ''}>5 Min.</option>
                                            </select>
                                        </div>
                                    </td>

                                    <!-- Spalte: Golden Score -->
                                    <td class="pool-cell pool-align-top">
                                        <select class="pool-gs-select" data-id="${pool.id}" style="width: 130px; padding: 5px 4px; font-size: 12px;">
                                            <option value="nein" ${!goldenScoreAktiv ? 'selected' : ''}>Nein</option>
                                            <option value="ja" ${goldenScoreAktiv && !goldenScoreMaxSekunden ? 'selected' : ''}>Ja</option>
                                            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(minuten => {
                                                const sekunden = minuten * 60;
                                                const ausgewaehlt = goldenScoreAktiv && Number(goldenScoreMaxSekunden) === sekunden;
                                                return `<option value="${sekunden}" ${ausgewaehlt ? 'selected' : ''}>Max. ${minuten} Minute${minuten > 1 ? 'n' : ''}</option>`;
                                            }).join('')}
                                        </select>
                                    </td>

                                    <!-- Spalte 7: Athleten-Dropzone -->
                                    <td class="pool-cell pool-athletes-cell pool-align-top">
                                        <div class="drop-zone" data-pool-id="${pool.id}" data-locked="${hatBegonnen}">
                                            ${pool.teilnehmer.map(t => {
                                                const draggableAttr = hatBegonnen ? 'false' : 'true';
                                                const iconName = hatBegonnen ? 'lock' : 'drag_indicator';
                                                return `
                                                    <div class="draggable-athlete ${hatBegonnen ? 'locked' : ''}" draggable="${draggableAttr}" data-athlete-id="${t.id}" data-current-pool="${pool.id}">
                                                        <div class="athlete-info-wrapper">
                                                            <span class="material-icons athlete-drag-icon">${iconName}</span>
                                                            <span class="athlete-name">${escapeHtml(t.nachname)}, ${escapeHtml(t.vorname)}</span>
                                                            <span class="athlete-pass-id">(${escapeHtml(t.judopass_id)})</span>
                                                        </div>
                                                        <div class="athlete-weight">${parseFloat(t.gewicht).toFixed(2)} kg</div>
                                                    </div>
                                                `;
                                            }).join('')}
                                        </div>
                                    </td>

                                     <!-- Spalte 8: Aktionen -->
                                     <td class="pool-cell pool-action-cell pool-align-top" style="display: flex; gap: 8px; justify-content: flex-end; padding-top: 10px;">
                                         ${!istLeer ? `
                                             <button type="button" class="btn-view-fightplan material-icons" data-id="${pool.id}" data-name="${pool.bezeichnung}" title="Kampfplan ansehen" style="color: var(--primary); background: none; border: none; cursor: pointer; font-size: 18px; padding: 4px;">table_view</button>
                                         ` : ''}
                                         ${istLeer ? `
                                             <button type="button" class="btn-delete-pool material-icons" data-id="${pool.id}" title="Leeren Pool löschen" style="font-size: 18px; padding: 4px;">delete</button>
                                         ` : ''}
                                     </td>
                                 </tr>
                            `;
    }

    // --- 6ER-POOLS: WETTKAMPFSYSTEM WECHSELN (GRUPPEN-ÜBERKREUZ <-> JEDER-GEGEN-JEDEN) ---
    function initialisiereSystemWechselEvents(root = document) {
        root.querySelectorAll('.btn-switch-system').forEach(button => {
            button.addEventListener('click', async (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const zielModus = e.currentTarget.getAttribute('data-ziel-modus');

                const bestaetigt = await zeigeBestaetigung(
                    `Möchten Sie das Wettkampfsystem dieses Pools wirklich auf "${zielModus}" umstellen? Der bisherige Kampfplan wird dabei neu erzeugt.`,
                    'Wettkampfsystem wechseln',
                    'swap_horiz'
                );

                if (!bestaetigt) return;

                try {
                    const response = await fetch(`/api/pools/${id}/system`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ modus: zielModus })
                    });
                    const result = await response.json();

                    if (result.success) {
                        zeigeNotification(`Wettkampfsystem erfolgreich auf "${zielModus}" umgestellt.`, 'success');
                        await ladePools();
                    } else {
                        zeigeNotification(result.error || 'Wechsel fehlgeschlagen.', 'error');
                    }
                } catch (err) {
                    zeigeNotification('Netzwerkfehler: ' + err.message, 'error');
                }
            });
        });
    }
    // --- STAMMDATEN INLINE-UPDATES & LIVE-NEUBERECHNUNG ---
    // Liest alle aktuell im DOM stehenden Stammdaten eines Pools (Name, Kampfzeit, Golden
    // Score) zusammen, damit jeder einzelne Feld-Handler beim Speichern konsistent ALLE
    // Werte mitsendet — sonst würde z.B. das Ändern der Kampfzeit die zuvor gesetzte
    // Golden-Score-Konfiguration wieder überschreiben (updatePoolStammdaten ersetzt die
    // gesamte Zeile, kein partielles Merge).
    function sammlePoolStammdaten(id) {
        const nameInput = document.querySelector(`.pool-name-input[data-id="${id}"]`);
        const zeitSelect = document.querySelector(`.pool-time-select[data-id="${id}"]`);
        const gsSelect = document.querySelector(`.pool-gs-select[data-id="${id}"]`);

        const bezeichnung = nameInput ? nameInput.value.trim() : 'Wettkampfklasse';
        const kampfzeitMinuten = zeitSelect ? parseInt(zeitSelect.value, 10) : 4;

        // Golden-Score-Select-Werte: "nein" = deaktiviert, "ja" = aktiv ohne Zeitlimit
        // (unbegrenzt), sonst die Sekundenzahl als Zeitlimit.
        const gsWert = gsSelect ? gsSelect.value : 'ja';
        const golden_score_aktiv = gsWert !== 'nein';
        const golden_score_max_sekunden = (golden_score_aktiv && gsWert !== 'ja') ? parseInt(gsWert, 10) : null;

        return {
            bezeichnung: bezeichnung || 'Wettkampfklasse',
            kampfzeit_sekunden: (Number.isFinite(kampfzeitMinuten) && kampfzeitMinuten > 0 ? kampfzeitMinuten : 4) * 60,
            golden_score_aktiv,
            golden_score_max_sekunden
        };
    }

    async function speicherePoolStammdaten(id) {
        return fetch(`/api/pools/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sammlePoolStammdaten(id))
        });
    }

    function initialisiereStammdatenEvents(root = document) {
        // Live-Namensänderung bei Fokusverlust (blur) oder Druck auf Enter
        root.querySelectorAll('.pool-name-input').forEach(input => {
            const speichereName = async (e) => {
                const id = e.target.getAttribute('data-id');
                if (!e.target.value.trim()) return;

                try {
                    await speicherePoolStammdaten(id);
                } catch (err) {
                    console.error('Fehler beim Umbenennen des Pools:', err);
                }
            };

            input.addEventListener('blur', speichereName);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.target.blur(); }
            });
        });

        // Kampfzeit-Änderung: Speichern und sofortige Live-Neuberechnung der Gesamtzeit
        root.querySelectorAll('.pool-time-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const id = e.target.getAttribute('data-id');
                if (isNaN(parseInt(e.target.value, 10))) return;

                try {
                    const response = await speicherePoolStammdaten(id);

                    if (response.ok) {
                        // Ansicht neu laden, um die voraussichtliche Gesamtdauer live hochzurechnen
                        await ladePools();
                        zeigeNotification('Kampfzeit aktualisiert, Gesamtzeit neu berechnet.', 'success');
                    } else {
                        zeigeNotification('Fehler beim Speichern der Kampfzeit.', 'error');
                    }
                } catch (err) {
                    console.error('Fehler beim Ändern der Kampfzeit:', err);
                    zeigeNotification('Netzwerkfehler beim Ändern der Kampfzeit.', 'error');
                }
            });
        });

        // Golden-Score-Auswahl: Nein / Ja (unbegrenzt) / Max. N Minuten
        root.querySelectorAll('.pool-gs-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const id = e.target.getAttribute('data-id');

                try {
                    const response = await speicherePoolStammdaten(id);
                    if (response.ok) {
                        zeigeNotification('Golden-Score-Einstellung aktualisiert.', 'success');
                    } else {
                        zeigeNotification('Fehler beim Speichern der Golden-Score-Einstellung.', 'error');
                    }
                } catch (err) {
                    console.error('Fehler beim Ändern von Golden Score:', err);
                    zeigeNotification('Netzwerkfehler beim Ändern der Golden-Score-Einstellung.', 'error');
                }
            });
        });
    }

    // --- LEERE POOLS LÖSCHEN ---
    function initialisiereDeleteEvents(root = document) {
        root.querySelectorAll('.btn-delete-pool').forEach(button => {
            button.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');

                const bestaetigt = await zeigeBestaetigung(
                    'Möchten Sie diesen leeren Pool wirklich unwiderruflich löschen?',
                    'Pool entfernen',
                    'delete_outline'
                );

                if (bestaetigt) {
                    try {
                        const response = await fetch(`/api/pools/${id}`, { method: 'DELETE' });
                        const result = await response.json();

                        if (result.success) {
                            zeigeNotification('Pool erfolgreich gelöscht.', 'success');

                            if (generatePoolsBtn) {
                                generatePoolsBtn.removeAttribute('disabled');
                                generatePoolsBtn.innerHTML = `
                                    <span class="material-icons btn-icon-spacing">auto_awesome</span>
                                    Pools jetzt generieren
                                `;
                            }

                            await ladePools();
                        } else {
                            zeigeNotification(result.error || 'Löschen fehlgeschlagen.', 'error');
                        }
                    } catch (err) {
                        zeigeNotification('Netzwerkfehler: ' + err.message, 'error');
                    }
                }
            });
        });
    }
    // --- NATIVES HTML5 DRAG & DROP FÜR ATHLETEN ---
    function initialisiereDragAndDrop(root = document) {
        const draggables = root.querySelectorAll('.draggable-athlete');
        const dropZones = root.querySelectorAll('.drop-zone');

        draggables.forEach(draggable => {
            draggable.addEventListener('dragstart', (e) => {
                if (draggable.classList.contains('locked')) {
                    e.preventDefault();
                    return;
                }
                draggable.classList.add('athlete-dragging');
                e.dataTransfer.setData('text/plain', draggable.getAttribute('data-athlete-id'));
                e.dataTransfer.setData('source-pool', draggable.getAttribute('data-current-pool'));
            });

            draggable.addEventListener('dragend', () => {
                draggable.classList.remove('athlete-dragging');
                dropZones.forEach(zone => {
                    zone.classList.remove('zone-active');
                });
            });
        });

        dropZones.forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault(); // Zwingend erforderlich, um Drop zu erlauben
                zone.classList.add('zone-active');
            });

            zone.addEventListener('dragleave', () => {
                zone.classList.remove('zone-active');
            });

            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                const athleteId = e.dataTransfer.getData('text/plain');
                const sourcePoolId = e.dataTransfer.getData('source-pool');
                const zielPoolId = zone.getAttribute('data-pool-id');

                // Ein Verschieben im selben Pool abfangen
                if (sourcePoolId === zielPoolId) return;

                if (zone.getAttribute('data-locked') === 'true') {
                    zeigeNotification('In diesen Pool können keine Teilnehmer verschoben werden, da die Kämpfe bereits begonnen haben.', 'error');
                    zone.classList.remove('zone-active');
                    return;
                }

                try {
                    const response = await fetch('/api/pools/verschieben', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            teilnehmerId: parseInt(athleteId, 10),
                            zielPoolId: parseInt(zielPoolId, 10)
                        })
                    });

                    const result = await response.json();
                    if (result.success) {
                        // Nur die zwei betroffenen Pool-Zeilen gezielt aktualisieren statt die
                        // ganze Tabelle neu zu laden — verhindert das sichtbare Ruckeln. Keine
                        // Erfolgs-Notification, da der Drag&Drop selbst schon sichtbares Feedback ist.
                        await aktualisierePoolZeilen([sourcePoolId, zielPoolId]);
                    } else {
                        zeigeNotification('Fehler beim Verschieben: ' + result.error, 'error');
                    }
                } catch (err) {
                    zeigeNotification('Netzwerkfehler beim Verschieben.', 'error');
                }
            });
        });
    }

    // Lädt die aktuellen Daten der übergebenen Pool-IDs nach und ersetzt nur deren
    // Tabellenzeilen im DOM (statt die komplette Tabelle neu aufzubauen) — verhindert
    // das sichtbare Ruckeln nach dem Verschieben eines Athleten per Drag & Drop.
    async function aktualisierePoolZeilen(poolIds) {
        try {
            const response = await fetch(`/api/pools/details?turnierId=${encodeURIComponent(turnierId)}`);
            const pools = await response.json();

            if (!response.ok || !Array.isArray(pools)) {
                throw new Error('Pool-Daten konnten nicht aktualisiert werden.');
            }

            poolIds.forEach(poolId => {
                const pool = pools.find(p => String(p.id) === String(poolId));
                const alteZeile = poolsContainer.querySelector(`tr.pool-section[data-pool-id="${poolId}"]`);
                if (!pool || !alteZeile) return;

                const template = document.createElement('template');
                template.innerHTML = renderPoolRow(pool).trim();
                const neueZeile = template.content.firstElementChild;
                if (!neueZeile) return;

                alteZeile.replaceWith(neueZeile);
                initialisiereStammdatenEvents(neueZeile);
                initialisiereDragAndDrop(neueZeile);
                initialisiereDeleteEvents(neueZeile);
                initialisiereFightplanEvents(neueZeile);
                initialisiereSystemWechselEvents(neueZeile);
            });
        } catch (error) {
            console.error('[Pools] Fehler beim gezielten Aktualisieren der Pool-Zeilen, lade komplett neu:', error);
            await ladePools();
        }
    }

    // --- AUTOMATISCHE POOL-GENERIERUNG NACH REGLEMENT ---
    async function fuehrePoolGenerierungAus({ neuGenerieren = false } = {}) {
        const button = neuGenerieren ? regeneratePoolsBtn : generatePoolsBtn;
        const urspruenglicherButtonText = button ? button.innerHTML : '';

        try {
            if (button) {
                button.setAttribute('disabled', 'true');
                // regeneratePoolsBtn ist ein reiner Icon-Button in der Titelzeile, generatePoolsBtn
                // dagegen die große Haupt-Aktionsfläche mit Textbeschriftung.
                button.innerHTML = neuGenerieren
                    ? `<span class="material-icons icon-spin">sync</span>`
                    : `
                        <span class="material-icons btn-icon-spacing icon-spin">sync</span>
                        Berechne Pools...
                    `;
            }

            const response = await fetch('/api/pools/generieren', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    turnierId: parseInt(turnierId, 10),
                    neuGenerieren
                })
            });

            const result = await response.json();

            if (result.success) {
                await ladePools();
                zeigeNotification(
                    neuGenerieren ? 'Pools wurden vollständig neu generiert.' : 'Pools erfolgreich generiert und ausgelost!',
                    'success'
                );
            } else {
                zeigeNotification('Fehler bei der Auslosung: ' + result.error, 'error');
            }
        } catch (error) {
            zeigeNotification('Netzwerkfehler: ' + error.message, 'error');
        } finally {
            if (button) {
                button.removeAttribute('disabled');
                button.innerHTML = urspruenglicherButtonText;
            }
        }
    }

    // --- WARNUNG: NICHT KAMPFBEREITE TEILNEHMER, DIE VON DER AUSLOSUNG AUSGESCHLOSSEN WERDEN ---
    // Nur kampfbereite Teilnehmer gehen in die Poolbildung ein (siehe generierePools im
    // Backend) — wer noch nicht bestätigt ist, wird dabei automatisch auf "nicht_erschienen"
    // gesetzt und ignoriert. Zurückgezogene Anmeldungen zählen hier nicht mit, da sie bereits
    // bewusst abgemeldet wurden, nicht "nicht zugelassen" sind.
    async function ermittleNichtKampfbereiteTeilnehmer() {
        try {
            const response = await fetch(`/api/teilnehmer?turnierId=${encodeURIComponent(turnierId)}`);
            if (!response.ok) return [];
            const alle = await response.json();
            return alle.filter(t => t.status !== 'kampfbereit' && t.status !== 'zurueckgezogen');
        } catch (err) {
            console.error('Fehler beim Prüfen der Kampfbereitschaft:', err);
            return [];
        }
    }

    async function warneVorNichtKampfbereitenTeilnehmern() {
        const nichtBereite = await ermittleNichtKampfbereiteTeilnehmer();
        if (nichtBereite.length === 0) return true;

        return zeigeBestaetigung(
            `${nichtBereite.length} Teilnehmer ${nichtBereite.length === 1 ? 'ist' : 'sind'} noch nicht als kampfbereit bestätigt und daher nicht für die Zuordnung in Pools zugelassen. ${nichtBereite.length === 1 ? 'Dieser wird' : 'Diese werden'} bei der Pool-Bildung ignoriert. Trotzdem fortfahren?`,
            'Nicht kampfbereite Teilnehmer',
            'warning'
        );
    }

    // --- GLOBALER AKKREDITIERUNGS-AUSLOSUNGSTRIGGER ---
    if (generatePoolsBtn) {
        generatePoolsBtn.addEventListener('click', async () => {
            const fortfahren = await warneVorNichtKampfbereitenTeilnehmern();
            if (!fortfahren) return;

            const waageSchliessen = await zeigeBestaetigung(
                'Sind alle Teilnehmer gewogen und registriert? Die Waage wird hiermit geschlossen und die Pools werden unwiderruflich berechnet.',
                'Waage schließen & Auslosen',
                'lock_clock'
            );

            if (!waageSchliessen) return;

            await fuehrePoolGenerierungAus({ neuGenerieren: false });
        });
    }

    if (regeneratePoolsBtn) {
        regeneratePoolsBtn.addEventListener('click', async () => {
            const fortfahren = await warneVorNichtKampfbereitenTeilnehmern();
            if (!fortfahren) return;

            const bestaetigt = await zeigeBestaetigung(
                'Wollen Sie wirklich alle Pools neu generieren?',
                'Pools neu generieren',
                'restart_alt'
            );

            if (!bestaetigt) return;

            await fuehrePoolGenerierungAus({ neuGenerieren: true });
        });
    }

    const refreshPoolsBtn = document.getElementById('refreshPoolsBtn');
    if (refreshPoolsBtn) {
        refreshPoolsBtn.addEventListener('click', async () => {
            await ladePools();
            zeigeNotification('Pools erfolgreich aktualisiert.', 'success');
        });
    }

    const deleteAllPoolsBtn = document.getElementById('deleteAllPoolsBtn');
    if (deleteAllPoolsBtn) {
        deleteAllPoolsBtn.addEventListener('click', async () => {
            const bestaetigt = await zeigeBestaetigung(
                'Möchten Sie wirklich alle Pools dieses Turniers löschen? Die Teilnehmerliste wird dadurch wieder zur Bearbeitung freigegeben. Pools mit bereits ausgetragenen Kämpfen verhindern das Löschen.',
                'Alle Pools löschen',
                'delete_sweep'
            );

            if (!bestaetigt) return;

            try {
                deleteAllPoolsBtn.setAttribute('disabled', 'true');
                const response = await fetch('/api/pools/loeschen-alle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ turnierId: parseInt(turnierId, 10) })
                });
                const result = await response.json();

                if (result.success) {
                    zeigeNotification('Alle Pools wurden gelöscht.', 'success');
                    if (generatePoolsBtn) {
                        generatePoolsBtn.removeAttribute('disabled');
                        generatePoolsBtn.innerHTML = `
                            <span class="material-icons btn-icon-spacing">auto_awesome</span>
                            Pools jetzt generieren
                        `;
                    }
                    await ladePools();
                } else {
                    zeigeNotification(result.error || 'Löschen fehlgeschlagen.', 'error');
                }
            } catch (err) {
                zeigeNotification('Netzwerkfehler: ' + err.message, 'error');
            } finally {
                deleteAllPoolsBtn.removeAttribute('disabled');
            }
        });
    }

    // --- KAMPFPLAN FÜR EINEN POOL ANSEHEN / DRUCKEN ---
    function renderMatrix(pool, matrixContainer = document.getElementById('matrixContainer')) {
        if (!matrixContainer) return;

        if (pool.teilnehmer && pool.teilnehmer.length === 1) {
            const athlete = pool.teilnehmer[0];
            const tableColsHeaders = `
                <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 50px;">1</th>
                <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 50px;">2</th>
                <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 50px;">3</th>
            `;
            const rowsHtml = `
                <tr style="border-bottom: 1px solid var(--border); white-space: nowrap;">
                    <td style="padding: 8px; border: 1px solid var(--border); font-weight: bold; text-align: center;">1</td>
                    <td style="padding: 8px; border: 1px solid var(--border); font-weight: bold; white-space: nowrap;">${escapeHtml(athlete.nachname)}, ${escapeHtml(athlete.vorname)}</td>
                    <td style="padding: 8px; border: 1px solid var(--border); color: var(--text-muted); font-size: 11px; white-space: nowrap;">${escapeHtml(athlete.verein || '')}</td>
                    <td style="background-color: var(--border) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border: 1px solid var(--border);"></td>
                    <td style="text-align: center; font-weight: bold; border: 1px solid var(--border);">-</td>
                    <td style="text-align: center; font-weight: bold; border: 1px solid var(--border);">-</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold; color: var(--primary);">0</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold;">0</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold; color: #ff9800;">1 🥇</td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border); white-space: nowrap;">
                    <td style="padding: 8px; border: 1px solid var(--border); font-weight: bold; text-align: center;">2</td>
                    <td style="padding: 8px; border: 1px solid var(--border); font-style: italic; color: var(--text-muted); white-space: nowrap;">(frei)</td>
                    <td style="padding: 8px; border: 1px solid var(--border); color: var(--text-muted); font-size: 11px; white-space: nowrap;">-</td>
                    <td style="text-align: center; font-weight: bold; border: 1px solid var(--border);">-</td>
                    <td style="background-color: var(--border) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border: 1px solid var(--border);"></td>
                    <td style="text-align: center; font-weight: bold; border: 1px solid var(--border);">-</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold; color: var(--primary);">-</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold;">-</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold; color: #ff9800;">-</td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border); white-space: nowrap;">
                    <td style="padding: 8px; border: 1px solid var(--border); font-weight: bold; text-align: center;">3</td>
                    <td style="padding: 8px; border: 1px solid var(--border); font-style: italic; color: var(--text-muted); white-space: nowrap;">(frei)</td>
                    <td style="padding: 8px; border: 1px solid var(--border); color: var(--text-muted); font-size: 11px; white-space: nowrap;">-</td>
                    <td style="text-align: center; font-weight: bold; border: 1px solid var(--border);">-</td>
                    <td style="text-align: center; font-weight: bold; border: 1px solid var(--border);">-</td>
                    <td style="background-color: var(--border) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border: 1px solid var(--border);"></td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold; color: var(--primary);">-</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold;">-</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold; color: #ff9800;">-</td>
                </tr>
            `;

            matrixContainer.innerHTML = `
                <div class="matrix-title" style="margin-bottom: 8px; font-weight: bold; font-size: 14px; text-transform: uppercase; border-bottom: 2px solid var(--border); padding-bottom: 6px;">
                    Pool-Kreuztabelle (Matrix)
                </div>
                <table class="matrix-table" style="width: 100%; border-collapse: collapse; margin-bottom: 16px; border: 1px solid var(--border); font-size: 12px;">
                    <thead>
                        <tr style="background-color: var(--bg-card); border-bottom: 2px solid var(--border); white-space: nowrap;">
                            <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 30px;">Nr.</th>
                            <th style="padding: 8px; border: 1px solid var(--border); text-align: left; white-space: nowrap;">Name</th>
                            <th style="padding: 8px; border: 1px solid var(--border); text-align: left; width: 140px; white-space: nowrap;">Verein</th>
                            ${tableColsHeaders}
                            <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 50px; font-weight: bold; white-space: nowrap;">Siege</th>
                            <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 60px; font-weight: bold; white-space: nowrap;">Punkte</th>
                            <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 50px; font-weight: bold; white-space: nowrap;">Platz</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            `;
            matrixContainer.style.display = 'block';
            return;
        }

        const modus = pool.modus;
        const isJederGegenJeden = modus === 'Jeder-gegen-Jeden' || modus === 'Jeder gegen Jeden' || (pool.teilnehmer && pool.teilnehmer.length === 1);
        if (!isJederGegenJeden || !pool.teilnehmer || pool.teilnehmer.length === 0) {
            matrixContainer.style.display = 'none';
            matrixContainer.innerHTML = '';
            return;
        }

        // Sort participants by weight ascending (official order)
        const participants = [...pool.teilnehmer].sort((a, b) => Number(a.gewicht) - Number(b.gewicht));
        const n = participants.length;

        // Calculate wins, points, and place for each participant
        const standings = participants.map(t => {
            let wins = 0;
            let points = 0;
            
            pool.kaempfe.forEach(k => {
                if (k.status === 'beendet') {
                    if (k.kaempfer1_id === t.id) {
                        points += Number(k.unterbewertung_kaempfer1) || 0;
                        if (k.sieger_id === t.id) wins++;
                    } else if (k.kaempfer2_id === t.id) {
                        points += Number(k.unterbewertung_kaempfer2) || 0;
                        if (k.sieger_id === t.id) wins++;
                    }
                }
            });
            
            return {
                ...t,
                wins,
                points
            };
        });

        // Compute places based on Judo rules (wins, points, head-to-head)
        const sortedStandings = [...standings].sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (b.points !== a.points) return b.points - a.points;
            
            const directFight = pool.kaempfe.find(k => 
                k.status === 'beendet' && 
                ((k.kaempfer1_id === a.id && k.kaempfer2_id === b.id) || 
                 (k.kaempfer1_id === b.id && k.kaempfer2_id === a.id))
            );
            if (directFight && directFight.sieger_id) {
                return directFight.sieger_id === a.id ? -1 : 1;
            }
            return 0;
        });

        const hasAnyFinished = pool.kaempfe.some(k => k.status === 'beendet');

        standings.forEach(s => {
            if (hasAnyFinished) {
                s.platz = sortedStandings.findIndex(x => x.id === s.id) + 1;
            } else {
                s.platz = '<span class="print-empty">-</span>';
            }
        });

        // Generate table HTML
        let tableColsHeaders = '';
        for (let i = 1; i <= n; i++) {
            tableColsHeaders += `<th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 50px;">${i}</th>`;
        }

        let rowsHtml = '';
        standings.forEach((athleteI, idxI) => {
            let cellsHtml = '';
            standings.forEach((athleteJ, idxJ) => {
                if (idxI === idxJ) {
                    // Diagonal blacked out
                    cellsHtml += `<td style="background-color: var(--border) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border: 1px solid var(--border);"></td>`;
                } else {
                    // Find fight
                    const fight = pool.kaempfe.find(k => 
                        (k.kaempfer1_id === athleteI.id && k.kaempfer2_id === athleteJ.id) ||
                        (k.kaempfer1_id === athleteJ.id && k.kaempfer2_id === athleteI.id)
                    );

                    let cellText = '<span class="print-empty">-</span>';
                    let cellStyle = 'text-align: center; font-weight: bold; border: 1px solid var(--border);';
                    
                    if (fight && fight.status === 'beendet') {
                        if (fight.sieger_id === athleteI.id) {
                            const score = fight.kaempfer1_id === athleteI.id 
                                ? fight.unterbewertung_kaempfer1 
                                : fight.unterbewertung_kaempfer2;
                            cellText = String(score);
                            cellStyle += ' background-color: rgba(46, 125, 50, 0.15) !important; color: #2e7d32; -webkit-print-color-adjust: exact; print-color-adjust: exact;'; // Light green for win
                        } else if (fight.sieger_id === athleteJ.id) {
                            cellText = '0';
                            cellStyle += ' color: #b83232;'; // Red for loss
                        }
                    }
                    
                    cellsHtml += `<td style="${cellStyle}">${cellText}</td>`;
                }
            });

            const siegeHtml = hasAnyFinished ? athleteI.wins : '<span class="print-empty">0</span>';
            const punkteHtml = hasAnyFinished ? athleteI.points : '<span class="print-empty">0</span>';

            rowsHtml += `
                <tr style="border-bottom: 1px solid var(--border); white-space: nowrap;">
                    <td style="padding: 8px; border: 1px solid var(--border); font-weight: bold; text-align: center;">${idxI + 1}</td>
                    <td style="padding: 8px; border: 1px solid var(--border); font-weight: bold; white-space: nowrap;">${escapeHtml(athleteI.nachname)}, ${escapeHtml(athleteI.vorname)}</td>
                    <td style="padding: 8px; border: 1px solid var(--border); color: var(--text-muted); font-size: 11px; white-space: nowrap;">${escapeHtml(athleteI.verein || '')}</td>
                    ${cellsHtml}
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold; color: var(--primary);">${siegeHtml}</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold;">${punkteHtml}</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center; font-weight: bold; color: #ff9800;">${athleteI.platz}</td>
                </tr>
            `;
        });

        matrixContainer.innerHTML = `
            <div class="matrix-title" style="margin-bottom: 8px; font-weight: bold; font-size: 14px; text-transform: uppercase; border-bottom: 2px solid var(--border); padding-bottom: 6px;">
                Pool-Kreuztabelle (Matrix)
            </div>
            <table class="matrix-table" style="width: 100%; border-collapse: collapse; margin-bottom: 24px; border: 1px solid var(--border); font-size: 12px;">
                <thead>
                    <tr style="background-color: var(--bg-card); border-bottom: 2px solid var(--border); white-space: nowrap;">
                        <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 30px;">Nr.</th>
                        <th style="padding: 8px; border: 1px solid var(--border); text-align: left; white-space: nowrap;">Name</th>
                        <th style="padding: 8px; border: 1px solid var(--border); text-align: left; width: 140px; white-space: nowrap;">Verein</th>
                        ${tableColsHeaders}
                        <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 50px; font-weight: bold; white-space: nowrap;">Siege</th>
                        <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 60px; font-weight: bold; white-space: nowrap;">Punkte</th>
                        <th style="padding: 8px; border: 1px solid var(--border); text-align: center; width: 50px; font-weight: bold; white-space: nowrap;">Platz</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        `;
        matrixContainer.style.display = 'block';
    }

    function getPlaceholderName(fightNr, compIndex) {
        if (fightNr === 'HF1') return compIndex === 1 ? '1. Gruppe A' : '2. Gruppe B';
        if (fightNr === 'HF2') return compIndex === 1 ? '1. Gruppe B' : '2. Gruppe A';
        if (fightNr === 'P5') return compIndex === 1 ? '3. Gruppe A' : '3. Gruppe B';
        if (fightNr === 'F1') return compIndex === 1 ? 'Sieger HF1' : 'Sieger HF2';
        if (fightNr === 'F2') return compIndex === 1 ? 'Verlierer HF1' : 'Verlierer HF2';

        if (fightNr === 'H5') return compIndex === 1 ? 'Sieger H1' : 'Sieger H2';
        if (fightNr === 'H6') return compIndex === 1 ? 'Sieger H3' : 'Sieger H4';
        if (fightNr === 'T1') return compIndex === 1 ? 'Verlierer H1' : 'Verlierer H2';
        if (fightNr === 'T2') return compIndex === 1 ? 'Verlierer H3' : 'Verlierer H4';
        if (fightNr === 'T3') return compIndex === 1 ? 'Sieger T1' : 'Verlierer H6';
        if (fightNr === 'T4') return compIndex === 1 ? 'Sieger T2' : 'Verlierer H5';
        if (fightNr === 'F') return compIndex === 1 ? 'Sieger H5' : 'Sieger H6';
        
        if (fightNr === 'H9') return compIndex === 1 ? 'Sieger H1' : 'Sieger H2';
        if (fightNr === 'H10') return compIndex === 1 ? 'Sieger H3' : 'Sieger H4';
        if (fightNr === 'H11') return compIndex === 1 ? 'Sieger H5' : 'Sieger H6';
        if (fightNr === 'H12') return compIndex === 1 ? 'Sieger H7' : 'Sieger H8';
        if (fightNr === 'H13') return compIndex === 1 ? 'Sieger H9' : 'Sieger H10';
        if (fightNr === 'H14') return compIndex === 1 ? 'Sieger H11' : 'Sieger H12';
        if (fightNr === 'F1') return compIndex === 1 ? 'Sieger H13' : 'Sieger H14';
        
        if (fightNr === 'T1') return compIndex === 1 ? 'Verlierer H1' : 'Verlierer H2';
        if (fightNr === 'T2') return compIndex === 1 ? 'Verlierer H3' : 'Verlierer H4';
        if (fightNr === 'T3') return compIndex === 1 ? 'Verlierer H5' : 'Verlierer H6';
        if (fightNr === 'T4') return compIndex === 1 ? 'Verlierer H7' : 'Verlierer H8';
        
        if (fightNr === 'T5') return compIndex === 1 ? 'Sieger T1' : 'Verlierer H10';
        if (fightNr === 'T6') return compIndex === 1 ? 'Sieger T2' : 'Verlierer H9';
        if (fightNr === 'T7') return compIndex === 1 ? 'Sieger T3' : 'Verlierer H12';
        if (fightNr === 'T8') return compIndex === 1 ? 'Sieger T4' : 'Verlierer H11';
        
        if (fightNr === 'T9') return compIndex === 1 ? 'Sieger T5' : 'Sieger T6';
        if (fightNr === 'T10') return compIndex === 1 ? 'Sieger T7' : 'Sieger T8';
        if (fightNr === 'T11') return compIndex === 1 ? 'Sieger T9' : 'Verlierer H14';
        if (fightNr === 'T12') return compIndex === 1 ? 'Sieger T10' : 'Verlierer H13';
        
        return 'noch offen';
    }

    function buildMatchCardHtml(fight, athleteMap) {
        if (!fight) {
            return `<div class="bracket-match-card empty-card" style="visibility: hidden;"></div>`;
        }
        
        const k1 = athleteMap.get(fight.kaempfer1_id);
        const k2 = athleteMap.get(fight.kaempfer2_id);
        
        const name1 = k1 ? `${k1.nachname}, ${k1.vorname}` : getPlaceholderName(fight.reihenfolge_nummer, 1);
        const verein1 = k1 ? (k1.verein || '') : '';
        const name2 = k2 ? `${k2.nachname}, ${k2.vorname}` : getPlaceholderName(fight.reihenfolge_nummer, 2);
        const verein2 = k2 ? (k2.verein || '') : '';
        
        const isFinished = fight.status === 'beendet' || fight.status === 'freilos';
        const isLaufend = fight.status === 'gestartet';
        const winnerId = fight.sieger_id;
        
        const isK1Winner = isFinished && winnerId === fight.kaempfer1_id;
        const isK2Winner = isFinished && winnerId === fight.kaempfer2_id;
        
        const score1 = isFinished ? fight.unterbewertung_kaempfer1 : '';
        const score2 = isFinished ? fight.unterbewertung_kaempfer2 : '';
        
        let medal1 = '';
        let medal2 = '';
        if (isFinished) {
            const isFinal = fight.reihenfolge_nummer === 'F' || fight.reihenfolge_nummer === 'F1';
            const isBronze = fight.reihenfolge_nummer === 'T3' || fight.reihenfolge_nummer === 'T4' || fight.reihenfolge_nummer === 'T11' || fight.reihenfolge_nummer === 'T12' || fight.reihenfolge_nummer === 'F2';
            
            if (isFinal) {
                if (isK1Winner) {
                    medal1 = `<span class="medal gold-medal" title="1. Platz (Gold)" style="font-size: 14px; margin-left: 6px; vertical-align: middle;">🥇</span>`;
                    medal2 = `<span class="medal silver-medal" title="2. Platz (Silber)" style="font-size: 14px; margin-left: 6px; vertical-align: middle;">🥈</span>`;
                } else if (isK2Winner) {
                    medal1 = `<span class="medal silver-medal" title="2. Platz (Silber)" style="font-size: 14px; margin-left: 6px; vertical-align: middle;">🥈</span>`;
                    medal2 = `<span class="medal gold-medal" title="1. Platz (Gold)" style="font-size: 14px; margin-left: 6px; vertical-align: middle;">🥇</span>`;
                }
            } else if (isBronze) {
                if (isK1Winner) {
                    medal1 = `<span class="medal bronze-medal" title="3. Platz (Bronze)" style="font-size: 14px; margin-left: 6px; vertical-align: middle;">🥉</span>`;
                } else if (isK2Winner) {
                    medal2 = `<span class="medal bronze-medal" title="3. Platz (Bronze)" style="font-size: 14px; margin-left: 6px; vertical-align: middle;">🥉</span>`;
                }
            }
        }

        let badgeHtml = '';
        if (isLaufend) {
            badgeHtml = `<span class="bracket-match-badge laufend">Laufend</span>`;
        } else if (isFinished) {
            badgeHtml = `<span class="bracket-match-badge beendet">Beendet</span>`;
        } else {
            let labelText = `Kampf ${fight.reihenfolge_nummer}`;
            if (activePoolModus === 'Doppel-KO-8') {
                if (fight.reihenfolge_nummer === 'H1') labelText = 'Kampf VF1';
                else if (fight.reihenfolge_nummer === 'H2') labelText = 'Kampf VF2';
                else if (fight.reihenfolge_nummer === 'H3') labelText = 'Kampf VF3';
                else if (fight.reihenfolge_nummer === 'H4') labelText = 'Kampf VF4';
                else if (fight.reihenfolge_nummer === 'H5') labelText = 'Kampf HF1';
                else if (fight.reihenfolge_nummer === 'H6') labelText = 'Kampf HF2';
                else if (fight.reihenfolge_nummer === 'F') labelText = 'Finale';
                else if (fight.reihenfolge_nummer === 'T3') labelText = 'kleines Finale 1';
                else if (fight.reihenfolge_nummer === 'T4') labelText = 'kleines Finale 2';
            } else if (activePoolModus === 'Doppel-KO-16') {
                if (fight.reihenfolge_nummer === 'H9') labelText = 'Kampf Viertelfinale 1';
                else if (fight.reihenfolge_nummer === 'H10') labelText = 'Kampf Viertelfinale 2';
                else if (fight.reihenfolge_nummer === 'H11') labelText = 'Kampf Viertelfinale 3';
                else if (fight.reihenfolge_nummer === 'H12') labelText = 'Kampf Viertelfinale 4';
                else if (fight.reihenfolge_nummer === 'H13') labelText = 'Kampf Halbfinale 1';
                else if (fight.reihenfolge_nummer === 'H14') labelText = 'Kampf Halbfinale 2';
                else if (fight.reihenfolge_nummer === 'F1') labelText = 'Finale';
                else if (fight.reihenfolge_nummer === 'T11') labelText = 'kleines Finale 1';
                else if (fight.reihenfolge_nummer === 'T12') labelText = 'kleines Finale 2';
            } else if (activePoolModus === 'Doppel-KO-32') {
                if (fight.reihenfolge_nummer === 'H25') labelText = 'Kampf Viertelfinale 1';
                else if (fight.reihenfolge_nummer === 'H26') labelText = 'Kampf Viertelfinale 2';
                else if (fight.reihenfolge_nummer === 'H27') labelText = 'Kampf Viertelfinale 3';
                else if (fight.reihenfolge_nummer === 'H28') labelText = 'Kampf Viertelfinale 4';
                else if (fight.reihenfolge_nummer === 'H29') labelText = 'Kampf Halbfinale 1';
                else if (fight.reihenfolge_nummer === 'H30') labelText = 'Kampf Halbfinale 2';
                else if (fight.reihenfolge_nummer === 'F1') labelText = 'Finale';
                else if (fight.reihenfolge_nummer === 'T27') labelText = 'kleines Finale 1';
                else if (fight.reihenfolge_nummer === 'T28') labelText = 'kleines Finale 2';
            } else if (fight.reihenfolge_nummer === 'F1') {
                labelText = 'Finale';
            } else if (fight.reihenfolge_nummer === 'F2') {
                labelText = 'kleines Finale';
            }
            badgeHtml = `<span class="bracket-match-badge">${labelText}</span>`;
        }
        
        return `
            <div class="bracket-match-card ${isLaufend ? 'laufend-card' : ''} ${isFinished ? 'beendet-card' : ''}">
                <div class="bracket-match-header">
                    ${badgeHtml}
                </div>
                <div class="bracket-fighters">
                    <div class="bracket-fighter-row ${isK1Winner ? 'winner' : ''} ${k1 ? 'has-fighter' : 'placeholder'}">
                        <span class="fighter-color-indicator blue-indicator"></span>
                        <span class="fighter-name">${escapeHtml(name1)}${medal1}</span>
                        <span class="fighter-verein">${escapeHtml(verein1)}</span>
                        <span class="fighter-score">${score1}</span>
                    </div>
                    <div class="bracket-fighter-row ${isK2Winner ? 'winner' : ''} ${k2 ? 'has-fighter' : 'placeholder'}">
                        <span class="fighter-color-indicator white-indicator"></span>
                        <span class="fighter-name">${escapeHtml(name2)}${medal2}</span>
                        <span class="fighter-verein">${escapeHtml(verein2)}</span>
                        <span class="fighter-score">${score2}</span>
                    </div>
                </div>
            </div>
        `;
    }

    // Match-Karten sind bewusst fix hoch (siehe .bracket-match-card in pools.css, feste
    // Zeilenhöhen + white-space:nowrap/ellipsis statt Umbruch) — das macht die geometrische
    // Zentrierung unten exakt berechenbar statt nur geschätzt.
    const BRACKET_CARD_HEIGHT = 96;
    const BRACKET_BASE_GAP = 16;

    // Definiert für jedes Doppel-KO-System die Runden (Titel + reihenfolge_nummer je Runde) für
    // Winner- und Loser-Bracket, jeweils von der kopfstärksten zur kleinsten Runde.
    const BRACKET_ROUND_DEFS = {
        'Doppel-KO-8': {
            winner: [
                { title: 'Viertelfinale', nummern: ['H1', 'H2', 'H3', 'H4'] },
                { title: 'Halbfinale', nummern: ['H5', 'H6'] },
                { title: 'Finale', nummern: ['F'] }
            ],
            loser: [
                { title: 'Trostrunde R1', nummern: ['T1', 'T2'] },
                { title: 'Bronze-Kämpfe (Platz 3)', nummern: ['T3', 'T4'] }
            ]
        },
        'Doppel-KO-16': {
            winner: [
                { title: 'Achtelfinale', nummern: [1, 2, 3, 4, 5, 6, 7, 8].map(i => `H${i}`) },
                { title: 'Viertelfinale', nummern: [9, 10, 11, 12].map(i => `H${i}`) },
                { title: 'Halbfinale', nummern: [13, 14].map(i => `H${i}`) },
                { title: 'Finale', nummern: ['F1'] }
            ],
            loser: [
                { title: 'Trostrunde R1', nummern: [1, 2, 3, 4].map(i => `T${i}`) },
                { title: 'Trostrunde R2', nummern: [5, 6, 7, 8].map(i => `T${i}`) },
                { title: 'Trostrunde R3', nummern: [9, 10].map(i => `T${i}`) },
                { title: 'Bronze-Kämpfe (Platz 3)', nummern: [11, 12].map(i => `T${i}`) }
            ]
        },
        'Doppel-KO-32': {
            winner: [
                { title: '1. Runde', nummern: Array.from({ length: 16 }, (_, i) => `H${i + 1}`) },
                { title: 'Achtelfinale', nummern: [17, 18, 19, 20, 21, 22, 23, 24].map(i => `H${i}`) },
                { title: 'Viertelfinale', nummern: [25, 26, 27, 28].map(i => `H${i}`) },
                { title: 'Halbfinale', nummern: [29, 30].map(i => `H${i}`) },
                { title: 'Finale', nummern: ['F1'] }
            ],
            loser: [
                { title: 'Trostrunde R1', nummern: [1, 2, 3, 4, 5, 6, 7, 8].map(i => `T${i}`) },
                { title: 'Trostrunde R2', nummern: [9, 10, 11, 12, 13, 14, 15, 16].map(i => `T${i}`) },
                { title: 'Trostrunde R3', nummern: [17, 18, 19, 20].map(i => `T${i}`) },
                { title: 'Trostrunde R4', nummern: [21, 22, 23, 24].map(i => `T${i}`) },
                { title: 'Trostrunde R5', nummern: [25, 26].map(i => `T${i}`) },
                { title: 'Bronze-Kämpfe (Platz 3)', nummern: [27, 28].map(i => `T${i}`) }
            ]
        }
    };

    // Baut eine einzelne Runden-Spalte, deren Kämpfe exakt mittig zwischen ihren beiden
    // speisenden Kämpfen der vorherigen Runde stehen (klassische Turnierbaum-Zentrierung):
    // Runde mit halb so vielen Kämpfen wie die Runde davor bekommt doppelten Kampfabstand +
    // einen halb so großen Rand oben, rekursiv — dadurch entsteht die korrekte Baumausrichtung,
    // ganz ohne gezeichnete Verbindungslinien.
    //
    // Positionierung bewusst über absolute Koordinaten in einem Container mit expliziter Höhe,
    // NICHT über Flexbox-gap/margin: Flexbox-Spalten mit berechnetem gap brechen beim Drucken
    // zuverlässig kaputt, sobald ein Seitenumbruch mitten durch die Spalte fällt (bekanntes,
    // browserübergreifendes Verhalten) — spätere Kämpfe einer Spalte rutschen dann sichtbar nach
    // oben und verlieren die Zentrierung. Absolut positionierte Elemente in einem Container fester
    // Höhe werden beim Seitenumbruch zuverlässig an der richtigen Stelle weitergeführt.
    function buildAlignedRoundHtml(title, nummern, depth, fightMap, athleteMap) {
        const slot = (BRACKET_CARD_HEIGHT + BRACKET_BASE_GAP) * Math.pow(2, depth);
        const gap = slot - BRACKET_CARD_HEIGHT;
        const topOffset = gap / 2;
        const totalHeight = topOffset * 2 + nummern.length * BRACKET_CARD_HEIGHT + (nummern.length - 1) * gap;

        const cardsHtml = nummern.map((nr, i) => {
            const top = topOffset + i * slot;
            return `<div class="bracket-match-slot" style="top: ${top}px;">${buildMatchCardHtml(fightMap.get(nr), athleteMap)}</div>`;
        }).join('');

        return `
            <div class="bracket-round">
                <div class="bracket-round-title">${title}</div>
                <div class="bracket-match-list" style="height: ${totalHeight}px;">
                    ${cardsHtml}
                </div>
            </div>
        `;
    }

    function buildAlignedRoundsHtml(roundDefs, fightMap, athleteMap) {
        const firstRoundCount = roundDefs[0].nummern.length;
        return roundDefs.map(round => {
            const depth = Math.round(Math.log2(firstRoundCount / round.nummern.length));
            return buildAlignedRoundHtml(round.title, round.nummern, depth, fightMap, athleteMap);
        }).join('');
    }

    function renderBracket(pool, bracketContainer = document.getElementById('bracketContainer')) {
        if (!bracketContainer) return;
        activePoolModus = pool.modus;

        const roundDefs = BRACKET_ROUND_DEFS[pool.modus];
        if (!roundDefs) {
            bracketContainer.style.display = 'none';
            bracketContainer.innerHTML = '';
            return;
        }

        const athleteMap = new Map(pool.teilnehmer.map(t => [t.id, t]));
        const fightMap = new Map(pool.kaempfe.map(k => [k.reihenfolge_nummer, k]));

        const winnerHtml = `
            <div class="bracket-section-title">Hauptrunde (Winner Bracket)</div>
            <div class="bracket-rounds winner-bracket">
                ${buildAlignedRoundsHtml(roundDefs.winner, fightMap, athleteMap)}
            </div>
        `;

        const loserHtml = `
            <div class="bracket-loser-section">
                <div class="bracket-section-title" style="margin-top: 32px;">Trostrunde (Loser Bracket)</div>
                <div class="bracket-rounds loser-bracket">
                    ${buildAlignedRoundsHtml(roundDefs.loser, fightMap, athleteMap)}
                </div>
            </div>
        `;

        bracketContainer.innerHTML = `
            <div class="bracket-wrapper">
                ${winnerHtml}
                ${loserHtml}
            </div>
        `;
        bracketContainer.style.display = 'block';
    }

    function buildMiniMatrixHtml(groupName, athletes, fights) {
        // athletes is an array of 3 players
        // fights is an array of fights for this group
        let colsHeader = '';
        athletes.forEach((ath, idx) => {
            colsHeader += `<th style="padding: 6px; border: 1px solid var(--border); text-align: center; width: 32px;">${idx + 1}</th>`;
        });
        
        const stats = athletes.map(ath => ({ id: ath.id, siege: 0, punkte: 0 }));
        const cells = {};
        const hasAnyGroupFinished = fights.some(f => f.status === 'beendet');
        
        athletes.forEach((rowAth, rIdx) => {
            athletes.forEach((colAth, cIdx) => {
                if (rIdx === cIdx) {
                    cells[`${rIdx}_${cIdx}`] = `<td style="background-color: var(--border); border: 1px solid var(--border);"></td>`;
                    return;
                }
                
                const fight = fights.find(f => 
                    (f.kaempfer1_id === rowAth.id && f.kaempfer2_id === colAth.id) ||
                    (f.kaempfer1_id === colAth.id && f.kaempfer2_id === rowAth.id)
                );
                
                if (!fight || fight.status !== 'beendet') {
                    cells[`${rIdx}_${cIdx}`] = `<td style="text-align: center; color: var(--text-muted); padding: 6px; border: 1px solid var(--border);"><span class="print-empty">-</span></td>`;
                    return;
                }
                
                const isRowKaempfer1 = fight.kaempfer1_id === rowAth.id;
                const rowScore = isRowKaempfer1 ? fight.unterbewertung_kaempfer1 : fight.unterbewertung_kaempfer2;
                const colScore = isRowKaempfer1 ? fight.unterbewertung_kaempfer2 : fight.unterbewertung_kaempfer1;
                
                if (fight.sieger_id === rowAth.id) {
                    cells[`${rIdx}_${cIdx}`] = `<td style="text-align: center; font-weight: bold; padding: 6px; border: 1px solid var(--border); background-color: rgba(46, 125, 50, 0.15) !important; color: #2e7d32; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${rowScore}</td>`;
                    const stat = stats.find(s => s.id === rowAth.id);
                    if (stat) {
                        stat.siege += 1;
                        stat.punkte += rowScore;
                    }
                } else if (fight.sieger_id === colAth.id) {
                    cells[`${rIdx}_${cIdx}`] = `<td style="text-align: center; padding: 6px; border: 1px solid var(--border); color: #b83232; font-weight: bold;">0</td>`;
                } else {
                    cells[`${rIdx}_${cIdx}`] = `<td style="text-align: center; color: var(--text-muted); padding: 6px; border: 1px solid var(--border);">${rowScore}</td>`;
                    const stat = stats.find(s => s.id === rowAth.id);
                    if (stat) {
                        stat.punkte += rowScore;
                    }
                }
            });
        });
        
        const sortedStats = [...stats].sort((a, b) => {
            if (b.siege !== a.siege) return b.siege - a.siege;
            return b.punkte - a.punkte;
        });
        
        let rowsHtml = '';
        athletes.forEach((ath, rIdx) => {
            let cellsHtml = '';
            athletes.forEach((_, cIdx) => {
                cellsHtml += cells[`${rIdx}_${cIdx}`];
            });
            
            const stat = stats.find(s => s.id === ath.id);
            const rank = sortedStats.findIndex(s => s.id === ath.id) + 1;
            
            const siegeHtml = hasAnyGroupFinished ? stat.siege : '<span class="print-empty">0</span>';
            const punkteHtml = hasAnyGroupFinished ? stat.punkte : '<span class="print-empty">0</span>';
            const rankHtml = hasAnyGroupFinished ? `${rank}.` : '<span class="print-empty">-</span>';

            rowsHtml += `
                <tr style="border-bottom: 1px solid var(--border); white-space: nowrap;">
                    <td style="padding: 6px; border: 1px solid var(--border); text-align: center; font-weight: bold;">${rIdx + 1}</td>
                    <td style="padding: 6px; border: 1px solid var(--border); font-weight: 600; white-space: nowrap;">${escapeHtml(ath.nachname)}, ${escapeHtml(ath.vorname)}</td>
                    <td style="padding: 6px; border: 1px solid var(--border); color: var(--text-muted); white-space: nowrap;">${escapeHtml(ath.verein || '')}</td>
                    ${cellsHtml}
                    <td style="padding: 6px; border: 1px solid var(--border); text-align: center; font-weight: bold;">${siegeHtml}</td>
                    <td style="padding: 6px; border: 1px solid var(--border); text-align: center;">${punkteHtml}</td>
                    <td style="padding: 6px; border: 1px solid var(--border); text-align: center; font-weight: bold; background-color: var(--bg-body);">${rankHtml}</td>
                </tr>
            `;
        });
        
        return `
            <div class="mini-matrix-box" style="flex: 1; min-width: 320px; border: 1px solid var(--border); border-radius: 6px; background-color: var(--bg-card); padding: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="font-weight: bold; font-size: 13px; text-transform: uppercase; margin-bottom: 8px; border-bottom: 2px solid var(--border); padding-bottom: 4px; color: var(--primary);">
                    Gruppe ${groupName}
                </div>
                <table class="matrix-table" style="width: 100%; border-collapse: collapse; font-size: 11px;">
                    <thead>
                        <tr style="background-color: var(--bg-body); border-bottom: 2px solid var(--border); white-space: nowrap;">
                            <th style="padding: 6px; border: 1px solid var(--border); text-align: center; width: 20px;">Nr.</th>
                            <th style="padding: 6px; border: 1px solid var(--border); text-align: left; white-space: nowrap;">Name</th>
                            <th style="padding: 6px; border: 1px solid var(--border); text-align: left; white-space: nowrap;">Verein</th>
                            ${colsHeader}
                            <th style="padding: 6px; border: 1px solid var(--border); text-align: center; width: 30px; font-weight: bold;">S</th>
                            <th style="padding: 6px; border: 1px solid var(--border); text-align: center; width: 30px; font-weight: bold;">P</th>
                            <th style="padding: 6px; border: 1px solid var(--border); text-align: center; width: 30px; font-weight: bold;">Pl.</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderUeberKreuz(pool, ueberKreuzContainer = document.getElementById('ueberKreuzContainer')) {
        if (!ueberKreuzContainer) return;
        activePoolModus = pool.modus;

        const athleteMap = new Map(pool.teilnehmer.map(t => [t.id, t]));
        const fightMap = new Map(pool.kaempfe.map(k => [k.reihenfolge_nummer, k]));

        const sortedTeilnehmer = [...pool.teilnehmer].sort((a, b) => Number(a.gewicht) - Number(b.gewicht));
        const poolA = [];
        const poolB = [];
        sortedTeilnehmer.forEach((athlet, index) => {
            if (index % 2 === 0) {
                poolA.push(athlet);
            } else {
                poolB.push(athlet);
            }
        });

        const groupAFights = pool.kaempfe.filter(f => f.reihenfolge_nummer?.startsWith('V_A_'));
        const groupBFights = pool.kaempfe.filter(f => f.reihenfolge_nummer?.startsWith('V_B_'));

        const matricesHtml = `
            <div class="print-row-block" style="display: flex; flex-wrap: wrap; gap: 24px; margin-bottom: 32px;">
                ${buildMiniMatrixHtml('A', poolA, groupAFights)}
                ${buildMiniMatrixHtml('B', poolB, groupBFights)}
            </div>
        `;

        const bracketHtml = `
            <div class="bracket-loser-section ueberkreuz-final-section">
                <div class="bracket-section-title">Finalrunde (Überkreuz-Spiele & Platzierungen)</div>
                <div class="bracket-rounds" style="height: 420px;">
                    <div class="bracket-round">
                        <div class="bracket-round-title">Halbfinale (Überkreuz)</div>
                        <div class="bracket-match-list">
                            ${buildMatchCardHtml(fightMap.get('HF1'), athleteMap)}
                            ${buildMatchCardHtml(fightMap.get('HF2'), athleteMap)}
                        </div>
                    </div>
                    <div class="bracket-round">
                        <div class="bracket-round-title">Finale & Platz 3</div>
                        <div class="bracket-match-list">
                            ${buildMatchCardHtml(fightMap.get('F1'), athleteMap)}
                            ${buildMatchCardHtml(fightMap.get('F2'), athleteMap)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        ueberKreuzContainer.innerHTML = `
            <div class="ueberkreuz-wrapper">
                ${matricesHtml}
                ${bracketHtml}
            </div>
        `;
        ueberKreuzContainer.style.display = 'block';
    }

    let activeFightplanPoolId = null;
    let activeFightplanPoolName = null;

    function initialisiereFightplanEvents(root = document) {
        const fightplanModal = document.getElementById('fightplanModal');
        const modalPoolTitle = document.getElementById('modalPoolTitle');
        const printPoolTitleHeader = document.getElementById('printPoolTitleHeader');
        const fightplanTableBody = document.getElementById('fightplanTableBody');
        const printFightplanBtn = document.getElementById('printFightplanBtn');
        const refreshFightplanBtn = document.getElementById('refreshFightplanBtn');
        const closeFightplanBtn = document.getElementById('closeFightplanBtn');

        if (!fightplanModal) return;

        async function loadFightplan(poolId, poolName) {
            activeFightplanPoolId = poolId;
            activeFightplanPoolName = poolName;
            
            modalPoolTitle.textContent = `Kampfplan: ${poolName}`;
            printPoolTitleHeader.textContent = poolName;
            fightplanTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:16px;">Kämpfe werden geladen...</td></tr>';

            try {
                const response = await fetch(`/api/pools/${poolId}`);
                const pool = await response.json();

                if (!response.ok) throw new Error(pool.error || 'Fehler beim Laden des Kampfplans.');

                // Sort fights numerically by actual order (reihenfolge_nummer)
                pool.kaempfe.sort((a, b) => {
                    const numA = parseInt(a.reihenfolge_nummer, 10);
                    const numB = parseInt(b.reihenfolge_nummer, 10);
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return numA - numB;
                    }
                    return String(a.reihenfolge_nummer || '').localeCompare(String(b.reihenfolge_nummer || ''), undefined, {numeric: true});
                });

                // Matrix oder Bracket rendern, je nach Modus
                const isJederGegenJeden = pool.modus === 'Jeder-gegen-Jeden' || pool.modus === 'Jeder gegen Jeden' || pool.teilnehmer.length === 1;
                const isDoppelKo = pool.modus === 'Doppel-KO-8' || pool.modus === 'Doppel-KO-16' || pool.modus === 'Doppel-KO-32';
                const isUeberKreuz = pool.modus === 'Gruppen-Überkreuz' || pool.modus === 'Gruppen-ueberkreuz';
                
                if (isJederGegenJeden) {
                    document.getElementById('bracketContainer').style.display = 'none';
                    document.getElementById('ueberKreuzContainer').style.display = 'none';
                    renderMatrix(pool);
                } else if (isDoppelKo) {
                    document.getElementById('matrixContainer').style.display = 'none';
                    document.getElementById('ueberKreuzContainer').style.display = 'none';
                    renderBracket(pool);
                } else if (isUeberKreuz) {
                    document.getElementById('matrixContainer').style.display = 'none';
                    document.getElementById('bracketContainer').style.display = 'none';
                    renderUeberKreuz(pool);
                } else {
                    document.getElementById('matrixContainer').style.display = 'none';
                    document.getElementById('bracketContainer').style.display = 'none';
                    document.getElementById('ueberKreuzContainer').style.display = 'none';
                }

                // Tabellen-Header dynamisch befüllen
                const fightplanTableHeader = document.getElementById('fightplanTableHeader');
                if (fightplanTableHeader) {
                    fightplanTableHeader.innerHTML = `
                        <tr class="pools-table-header">
                            <th class="pool-cell" style="width: 60px; text-align: left; padding: 8px; border-bottom: 2px solid var(--border);">Nr.</th>
                            ${isJederGegenJeden ? '' : `<th class="pool-cell" style="text-align: left; padding: 8px; border-bottom: 2px solid var(--border);">Typ / Runde</th>`}
                            <th class="pool-cell" style="text-align: left; padding: 8px; border-bottom: 2px solid var(--border);">Kämpfer 1 (Rot)</th>
                            <th class="pool-cell" style="text-align: center; width: 40px; padding: 8px; border-bottom: 2px solid var(--border);">VS</th>
                            <th class="pool-cell" style="text-align: left; padding: 8px; border-bottom: 2px solid var(--border);">Kämpfer 2 (Weiß)</th>
                            <th class="pool-cell" style="text-align: right; width: 180px; padding: 8px; border-bottom: 2px solid var(--border);">Ergebnis</th>
                        </tr>
                    `;
                }

                const athleteMap = new Map(pool.teilnehmer.map(t => [t.id, t]));
                const fights = pool.kaempfe.map(k => {
                    const t1 = athleteMap.get(k.kaempfer1_id);
                    const t2 = athleteMap.get(k.kaempfer2_id);
                    return {
                        ...k,
                        kaempfer1_vorname: t1 ? t1.vorname : '',
                        kaempfer1_nachname: t1 ? t1.nachname : '',
                        kaempfer1_verein: t1 ? t1.verein : '',
                        kaempfer2_vorname: t2 ? t2.vorname : '',
                        kaempfer2_nachname: t2 ? t2.nachname : '',
                        kaempfer2_verein: t2 ? t2.verein : ''
                    };
                });

                fights.sort((a, b) => {
                    const aOpen = !a.kaempfer1_id || !a.kaempfer2_id;
                    const bOpen = !b.kaempfer1_id || !b.kaempfer2_id;
                    if (aOpen && !bOpen) return 1;
                    if (!aOpen && bOpen) return -1;
                    return a.id - b.id;
                });

                if (fights.length === 0) {
                    const colSpan = isJederGegenJeden ? 5 : 6;
                    fightplanTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; padding:16px; color:var(--text-muted);">Keine Kämpfe in diesem Pool generiert.</td></tr>`;
                    return;
                }

                fightplanTableBody.innerHTML = fights.map((k, idx) => {
                    const name1 = k.kaempfer1_nachname ? `${k.kaempfer1_nachname}, ${k.kaempfer1_vorname}` : 'noch offen';
                    const name2 = k.kaempfer2_nachname ? `${k.kaempfer2_nachname}, ${k.kaempfer2_vorname}` : 'noch offen';
                    
                    let ergebnis = '<span class="print-empty">-</span>';
                    if (k.status === 'beendet') {
                        const min = Math.floor(k.kampfzeit_in_sekunden / 60);
                        const sec = String(k.kampfzeit_in_sekunden % 60).padStart(2, '0');
                        ergebnis = `Sieger: ${k.sieger_id === k.kaempfer1_id ? 'Rot' : 'Weiß'} (${k.unterbewertung_kaempfer1}:${k.unterbewertung_kaempfer2} | ${min}:${sec})`;
                    } else if (k.status === 'freilos') {
                        ergebnis = k.sieger_id ? 'Freilos (automatischer Sieg)' : 'Freilos';
                    } else if (k.status === 'gestartet') {
                        ergebnis = 'Laufend';
                    } else {
                        ergebnis = '<span class="print-empty">Ausstehend</span>';
                    }

                    let rundeTyp = k.reihenfolge_nummer || 'Vorrunde';
                    if (pool.modus === 'Doppel-KO-8') {
                        if (rundeTyp === 'H1') rundeTyp = 'VF1';
                        else if (rundeTyp === 'H2') rundeTyp = 'VF2';
                        else if (rundeTyp === 'H3') rundeTyp = 'VF3';
                        else if (rundeTyp === 'H4') rundeTyp = 'VF4';
                        else if (rundeTyp === 'H5') rundeTyp = 'HF1';
                        else if (rundeTyp === 'H6') rundeTyp = 'HF2';
                        else if (rundeTyp === 'F') rundeTyp = 'Finale';
                        else if (rundeTyp === 'T3') rundeTyp = 'kleines Finale 1';
                        else if (rundeTyp === 'T4') rundeTyp = 'kleines Finale 2';
                    } else if (pool.modus === 'Doppel-KO-16') {
                        if (rundeTyp === 'H9') rundeTyp = 'Viertelfinale 1';
                        else if (rundeTyp === 'H10') rundeTyp = 'Viertelfinale 2';
                        else if (rundeTyp === 'H11') rundeTyp = 'Viertelfinale 3';
                        else if (rundeTyp === 'H12') rundeTyp = 'Viertelfinale 4';
                        else if (rundeTyp === 'H13') rundeTyp = 'Halbfinale 1';
                        else if (rundeTyp === 'H14') rundeTyp = 'Halbfinale 2';
                        else if (rundeTyp === 'F1') rundeTyp = 'Finale';
                        else if (rundeTyp === 'T11') rundeTyp = 'kleines Finale 1';
                        else if (rundeTyp === 'T12') rundeTyp = 'kleines Finale 2';
                    } else {
                        if (rundeTyp === 'F1') rundeTyp = 'Finale';
                        else if (rundeTyp === 'F2') rundeTyp = 'kleines Finale';
                        else if (rundeTyp === 'HF1') rundeTyp = 'Halbfinale 1';
                        else if (rundeTyp === 'HF2') rundeTyp = 'Halbfinale 2';
                    }

                    return `
                        <tr>
                            <td class="pool-cell" style="padding: 8px; border-bottom: 1px solid var(--border);">${idx + 1}</td>
                            ${isJederGegenJeden ? '' : `<td class="pool-cell" style="padding: 8px; border-bottom: 1px solid var(--border);">${escapeHtml(rundeTyp)}</td>`}
                            <td class="pool-cell" style="padding: 8px; border-bottom: 1px solid var(--border);">${escapeHtml(name1)}</td>
                            <td class="pool-cell" style="text-align: center; padding: 8px; border-bottom: 1px solid var(--border); font-weight:bold; color:var(--primary);">VS</td>
                            <td class="pool-cell" style="padding: 8px; border-bottom: 1px solid var(--border);">${escapeHtml(name2)}</td>
                            <td class="pool-cell" style="text-align: right; padding: 8px; border-bottom: 1px solid var(--border); font-weight:600;">${ergebnis}</td>
                        </tr>
                    `;
                }).join('');
            } catch (err) {
                fightplanTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:16px; color:#b83232;">Fehler: ${escapeHtml(err.message)}</td></tr>`;
            }
        }

        root.querySelectorAll('.btn-view-fightplan').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const poolId = e.currentTarget.getAttribute('data-id');
                const poolName = e.currentTarget.getAttribute('data-name');
                
                fightplanModal.style.display = 'flex';
                await loadFightplan(poolId, poolName);
            });
        });

        if (refreshFightplanBtn) {
            refreshFightplanBtn.onclick = async () => {
                if (activeFightplanPoolId) {
                    await loadFightplan(activeFightplanPoolId, activeFightplanPoolName);
                }
            };
        }

        if (closeFightplanBtn) {
            closeFightplanBtn.onclick = () => {
                fightplanModal.style.display = 'none';
            };
        }

        if (printFightplanBtn) {
            printFightplanBtn.onclick = () => {
                window.print();
            };
        }

        const printAllPoolsBtn = document.getElementById('printAllPoolsBtn');
        if (printAllPoolsBtn) {
            printAllPoolsBtn.onclick = async () => {
                try {
                    const response = await fetch(`/api/pools/details?turnierId=${encodeURIComponent(turnierId)}`);
                    const responseText = await response.text();
                    
                    let pools;
                    try {
                        pools = JSON.parse(responseText);
                    } catch (parseError) {
                        throw new Error(`Ungültige Serverantwort: ${responseText}`);
                    }
                    
                    if (!response.ok) throw new Error(pools.error || 'Fehler beim Laden der Pools.');
                    if (pools.length === 0) {
                        zeigeNotification('Keine Pools vorhanden.', 'error');
                        return;
                    }
                    
                    const originalPrintAreaHtml = document.getElementById('printArea').innerHTML;
                    let allPoolsPrintHtml = '';
                    
                    const tempDiv = document.createElement('div');
                    tempDiv.style.display = 'none';
                    document.body.appendChild(tempDiv);
                    
                    pools.forEach((pool) => {
                        const isJederGegenJeden = pool.modus === 'Jeder-gegen-Jeden' || pool.modus === 'Jeder gegen Jeden' || pool.teilnehmer.length === 1;
                        const isDoppelKo = pool.modus === 'Doppel-KO-8' || pool.modus === 'Doppel-KO-16' || pool.modus === 'Doppel-KO-32';
                        const isUeberKreuz = pool.modus === 'Gruppen-Überkreuz' || pool.modus === 'Gruppen-ueberkreuz';
                        
                        let visualHtml = '';
                        
                        if (isJederGegenJeden) {
                            const mDiv = document.createElement('div');
                            tempDiv.appendChild(mDiv);
                            renderMatrix(pool, mDiv);
                            visualHtml = mDiv.innerHTML;
                            tempDiv.removeChild(mDiv);
                        } else if (isDoppelKo) {
                            const bDiv = document.createElement('div');
                            tempDiv.appendChild(bDiv);
                            renderBracket(pool, bDiv);
                            visualHtml = bDiv.innerHTML;
                            tempDiv.removeChild(bDiv);
                        } else if (isUeberKreuz) {
                            const uDiv = document.createElement('div');
                            tempDiv.appendChild(uDiv);
                            renderUeberKreuz(pool, uDiv);
                            visualHtml = uDiv.innerHTML;
                            tempDiv.removeChild(uDiv);
                        }
                        
                        allPoolsPrintHtml += `
                            <div class="single-pool-print-container">
                                <div class="print-only-header" style="margin-bottom: 16px; display: block !important;">
                                    <h1 style="margin: 0 0 4px 0; font-size: 24px; font-weight: bold; text-transform: uppercase;">${escapeHtml(pool.bezeichnung)}</h1>
                                    <div style="font-size: 12px; color: #555555;">Hajime Pro Turniermanager</div>
                                </div>
                                <div style="margin-bottom: 24px;">
                                    ${visualHtml}
                                </div>
                            </div>
                        `;
                    });
                    
                    document.body.removeChild(tempDiv);
                    document.getElementById('printArea').innerHTML = allPoolsPrintHtml;
                    
                    fightplanModal.classList.add('print-all-active');
                    
                    window.print();
                    
                    fightplanModal.classList.remove('print-all-active');
                    document.getElementById('printArea').innerHTML = originalPrintAreaHtml;
                    
                } catch (err) {
                    zeigeNotification(err.message, 'error');
                }
            };
        }

    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Beim ersten Laden der Seite sofort den Ist-Zustand abfragen
    ladePools();
});
