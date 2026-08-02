document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const turnierId = urlParams.get('turnierId') || urlParams.get('id');

    if (!turnierId) {
        alert('Fehler: Kein aktives Turnier ausgewählt!');
        window.location.href = '/turnier.html';
        return;
    }

    const tableBody = document.getElementById('teilnehmerTableBody');

    // --- TURNIER-ALTERSKLASSEN (welche Klassen werden bei diesem Turnier überhaupt ausgetragen) ---
    let turnierAltersklassenKeys = null; // null = keine Einschränkung bekannt/hinterlegt
    let turnierKostenlos = false; // true, wenn Startgeld des Turniers 0€ ist -> gilt für alle als "bezahlt"

    // --- ZAHLUNGSDATEN DES TURNIERS (für den "Startgeld bezahlen"-QR-Code) ---
    let turnierBezeichnung = '';
    let turnierStartgeldWert = 0;
    let turnierIban = '';
    let turnierKontoinhaber = '';
    let turnierVerwendungszweck = '';

    // --- SPERRE DER TEILNEHMERLISTE, SOBALD POOLS EXISTIEREN ---
    let teilnehmerlisteGesperrt = false;

    async function pruefeTeilnehmerlisteSperre() {
        try {
            const resp = await fetch(`/api/pools/vorhanden?turnierId=${turnierId}`);
            if (!resp.ok) return;
            const data = await resp.json();
            teilnehmerlisteGesperrt = !!data.gesperrt;

            const banner = document.getElementById('teilnehmerGesperrtBanner');
            const link = document.getElementById('teilnehmerGesperrtPoolsLink');
            if (link) link.href = `/pools.html?turnierId=${turnierId}`;
            if (banner) banner.style.display = teilnehmerlisteGesperrt ? 'flex' : 'none';

            const importBtn = document.getElementById('importBtn');
            if (importBtn) importBtn.style.display = teilnehmerlisteGesperrt ? 'none' : 'inline-flex';

            const addBtn = document.getElementById('addBtn');
            if (addBtn) addBtn.style.display = teilnehmerlisteGesperrt ? 'none' : 'inline-flex';

            const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
            if (bulkDeleteBtn) bulkDeleteBtn.style.display = teilnehmerlisteGesperrt ? 'none' : 'inline-flex';
        } catch (err) {
            console.error('Fehler beim Prüfen der Teilnehmerlisten-Sperre:', err);
        }
    }

    async function ladeTurnierAltersklassen() {
        try {
            const resp = await fetch(`/api/turniere/${turnierId}`);
            if (!resp.ok) return;
            const turnier = await resp.json();

            let ak = turnier.altersklassen;
            let keys = [];
            if (Array.isArray(ak)) {
                keys = ak;
            } else if (ak && typeof ak === 'object') {
                keys = Object.keys(ak);
            }

            if (keys.length > 0) turnierAltersklassenKeys = keys;
            turnierStartgeldWert = parseFloat(turnier.startgeld) || 0;
            turnierKostenlos = turnierStartgeldWert === 0;

            turnierBezeichnung = turnier.bezeichnung || '';
            turnierIban = turnier.iban || '';
            turnierKontoinhaber = turnier.kontoinhaber || '';
            turnierVerwendungszweck = turnier.verwendungszweck || '';
        } catch (err) {
            console.error('Fehler beim Laden der Turnier-Altersklassen:', err);
        }
    }

    function istAltersklasseAusgetragen(athlet) {
        if (!turnierAltersklassenKeys) return true;
        const key = `${athlet.geschlecht}_${athlet.altersklasse}`;
        const mixedKey = `mixed_${athlet.altersklasse}`;
        return turnierAltersklassenKeys.includes(key) || turnierAltersklassenKeys.includes(mixedKey) || turnierAltersklassenKeys.includes(athlet.altersklasse);
    }

    // Teilnehmer-Lebenszyklus-Status: Anzeige als eigene Zeile unter dem Namen (ersetzt den
    // früheren roten/grünen Punkt).
    const TEILNEHMER_STATUS_LABELS = {
        angemeldet: { text: 'Angemeldet', farbe: 'blau' },
        zurueckgezogen: { text: 'Zurückgezogen', farbe: 'grau' },
        kampfbereit: { text: 'bereit', farbe: 'gruen' },
        nicht_erschienen: { text: 'Nicht erschienen', farbe: 'rot' },
        teilgenommen: { text: 'Teilgenommen', farbe: 'blau' },
        nicht_angetreten: { text: 'Nicht angetreten', farbe: 'rot' },
        disqualifiziert: { text: 'Disqualifiziert', farbe: 'rot' }
    };

    // Ermittelt den Startberechtigt-Status (grün/rot) eines Athleten. Gemeinsam genutzt von
    // Sortierung (rote zuerst) und Tabellen-Rendering, damit beide dieselbe Definition verwenden.
    function berechneStatus(athlet) {
        const heute = new Date();
        heute.setHours(0, 0, 0, 0);
        const ablaufDate = new Date(athlet.lizenz_ablauf);
        ablaufDate.setHours(0, 0, 0, 0);

        const lizenzGueltig = ablaufDate >= heute;
        const startgeldBezahlt = turnierKostenlos || !!athlet.startgeld_bezahlt;
        const gewichtEingetragen = athlet.gewicht && parseFloat(athlet.gewicht) > 0;
        const judopassVorhanden = !!(athlet.judopass_id && String(athlet.judopass_id).trim() !== '');
        const altersklasseGueltig = istAltersklasseAusgetragen(athlet);
        const statusGruen = lizenzGueltig && startgeldBezahlt && gewichtEingetragen && judopassVorhanden && altersklasseGueltig;

        return { lizenzGueltig, startgeldBezahlt, gewichtEingetragen, judopassVorhanden, altersklasseGueltig, statusGruen };
    }

    // --- GRADUIERUNGEN (Gürtelfarben) ---
    let graduierungenMap = {};

    async function ladeGraduierungen() {
        try {
            const resp = await fetch('/api/graduierungen');
            if (!resp.ok) return;
            const liste = await resp.json();
            liste.forEach(grad => { graduierungenMap[grad.id] = grad; });
        } catch (err) {
            console.error('Fehler beim Laden der Graduierungen:', err);
        }
    }

    function renderGraduierungKreis(athlet) {
        const grad = graduierungenMap[athlet.graduierung];
        if (!grad) {
            return `<span class="graduierung-kreis graduierung-leer" title="Keine Graduierung hinterlegt"></span>`;
        }

        const farben = grad.farben || [];
        const hintergrund = farben.length >= 3
            ? `linear-gradient(to bottom,   ${farben[0]} 0%,      
                                            ${farben[0]} 33.33%,  
                                            ${farben[1]} 33.33%,  
                                            ${farben[1]} 66.66%,  
                                            ${farben[2]} 66.66%, 
                                            ${farben[2]} 100% )`
            : (farben[0] || '#ffffff');

        return `<span class="graduierung-kreis" style="background: ${hintergrund};" title="${grad.label}"></span>`;
    }

    function formatiereAltersklasse(athlet) {
        const istSonderklasse = athlet.altersklasse === 'Männer' || athlet.altersklasse === 'Frauen'
            || athlet.altersklasse === 'Mixed' || athlet.geschlecht === 'mixed';
        const geschlechtsKuerzel = istSonderklasse ? '' : (athlet.geschlecht === 'weiblich' ? 'w' : 'm');
        return `${athlet.altersklasse}${geschlechtsKuerzel}`;
    }

    // Liefert einen numerischen Sortierwert für die Altersklasse, damit z.B. "U11" nicht (als
    // String) fälschlich vor "U9" einsortiert wird. U-Klassen nach ihrer Zahl aufsteigend, freie
    // Ü/Veteranen-Klassen danach, Männer/Frauen/Mixed/sonstige Erwachsenenklassen dazwischen.
    function altersklasseSortWert(altersklasse) {
        const ak = String(altersklasse || '').trim();
        if (!ak) return Infinity;

        const uMatch = ak.match(/^U\s*(\d+)$/i);
        if (uMatch) return parseInt(uMatch[1], 10);

        const ueMatch = ak.match(/Ü\s*(\d+)/i);
        if (ueMatch) return 1000 + parseInt(ueMatch[1], 10);
        if (/veteranen/i.test(ak)) return 1030;

        return 999;
    }

    // --- SORTIERUNG ---
    let athletenDaten = [];
    let aktiveSortierung = 'nachname';
    let sortierRichtung = 'asc';

    // --- SUCHE ---
    // Filtert athletenDaten anhand des aktuellen Suchfeld-Werts (Name/Vorname/Verein).
    // Wird sowohl beim Laden als auch beim Sortieren angewendet, damit ein aktiver
    // Suchbegriff beim Klick auf eine Spaltenüberschrift nicht verloren geht.
    function gefilterteAthleten() {
        const suchfeld = document.getElementById('teilnehmerSearchInput');
        const begriff = (suchfeld ? suchfeld.value : '').trim().toLowerCase();
        if (!begriff) return athletenDaten;

        return athletenDaten.filter(athlet => {
            const nachname = (athlet.nachname || '').toLowerCase();
            const vorname = (athlet.vorname || '').toLowerCase();
            const verein = (athlet.verein || '').toLowerCase();
            return nachname.includes(begriff) || vorname.includes(begriff) || verein.includes(begriff);
        });
    }

    function sortiereUndRendere() {
        const sortiert = sortiereAthleten(gefilterteAthleten(), aktiveSortierung, sortierRichtung);
        renderTabelle(sortiert);
    }

    // --- GASTGEBER-STATUS (steuert hartes Löschen vs. Zurückziehen) ---
    let istGastgeberVerein = false;
    async function ermittleGastgeberStatus() {
        try {
            const [meResp, turnierResp, configResp] = await Promise.all([
                fetch('/api/auth/me'),
                fetch(`/api/turniere/${turnierId}`),
                fetch('/api/config')
            ]);
            if (!meResp.ok || !turnierResp.ok) return;
            const user = (await meResp.json()).user;
            const turnier = await turnierResp.json();
            const istOffline = configResp.ok && !!(await configResp.json()).isOffline;
            istGastgeberVerein = istOffline || !!(user.verein_id && turnier.verein_id === user.verein_id);
        } catch (err) {
            console.error('Fehler beim Ermitteln des Gastgeber-Status:', err);
        }
    }
    ermittleGastgeberStatus();

    function sortiereAthleten(daten, sortKey, richtung) {
        const sorted = [...daten].sort((a, b) => {
            const statusA = berechneStatus(a).statusGruen;
            const statusB = berechneStatus(b).statusGruen;
            if (statusA !== statusB) {
                return statusA ? 1 : -1; // Rote (nicht startberechtigt) stehen immer oben
            }

            let valA, valB;

            switch (sortKey) {
                case 'nachname':
                    valA = `${a.nachname} ${a.vorname}`.toLowerCase();
                    valB = `${b.nachname} ${b.vorname}`.toLowerCase();
                    break;
                case 'verein':
                    valA = (a.verein || '').toLowerCase();
                    valB = (b.verein || '').toLowerCase();
                    break;
                case 'klasse':
                    valA = altersklasseSortWert(a.altersklasse);
                    valB = altersklasseSortWert(b.altersklasse);
                    // Bei gleicher Altersklasse zusätzlich nach Gewichtsklasse sortieren
                    if (valA === valB) {
                        valA = (a.gewichtsklasse || '').toLowerCase();
                        valB = (b.gewichtsklasse || '').toLowerCase();
                    }
                    break;
                case 'gewicht':
                    // Deutsches Komma-Dezimaltrennzeichen (z.B. aus älteren Importen) robust
                    // mitbehandeln, sonst schneidet parseFloat bei "26,5" auf 26 ab.
                    valA = parseFloat(String(a.gewicht ?? '').replace(',', '.')) || 0;
                    valB = parseFloat(String(b.gewicht ?? '').replace(',', '.')) || 0;
                    break;
                default:
                    return 0;
            }

            if (valA < valB) return richtung === 'asc' ? -1 : 1;
            if (valA > valB) return richtung === 'asc' ? 1 : -1;
            return 0;
        });

        return sorted;
    }

    function aktualisiereSortierIcons() {
        document.querySelectorAll('.judo-table th.sortable').forEach(th => {
            const icon = th.querySelector('.sort-icon');
            const key = th.getAttribute('data-sort');

            th.classList.remove('active-sort');
            if (icon) icon.textContent = '';

            if (key === aktiveSortierung) {
                th.classList.add('active-sort');
                th.setAttribute('data-dir', sortierRichtung);
                if (icon) icon.textContent = sortierRichtung === 'asc' ? 'arrow_upward' : 'arrow_downward';
            }
        });
    }

    function renderTabelle(athleten) {
        if (athleten.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="10" class="no-data">Noch keine Kämpfer für dieses Turnier eingewogen.</td></tr>`;
            updateBulkActionsBar();
            return;
        }

        tableBody.innerHTML = athleten.map(athlet => {
            const { lizenzGueltig, startgeldBezahlt, gewichtEingetragen, judopassVorhanden, altersklasseGueltig, statusGruen } = berechneStatus(athlet);

            let statusDetails = [];
            if (!judopassVorhanden) statusDetails.push('Judopass-ID fehlt');
            if (!lizenzGueltig) statusDetails.push('Lizenz abgelaufen');
            if (!startgeldBezahlt) statusDetails.push('Startgeld offen');
            if (!gewichtEingetragen) statusDetails.push('Gewicht fehlt');
            if (!altersklasseGueltig) statusDetails.push('Altersklasse wird bei diesem Turnier nicht ausgetragen');

            const statusTitle = statusGruen 
                ? 'Status: Startberechtigt (Lizenz gültig, Startgeld bezahlt, Gewicht eingetragen)' 
                : `Status: Nicht startberechtigt (${statusDetails.join(', ')})`;

            const gewichtFloat = parseFloat(athlet.gewicht) || 0;
            const gewichtFarbe = gewichtFloat > 0 ? 'var(--primary)' : '#c62828';

            const lizenzDatumRoh = athlet.lizenz_ablauf ? String(athlet.lizenz_ablauf).split('T')[0] : null;
            const gewogen = !!lizenzDatumRoh && lizenzDatumRoh !== '1970-01-01';

            // Zurückgezogene Anmeldungen bleiben zur Nachvollziehbarkeit sichtbar, aber
            // ausgegraut und nicht mehr editierbar.
            const istZurueckgezogen = athlet.status === 'zurueckgezogen';
            const { text: teilnehmerStatusText, farbe: teilnehmerStatusFarbe } = TEILNEHMER_STATUS_LABELS[athlet.status] || { text: athlet.status || '', farbe: 'grau' };

            return `
                <tr${istZurueckgezogen ? ' style="opacity: 0.5;"' : ''}>
                    <td style="text-align: center; vertical-align: middle;">
                        <input type="checkbox" class="row-checkbox" data-id="${athlet.id}" style="transform: scale(1.2); cursor: pointer;" ${istZurueckgezogen ? 'disabled' : ''}>
                    </td>
                    <td>
                        <strong>${athlet.nachname}</strong>, ${athlet.vorname}
                    </td>
                    <td style="text-align: center;" title="${statusTitle}">
                        <span class="status-badge status-${teilnehmerStatusFarbe}">${teilnehmerStatusText}</span>
                    </td>
                    <td style="text-align: center;">${renderGraduierungKreis(athlet)}</td>
                    <td>${athlet.verein}</td>
                    <td><span class="klasse-badge ${altersklasseGueltig ? 'valid' : 'invalid'}" title="${altersklasseGueltig ? 'Wird bei diesem Turnier ausgetragen' : 'Diese Altersklasse wird bei diesem Turnier nicht ausgetragen'}">${formatiereAltersklasse(athlet)}</span></td>
                    <td style="font-weight: 700; color: ${gewichtFarbe};">${gewichtFloat.toFixed(2).replace('.', ',')} kg</td>
                    <td style="text-align: center;">
                        <span class="material-icons action-icon icon-toggle ${gewogen ? 'active' : ''}" data-id="${athlet.id}" data-toggle="gewogen" title="${gewogen ? 'Als nicht gewogen markieren' : 'Als gewogen markieren'}">scale</span>
                    </td>
                    <td style="text-align: center;">
                        <span class="material-icons action-icon icon-toggle ${startgeldBezahlt ? 'active' : ''}" data-id="${athlet.id}" data-toggle="bezahlt" title="${startgeldBezahlt ? 'Als unbezahlt markieren' : 'Als bezahlt markieren'}">payments</span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            ${teilnehmerlisteGesperrt ? `
                                <span class="material-icons action-icon" style="color: var(--text-muted); opacity: 0.3; cursor: not-allowed;" title="Gesperrt: Es existieren bereits Pools für dieses Turnier">lock</span>
                            ` : `
                                <span class="material-icons action-icon icon-edit" title="Eintrag bearbeiten" onclick="window.location.href='/waage.html?turnierId=${turnierId}&editId=${athlet.id}'">edit</span>
                                <span class="material-icons action-icon icon-delete" data-id="${athlet.id}" data-name="${athlet.vorname} ${athlet.nachname}">delete</span>
                            `}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Ensure bulk action bar state is updated on every render
        updateBulkActionsBar();

        // Delete-Handler: Gastgeber-Verein löscht hart (Fehlerkorrektur), alle anderen ziehen
        // nur die eigene Anmeldung zurück (Datensatz bleibt für Nachvollziehbarkeit erhalten).
        document.querySelectorAll('.icon-delete').forEach(button => {
            button.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                const name = e.target.getAttribute('data-name');
                const zielUrl = istGastgeberVerein ? `/api/teilnehmer/${id}` : `/api/teilnehmer/${id}/zurueckziehen`;
                const methode = istGastgeberVerein ? 'DELETE' : 'POST';

                const bestaetigt = await window.zeigeZentraleBestaetigung(
                    istGastgeberVerein
                        ? `Möchten Sie den Athleten ${name} wirklich unwiderruflich aus der Waage-Liste löschen?`
                        : `Möchten Sie die Anmeldung von ${name} wirklich zurückziehen?`,
                    istGastgeberVerein ? 'Teilnehmer entfernen' : 'Anmeldung zurückziehen',
                    'person_remove'
                );

                if (bestaetigt) {
                    try {
                        const delResponse = await fetch(zielUrl, { method: methode });
                        const result = await delResponse.json();

                        if (result.success) {
                            window.zeigeNotification(istGastgeberVerein ? `Athlet ${name} erfolgreich entfernt.` : `Anmeldung von ${name} zurückgezogen.`, 'success');
                            ladeTeilnehmer();
                        } else {
                            window.zeigeNotification('Fehler: ' + result.error, 'error');
                        }
                    } catch (err) {
                        window.zeigeNotification('Netzwerkfehler: ' + err.message, 'error');
                    }
                }
            });
        });

        // Gewogen/Bezahlt Quick-Toggle-Handler
        document.querySelectorAll('.icon-toggle').forEach(button => {
            button.addEventListener('click', async (e) => {
                const id = parseInt(e.target.getAttribute('data-id'), 10);
                const toggleType = e.target.getAttribute('data-toggle');
                const athlet = athletenDaten.find(a => a.id === id);
                if (!athlet) return;

                let payload;
                if (toggleType === 'gewogen') {
                    const lizenzDatumRoh = athlet.lizenz_ablauf ? String(athlet.lizenz_ablauf).split('T')[0] : null;
                    const istGewogen = !!lizenzDatumRoh && lizenzDatumRoh !== '1970-01-01';
                    const naechstesJahr = new Date().getFullYear() + 1;
                    payload = { lizenz_ablauf: istGewogen ? '1970-01-01' : `${naechstesJahr}-12-31` };
                } else if (toggleType === 'bezahlt') {
                    payload = { startgeld_bezahlt: !athlet.startgeld_bezahlt };
                } else {
                    return;
                }

                try {
                    const response = await fetch(`/api/teilnehmer/${id}/status`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const result = await response.json();
                    if (result.success) {
                        await ladeTeilnehmer();
                    } else {
                        window.zeigeNotification('Fehler beim Aktualisieren: ' + result.error, 'error');
                    }
                } catch (err) {
                    window.zeigeNotification('Netzwerkfehler: ' + err.message, 'error');
                }
            });
        });
    }

    // --- BULK SELECTION & ACTIONS ---
    function updateBulkActionsBar() {
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const checkboxes = document.querySelectorAll('.row-checkbox');
        const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
        const bulkMarkPaidBtn = document.getElementById('bulkMarkPaidBtn');
        const bulkMarkWeighedBtn = document.getElementById('bulkMarkWeighedBtn');
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');

        const keineAuswahl = checkedBoxes.length === 0;
        if (bulkMarkPaidBtn) bulkMarkPaidBtn.disabled = keineAuswahl;
        if (bulkMarkWeighedBtn) bulkMarkWeighedBtn.disabled = keineAuswahl;
        if (bulkDeleteBtn) bulkDeleteBtn.disabled = keineAuswahl;

        if (selectAllCheckbox) {
            selectAllCheckbox.checked = checkboxes.length > 0 && checkedBoxes.length === checkboxes.length;
            selectAllCheckbox.indeterminate = checkedBoxes.length > 0 && checkedBoxes.length < checkboxes.length;
        }
    }

    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.row-checkbox').forEach(cb => {
                cb.checked = checked;
            });
            updateBulkActionsBar();
        });
    }

    if (tableBody) {
        tableBody.addEventListener('change', (e) => {
            if (e.target.classList.contains('row-checkbox')) {
                updateBulkActionsBar();
            }
        });
    }

    const bulkMarkPaidBtn = document.getElementById('bulkMarkPaidBtn');
    if (bulkMarkPaidBtn) {
        bulkMarkPaidBtn.addEventListener('click', async () => {
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            if (checkedBoxes.length === 0) return;

            const ids = Array.from(checkedBoxes).map(cb => parseInt(cb.getAttribute('data-id'), 10));

            const confirmed = await window.zeigeZentraleBestaetigung(
                `Möchten Sie wirklich ${ids.length} Teilnehmer als "bezahlt" markieren?`,
                'Zahlungsstatus aktualisieren',
                'payments'
            );

            if (!confirmed) return;

            try {
                const updatePromises = ids.map(id => fetch(`/api/teilnehmer/${id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ startgeld_bezahlt: true })
                }));

                await Promise.all(updatePromises);

                window.zeigeNotification(`${ids.length} Teilnehmer erfolgreich aktualisiert.`, 'success');

                if (selectAllCheckbox) selectAllCheckbox.checked = false;
                await ladeTeilnehmer();
            } catch (err) {
                console.error(err);
                window.zeigeNotification('Fehler beim Aktualisieren: ' + err.message, 'error');
            }
        });
    }

    const bulkMarkWeighedBtn = document.getElementById('bulkMarkWeighedBtn');
    if (bulkMarkWeighedBtn) {
        bulkMarkWeighedBtn.addEventListener('click', async () => {
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            if (checkedBoxes.length === 0) return;

            const ids = Array.from(checkedBoxes).map(cb => parseInt(cb.getAttribute('data-id'), 10));

            const confirmed = await window.zeigeZentraleBestaetigung(
                `Möchten Sie wirklich ${ids.length} Teilnehmer als "gewogen" markieren?`,
                'Gewogen-Status aktualisieren',
                'scale'
            );

            if (!confirmed) return;

            const naechstesJahr = new Date().getFullYear() + 1;
            const lizenzGueltigBis = `${naechstesJahr}-12-31`;

            try {
                const updatePromises = ids.map(id => fetch(`/api/teilnehmer/${id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lizenz_ablauf: lizenzGueltigBis })
                }));

                await Promise.all(updatePromises);

                window.zeigeNotification(`${ids.length} Teilnehmer erfolgreich als gewogen markiert.`, 'success');

                if (selectAllCheckbox) selectAllCheckbox.checked = false;
                await ladeTeilnehmer();
            } catch (err) {
                console.error(err);
                window.zeigeNotification('Fehler beim Aktualisieren: ' + err.message, 'error');
            }
        });
    }

    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', async () => {
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            if (checkedBoxes.length === 0) return;

            const ids = Array.from(checkedBoxes).map(cb => parseInt(cb.getAttribute('data-id'), 10));

            const confirmed = await window.zeigeZentraleBestaetigung(
                `Möchten Sie wirklich ${ids.length} Teilnehmer unwiderruflich aus der Waage-Liste löschen?`,
                'Teilnehmer entfernen',
                'person_remove'
            );

            if (!confirmed) return;

            const results = await Promise.allSettled(ids.map(async (id) => {
                const delResponse = await fetch(`/api/teilnehmer/${id}`, { method: 'DELETE' });
                const result = await delResponse.json();
                if (!result.success) throw new Error(result.error || 'Unbekannter Fehler');
                return id;
            }));

            const erfolgreich = results.filter(r => r.status === 'fulfilled').length;
            const fehlgeschlagen = results.filter(r => r.status === 'rejected');

            if (fehlgeschlagen.length === 0) {
                window.zeigeNotification(`${erfolgreich} Teilnehmer erfolgreich gelöscht.`, 'success');
            } else if (erfolgreich === 0) {
                window.zeigeNotification(`Löschen fehlgeschlagen: ${fehlgeschlagen[0].reason.message}`, 'error');
            } else {
                window.zeigeNotification(`${erfolgreich} Teilnehmer gelöscht, ${fehlgeschlagen.length} fehlgeschlagen (${fehlgeschlagen[0].reason.message}).`, 'error');
            }

            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            await ladeTeilnehmer();
        });
    }

    // --- NEUEN TEILNEHMER HINZUFÜGEN ---
    const addBtn = document.getElementById('addBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            window.location.href = `/waage.html?turnierId=${turnierId}`;
        });
    }

    // --- CSV/XLSX IMPORT ---
    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            reader.readAsDataURL(file);
        });
    }

    const importBtn = document.getElementById('importBtn');
    const importFileInput = document.getElementById('importFileInput');
    const importStatus = document.getElementById('importStatus');
    const importSkippedList = document.getElementById('importSkippedList');

    if (importBtn && importFileInput) {
        importBtn.addEventListener('click', () => importFileInput.click());

        importFileInput.addEventListener('change', async () => {
            const file = importFileInput.files[0];
            importFileInput.value = '';
            if (!file) return;

            importStatus.textContent = `Importiere "${file.name}" ...`;
            importSkippedList.style.display = 'none';
            importSkippedList.innerHTML = '';

            try {
                const contentBase64 = await readFileAsBase64(file);
                const response = await fetch('/api/teilnehmer/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ turnier_id: turnierId, filename: file.name, contentBase64 })
                });
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Import fehlgeschlagen.');
                }

                let meldung = `${data.imported} von ${data.total} Teilnehmern importiert.`;
                if (data.skipped && data.skipped.length > 0) {
                    meldung += ` ${data.skipped.length} übersprungen.`;
                }
                importStatus.textContent = meldung;

                if (window.zeigeNotification) {
                    window.zeigeNotification(meldung, data.skipped && data.skipped.length > 0 ? 'error' : 'success');
                }

                if (data.skipped && data.skipped.length > 0) {
                    importSkippedList.style.display = 'block';
                    importSkippedList.innerHTML = `<strong>Übersprungene Zeilen:</strong><ul style="margin:4px 0 0 20px;">${data.skipped.map(s => `<li>Zeile ${s.row}: ${s.reason}</li>`).join('')}</ul>`;
                }

                await ladeTeilnehmer();
            } catch (err) {
                importStatus.textContent = '';
                if (window.zeigeNotification) window.zeigeNotification('Import-Fehler: ' + err.message, 'error');
                else alert('Import-Fehler: ' + err.message);
            }
        });
    }

    // --- DATEN LADEN ---
    async function ladeTeilnehmer() {
        try {
            const response = await fetch(`/api/teilnehmer?turnierId=${turnierId}`);
            if (!response.ok) throw new Error('Teilnehmer konnten nicht geladen werden.');

            athletenDaten = await response.json();
            sortiereUndRendere();

            // ladeTeilnehmer() läuft nach jeder Statusänderung (Gewogen/Bezahlt-Toggle,
            // Zurückziehen/Löschen, Sammel-Aktionen), daher hier zentral den Pools-Menüpunkt
            // live neu bewerten statt an jeder einzelnen Aktion.
            if (window.hajimeAktualisiereMenueSperren) {
                window.hajimeAktualisiereMenueSperren(['pools']);
            }

        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="10" class="no-data" style="color: #b83232;">Fehler beim Laden: ${error.message}</td></tr>`;
        }
    }

    // --- SORTIER-KLICK-HANDLER ---
    document.querySelectorAll('.judo-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');

            if (key === aktiveSortierung) {
                sortierRichtung = sortierRichtung === 'asc' ? 'desc' : 'asc';
            } else {
                aktiveSortierung = key;
                sortierRichtung = 'asc';
            }

            aktualisiereSortierIcons();
            sortiereUndRendere();
        });
    });

    // --- SUCH-KLICK-HANDLER ---
    const teilnehmerSearchInput = document.getElementById('teilnehmerSearchInput');
    if (teilnehmerSearchInput) {
        teilnehmerSearchInput.addEventListener('input', () => {
            sortiereUndRendere();
        });
    }

    (async () => {
        await Promise.all([ladeTurnierAltersklassen(), ladeGraduierungen(), pruefeTeilnehmerlisteSperre()]);
        await ladeTeilnehmer();
    })();

    // --- STARTGELD-ZAHLUNG (nur andere Vereine, nur online) ---
    // "Gesamtes Turnier exportieren" gibt es hier nicht mehr — der Export ist jetzt in
    // turnier.html (Bearbeiten-Modus) zu finden.
    async function pruefeUndZeigeStartgeldButton() {
        const startgeldBezahlenBtn = document.getElementById('startgeldBezahlenBtn');
        if (!startgeldBezahlenBtn) return;

        try {
            const [meResp, turnierResp, configResp] = await Promise.all([
                fetch('/api/auth/me'),
                fetch(`/api/turniere/${turnierId}`),
                fetch('/api/config')
            ]);
            if (!meResp.ok || !turnierResp.ok) return;

            const user = (await meResp.json()).user;
            const turnier = await turnierResp.json();
            const istOffline = configResp.ok && !!(await configResp.json()).isOffline;

            // Der "Startgeld bezahlen"-Button ist nur im Online-Betrieb sinnvoll (im Offline-Modus
            // gibt es keine Fremdvereins-Anmeldungen über das Netz) und nur für Nutzer ANDERER
            // Vereine als des Ausrichters — der Ausrichter-Verein markiert Zahlungen direkt in der
            // Liste, statt sich selbst eine Überweisung zu schicken.
            const istFremderVerein = !!(user.verein_id && turnier.verein_id !== user.verein_id);
            const startgeldWert = parseFloat(turnier.startgeld) || 0;
            const darfStartgeldZahlen = !istOffline && istFremderVerein && startgeldWert > 0;
            startgeldBezahlenBtn.style.display = darfStartgeldZahlen ? 'inline-flex' : 'none';
        } catch (err) {
            console.error('Fehler bei der Berechtigungsprüfung:', err);
        }
    }

    pruefeUndZeigeStartgeldButton();

    // --- STARTGELD BEZAHLEN: GiroCode/EPC-QR mit vorausgefülltem Betrag für den eigenen Verein ---
    // Format nach EPC069-12 ("Girocode"), von SEPA-fähigen Banking-Apps direkt scanbar.
    function baueGiroCodePayload({ name, iban, betrag, verwendungszweck }) {
        const zeilen = [
            'BCD',
            '002',
            '1',
            'SCT',
            '', // BIC — seit 2016 für IBANs aus dem EWR nicht mehr erforderlich
            (name || '').slice(0, 70),
            (iban || '').replace(/\s+/g, ''),
            `EUR${betrag.toFixed(2)}`,
            '', // Purpose
            '', // Strukturierte Zahlungsreferenz
            (verwendungszweck || '').slice(0, 140)
        ];
        return zeilen.join('\n');
    }

    const startgeldBezahlenBtn = document.getElementById('startgeldBezahlenBtn');
    const startgeldModal = document.getElementById('startgeldModal');
    if (startgeldBezahlenBtn && startgeldModal) {
        startgeldBezahlenBtn.addEventListener('click', async () => {
            try {
                const meResp = await fetch('/api/auth/me');
                if (!meResp.ok) throw new Error('Benutzerdaten konnten nicht geladen werden.');
                const user = (await meResp.json()).user;
                const eigenerVerein = user && user.verein_name;

                if (!eigenerVerein) {
                    if (window.zeigeNotification) window.zeigeNotification('Ihrem Konto ist kein Verein zugeordnet.', 'error');
                    return;
                }

                const unbezahlt = athletenDaten.filter(a => a.verein === eigenerVerein && !a.startgeld_bezahlt);
                if (unbezahlt.length === 0) {
                    if (window.zeigeNotification) window.zeigeNotification('Alle Teilnehmer Ihres Vereins sind bereits als bezahlt markiert.', 'success');
                    return;
                }

                const betrag = turnierStartgeldWert * unbezahlt.length;
                const verwendungszweckErsetzt = (turnierVerwendungszweck || '')
                    .replace(/<Turniername>/g, turnierBezeichnung)
                    .replace(/<Verein>/g, eigenerVerein);

                document.getElementById('startgeldIbanFeld').value = turnierIban;
                document.getElementById('startgeldKontoinhaberFeld').value = turnierKontoinhaber;
                document.getElementById('startgeldVerwendungszweckFeld').value = verwendungszweckErsetzt;
                document.getElementById('startgeldBetragAnzeige').textContent =
                    `Offener Betrag: ${betrag.toFixed(2).replace('.', ',')} € (${unbezahlt.length} Teilnehmer)`;

                const payload = baueGiroCodePayload({
                    name: turnierKontoinhaber,
                    iban: turnierIban,
                    betrag,
                    verwendungszweck: verwendungszweckErsetzt
                });

                const qrContainer = document.getElementById('startgeldQrContainer');
                qrContainer.innerHTML = '';
                const qr = qrcode(0, 'M');
                qr.addData(payload);
                qr.make();
                qrContainer.innerHTML = qr.createSvgTag(4, 4);

                startgeldModal.style.display = 'flex';
            } catch (err) {
                if (window.zeigeNotification) window.zeigeNotification('Fehler: ' + err.message, 'error');
                else alert(err.message);
            }
        });

        const schliesseStartgeldModal = () => { startgeldModal.style.display = 'none'; };
        const startgeldModalClose = document.getElementById('startgeldModalClose');
        if (startgeldModalClose) startgeldModalClose.addEventListener('click', schliesseStartgeldModal);
        startgeldModal.addEventListener('click', (e) => {
            if (e.target === startgeldModal) schliesseStartgeldModal();
        });
    }
});
