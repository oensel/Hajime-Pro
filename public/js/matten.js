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
    const mattenContainer = document.getElementById('mattenContainer');
    const aufteilenBtn = document.getElementById('aufteilenBtn');
    const alleNeuVerteilenBtn = document.getElementById('alleNeuVerteilenBtn');
    const alleZuordnungenLoeschenBtn = document.getElementById('alleZuordnungenLoeschenBtn');
    const alleDruckenBtn = document.getElementById('alleDruckenBtn');

    // --- UTILITIES ---
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

    // --- WETTKAMPFSYSTEM-MAPPER ---
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
        return modus || '?';
    };

    // --- DRAG STATE ---
    let draggedPoolId = null;

    // --- DATEN LADEN ---
    async function ladeDaten() {
        if (!mattenContainer) return;

        try {
            mattenContainer.innerHTML = '<div class="matten-loading">Kampfflächen werden geladen...</div>';

            const response = await fetch(`/api/pools/kampfflaechen?turnierId=${encodeURIComponent(turnierId)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Daten konnten nicht geladen werden.');
            }

            renderAlles(data);

        } catch (error) {
            console.error('[Matten] Fehler beim Laden:', error);
            mattenContainer.innerHTML = `<div class="matten-error">Fehler beim Laden: ${error.message}</div>`;
        }
    }

    // --- KOMPLETT-RENDERING ---
    function renderAlles(data) {
        const { pools = [], kampfflaechen = [] } = data;

        // Pools aufteilen: zugeordnet vs. nicht zugeordnet
        const zugeordnet = new Map(); // kampflaecheId -> [pool, ...]
        const nichtZugeordnet = [];

        kampfflaechen.forEach(k => zugeordnet.set(k.id, []));

        pools.forEach(pool => {
            if (pool.kampflaeche_id && zugeordnet.has(pool.kampflaeche_id)) {
                zugeordnet.get(pool.kampflaeche_id).push(pool);
            } else {
                nichtZugeordnet.push(pool);
            }
        });

        // Innerhalb jeder Matte nach Reihenfolge sortieren
        zugeordnet.forEach((matPools) => {
            matPools.sort((a, b) => (a.reihenfolge || 0) - (b.reihenfolge || 0));
        });

        // HTML zusammenbauen (Nicht zugeordnet wird UNTER den Wettkampfflächen gerendert)
        let html = '';

        // 1. Matten-Raster
        html += '<div class="matten-grid">';
        kampfflaechen.forEach(kf => {
            const matPools = zugeordnet.get(kf.id) || [];
            html += renderMatte(kf, matPools);
        });
        html += '</div>';

        // 2. Nicht zugeordnete Pools
        html += renderUnzugeordnet(nichtZugeordnet);

        mattenContainer.innerHTML = html;

        // Event-Handler anbinden
        initialisiereCollapse();
        initialisiereDragAndDrop();
        aktualisiereDruckZustand();
    }

    // --- DRUCK: nur möglich, wenn Pools auf Matten verteilt sind ---
    // Matten-Druckknopf je Matte nur mit mindestens einem Pool auf dieser Matte, "Alle Pools
    // drucken" nur, wenn irgendeine Matte Pools hat. Wird nach jeder Änderung der Zuordnung
    // (auch dem lokalen DOM-Update ohne Neuladen) neu bewertet.
    function aktualisiereDruckZustand() {
        let pools = 0;
        mattenContainer.querySelectorAll('.matte-box').forEach(box => {
            const n = box.querySelectorAll('.matte-drop-zone .pool-card').length;
            pools += n;
            const icon = box.querySelector('.matte-druck-icon');
            if (icon) {
                icon.style.opacity = n > 0 ? '' : '0.3';
                icon.style.pointerEvents = n > 0 ? '' : 'none';
            }
        });
        if (alleDruckenBtn) alleDruckenBtn.disabled = pools === 0;
    }

    // Der Druck läuft über pools.html (dort liegt die Darstellung der Kampfbögen/Turnierbäume),
    // aber in einem unsichtbaren Rahmen: der Nutzer bleibt auf der Matten-Seite.
    let druckRahmen = null;
    function entferneDruckRahmen() {
        if (druckRahmen) {
            druckRahmen.remove();
            druckRahmen = null;
        }
    }

    function oeffneDruck(matteId) {
        entferneDruckRahmen();
        druckRahmen = document.createElement('iframe');
        druckRahmen.setAttribute('aria-hidden', 'true');
        // Außerhalb des sichtbaren Bereichs, aber mit echter Größe, damit der Druck sauber layoutet
        druckRahmen.style.cssText = 'position: fixed; left: -10000px; top: 0; width: 1100px; height: 800px; border: 0;';
        druckRahmen.src = `/pools.html?turnierId=${encodeURIComponent(turnierId)}&druckMatte=${encodeURIComponent(matteId)}`;
        document.body.appendChild(druckRahmen);
    }

    window.addEventListener('message', (e) => {
        if (e.origin !== window.location.origin || !druckRahmen || e.source !== druckRahmen.contentWindow) return;
        if (e.data?.hajimeDruck === 'fehler') {
            zeigeNotification(e.data.text || 'Drucken nicht möglich.', 'error');
        }
        if (e.data?.hajimeDruck === 'fehler' || e.data?.hajimeDruck === 'fertig') {
            entferneDruckRahmen();
        }
    });

    if (alleDruckenBtn) {
        alleDruckenBtn.addEventListener('click', () => {
            const nichtZugeordnet = mattenContainer.querySelectorAll('.unzugeordnet-body .pool-card').length;
            if (nichtZugeordnet > 0) {
                zeigeNotification(`${nichtZugeordnet} Pool(s) ohne Matte werden nicht gedruckt.`, 'info');
            }
            oeffneDruck('alle');
        });
    }

    // --- UNZUGEORDNET-BEREICH ---
    function renderUnzugeordnet(pools) {
        const count = pools.length;

        return `
            <div class="unzugeordnet-area" style="margin-top: 30px;">
                <div class="unzugeordnet-header" data-toggle="unzugeordnet">
                    <span class="material-icons">inbox</span>
                    <span class="section-title">Nicht zugeordnet</span>
                    <span class="pool-count-badge">${count}</span>
                    <span class="material-icons collapse-icon">expand_more</span>
                </div>
                <div class="unzugeordnet-body" data-drop-zone="unzugeordnet">
                    ${count === 0
                        ? '<span class="unzugeordnet-empty">Alle Pools sind einer Kampffläche zugeordnet.</span>'
                        : pools.map(p => renderPoolCard(p)).join('')
                    }
                </div>
            </div>
        `;
    }

    // --- MATTEN-STATUS-BADGE ---
    const MATTE_STATUS_LABELS = {
        frei: { text: 'Frei', klasse: 'bereit' },
        pools_vorhanden: { text: 'Pools vorhanden', klasse: 'vorbereitung' },
        in_austragung: { text: 'In Austragung', klasse: 'laufend' },
        pausiert: { text: 'Pausiert', klasse: 'kampflos' },
        gesperrt: { text: 'Gesperrt', klasse: 'beendet' }
    };

    // --- EINZELNE MATTE ---
    function renderMatte(kf, pools) {
        const gesamtMinuten = pools.reduce((sum, p) => sum + (p.dauer_minuten || 0), 0);
        const { text: mattenStatusText, klasse: mattenStatusKlasse } = MATTE_STATUS_LABELS[kf.status] || { text: kf.status || '', klasse: 'bereit' };
        const istPausiert = kf.status === 'pausiert';
        const istGesperrt = kf.status === 'gesperrt';

        return `
            <div class="matte-box" data-kampflaeche-id="${kf.id}">
                <div class="matte-header">
                    <span class="matte-name">${escapeHtml(kf.bezeichnung)}</span>
                    <span class="pool-status-badge ${mattenStatusKlasse}" style="margin-left: 8px;">${mattenStatusText}</span>
                    <span class="matte-total-time">${gesamtMinuten} Min.</span>
                    <span class="material-icons matte-druck-icon" data-kampflaeche-id="${kf.id}" title="Pools dieser Matte drucken" style="cursor: pointer; font-size: 18px; margin-left: 8px;">print</span>
                    <span class="material-icons matte-action-icon" data-action="${istPausiert ? 'fortsetzen' : 'pausieren'}" data-kampflaeche-id="${kf.id}" title="${istPausiert ? 'Matte fortsetzen' : 'Matte pausieren'}" style="cursor: pointer; font-size: 18px; margin-left: 8px; ${istGesperrt ? 'opacity: 0.3; pointer-events: none;' : ''}">${istPausiert ? 'play_circle' : 'pause_circle'}</span>
                    <span class="material-icons matte-action-icon" data-action="${istGesperrt ? 'entsperren' : 'sperren'}" data-kampflaeche-id="${kf.id}" title="${istGesperrt ? 'Matte entsperren' : 'Matte sperren'}" style="cursor: pointer; font-size: 18px; margin-left: 4px;">${istGesperrt ? 'lock_open' : 'lock'}</span>
                </div>
                <div class="matte-drop-zone" data-drop-zone="matte" data-kampflaeche-id="${kf.id}">
                    ${pools.length === 0
                        ? '<span class="matte-empty-hint">Pools hierher ziehen</span>'
                        : pools.map(p => renderPoolCard(p)).join('')
                    }
                </div>
            </div>
        `;
    }

    // --- POOL-KARTE ---
    // Status-Badge basiert direkt auf pools.status (Server-Wahrheit) statt einer eigenen
    // Client-Berechnung. anzahlTeilnehmer 0/1 bleiben als visuelle Sonderfälle bestehen
    // ("In Vorbereitung"/"Kampflos"), überlagern aber nur die Anzeige, nicht den echten Status.
    const POOL_STATUS_LABELS = {
        angelegt: { text: 'In Vorbereitung', klasse: 'vorbereitung' },
        teilnehmer_zugewiesen: { text: 'Bereit', klasse: 'bereit' },
        matte_zugewiesen: { text: 'Bereit', klasse: 'bereit' },
        gestartet: { text: 'Laufend', klasse: 'laufend' },
        kaempfe_beendet: { text: 'Ergebnisse prüfen', klasse: 'beendet' },
        abgeschlossen: { text: 'Abgeschlossen', klasse: 'beendet' }
    };

    function renderPoolCard(pool) {
        const abk = mapWettkampfsystem(pool.modus, pool.anzahl_teilnehmer);
        const kaempfe = pool.gesamt_kaempfe || 0;
        const dauer = pool.dauer_minuten || 0;
        const anzahlTeilnehmer = Number(pool.anzahl_teilnehmer) || 0;

        let { text: statusText, klasse: statusClass } = POOL_STATUS_LABELS[pool.status] || { text: 'Bereit', klasse: 'bereit' };
        if (anzahlTeilnehmer === 0) {
            statusText = 'In Vorbereitung';
            statusClass = 'vorbereitung';
        } else if (anzahlTeilnehmer === 1) {
            statusText = 'Kampflos';
            statusClass = 'kampflos';
        }

        return `
            <div class="pool-card" draggable="true" data-pool-id="${pool.id}" data-dauer-minuten="${dauer}">
                <span class="material-icons drag-handle">drag_indicator</span>
                <span class="pool-card-name">${escapeHtml(pool.bezeichnung)}</span>
                <span class="pool-card-sep">|</span>
                <span class="pool-status-badge ${statusClass}">${statusText}</span>
                <span class="pool-card-sep">|</span>
                <span class="pool-card-system">${abk}</span>
                <span class="pool-card-sep">|</span>
                <span class="pool-card-fights">${kaempfe} Kämpfe</span>
                <span class="pool-card-sep">|</span>
                <span class="pool-card-duration">${dauer}min</span>
            </div>
        `;
    }

    // --- COLLAPSE-LOGIK ---
    function initialisiereCollapse() {
        const header = mattenContainer.querySelector('.unzugeordnet-header');
        if (!header) return;

        header.addEventListener('click', () => {
            const body = mattenContainer.querySelector('.unzugeordnet-body');
            const icon = header.querySelector('.collapse-icon');
            if (!body) return;

            body.classList.toggle('collapsed');
            icon.textContent = body.classList.contains('collapsed') ? 'expand_more' : 'expand_less';
        });
    }

    // --- DRAG & DROP ---
    function initialisiereDragAndDrop() {
        const poolCards = mattenContainer.querySelectorAll('.pool-card');
        const dropZones = mattenContainer.querySelectorAll('[data-drop-zone]');

        // Drag start / end auf Pool-Karten
        poolCards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                draggedPoolId = card.getAttribute('data-pool-id');
                e.dataTransfer.setData('text/plain', draggedPoolId);
                e.dataTransfer.effectAllowed = 'move';
                requestAnimationFrame(() => card.classList.add('dragging'));
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                draggedPoolId = null;
                dropZones.forEach(zone => zone.classList.remove('drag-over'));
            });
        });

        // Drop-Zonen konfigurieren
        dropZones.forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                zone.classList.add('drag-over');
            });

            zone.addEventListener('dragleave', (e) => {
                // Nur entfernen wenn wir wirklich die Zone verlassen
                if (!zone.contains(e.relatedTarget)) {
                    zone.classList.remove('drag-over');
                }
            });

            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');

                const poolId = e.dataTransfer.getData('text/plain');
                if (!poolId) return;

                const zoneType = zone.getAttribute('data-drop-zone');

                if (zoneType === 'unzugeordnet') {
                    // Pool von Matte entfernen
                    await zuordnungAufheben(parseInt(poolId, 10));
                } else if (zoneType === 'matte') {
                    const kampflaecheId = parseInt(zone.getAttribute('data-kampflaeche-id'), 10);
                    // Position bestimmen basierend auf Mausposition
                    const position = berechneDropPosition(zone, e.clientY);
                    await zuordnungSetzen(parseInt(poolId, 10), kampflaecheId, position);
                }
            });
        });
    }

    // --- DROP-POSITION BERECHNEN ---
    function berechneDropPosition(zone, clientY) {
        const cards = Array.from(zone.querySelectorAll('.pool-card:not(.dragging)'));
        if (cards.length === 0) return 0;

        for (let i = 0; i < cards.length; i++) {
            const rect = cards[i].getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (clientY < midY) return i;
        }

        return cards.length;
    }

    // --- OPTIMISTISCHES DOM-UPDATE NACH ZUORDNUNG (statt komplettem Neuladen) ---
    // Ein voller ladeDaten()-Aufruf ersetzt das gesamte Raster (kurzzeitig durch den
    // Lade-Platzhalter) und lässt das Bild bei jeder Verschiebung sichtbar "ruckeln". Da der
    // Server bereits die Quelle der Wahrheit aktualisiert hat, reicht es, den bereits
    // verschobenen Karten-Knoten an die richtige Stelle im DOM zu setzen und die betroffenen
    // Zonen/Summen lokal nachzuziehen.
    function aktualisiereMattenGesamtzeit(kampflaecheId) {
        const matteBox = mattenContainer.querySelector(`.matte-box[data-kampflaeche-id="${kampflaecheId}"]`);
        if (!matteBox) return;
        const zone = matteBox.querySelector('.matte-drop-zone');
        const summe = Array.from(zone ? zone.querySelectorAll('.pool-card') : [])
            .reduce((sum, card) => sum + (parseInt(card.getAttribute('data-dauer-minuten'), 10) || 0), 0);
        const badge = matteBox.querySelector('.matte-total-time');
        if (badge) badge.textContent = `${summe} Min.`;
    }

    function aktualisiereZoneLeerZustand(zone) {
        if (!zone) return;
        aktualisiereDruckZustand();
        const hatKarten = zone.querySelector('.pool-card') !== null;
        const zoneType = zone.getAttribute('data-drop-zone');
        let hint = zone.querySelector('.matte-empty-hint, .unzugeordnet-empty');

        if (hatKarten) {
            if (hint) hint.remove();
        } else if (!hint) {
            hint = document.createElement('span');
            hint.className = zoneType === 'unzugeordnet' ? 'unzugeordnet-empty' : 'matte-empty-hint';
            hint.textContent = zoneType === 'unzugeordnet' ? 'Alle Pools sind einer Kampffläche zugeordnet.' : 'Pools hierher ziehen';
            zone.appendChild(hint);
        }

        if (zoneType === 'unzugeordnet') {
            const badge = mattenContainer.querySelector('.unzugeordnet-area .pool-count-badge');
            if (badge) badge.textContent = String(zone.querySelectorAll('.pool-card').length);
        }
    }

    // Setzt die Karte an der gewünschten Position innerhalb der Ziel-Zone ein (Reihenfolge
    // bleibt dieselbe wie die zuvor per API persistierte).
    function fuegeKarteAnPositionEin(zone, karte, position) {
        const vorhandeneKarten = Array.from(zone.querySelectorAll('.pool-card')).filter(c => c !== karte);
        const referenz = vorhandeneKarten[position] || null;
        zone.insertBefore(karte, referenz);
    }

    // --- API: POOL EINER MATTE ZUORDNEN / REIHENFOLGE SETZEN ---
    async function zuordnungSetzen(poolId, kampflaecheId, position) {
        const karte = mattenContainer.querySelector(`.pool-card[data-pool-id="${poolId}"]`);
        const alteZone = karte ? karte.closest('[data-drop-zone]') : null;
        const alteMatteId = alteZone && alteZone.getAttribute('data-drop-zone') === 'matte'
            ? alteZone.getAttribute('data-kampflaeche-id')
            : null;

        try {
            if (window.zeigeLadeModal) window.zeigeLadeModal('Pool wird zugeordnet…');

            // 1. Pool der Matte zuordnen
            const zuordnenRes = await fetch('/api/pools/kampfflaeche-zuordnen', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ poolId, kampflaecheId })
            });

            if (!zuordnenRes.ok) {
                const err = await zuordnenRes.json();
                throw new Error(err.error || 'Zuordnung fehlgeschlagen.');
            }

            // Kampf-Menüpunkt live neu bewerten: durch diese Zuordnung könnte gerade die erste
            // Matte einen Pool erhalten haben.
            if (window.hajimeAktualisiereMenueSperren) {
                window.hajimeAktualisiereMenueSperren(['kampf']);
            }

            // 2. Reihenfolge auf der Matte aktualisieren
            const dropZone = mattenContainer.querySelector(
                `.matte-drop-zone[data-kampflaeche-id="${kampflaecheId}"]`
            );

            const currentIds = dropZone
                ? Array.from(dropZone.querySelectorAll('.pool-card:not(.dragging)'))
                    .map(c => parseInt(c.getAttribute('data-pool-id'), 10))
                    .filter(id => id !== poolId)
                : [];

            // Pool an gewünschter Position einfügen
            currentIds.splice(position, 0, poolId);

            await fetch('/api/pools/kampfflaeche-reihenfolge', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kampflaecheId, poolIds: currentIds })
            });

            // 3. DOM lokal nachziehen statt alles neu zu laden
            if (karte && dropZone) {
                fuegeKarteAnPositionEin(dropZone, karte, position);
                if (alteZone && alteZone !== dropZone) aktualisiereZoneLeerZustand(alteZone);
                aktualisiereZoneLeerZustand(dropZone);
                if (alteMatteId) aktualisiereMattenGesamtzeit(alteMatteId);
                aktualisiereMattenGesamtzeit(kampflaecheId);
            } else {
                await ladeDaten();
            }

        } catch (error) {
            console.error('[Matten] Fehler bei Zuordnung:', error);
            zeigeNotification('Fehler: ' + error.message, 'error');
            await ladeDaten();
        } finally {
            if (window.versteckeLadeModal) window.versteckeLadeModal();
        }
    }

    // --- API: POOL VON MATTE ENTFERNEN ---
    async function zuordnungAufheben(poolId) {
        const karte = mattenContainer.querySelector(`.pool-card[data-pool-id="${poolId}"]`);
        const alteZone = karte ? karte.closest('[data-drop-zone]') : null;
        const alteMatteId = alteZone && alteZone.getAttribute('data-drop-zone') === 'matte'
            ? alteZone.getAttribute('data-kampflaeche-id')
            : null;

        try {
            const response = await fetch('/api/pools/kampfflaeche-zuordnen', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ poolId, kampflaecheId: null })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Entfernung fehlgeschlagen.');
            }

            // Kampf-Menüpunkt live neu bewerten: falls dies die letzte zugeordnete Matte war,
            // muss Kampf wieder gesperrt werden.
            if (window.hajimeAktualisiereMenueSperren) {
                window.hajimeAktualisiereMenueSperren(['kampf']);
            }

            const unzugeordnetZone = mattenContainer.querySelector('.unzugeordnet-body[data-drop-zone="unzugeordnet"]');
            if (karte && unzugeordnetZone) {
                unzugeordnetZone.appendChild(karte);
                if (alteZone && alteZone !== unzugeordnetZone) aktualisiereZoneLeerZustand(alteZone);
                aktualisiereZoneLeerZustand(unzugeordnetZone);
                if (alteMatteId) aktualisiereMattenGesamtzeit(alteMatteId);
            } else {
                await ladeDaten();
            }

        } catch (error) {
            console.error('[Matten] Fehler beim Entfernen:', error);
            zeigeNotification('Fehler: ' + error.message, 'error');
            await ladeDaten();
        }
    }

    // --- API: AUTOMATISCH AUFTEILEN ---
    // modus 'neue': nur Pools ohne Matte werden an die bestehenden Zuordnungen angehängt (Waage in
    // Runden); 'alle': Zuordnungen aller Pools ohne begonnene Kämpfe verwerfen und neu verteilen.
    async function fuehreAufteilenAus(modus, knopf, knopfHtml) {
        {
            try {
                knopf.setAttribute('disabled', 'true');
                knopf.innerHTML = `<span class="material-icons icon-spin">sync</span>`;
                if (window.zeigeLadeModal) window.zeigeLadeModal('Pools werden aufgeteilt…');

                const response = await fetch('/api/pools/aufteilen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ turnierId: parseInt(turnierId, 10), modus })
                });

                const result = await response.json();
                if (result.success) {
                    zeigeNotification(result.message || 'Pools erfolgreich auf Kampfflächen verteilt.', 'success');
                    await ladeDaten();

                    // Kampf-Menüpunkt live neu bewerten: durch die automatische Verteilung
                    // könnten Matten gerade ihre ersten Pools erhalten haben.
                    if (window.hajimeAktualisiereMenueSperren) {
                        window.hajimeAktualisiereMenueSperren(['kampf']);
                    }
                } else {
                    zeigeNotification(result.error || 'Fehler beim Aufteilen.', result.keineNeuenPools ? 'info' : 'error');
                }
            } catch (err) {
                zeigeNotification('Netzwerkfehler beim Aufteilen.', 'error');
            } finally {
                knopf.removeAttribute('disabled');
                knopf.innerHTML = knopfHtml;
                if (window.versteckeLadeModal) window.versteckeLadeModal();
            }
        }
    }

    if (aufteilenBtn) {
        const html = aufteilenBtn.innerHTML;
        aufteilenBtn.addEventListener('click', async () => {
            const bestaetigt = await zeigeBestaetigung(
                'Die noch keiner Matte zugeordneten Pools werden auf die Matten verteilt. Bereits zugeordnete Pools bleiben unverändert.',
                'Pools aufteilen',
                'auto_awesome'
            );
            if (!bestaetigt) return;
            await fuehreAufteilenAus('neue', aufteilenBtn, html);
        });
    }

    if (alleNeuVerteilenBtn) {
        const html = alleNeuVerteilenBtn.innerHTML;
        alleNeuVerteilenBtn.addEventListener('click', async () => {
            const bestaetigt = await zeigeBestaetigung(
                'Möchten Sie die Pools wirklich neu verteilen? Alle vorherigen Zuteilungen (außer Pools mit begonnenen Kämpfen) werden dabei gelöscht.',
                'Alle neu verteilen',
                'shuffle'
            );
            if (!bestaetigt) return;
            await fuehreAufteilenAus('alle', alleNeuVerteilenBtn, html);
        });
    }

    // --- API: ALLE MATTENZUORDNUNGEN LÖSCHEN ---
    if (alleZuordnungenLoeschenBtn) {
        alleZuordnungenLoeschenBtn.addEventListener('click', async () => {
            const bestaetigt = await zeigeBestaetigung(
                'Möchten Sie wirklich alle Pool-zu-Kampffläche-Zuordnungen dieses Turniers löschen? Alle Pools werden dabei "Nicht zugeordnet".',
                'Alle Zuordnungen löschen',
                'delete_sweep'
            );

            if (!bestaetigt) return;

            try {
                alleZuordnungenLoeschenBtn.setAttribute('disabled', 'true');
                alleZuordnungenLoeschenBtn.innerHTML = `<span class="material-icons icon-spin">sync</span>`;

                const response = await fetch('/api/pools/kampfflaeche-zuordnungen-loeschen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ turnierId: parseInt(turnierId, 10) })
                });

                const result = await response.json();
                if (result.success) {
                    zeigeNotification('Alle Mattenzuordnungen wurden gelöscht.', 'success');
                    if (window.hajimeAktualisiereMenueSperren) {
                        window.hajimeAktualisiereMenueSperren(['kampf']);
                    }
                    await ladeDaten();
                } else {
                    zeigeNotification(result.error || 'Fehler beim Löschen.', 'error');
                }
            } catch (err) {
                zeigeNotification('Netzwerkfehler beim Löschen.', 'error');
            } finally {
                alleZuordnungenLoeschenBtn.removeAttribute('disabled');
                alleZuordnungenLoeschenBtn.innerHTML = `<span class="material-icons" style="font-size: 18px;">delete_sweep</span>Alle Zuordnungen löschen`;
            }
        });
    }

    // --- API: MATTE PAUSIEREN/FORTSETZEN/SPERREN/ENTSPERREN ---
    mattenContainer.addEventListener('click', async (e) => {
        // Pools der Matte drucken: pools.html öffnet den Druckdialog für genau diese Kampffläche
        const druckIcon = e.target.closest('.matte-druck-icon');
        if (druckIcon) {
            e.stopPropagation();
            const matteId = druckIcon.getAttribute('data-kampflaeche-id');
            if (!mattenContainer.querySelector(`.matte-drop-zone[data-kampflaeche-id="${matteId}"] .pool-card`)) {
                zeigeNotification('Dieser Kampffläche sind keine Pools zugeordnet.', 'error');
                return;
            }
            oeffneDruck(matteId);
            return;
        }

        const icon = e.target.closest('.matte-action-icon');
        if (!icon) return;
        e.stopPropagation();

        const aktion = icon.getAttribute('data-action');
        const kampflaecheId = icon.getAttribute('data-kampflaeche-id');
        const aktionsText = {
            pausieren: 'Diese Matte pausieren (z.B. Arzt auf der Matte, technisches Problem)?',
            fortsetzen: 'Diese Matte wieder fortsetzen?',
            sperren: 'Diese Matte für den Wettkampf sperren (z.B. Mittagspause, Abbau)?',
            entsperren: 'Diese Matte wieder entsperren?'
        }[aktion];

        const bestaetigt = await zeigeBestaetigung(aktionsText, 'Matte verwalten', 'pan_tool');
        if (!bestaetigt) return;

        try {
            const response = await fetch(`/api/kampfflaechen/${kampflaecheId}/${aktion}`, { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                zeigeNotification(result.message || 'Matte aktualisiert.', 'success');
                await ladeDaten();
            } else {
                zeigeNotification(result.error || 'Fehler bei der Aktion.', 'error');
            }
        } catch (err) {
            zeigeNotification('Netzwerkfehler: ' + err.message, 'error');
        }
    });

    // --- HTML-ESCAPE ---
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // --- INITIALES LADEN ---
    await ladeDaten();
});
