// public/js/kampf.js

document.addEventListener('DOMContentLoaded', async () => {
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
    const mattenSelect = document.getElementById('mattenSelect');
    const kampfplanContainer = document.getElementById('kampfplanContainer');
    const offlineActions = document.getElementById('offlineActions');
    const exportBtn = document.getElementById('exportBtn');
    const importInput = document.getElementById('importInput');
    
    const currentPoolTitle = document.getElementById('currentPoolTitle');
    const currentFighter1Name = document.getElementById('currentFighter1Name');
    const currentFighter1Club = document.getElementById('currentFighter1Club');
    const currentFighter2Name = document.getElementById('currentFighter2Name');
    const currentFighter2Club = document.getElementById('currentFighter2Club');
    const currentFightActions = document.getElementById('currentFightActions');
    
    const upcomingFightsList = document.getElementById('upcomingFightsList');
    const finishedFightsList = document.getElementById('finishedFightsList');
    
    // Modal-Elemente
    const resultModal = document.getElementById('resultModal');
    const resultForm = document.getElementById('resultForm');
    const modalKampfId = document.getElementById('modalKampfId');
    const siegerSelect = document.getElementById('siegerSelect');
    const score1 = document.getElementById('score1');
    const score2 = document.getElementById('score2');
    const scoreLabel1 = document.getElementById('scoreLabel1');
    const scoreLabel2 = document.getElementById('scoreLabel2');
    const kampfzeit = document.getElementById('kampfzeit');
    const cancelResultBtn = document.getElementById('cancelResultBtn');

    let allFights = [];

    // --- UTILITIES ---
    const zeigeNotification = (nachricht, typ = 'info') => {
        if (typeof window.zeigeNotification === 'function') {
            window.zeigeNotification(nachricht, typ);
            return;
        }
        console.log(`[${typ}] ${nachricht}`);
    };

    // --- MATTEN LADEN ---
    async function ladeMatten() {
        try {
            const response = await fetch(`/api/kampfflaechen?turnierId=${turnierId}`);
            const mats = await response.json();
            
            if (!response.ok) throw new Error(mats.error || 'Fehler beim Laden der Kampfflächen.');

            mattenSelect.innerHTML = '<option value="" disabled selected hidden>Bitte wählen...</option>';
            mats.forEach(mat => {
                const opt = document.createElement('option');
                opt.value = mat.id;
                opt.textContent = mat.bezeichnung;
                mattenSelect.appendChild(opt);
            });

            // Vorherige Auswahl wiederherstellen
            const letzteMatte = localStorage.getItem('aktiveMatteId');
            if (letzteMatte && mats.some(m => m.id === parseInt(letzteMatte))) {
                mattenSelect.value = letzteMatte;
                ladeKämpfe(letzteMatte);
            }
        } catch (err) {
            zeigeNotification('Fehler beim Laden der Kampfflächen: ' + err.message, 'error');
        }
    }

    // --- KÄMPFE LADEN ---
    async function ladeKämpfe(matId) {
        if (!matId) {
            if (offlineActions) offlineActions.style.display = 'none';
            return;
        }
        localStorage.setItem('aktiveMatteId', matId);

        try {
            kampfplanContainer.style.display = 'none';
            if (offlineActions) offlineActions.style.display = 'none';

            const response = await fetch(`/api/kaempfe?kampfflaecheId=${matId}`);
            allFights = await response.json();

            if (!response.ok) throw new Error(allFights.error || 'Fehler beim Laden der Kämpfe.');

            renderKämpfe();
            kampfplanContainer.style.display = 'block';
            if (offlineActions) offlineActions.style.display = 'flex';
        } catch (err) {
            zeigeNotification('Fehler beim Laden der Kämpfe: ' + err.message, 'error');
            if (offlineActions) offlineActions.style.display = 'none';
        }
    }

    // --- KÄMPFE RENDERN ---
    function renderKämpfe() {
        // 1. Finde den aktuellen Kampf: Der erste, der "gestartet" ist.
        // Falls keiner gestartet ist, der erste "bereit" (beide Kämpfer feststehen).
        // Andernfalls der erste, der überhaupt noch "angelegt" (Platzhalter) ist.
        let currentFight = allFights.find(k => k.status === 'gestartet');
        if (!currentFight) {
            currentFight = allFights.find(k => k.status === 'bereit');
        }
        if (!currentFight) {
            currentFight = allFights.find(k => k.status === 'angelegt');
        }

        // 2. Teile restliche Kämpfe in Warteliste und Verlauf
        const upcoming = allFights.filter(k => (k.status === 'bereit' || k.status === 'angelegt') && k.id !== currentFight?.id);
        upcoming.sort((a, b) => {
            const aOpen = !a.kaempfer1_id || !a.kaempfer2_id;
            const bOpen = !b.kaempfer1_id || !b.kaempfer2_id;
            if (aOpen && !bOpen) return 1;
            if (!aOpen && bOpen) return -1;
            return 0;
        });
        const finished = allFights.filter(k => k.status === 'beendet' || k.status === 'freilos').reverse(); // Letzte beendete zuerst

        // --- AKTUELLEN KAMPF ANZEIGEN ---
        if (currentFight) {
            currentPoolTitle.textContent = currentFight.pool_bezeichnung;
            
            // Name 1
            const name1 = formatFighterName(currentFight.kaempfer1_nachname, currentFight.kaempfer1_vorname);
            currentFighter1Name.textContent = name1 || 'noch offen';
            currentFighter1Club.textContent = currentFight.kaempfer1_verein || '';
            
            // Name 2
            const name2 = formatFighterName(currentFight.kaempfer2_nachname, currentFight.kaempfer2_vorname);
            currentFighter2Name.textContent = name2 || 'noch offen';
            currentFighter2Club.textContent = currentFight.kaempfer2_verein || '';
            
            // Buttons steuern
            currentFightActions.innerHTML = '';
            if (currentFight.status === 'bereit') {
                const startBtn = document.createElement('button');
                startBtn.className = 'btn btn-raised';
                startBtn.style.backgroundColor = '#f57c00';
                startBtn.innerHTML = '<span class="material-icons" style="margin-right: 8px; vertical-align: middle;">play_arrow</span>Kampf im Scoreboard starten';
                startBtn.addEventListener('click', () => startKampf(currentFight));
                currentFightActions.appendChild(startBtn);
            } else if (currentFight.status === 'angelegt') {
                currentFightActions.innerHTML = '<span class="badge wartet">Wartet auf feste Paarungen</span>';
            } else if (currentFight.status === 'gestartet') {
                const finishBtn = document.createElement('button');
                finishBtn.className = 'btn btn-raised';
                finishBtn.style.backgroundColor = '#2e7d32';
                finishBtn.innerHTML = '<span class="material-icons" style="margin-right: 8px; vertical-align: middle;">check</span>Ergebnis eintragen';
                finishBtn.addEventListener('click', () => openResultModal(currentFight));
                currentFightActions.appendChild(finishBtn);
            }

            // Forfeit-Aktionen (nicht angetreten / disqualifiziert) — nur wenn beide Kämpfer
            // feststehen und der Kampf noch nicht beendet ist.
            if ((currentFight.status === 'bereit' || currentFight.status === 'gestartet') && currentFight.kaempfer1_id && currentFight.kaempfer2_id) {
                currentFightActions.appendChild(baueForfeitAktionen(currentFight));
            }
        } else {
            // Keine Kämpfe vorhanden oder alle beendet
            currentPoolTitle.textContent = 'Keine anstehenden Kämpfe';
            currentFighter1Name.textContent = '-';
            currentFighter1Club.textContent = '';
            currentFighter2Name.textContent = '-';
            currentFighter2Club.textContent = '';
            currentFightActions.innerHTML = '<span class="badge beendet">Alle Kämpfe abgeschlossen</span>';
        }

        // --- WARTELISTE RENDERN ---
        upcomingFightsList.innerHTML = '';
        if (upcoming.length === 0) {
            upcomingFightsList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted);">Keine anstehenden Kämpfe in der Warteliste.</div>';
        } else {
            upcoming.forEach((k, idx) => {
                const name1 = formatFighterName(k.kaempfer1_nachname, k.kaempfer1_vorname) || 'noch offen';
                const name2 = formatFighterName(k.kaempfer2_nachname, k.kaempfer2_vorname) || 'noch offen';
                
                const row = document.createElement('div');
                row.className = 'fight-row';
                row.innerHTML = `
                    <span class="fight-row-order">#${idx + 1}</span>
                    <span class="fight-row-pool">${escapeHtml(k.pool_bezeichnung)}</span>
                    <span class="fight-row-fighters">
                        <span>${escapeHtml(name1)}</span>
                        <span class="fight-row-vs">VS</span>
                        <span>${escapeHtml(name2)}</span>
                    </span>
                    <span class="fight-row-status"><span class="badge wartet">Bereit</span></span>
                `;
                upcomingFightsList.appendChild(row);
            });
        }

        // --- VERLAUF RENDERN ---
        finishedFightsList.innerHTML = '';
        if (finished.length === 0) {
            finishedFightsList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted);">Noch keine Kämpfe beendet.</div>';
        } else {
            finished.forEach(k => {
                const name1 = formatFighterName(k.kaempfer1_nachname, k.kaempfer1_vorname) || 'Unbekannt';
                const name2 = formatFighterName(k.kaempfer2_nachname, k.kaempfer2_vorname) || 'Unbekannt';
                
                // Sieger hervorheben
                let fighter1Display = escapeHtml(name1);
                let fighter2Display = escapeHtml(name2);
                
                if (k.sieger_id === k.kaempfer1_id) {
                    fighter1Display = `<strong>${fighter1Display} (Sieger)</strong>`;
                } else if (k.sieger_id === k.kaempfer2_id) {
                    fighter2Display = `<strong>${fighter2Display} (Sieger)</strong>`;
                }

                const min = Math.floor(k.kampfzeit_in_sekunden / 60);
                const sec = String(k.kampfzeit_in_sekunden % 60).padStart(2, '0');
                const scoreText = k.status === 'freilos' ? '(Freilos)' : `(${k.unterbewertung_kaempfer1} : ${k.unterbewertung_kaempfer2} | ${min}:${sec})`;
                // Ein Freilos hat kein echtes Ergebnis zu korrigieren.
                const korrigierenButton = k.status === 'freilos' ? '' : `<button type="button" class="btn btn-outlined" style="padding: 4px 8px; font-size: 10px;" onclick="window.bearbeiteKampfergebnis(${k.id})">Korrigieren</button>`;

                const row = document.createElement('div');
                row.className = 'fight-row';
                row.style.opacity = '0.7';
                row.innerHTML = `
                    <span class="fight-row-order"><span class="material-icons" style="color: #2e7d32; font-size: 16px;">check_circle</span></span>
                    <span class="fight-row-pool">${escapeHtml(k.pool_bezeichnung)}</span>
                    <span class="fight-row-fighters">
                        <span>${fighter1Display}</span>
                        <span class="fight-row-vs">VS</span>
                        <span>${fighter2Display}</span>
                    </span>
                    <span class="fight-row-status" style="width: auto; font-size: 12px; font-weight: 700; color: var(--text-muted); margin-right: 12px;">${scoreText}</span>
                    <span class="fight-row-actions">
                        ${korrigierenButton}
                    </span>
                `;
                finishedFightsList.appendChild(row);
            });
        }
    }

    // --- FORFEIT-AKTIONEN (NICHT ANGETRETEN / DISQUALIFIZIERT) ---
    function baueForfeitAktionen(kampf) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; justify-content: center;';

        const fighterLabel = (teilnehmerId) => teilnehmerId === kampf.kaempfer1_id
            ? (formatFighterName(kampf.kaempfer1_nachname, kampf.kaempfer1_vorname) || 'Kämpfer 1')
            : (formatFighterName(kampf.kaempfer2_nachname, kampf.kaempfer2_vorname) || 'Kämpfer 2');

        const macheButton = (teilnehmerId, aktion, label, icon) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-outlined';
            btn.style.cssText = 'padding: 4px 10px; font-size: 11px; color: #c62828; border-color: #c62828;';
            btn.innerHTML = `<span class="material-icons" style="font-size: 14px; vertical-align: middle; margin-right: 4px;">${icon}</span>${label}`;
            btn.addEventListener('click', () => fuehreForfeitAktionAus(teilnehmerId, kampf.id, aktion, fighterLabel(teilnehmerId)));
            return btn;
        };

        wrapper.appendChild(macheButton(kampf.kaempfer1_id, 'nicht-angetreten', `${fighterLabel(kampf.kaempfer1_id)}: nicht angetreten`, 'person_off'));
        wrapper.appendChild(macheButton(kampf.kaempfer1_id, 'disqualifizieren', `${fighterLabel(kampf.kaempfer1_id)}: DSQ`, 'block'));
        wrapper.appendChild(macheButton(kampf.kaempfer2_id, 'nicht-angetreten', `${fighterLabel(kampf.kaempfer2_id)}: nicht angetreten`, 'person_off'));
        wrapper.appendChild(macheButton(kampf.kaempfer2_id, 'disqualifizieren', `${fighterLabel(kampf.kaempfer2_id)}: DSQ`, 'block'));

        return wrapper;
    }

    async function fuehreForfeitAktionAus(teilnehmerId, kampfId, aktion, name) {
        const nachricht = aktion === 'disqualifizieren'
            ? `${name} disqualifizieren? Der Gegner erhält einen regulären Sieg (10 Punkte).`
            : `${name} als nicht angetreten markieren? Der Gegner erhält einen regulären Sieg (10 Punkte).`;
        const bestaetigt = window.zeigeZentraleBestaetigung
            ? await window.zeigeZentraleBestaetigung(nachricht, 'Forfeit werten', 'warning')
            : confirm(nachricht);
        if (!bestaetigt) return;

        try {
            const response = await fetch(`/api/teilnehmer/${teilnehmerId}/${aktion}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kampf_id: kampfId })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Aktion fehlgeschlagen.');
            }
            zeigeNotification('Forfeit gewertet.', 'success');
            ladeKämpfe(mattenSelect.value);
        } catch (err) {
            zeigeNotification(err.message, 'error');
        }
    }

    // --- KAMPF STARTEN ---
    async function startKampf(kampf) {
        try {
            const response = await fetch(`/api/kaempfe/${kampf.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'gestartet' })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Fehler beim Starten des Kampfes.');
            }

            zeigeNotification('Kampf gestartet.', 'success');

            // Steuerung-Fenster öffnen und mit Parametern befüllen
            const nameW = `${kampf.kaempfer1_nachname || ''}, ${kampf.kaempfer1_vorname || ''}`;
            const clubW = kampf.kaempfer1_verein || '';
            const nameB = `${kampf.kaempfer2_nachname || ''}, ${kampf.kaempfer2_vorname || ''}`;
            const clubB = kampf.kaempfer2_verein || '';
            const poolName = kampf.pool_bezeichnung || '';
            const duration = kampf.pool_kampfzeit || 240;
            const gsAktiv = kampf.pool_golden_score_aktiv !== false ? 1 : 0;
            const gsMax = kampf.pool_golden_score_max_sekunden || '';

            const steuerungUrl = `/steuerung.html?id=${kampf.id}&k1_id=${kampf.kaempfer1_id}&k2_id=${kampf.kaempfer2_id}&matId=${mattenSelect.value}&turnierId=${turnierId}&nameW=${encodeURIComponent(nameW)}&clubW=${encodeURIComponent(clubW)}&nameB=${encodeURIComponent(nameB)}&clubB=${encodeURIComponent(clubB)}&poolName=${encodeURIComponent(poolName)}&duration=${duration}&gsAktiv=${gsAktiv}&gsMax=${gsMax}`;
            window.open(steuerungUrl, '_blank');

            ladeKämpfe(mattenSelect.value);
        } catch (err) {
            zeigeNotification(err.message, 'error');
        }
    }

    // --- MODAL: KAMPFERGEBNIS EINTRAGEN ---
    function openResultModal(kampf) {
        modalKampfId.value = kampf.id;
        
        // Sieger-Auswahl befüllen
        siegerSelect.innerHTML = '<option value="" disabled selected hidden>Bitte wählen...</option>';
        
        const opt1 = document.createElement('option');
        opt1.value = kampf.kaempfer1_id;
        opt1.textContent = `Rot: ${formatFighterName(kampf.kaempfer1_nachname, kampf.kaempfer1_vorname)}`;
        siegerSelect.appendChild(opt1);
        
        const opt2 = document.createElement('option');
        opt2.value = kampf.kaempfer2_id;
        opt2.textContent = `Weiß: ${formatFighterName(kampf.kaempfer2_nachname, kampf.kaempfer2_vorname)}`;
        siegerSelect.appendChild(opt2);

        // Labels für die Scores anpassen
        scoreLabel1.textContent = `Score Rot (${kampf.kaempfer1_nachname || 'Kämpfer 1'})`;
        scoreLabel2.textContent = `Score Weiß (${kampf.kaempfer2_nachname || 'Kämpfer 2'})`;

        // Default Werte zurücksetzen
        score1.value = 10;
        score2.value = 0;
        kampfzeit.value = parseInt(kampf.pool_kampfzeit) || 240;

        // Falls wir ein bereits beendetes Ergebnis korrigieren
        if (kampf.status === 'beendet') {
            siegerSelect.value = kampf.sieger_id;
            score1.value = kampf.unterbewertung_kaempfer1;
            score2.value = kampf.unterbewertung_kaempfer2;
            kampfzeit.value = kampf.kampfzeit_in_sekunden;
        }

        // Automatische Score-Zuweisung beim Wählen des Siegers
        siegerSelect.onchange = (e) => {
            if (e.target.value === String(kampf.kaempfer1_id)) {
                score1.value = 10;
                score2.value = 0;
            } else {
                score1.value = 0;
                score2.value = 10;
            }
        };

        resultModal.style.display = 'flex';
    }

    // --- KAMPFERGEBNIS SPEICHERN ---
    resultForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = modalKampfId.value;
        const sieger_id = parseInt(siegerSelect.value, 10);
        const unterbewertung_kaempfer1 = parseInt(score1.value, 10);
        const unterbewertung_kaempfer2 = parseInt(score2.value, 10);
        const kampfzeit_in_sekunden = parseInt(kampfzeit.value, 10);

        try {
            const response = await fetch(`/api/kaempfe/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'beendet',
                    sieger_id,
                    unterbewertung_kaempfer1,
                    unterbewertung_kaempfer2,
                    kampfzeit_in_sekunden
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Fehler beim Speichern des Ergebnisses.');
            }

            zeigeNotification('Kampfergebnis gespeichert.', 'success');
            resultModal.style.display = 'none';
            ladeKämpfe(mattenSelect.value);
        } catch (err) {
            zeigeNotification(err.message, 'error');
        }
    });

    // --- ERGEBNIS KORRIGIEREN TRIGER ---
    window.bearbeiteKampfergebnis = (kampfId) => {
        const kampf = allFights.find(k => k.id === kampfId);
        if (kampf) {
            openResultModal(kampf);
        }
    };

    // --- MODAL SCHLIESSEN ---
    cancelResultBtn.addEventListener('click', () => {
        resultModal.style.display = 'none';
    });

    // --- FORMATTERS & ESCAPING ---
    function formatFighterName(nachname, vorname) {
        if (!nachname && !vorname) return '';
        return `${nachname || ''}, ${vorname || ''}`;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // --- SELECT BINDING & REFRESH ---
    mattenSelect.addEventListener('change', (e) => {
        ladeKämpfe(e.target.value);
    });

    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            const activeMatId = mattenSelect.value;
            if (activeMatId) {
                ladeKämpfe(activeMatId);
                zeigeNotification('Kämpfe aktualisiert', 'success');
            } else {
                zeigeNotification('Bitte zuerst eine Kampffläche auswählen', 'info');
            }
        });
    }

    // --- OFFLINE IMPORT / EXPORT BINDINGS ---
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const matId = mattenSelect.value;
            if (!matId) {
                zeigeNotification('Bitte zuerst eine Kampffläche auswählen', 'error');
                return;
            }
            // Direkte Navigation (window.location.href) sendet keinen Authorization-Header mit
            // und schlägt im Online-Modus daher fehl — stattdessen per fetch() laden (der globale
            // fetch-Wrapper in menu.js ergänzt Authorization/X-Steuerung-Password automatisch)
            // und den Download clientseitig über einen Blob-Link auslösen.
            try {
                const response = await fetch(`/api/offline/export?kampfflaecheId=${matId}&turnierId=${turnierId}`);
                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.error || 'Export fehlgeschlagen.');
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `turnier_${turnierId}_matte_${matId}.json`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
            } catch (err) {
                zeigeNotification('Fehler beim Export: ' + err.message, 'error');
            }
        });
    }

    if (importInput) {
        importInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    const data = JSON.parse(evt.target.result);
                    
                    if (parseInt(data.turnierId) !== parseInt(turnierId)) {
                        throw new Error('Die geladene Datei gehört zu einem anderen Turnier.');
                    }

                    const response = await fetch('/api/offline/import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            turnierId: data.turnierId,
                            kampfflaecheId: data.kampfflaecheId,
                            kaempfe: data.kaempfe
                        })
                    });

                    const resData = await response.json();
                    if (!response.ok) {
                        throw new Error(resData.error || 'Fehler beim Hochladen der Ergebnisse.');
                    }

                    zeigeNotification(resData.message || 'Ergebnisse erfolgreich importiert!', 'success');
                    
                    const activeMatId = mattenSelect.value;
                    if (activeMatId) {
                        ladeKämpfe(activeMatId);
                    }
                } catch (err) {
                    console.error(err);
                    zeigeNotification('Fehler beim Einlesen: ' + err.message, 'error');
                } finally {
                    importInput.value = '';
                }
            };
            reader.readAsText(file);
        });
    }

    // --- INITIALISIERUNG ---
    await ladeMatten();
});
