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
    
    const currentPoolTitle = document.getElementById('currentPoolTitle');
    const currentFighter1Name = document.getElementById('currentFighter1Name');
    const currentFighter1Club = document.getElementById('currentFighter1Club');
    const currentFighter2Name = document.getElementById('currentFighter2Name');
    const currentFighter2Club = document.getElementById('currentFighter2Club');
    const currentFightActions = document.getElementById('currentFightActions');
    const currentFighter1Substitute = document.getElementById('currentFighter1Substitute');
    const currentFighter2Substitute = document.getElementById('currentFighter2Substitute');

    const upcomingFightsList = document.getElementById('upcomingFightsList');
    const finishedFightsList = document.getElementById('finishedFightsList');
    const currentTeamBanner = document.getElementById('currentTeamBanner');
    const pausenWarnungBanner = document.getElementById('pausenWarnungBanner');
    const pausenWarnungText = document.getElementById('pausenWarnungText');
    const pausenWarnungPausierenBtn = document.getElementById('pausenWarnungPausierenBtn');

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

    // Auswechseln-Modal-Elemente (Mannschaftskampf: Ersatzkämpfer nachnominieren)
    const auswechselModal = document.getElementById('auswechselModal');
    const auswechselHinweis = document.getElementById('auswechselHinweis');
    const auswechselSelect = document.getElementById('auswechselSelect');
    const auswechselAbbrechenBtn = document.getElementById('auswechselAbbrechenBtn');
    const auswechselBestaetigenBtn = document.getElementById('auswechselBestaetigenBtn');
    let auswechselKontext = null; // { kampfId, seite }

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
            const mats = await window.Datenzugriff.ladeKampfflaechen(turnierId);

            mattenSelect.innerHTML = '<option value="" disabled selected hidden>Bitte wählen...</option>';
            mats.forEach(mat => {
                const opt = document.createElement('option');
                opt.value = mat.id;
                opt.textContent = mat.bezeichnung;
                mattenSelect.appendChild(opt);
            });

            // Vorherige Auswahl wiederherstellen (Client-Gerät: die auf dem Gerät gewählte Matte)
            const geraeteMatte = await window.Datenzugriff.clientMatte();
            const letzteMatte = geraeteMatte ? String(geraeteMatte) : localStorage.getItem('aktiveMatteId');
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
            return;
        }
        localStorage.setItem('aktiveMatteId', matId);

        try {
            kampfplanContainer.style.display = 'none';

            allFights = await window.Datenzugriff.ladeKaempfeDerMatte(matId);

            renderKämpfe();
            kampfplanContainer.style.display = 'block';
        } catch (err) {
            zeigeNotification('Fehler beim Laden der Kämpfe: ' + err.message, 'error');
        }
    }

    // --- KÄMPFE RENDERN ---
    function renderKämpfe() {
        // 1. Finde den aktuellen Kampf: Der erste, der "gestartet" ist.
        // Falls keiner gestartet ist, der erste "bereit" (beide Kämpfer feststehen).
        // Andernfalls der erste, der überhaupt noch "angelegt" (Platzhalter) ist.
        // Mannschaftskampf-Einzelkämpfe, die noch auf den Abschluss der Einzelwettkampf-Pools
        // dieser Matte warten (wartet_auf_einzelpools, siehe kampfController.getKaempfe), dürfen
        // nicht als "aktueller Kampf" ausgewählt werden — sonst könnte der Tisch einen
        // Mannschaftskampf starten, obwohl ein Einzelpool der Matte noch nicht fertig ist.
        const fuerAktuellenKampfWaehlbar = allFights.filter(k => !k.wartet_auf_einzelpools);
        let currentFight = fuerAktuellenKampfWaehlbar.find(k => k.status === 'gestartet');
        if (!currentFight) {
            currentFight = fuerAktuellenKampfWaehlbar.find(k => k.status === 'bereit');
        }
        if (!currentFight) {
            currentFight = fuerAktuellenKampfWaehlbar.find(k => k.status === 'angelegt');
        }

        // 2. Teile restliche Kämpfe in Warteliste und Verlauf
        const upcoming = allFights.filter(k => (k.status === 'bereit' || k.status === 'angelegt') && k.id !== currentFight?.id);
        upcoming.sort((a, b) => {
            // Noch gesperrte Mannschaftskämpfe kommen immer ans Ende der Warteliste (siehe
            // Kommentar oben) — unabhängig davon, ob ihre Kämpfer bereits feststehen.
            if (a.wartet_auf_einzelpools && !b.wartet_auf_einzelpools) return 1;
            if (!a.wartet_auf_einzelpools && b.wartet_auf_einzelpools) return -1;
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

            // Mannschaftskampf-Kontext: dieser Einzelkampf ist eine Gewichtsklassen-Position
            // innerhalb einer Team-Begegnung — Begegnung und Zwischenstand anzeigen.
            if (currentFight.mannschaftskampf_id && currentTeamBanner) {
                const team1 = currentFight.mannschaft1_bezeichnung || 'Mannschaft 1';
                const team2 = currentFight.mannschaft2_bezeichnung || 'Mannschaft 2';
                const stand1 = currentFight.siegpunkte_mannschaft1 ?? 0;
                const stand2 = currentFight.siegpunkte_mannschaft2 ?? 0;
                currentTeamBanner.textContent =
                    `Begegnung: ${team1} vs. ${team2} — Stand ${stand1}:${stand2} (Gewichtsklasse ${currentFight.mannschaft_gewichtsklasse || '?'})`;
                currentTeamBanner.style.display = 'block';
            } else if (currentTeamBanner) {
                currentTeamBanner.style.display = 'none';
            }

            // Name 1
            const name1 = formatFighterName(currentFight.kaempfer1_nachname, currentFight.kaempfer1_vorname);
            currentFighter1Name.textContent = name1 || 'noch offen';
            currentFighter1Club.textContent = currentFight.kaempfer1_verein || '';
            
            const panel2 = document.getElementById('currentPanel2');
            if (panel2) panel2.className = `fighter-panel ${farbeKaempfer2(currentFight) === 'rot' ? 'red' : 'blau'}`;

            // Name 2
            const name2 = formatFighterName(currentFight.kaempfer2_nachname, currentFight.kaempfer2_vorname);
            currentFighter2Name.textContent = name2 || 'noch offen';
            currentFighter2Club.textContent = currentFight.kaempfer2_verein || '';

            // Auswechseln (nur bei Mannschaftskampf-Einzelkämpfen, solange noch nicht gestartet)
            zeigeAuswechselButton(currentFighter1Substitute, currentFight, 'kaempfer1');
            zeigeAuswechselButton(currentFighter2Substitute, currentFight, 'kaempfer2');

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
            if (currentTeamBanner) currentTeamBanner.style.display = 'none';
            currentPoolTitle.textContent = 'Keine anstehenden Kämpfe';
            currentFighter1Name.textContent = '-';
            currentFighter1Club.textContent = '';
            currentFighter2Name.textContent = '-';
            currentFighter2Club.textContent = '';
            currentFightActions.innerHTML = '<span class="badge beendet">Alle Kämpfe abgeschlossen</span>';
            currentFighter1Substitute.innerHTML = '';
            currentFighter2Substitute.innerHTML = '';
        }

        // --- PAUSENWARNUNG FÜR DEN AKTUELLEN KAMPF ---
        zeigePausenWarnung(currentFight);

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

    // --- PAUSENWARNUNG-BANNER ---
    // kampf.pausenwarnung wird serverseitig nur für 'bereit'e Kämpfe anhand ECHTER Zeitstempel
    // berechnet (siehe pruefeKampfPause in pausenRegel.js / getKaempfe in kampfController.js) —
    // andere Status liefern immer null. Zeigt an, welche(r) Kämpfer(in) noch nicht genug Pause
    // seit dem letzten echten Kampf hatte(n), und bietet als Ausweg (falls sich die Reihenfolge
    // nicht mehr sinnvoll tauschen lässt) einen direkten Kurzschluss zum manuellen Pausieren der
    // Matte (identische Aktion wie der Pause-Button auf matten.html).
    function zeigePausenWarnung(kampf) {
        if (!pausenWarnungBanner) return;

        if (!kampf || kampf.status !== 'bereit' || !kampf.pausenwarnung) {
            pausenWarnungBanner.style.display = 'none';
            return;
        }

        const betroffeneNamen = kampf.pausenwarnung.kaempfer.map(betroffener => {
            const name = betroffener.id === kampf.kaempfer1_id
                ? formatFighterName(kampf.kaempfer1_nachname, kampf.kaempfer1_vorname)
                : formatFighterName(kampf.kaempfer2_nachname, kampf.kaempfer2_vorname);
            const fehlendeMinuten = Math.ceil(betroffener.fehlendeSekunden / 60);
            return `${name || 'Kämpfer/in'} (noch ${fehlendeMinuten} Min. Pause nötig)`;
        }).join(', ');

        pausenWarnungText.textContent =
            `Pausenwarnung: ${betroffeneNamen} — laut Mindestpausenregel noch nicht genug Erholzeit seit dem letzten Kampf. ` +
            `Wenn möglich die Reihenfolge tauschen, sonst die Matte pausieren.`;
        pausenWarnungBanner.style.display = 'flex';
    }

    if (pausenWarnungPausierenBtn) {
        pausenWarnungPausierenBtn.addEventListener('click', async () => {
            const matId = mattenSelect.value;
            if (!matId) return;

            const bestaetigt = window.zeigeZentraleBestaetigung
                ? await window.zeigeZentraleBestaetigung(
                    'Diese Matte jetzt pausieren, damit die Kämpfer/innen ausreichend Pause bekommen? Der Tisch kann sie später über "Matten" wieder fortsetzen.',
                    'Matte pausieren',
                    'pause_circle'
                )
                : confirm('Matte pausieren?');
            if (!bestaetigt) return;

            try {
                const result = await window.Datenzugriff.pausiereMatte(matId);
                if (!result.ok) throw new Error(result.fehler || 'Matte konnte nicht pausiert werden.');
                zeigeNotification(result.meldung || 'Matte pausiert.', 'success');
            } catch (err) {
                zeigeNotification(err.message, 'error');
            }
        });
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
            btn.addEventListener('click', () => fuehreForfeitAktionAus(teilnehmerId, kampf.id, aktion, fighterLabel(teilnehmerId), kampf));
            return btn;
        };

        wrapper.appendChild(macheButton(kampf.kaempfer1_id, 'nicht-angetreten', `${fighterLabel(kampf.kaempfer1_id)}: nicht angetreten`, 'person_off'));
        wrapper.appendChild(macheButton(kampf.kaempfer1_id, 'disqualifizieren', `${fighterLabel(kampf.kaempfer1_id)}: DSQ`, 'block'));
        wrapper.appendChild(macheButton(kampf.kaempfer2_id, 'nicht-angetreten', `${fighterLabel(kampf.kaempfer2_id)}: nicht angetreten`, 'person_off'));
        wrapper.appendChild(macheButton(kampf.kaempfer2_id, 'disqualifizieren', `${fighterLabel(kampf.kaempfer2_id)}: DSQ`, 'block'));

        return wrapper;
    }

    async function fuehreForfeitAktionAus(teilnehmerId, kampfId, aktion, name, kampf) {
        let nachricht = aktion === 'disqualifizieren'
            ? `${name} disqualifizieren? Der Gegner erhält einen regulären Sieg (10 Punkte).`
            : `${name} als nicht angetreten markieren? Der Gegner erhält einen regulären Sieg (10 Punkte).`;
        // Abschenken-Verbot (DJB-WKO Art. 3.12.13.3): gehört der Kampf zu einer
        // Mannschaftsbegegnung, verliert nicht nur dieser Einzelkampf, sondern die GESAMTE
        // Mannschaft die Begegnung sofort mit 0 Siegen — der Tisch muss das vorher wissen.
        if (kampf && kampf.mannschaftskampf_id) {
            nachricht += ' ACHTUNG: Dieser Kampf gehört zu einer Mannschaftsbegegnung — die gesamte Mannschaft verliert dadurch sofort die Begegnung mit 0 Siegen ("zu Null"), unabhängig vom bisherigen Zwischenstand!';
        }
        const bestaetigt = window.zeigeZentraleBestaetigung
            ? await window.zeigeZentraleBestaetigung(nachricht, 'Forfeit werten', 'warning')
            : confirm(nachricht);
        if (!bestaetigt) return;

        try {
            const result = await window.Datenzugriff.werteForfeit(teilnehmerId, kampfId, aktion);
            if (!result.ok) throw new Error(result.fehler || 'Aktion fehlgeschlagen.');
            zeigeNotification('Forfeit gewertet.', 'success');
            ladeKämpfe(mattenSelect.value);
        } catch (err) {
            zeigeNotification(err.message, 'error');
        }
    }

    // --- KAMPF STARTEN ---
    async function startKampf(kampf) {
        try {
            const start = await window.Datenzugriff.aktualisiereKampf(kampf.id, { status: 'gestartet' });
            if (!start.ok) throw new Error(start.fehler || 'Fehler beim Starten des Kampfes.');

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

    // Kämpfer 1 ist immer Weiß, Kämpfer 2 Blau oder Rot — je nach Einstellung "Farbe" im Scoreboard (live_farbe).
    function farbeKaempfer2(kampf) {
        return kampf && kampf.live_farbe === 'rot' ? 'rot' : 'blau';
    }
    const farbName = (farbe) => (farbe === 'rot' ? 'Rot' : 'Blau');

    // --- MODAL: KAMPFERGEBNIS EINTRAGEN ---
    function openResultModal(kampf) {
        const farbe2 = farbeKaempfer2(kampf);
        modalKampfId.value = kampf.id;
        
        // Sieger-Auswahl befüllen
        siegerSelect.innerHTML = '<option value="" disabled selected hidden>Bitte wählen...</option>';
        
        const opt1 = document.createElement('option');
        opt1.value = kampf.kaempfer1_id;
        opt1.textContent = `Weiß: ${formatFighterName(kampf.kaempfer1_nachname, kampf.kaempfer1_vorname)}`;
        siegerSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = kampf.kaempfer2_id;
        opt2.textContent = `${farbName(farbe2)}: ${formatFighterName(kampf.kaempfer2_nachname, kampf.kaempfer2_vorname)}`;
        siegerSelect.appendChild(opt2);

        // Labels für die Scores anpassen
        scoreLabel1.textContent = `Score Weiß (${kampf.kaempfer1_nachname || 'Kämpfer 1'})`;
        scoreLabel2.textContent = `Score ${farbName(farbe2)} (${kampf.kaempfer2_nachname || 'Kämpfer 2'})`;

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
            const ergebnis = await window.Datenzugriff.aktualisiereKampf(id, {
                status: 'beendet',
                sieger_id,
                unterbewertung_kaempfer1,
                unterbewertung_kaempfer2,
                kampfzeit_in_sekunden
            });
            if (!ergebnis.ok) throw new Error(ergebnis.fehler || 'Fehler beim Speichern des Ergebnisses.');

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

    // --- AUSWECHSELN: Button je Kämpfer-Panel rendern ---
    // Nur bei Mannschaftskampf-Einzelkämpfen, die noch nicht gestartet sind — sonst bleibt der
    // Container leer (kein Button für normale Einzelwettkampf-Kämpfe oder laufende/beendete).
    function zeigeAuswechselButton(container, kampf, seite) {
        container.innerHTML = '';
        if (!kampf.mannschaftskampf_id || kampf.status !== 'bereit') return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-outlined';
        btn.style.cssText = 'padding: 4px 10px; font-size: 11px;';
        btn.innerHTML = '<span class="material-icons" style="font-size: 14px; vertical-align: middle; margin-right: 4px;">swap_horiz</span>Auswechseln';
        btn.addEventListener('click', () => oeffneAuswechselModal(kampf, seite));
        container.appendChild(btn);
    }

    // --- AUSWECHSELN: Modal öffnen und mit gewichtsklassenkonformen Team-Kandidaten befüllen ---
    async function oeffneAuswechselModal(kampf, seite) {
        try {
            const response = await fetch(`/api/kaempfe/${kampf.id}/ersatz-optionen`);
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Ersatzkämpfer konnten nicht geladen werden.');
            }

            const optionen = seite === 'kaempfer1' ? data.kaempfer1Optionen : data.kaempfer2Optionen;
            const aktuellerId = seite === 'kaempfer1' ? kampf.kaempfer1_id : kampf.kaempfer2_id;

            auswechselSelect.innerHTML = '';
            optionen.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.turnier_teilnehmer_id;
                opt.textContent = `${formatFighterName(o.nachname, o.vorname)} (${o.gewichtsklasse}, ${o.gewicht} kg)`;
                if (o.turnier_teilnehmer_id === aktuellerId) opt.selected = true;
                auswechselSelect.appendChild(opt);
            });

            auswechselHinweis.textContent = `Nur Mitglieder derselben Mannschaft mit Gewichtsklasse "${kampf.mannschaft_gewichtsklasse}" oder leichter sind wählbar.`;
            auswechselKontext = { kampfId: kampf.id, seite };
            auswechselModal.style.display = 'flex';
        } catch (err) {
            zeigeNotification(err.message, 'error');
        }
    }

    auswechselAbbrechenBtn.addEventListener('click', () => {
        auswechselModal.style.display = 'none';
        auswechselKontext = null;
    });

    auswechselBestaetigenBtn.addEventListener('click', async () => {
        if (!auswechselKontext) return;
        const teilnehmerId = parseInt(auswechselSelect.value, 10);

        try {
            const response = await fetch(`/api/kaempfe/${auswechselKontext.kampfId}/auswechseln`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seite: auswechselKontext.seite, teilnehmerId })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Auswechseln fehlgeschlagen.');
            }

            zeigeNotification('Kämpfer erfolgreich ausgewechselt.', 'success');
            auswechselModal.style.display = 'none';
            auswechselKontext = null;
            ladeKämpfe(mattenSelect.value);
        } catch (err) {
            zeigeNotification(err.message, 'error');
        }
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
    let angezeigteMatte = null;
    mattenSelect.addEventListener('change', async (e) => {
        const neu = e.target.value;
        // Client-Gerät: Mattenwechsel im Betrieb mit Nachfrage (siehe syncStatus.js).
        if (window.Datenzugriff.rolle() === 'client') {
            const bisher = angezeigteMatte || await window.Datenzugriff.clientMatte();
            const gewechselt = await window.wechsleClientMatte(neu, bisher);
            if (!gewechselt) {
                if (bisher) mattenSelect.value = String(bisher);
                return;
            }
        }
        angezeigteMatte = neu;
        ladeKämpfe(neu);
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

    // --- INITIALISIERUNG ---
    await ladeMatten();
});
