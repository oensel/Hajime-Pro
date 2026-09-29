document.addEventListener('DOMContentLoaded', () => {
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

    const container = document.getElementById('mannschaftsPoolsContainer');
    let djbKlassen = { weiblich: [], männlich: [], mixed: [], mannschaft: { weiblich: [], männlich: [] } };

    // --- TURNIER-MANNSCHAFTS-ALTERSKLASSEN (welche Klassen werden bei diesem Turnier für
    // Mannschaftskämpfe überhaupt ausgetragen, siehe turnier.html) — analog zur
    // Registrierungs-Einschränkung in teilnehmer.js: null = keine Einschränkung hinterlegt.
    let turnierMannschaftAltersklassenKeys = null;

    async function ladeTurnierMannschaftAltersklassen() {
        try {
            const resp = await fetch(`/api/turniere/${turnierId}`);
            if (!resp.ok) return;
            const turnier = await resp.json();

            const mak = turnier.mannschafts_altersklassen;
            if (Array.isArray(mak) && mak.length > 0) turnierMannschaftAltersklassenKeys = mak;
        } catch (e) {
            console.error('Fehler beim Laden der Turnier-Mannschafts-Altersklassen:', e);
        }
    }

    const notify = (msg, typ = 'success') => {
        if (typeof window.zeigeNotification === 'function') window.zeigeNotification(msg, typ);
        else console.log(`[${typ}] ${msg}`);
    };
    const confirmDialog = async (msg, titel = 'Aktion bestätigen', icon = 'help_outline') => {
        if (typeof window.zeigeZentraleBestaetigung === 'function') return window.zeigeZentraleBestaetigung(msg, titel, icon);
        return confirm(msg);
    };

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str ?? '';
        return div.innerHTML;
    }

    // --- MODAL HELPERS ---
    function openModal(id) { document.getElementById(id).style.display = 'flex'; }
    function closeModal(id) { document.getElementById(id).style.display = 'none'; }

    // --- DATEN LADEN ---
    async function ladeDjbKlassen() {
        try {
            const res = await fetch('/api/djb-klassen');
            djbKlassen = await res.json();
        } catch (e) {
            console.error('Fehler beim Laden der DJB-Klassen:', e);
        }
    }

    // Gewichtsklassen-Vorschlag: U15/U18 -> offizielle DJB-Mannschafts-Positionen; alle anderen
    // Altersklassen -> die bereits vorhandene Einzelwettkampf-Gewichtsklassen-Liste derselben
    // Altersklasse/desselben Geschlechts (siehe CLAUDE-Plan Abschnitt 2).
    function ermittleGewichtsklassenVorschlag(geschlecht, altersklasse) {
        const mannschaftListe = djbKlassen.mannschaft && djbKlassen.mannschaft[geschlecht];
        const mannschaftEintrag = Array.isArray(mannschaftListe) ? mannschaftListe.find(k => k.id === altersklasse) : null;
        if (mannschaftEintrag) return mannschaftEintrag.gewichtsklassen || [];

        const einzelListe = djbKlassen[geschlecht];
        const einzelEintrag = Array.isArray(einzelListe) ? einzelListe.find(k => k.id === altersklasse) : null;
        return (einzelEintrag && einzelEintrag.gewichtsklassen) || [];
    }

    function befuelleAltersklassenSelect() {
        const geschlecht = document.getElementById('poolGeschlecht').value;
        const select = document.getElementById('poolAltersklasse');
        let liste = djbKlassen[geschlecht] || [];

        if (turnierMannschaftAltersklassenKeys) {
            liste = liste.filter(k => turnierMannschaftAltersklassenKeys.includes(`${geschlecht}_${k.id}`));
        }

        select.innerHTML = liste.map(k => `<option value="${k.id}">${escapeHtml(k.bezeichnung || k.id)}</option>`).join('');
        aktualisiereGewichtsklassenVorschlag();
    }

    // Kampfzeit-Vorschlag: die Mannschafts-Vorlage in altersklassen.json führt (anders als die
    // Einzelwettkampf-Einträge) keine eigene Kampfzeit, daher immer die Einzelwettkampf-Kampfzeit
    // derselben Altersklasse/desselben Geschlechts übernehmen, sonst 180s (3 Min.) als Rückfall —
    // identische Herleitung wie ermittleMannschaftsKampfzeit() in mannschaftController.js.
    function ermittleKampfzeitVorschlag(geschlecht, altersklasse) {
        const einzelListe = djbKlassen[geschlecht];
        const einzelEintrag = Array.isArray(einzelListe) ? einzelListe.find(k => k.id === altersklasse) : null;
        return (einzelEintrag && parseInt(einzelEintrag.kampfzeit, 10)) || 180;
    }

    function aktualisiereGewichtsklassenVorschlag() {
        const geschlecht = document.getElementById('poolGeschlecht').value;
        const altersklasse = document.getElementById('poolAltersklasse').value;
        const vorschlag = ermittleGewichtsklassenVorschlag(geschlecht, altersklasse);
        const feld = document.getElementById('poolGewichtsklassen');
        const hint = document.getElementById('poolGewichtsklassenHint');
        feld.value = vorschlag.join(', ');
        hint.textContent = vorschlag.length > 0
            ? (djbKlassen.mannschaft?.[geschlecht]?.some(k => k.id === altersklasse)
                ? 'Offizielle DJB-Mannschafts-Gewichtsklassen (frei editierbar).'
                : 'Übernommen aus den Einzelwettkampf-Gewichtsklassen dieser Altersklasse (frei editierbar).')
            : 'Keine Vorlage verfügbar — bitte Positionen manuell eintragen.';

        const kampfzeitSelect = document.getElementById('poolKampfzeit');
        const kampfzeitVorschlag = ermittleKampfzeitVorschlag(geschlecht, altersklasse);
        const passendeOption = Array.from(kampfzeitSelect.options).find(o => parseInt(o.value, 10) === kampfzeitVorschlag);
        if (passendeOption) kampfzeitSelect.value = passendeOption.value;
    }

    // Gleiche pools.status-Werte/Bedeutung wie bei Einzelwettkampf-Pools (siehe pools.js), hier
    // nur auf die für Mannschafts-Pools tatsächlich vorkommenden Zustände reduziert.
    const POOL_STATUS_LABELS = {
        angelegt: { text: 'In Vorbereitung', klasse: 'vorbereitung' },
        gestartet: { text: 'Laufend', klasse: 'laufend' },
        kaempfe_beendet: { text: 'Ergebnisse prüfen', klasse: 'pruefen' },
        abgeschlossen: { text: 'Abgeschlossen', klasse: 'beendet' }
    };

    // --- POOLS/MANNSCHAFTEN LADEN & RENDERN ---
    async function ladeUndRendere() {
        try {
            const [poolsRes, teamsRes] = await Promise.all([
                fetch(`/api/mannschaften/pools?turnierId=${turnierId}`),
                fetch(`/api/mannschaften?turnierId=${turnierId}`)
            ]);
            let pools = await poolsRes.json();
            if (!Array.isArray(pools)) pools = [];
            const teams = await teamsRes.json();

            const teamsByPool = new Map();
            const nichtZugeordnet = [];
            for (const t of (Array.isArray(teams) ? teams : [])) {
                if (t.pool_id === null || t.pool_id === undefined) {
                    nichtZugeordnet.push(t);
                    continue;
                }
                if (!teamsByPool.has(t.pool_id)) teamsByPool.set(t.pool_id, []);
                teamsByPool.get(t.pool_id).push(t);
            }

            let html = renderNichtZugeordneteSektion(nichtZugeordnet, pools);

            if (!Array.isArray(pools) || pools.length === 0) {
                html += '<p class="no-data">Noch keine Mannschafts-Pools angelegt. Klicken Sie oben auf "Neuer Mannschafts-Pool".</p>';
            } else {
                const poolCards = await Promise.all(pools.map(pool => renderPoolCard(pool, teamsByPool.get(pool.id) || [])));
                html += poolCards.join('');
            }

            container.innerHTML = html;
            bindeEvents();
        } catch (e) {
            console.error(e);
            container.innerHTML = `<p class="no-data">Fehler beim Laden: ${escapeHtml(e.message)}</p>`;
        }
    }

    // Mannschaften ohne pool_id (z.B. per Teilnehmer-Import automatisch angelegt, siehe
    // importTeilnehmer/mannschaft_name in teilnehmerController.js) — werden unabhängig von den
    // Pool-Karten immer angezeigt, sonst blieben sie nach dem Import unsichtbar (siehe
    // renderPoolCard, das ausschließlich pool-gebundene Teams rendert).
    function renderNichtZugeordneteSektion(teams, pools) {
        if (!teams || teams.length === 0) return '';

        const poolOptions = (pools || [])
            .map(p => `<option value="${p.id}">${escapeHtml(p.bezeichnung)} (${escapeHtml(p.altersklasse)} ${escapeHtml(p.geschlecht)})</option>`)
            .join('');

        return `
            <div class="mannschafts-pool-card" style="border-color: var(--primary);">
                <div class="mannschafts-pool-header">
                    <h3>Noch keinem Pool zugeordnet</h3>
                    <span class="mannschafts-pool-meta">${teams.length} Mannschaft(en) — z.B. aus dem Teilnehmer-Import</span>
                </div>
                <div class="mannschaften-body">
                    ${teams.map(team => renderUnassignedTeamCard(team, poolOptions)).join('')}
                </div>
            </div>`;
    }

    function renderUnassignedTeamCard(team, poolOptions) {
        const mitglieder = sortiereMitglieder(team.mitglieder, []);
        return `
            <div class="mannschaft-card" data-team-id="${team.id}">
                <div class="mannschaft-card-header">
                    <strong>${escapeHtml(team.bezeichnung)}</strong>
                    <span class="mannschaft-verein">${escapeHtml(team.verein)}</span>
                    <div class="mannschaft-card-actions" style="align-items: center; gap: 8px;">
                        ${poolOptions ? `
                        <select class="unassigned-pool-select" data-team-id="${team.id}" style="font-size: 12px; max-width: 220px;">
                            <option value="">Pool wählen…</option>
                            ${poolOptions}
                        </select>
                        <button type="button" class="toolbar-btn assign-pool-btn" data-team-id="${team.id}">Zuweisen</button>
                        ` : '<span class="mannschaften-hint">Noch kein Mannschafts-Pool vorhanden.</span>'}
                        <button type="button" class="icon-btn-small delete-team-btn" data-team-id="${team.id}" title="Mannschaft löschen"><span class="material-icons">delete</span></button>
                    </div>
                </div>
                ${mitglieder.length === 0 ? '<p class="roster-empty">Noch keine Mitglieder zugeordnet.</p>' : `
                <table class="roster-table">
                    <thead><tr><th>Gewichtsklasse</th><th>Judoka</th><th>Gewicht</th><th></th></tr></thead>
                    <tbody>
                        ${mitglieder.map(m => `
                            <tr>
                                <td>${escapeHtml(m.gewichtsklasse)}</td>
                                <td>${escapeHtml(m.vorname)} ${escapeHtml(m.nachname)}</td>
                                <td>${m.gewicht ? escapeHtml(String(m.gewicht)) + ' kg' : '-'}</td>
                                <td><button type="button" class="icon-btn-small remove-mitglied-btn" data-team-id="${team.id}" data-mitglied-id="${m.id}" title="Entfernen"><span class="material-icons">close</span></button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>`}
            </div>`;
    }

    async function renderPoolCard(pool, teams) {
        let gewichtsklassen = [];
        try { gewichtsklassen = JSON.parse(pool.mannschafts_gewichtsklassen || '[]'); } catch (e) { gewichtsklassen = []; }

        let begegnungenHtml = '';
        if (teams.length >= 2) {
            try {
                const res = await fetch(`/api/mannschaftskaempfe?poolId=${pool.id}`);
                const begegnungen = await res.json();
                if (Array.isArray(begegnungen) && begegnungen.length > 0) {
                    begegnungenHtml = `
                        <div class="begegnungen-list">
                            <h4>Begegnungen</h4>
                            ${begegnungen.map(renderBegegnungRow).join('')}
                        </div>`;
                }
            } catch (e) { console.error('Begegnungen-Fehler:', e); }
        }

        const { text: statusText, klasse: statusKlasse } = POOL_STATUS_LABELS[pool.status] || { text: pool.status, klasse: 'vorbereitung' };

        return `
            <div class="mannschafts-pool-card" data-pool-id="${pool.id}">
                <div class="mannschafts-pool-header">
                    <h3>${escapeHtml(pool.bezeichnung)}</h3>
                    <span class="mannschafts-pool-meta">${escapeHtml(pool.altersklasse)} ${escapeHtml(pool.geschlecht)} · ${escapeHtml(pool.modus)}</span>
                    <span class="pool-status-badge ${statusKlasse}">${escapeHtml(statusText)}</span>
                    <div class="mannschafts-pool-actions">
                        ${pool.status === 'kaempfe_beendet' ? `<button type="button" class="toolbar-btn toolbar-btn-primary confirm-pool-btn" data-pool-id="${pool.id}" data-pool-name="${escapeHtml(pool.bezeichnung).replace(/"/g, '&quot;')}"><span class="material-icons">fact_check</span><span>Ergebnisse bestätigen</span></button>` : ''}
                        <button type="button" class="toolbar-btn add-team-btn" data-pool-id="${pool.id}"><span class="material-icons">add</span><span>Mannschaft</span></button>
                        <button type="button" class="icon-btn-small delete-pool-btn" data-pool-id="${pool.id}" title="Pool löschen"><span class="material-icons">delete</span></button>
                    </div>
                </div>
                <div class="gewichtsklassen-chips">
                    ${gewichtsklassen.map(gk => `<span class="gk-chip">${escapeHtml(formatiereGewichtsklasse(gk))}</span>`).join('') || '<span class="mannschaften-hint">Keine Gewichtsklassen-Positionen hinterlegt.</span>'}
                </div>
                <div class="mannschaften-body">
                    ${teams.length === 0
                        ? '<p class="roster-empty">Noch keine Mannschaften in diesem Pool.</p>'
                        : teams.map(team => renderTeamCard(team, gewichtsklassen)).join('')}
                    ${begegnungenHtml}
                </div>
            </div>`;
    }

    // Sortiert Mitglieder nach ihrer Gewichtsklassen-Position (Reihenfolge der Pool-Optionen, siehe
    // gewichtsklassen), unbekannte/fehlende Positionen ans Ende; innerhalb derselben Position nach
    // Judoka-Name. Bei fehlender Positionsliste (z.B. Team ohne Pool) bleibt effektiv nur die
    // Namenssortierung übrig.
    function sortiereMitglieder(mitglieder, gewichtsklassen) {
        const indexVon = (gk) => {
            const idx = (gewichtsklassen || []).indexOf(gk);
            return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
        };
        return [...(mitglieder || [])].sort((a, b) => {
            const diff = indexVon(a.gewichtsklasse) - indexVon(b.gewichtsklasse);
            if (diff !== 0) return diff;
            const nameA = `${a.nachname || ''} ${a.vorname || ''}`.toLowerCase();
            const nameB = `${b.nachname || ''} ${b.vorname || ''}`.toLowerCase();
            return nameA.localeCompare(nameB);
        });
    }

    // "kg"-Suffix für die Anzeige einer Gewichtsklasse (z.B. "-30" -> "-30 kg"); gespeichert wird
    // weiterhin die reine Zahl-Notation, das Suffix ist reine Anzeigesache.
    function formatiereGewichtsklasse(gk) {
        const text = String(gk || '').trim();
        if (!text) return '';
        return /kg$/i.test(text) ? text : `${text} kg`;
    }

    function renderRosterChip(m, teamId) {
        return `
            <div class="roster-chip" draggable="true" data-mitglied-id="${m.id}" data-team-id="${teamId}" data-gewicht="${m.gewicht ?? ''}">
                <span>${escapeHtml(m.vorname)} ${escapeHtml(m.nachname)}</span>
                <span class="roster-chip-gewicht">${m.gewicht ? escapeHtml(String(m.gewicht)) + ' kg' : ''}</span>
                <button type="button" class="icon-btn-small remove-mitglied-btn" data-team-id="${teamId}" data-mitglied-id="${m.id}" title="Entfernen"><span class="material-icons">close</span></button>
            </div>`;
    }

    function renderTeamCard(team, gewichtsklassen) {
        const mitglieder = sortiereMitglieder(team.mitglieder, gewichtsklassen);
        const kopf = `
            <div class="mannschaft-card-header">
                <strong>${escapeHtml(team.bezeichnung)}</strong>
                <span class="mannschaft-verein">${escapeHtml(team.verein)}</span>
                <div class="mannschaft-card-actions">
                    <button type="button" class="icon-btn-small delete-team-btn" data-team-id="${team.id}" title="Mannschaft löschen"><span class="material-icons">delete</span></button>
                </div>
            </div>`;

        // Ohne bekannte Gewichtsklassen-Positionen des Pools ist Drag&Drop zwischen Klassen nicht
        // sinnvoll möglich (kein gültiges Ziel) — dann die einfache, nicht ziehbare Tabelle zeigen
        // (oder bei komplett leerem Team ganz ohne Vorlage nur den Hinweistext).
        if (!Array.isArray(gewichtsklassen) || gewichtsklassen.length === 0) {
            if (mitglieder.length === 0) {
                return `<div class="mannschaft-card" data-team-id="${team.id}">${kopf}<p class="roster-empty">Noch keine Mitglieder zugeordnet.</p></div>`;
            }
            return `
                <div class="mannschaft-card" data-team-id="${team.id}">
                    ${kopf}
                    <table class="roster-table">
                        <thead><tr><th>Gewichtsklasse</th><th>Judoka</th><th>Gewicht</th><th></th></tr></thead>
                        <tbody>
                            ${mitglieder.map(m => `
                                <tr>
                                    <td>${escapeHtml(m.gewichtsklasse)}</td>
                                    <td>${escapeHtml(m.vorname)} ${escapeHtml(m.nachname)}</td>
                                    <td>${m.gewicht ? escapeHtml(String(m.gewicht)) + ' kg' : '-'}</td>
                                    <td><button type="button" class="icon-btn-small remove-mitglied-btn" data-team-id="${team.id}" data-mitglied-id="${m.id}" title="Entfernen"><span class="material-icons">close</span></button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;
        }

        // Gruppiert nach den echten Positionen des Pools — jede Gruppe ist eine Drag&Drop-
        // Ablagezone (siehe bindeDragAndDrop). Mitglieder mit einer Position außerhalb der
        // Pool-Liste (z.B. eine Import-Zeitpunkt-Schätzung, bevor der Pool bekannt war) landen in
        // "Sonstige" — von dort kann man sie per Drag&Drop in eine echte Position ziehen, aber
        // nicht wieder zurück (keine gültige Ablagezone).
        const bekannt = new Set(gewichtsklassen);
        const sonstige = mitglieder.filter(m => !bekannt.has(m.gewichtsklasse));

        const gruppenHtml = gewichtsklassen.map(gk => {
            const hier = mitglieder.filter(m => m.gewichtsklasse === gk);
            const leerKlasse = hier.length === 0 ? ' roster-dnd-group-empty' : '';
            return `
                <div class="roster-dnd-group${leerKlasse}" data-gk="${escapeHtml(gk)}">
                    <div class="roster-dnd-header">${escapeHtml(formatiereGewichtsklasse(gk))}</div>
                    <div class="roster-dnd-body" data-drop-zone="true" data-gk="${escapeHtml(gk)}" data-team-id="${team.id}">
                        ${hier.map(m => renderRosterChip(m, team.id)).join('') || '<span class="roster-dnd-empty">—</span>'}
                    </div>
                </div>`;
        }).join('');

        const sonstigeHtml = sonstige.length === 0 ? '' : `
                <div class="roster-dnd-group roster-dnd-group-sonstige">
                    <div class="roster-dnd-header">Sonstige</div>
                    <div class="roster-dnd-body" data-drop-zone="false">
                        ${sonstige.map(m => renderRosterChip(m, team.id)).join('')}
                    </div>
                </div>`;

        return `
            <div class="mannschaft-card" data-team-id="${team.id}">
                ${kopf}
                <div class="roster-dnd">${gruppenHtml}${sonstigeHtml}</div>
            </div>`;
    }

    function renderBegegnungRow(b) {
        const statusKlasse = b.status === 'beendet' ? 'beendet' : (b.status === 'gestartet' ? 'gestartet' : '');
        const m1Name = b.mannschaft1_bezeichnung ? `${b.mannschaft1_bezeichnung} (${b.mannschaft1_verein})` : '—';
        const m2Name = b.mannschaft2_bezeichnung ? `${b.mannschaft2_bezeichnung} (${b.mannschaft2_verein})` : '—';
        const siegerLabel = b.sieger_mannschaft_id
            ? (b.sieger_mannschaft_id === b.mannschaft1_id ? b.mannschaft1_bezeichnung : b.mannschaft2_bezeichnung)
            : null;
        return `
            <div class="begegnung-row">
                <span class="begegnung-status-badge ${statusKlasse}">${escapeHtml(b.status)}</span>
                <span class="begegnung-teams">${escapeHtml(m1Name)} vs. ${escapeHtml(m2Name)}</span>
                <span class="begegnung-score">${b.siegpunkte_mannschaft1}:${b.siegpunkte_mannschaft2}</span>
                ${siegerLabel ? `<span class="begegnung-sieger">Sieger: ${escapeHtml(siegerLabel)}</span>` : ''}
                ${b.stichkampf_gewichtsklasse ? `<span class="begegnung-stichkampf">Stichkampf: ${escapeHtml(b.stichkampf_gewichtsklasse)}</span>` : ''}
            </div>`;
    }

    // --- EVENT-BINDUNG ---
    function bindeEvents() {
        container.querySelectorAll('.add-team-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('teamPoolId').value = btn.dataset.poolId;
                document.getElementById('teamForm').reset();
                openModal('teamModal');
            });
        });

        // Manueller Bestätigungsschritt "kaempfe_beendet" -> "abgeschlossen" (Tischbestätigung),
        // analog zum confirmFightplanBtn bei Einzelwettkampf-Pools in pools.js — derselbe generische
        // Endpunkt, hier nur bislang ohne UI-Auslöser für Mannschafts-Pools.
        container.querySelectorAll('.confirm-pool-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await confirmDialog(
                    'Ergebnisse dieses Mannschafts-Pools als final bestätigen?',
                    'Pool abschließen',
                    'fact_check'
                );
                if (!ok) return;
                try {
                    const res = await fetch(`/api/pools/${btn.dataset.poolId}/abschliessen`, { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Abschließen.');
                    notify('Pool erfolgreich abgeschlossen.');
                    ladeUndRendere();
                    if (window.hajimeAktualisiereMenueSperren) {
                        window.hajimeAktualisiereMenueSperren(['mannschaften']);
                    }
                    window.hajimeUrkunden?.bieteUrkundenNachAbschlussAn(turnierId, btn.dataset.poolId, btn.dataset.poolName);
                } catch (e) { notify(e.message, 'error'); }
            });
        });

        container.querySelectorAll('.delete-pool-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await confirmDialog('Diesen Mannschafts-Pool inkl. aller Begegnungen löschen? Die Mannschaften selbst bleiben erhalten (werden dem Pool entzogen).', 'Pool löschen', 'delete');
                if (!ok) return;
                try {
                    const res = await fetch(`/api/pools/${btn.dataset.poolId}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Löschen.');
                    notify('Pool gelöscht.');
                    ladeUndRendere();
                } catch (e) { notify(e.message, 'error'); }
            });
        });

        container.querySelectorAll('.remove-mitglied-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await confirmDialog('Dieses Mitglied aus der Mannschaft entfernen?', 'Mitglied entfernen', 'delete');
                if (!ok) return;
                try {
                    const res = await fetch(`/api/mannschaften/${btn.dataset.teamId}/mitglieder/${btn.dataset.mitgliedId}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Entfernen.');
                    notify('Mitglied entfernt.');
                    ladeUndRendere();
                } catch (e) { notify(e.message, 'error'); }
            });
        });

        container.querySelectorAll('.delete-team-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await confirmDialog('Diese Mannschaft komplett löschen (inkl. Roster-Zuordnungen)?', 'Mannschaft löschen', 'delete');
                if (!ok) return;
                try {
                    const res = await fetch(`/api/mannschaften/${btn.dataset.teamId}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Löschen.');
                    notify('Mannschaft gelöscht.');
                    ladeUndRendere();
                } catch (e) { notify(e.message, 'error'); }
            });
        });

        // Weist eine noch keinem Pool zugeordnete Mannschaft (siehe renderNichtZugeordneteSektion,
        // z.B. aus dem Teilnehmer-Import) nachträglich einem bestehenden Mannschafts-Pool zu.
        container.querySelectorAll('.assign-pool-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const select = container.querySelector(`.unassigned-pool-select[data-team-id="${btn.dataset.teamId}"]`);
                const poolId = select ? select.value : '';
                if (!poolId) { notify('Bitte zuerst einen Pool auswählen.', 'error'); return; }

                try {
                    const res = await fetch(`/api/mannschaften/${btn.dataset.teamId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pool_id: poolId })
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Zuweisen.');
                    notify('Mannschaft dem Pool zugewiesen.');
                    ladeUndRendere();
                } catch (e) { notify(e.message, 'error'); }
            });
        });

        bindeDragAndDrop();
    }

    // Merkt sich während eines Zieh-Vorgangs die Daten des gezogenen Judoka (Gewicht/Herkunfts-
    // Team/Mitglieds-ID) — dataTransfer.getData() ist während "dragover" in manchen Browsern nicht
    // zuverlässig lesbar, daher hier zwischengespeichert statt jedes Mal daraus zu lesen.
    let gezogenesMitglied = null;

    // Eine "-X"-Position ist nur gültig, wenn sie das Gewicht noch aufnimmt (Gewicht <= X); die
    // "+X"-Schwergewichts-Position ist immer groß genug — identische Regel wie serverseitig in
    // verschiebeMitglied() (mannschaftController.js).
    function istZielGewichtsklasseGueltig(gk, gewicht) {
        if (!gk) return false;
        if (gk.startsWith('+')) return true;
        const grenze = parseFloat(gk.replace('-', ''));
        if (Number.isNaN(grenze)) return true;
        return gewicht <= grenze;
    }

    function bindeDragAndDrop() {
        container.querySelectorAll('.roster-chip[draggable="true"]').forEach(chip => {
            chip.addEventListener('dragstart', (e) => {
                gezogenesMitglied = {
                    mitgliedId: chip.dataset.mitgliedId,
                    teamId: chip.dataset.teamId,
                    gewicht: parseFloat(chip.dataset.gewicht) || 0
                };
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', chip.dataset.mitgliedId); } catch (err) { /* Safari benötigt setData trotzdem */ }
            });
            chip.addEventListener('dragend', () => {
                gezogenesMitglied = null;
                container.querySelectorAll('.roster-dnd-body').forEach(z => z.classList.remove('drag-over-valid', 'drag-over-invalid'));
            });
        });

        container.querySelectorAll('.roster-dnd-body[data-drop-zone="true"]').forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!gezogenesMitglied) return;
                const gueltig = istZielGewichtsklasseGueltig(zone.dataset.gk, gezogenesMitglied.gewicht);
                zone.classList.toggle('drag-over-valid', gueltig);
                zone.classList.toggle('drag-over-invalid', !gueltig);
                e.dataTransfer.dropEffect = gueltig ? 'move' : 'none';
            });
            zone.addEventListener('dragleave', () => {
                zone.classList.remove('drag-over-valid', 'drag-over-invalid');
            });
            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over-valid', 'drag-over-invalid');
                if (!gezogenesMitglied) return;

                const zielGk = zone.dataset.gk;
                const { mitgliedId, teamId, gewicht } = gezogenesMitglied;
                gezogenesMitglied = null;

                // Nur innerhalb derselben Mannschaft verschieben — Roster-Gruppen sind pro Team
                // gerendert, ein teamübergreifendes Ziehen wäre ein Wechsel der Mannschaft, nicht
                // nur der Gewichtsklassen-Position (dafür gibt es "Zuweisen"/Mitglied entfernen).
                if (zone.dataset.teamId !== teamId) {
                    notify('Ein Judoka kann nur innerhalb derselben Mannschaft zwischen Gewichtsklassen verschoben werden.', 'error');
                    return;
                }

                if (!istZielGewichtsklasseGueltig(zielGk, gewicht)) {
                    notify(`Die Gewichtsklasse ${formatiereGewichtsklasse(zielGk)} ist kleiner als das Gewicht (${gewicht} kg).`, 'error');
                    return;
                }

                try {
                    const res = await fetch(`/api/mannschaften/${teamId}/mitglieder/${mitgliedId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ gewichtsklasse: zielGk })
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error || 'Verschieben fehlgeschlagen.');
                    ladeUndRendere();
                } catch (err) { notify(err.message, 'error'); }
            });
        });
    }

    // --- AUTOMATISCH VERTEILEN (Pools nach Altersklasse+Geschlecht anlegen und zuordnen) ---
    const autoVerteilenBtn = document.getElementById('autoVerteilenBtn');
    if (autoVerteilenBtn) {
        autoVerteilenBtn.addEventListener('click', async () => {
            const ok = await confirmDialog(
                'Für alle noch keinem Pool zugeordneten Mannschaften werden passende Mannschafts-Pools nach Altersklasse und Geschlecht angelegt (sofern noch nicht vorhanden) und die Mannschaften diesen zugeordnet. Fortfahren?',
                'Automatisch verteilen',
                'auto_awesome'
            );
            if (!ok) return;

            try {
                if (window.zeigeLadeModal) window.zeigeLadeModal('Mannschaften werden verteilt…');

                const res = await fetch('/api/mannschaften/auto-verteilen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ turnier_id: turnierId })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Fehler bei der automatischen Verteilung.');

                let meldung = `${data.poolsErstellt} Pool(s) angelegt, ${data.mannschaftenZugeordnet} Mannschaft(en) zugeordnet.`;
                if (data.uebersprungen && data.uebersprungen.length > 0) {
                    meldung += ` ${data.uebersprungen.length} übersprungen (keine Mitglieder).`;
                }
                notify(meldung);
                ladeUndRendere();
            } catch (e) {
                notify(e.message, 'error');
            } finally {
                if (window.versteckeLadeModal) window.versteckeLadeModal();
            }
        });
    }

    // --- ALLE MANNSCHAFTS-POOLS LÖSCHEN ---
    const alleLoeschenBtn = document.getElementById('alleLoeschenBtn');
    if (alleLoeschenBtn) {
        alleLoeschenBtn.addEventListener('click', async () => {
            const ok = await confirmDialog(
                'Alle Mannschafts-Pools dieses Turniers inkl. aller Begegnungen löschen? Die Mannschaften selbst bleiben erhalten (werden nur von ihrem Pool entzogen).',
                'Alle Pools löschen',
                'delete_sweep'
            );
            if (!ok) return;

            try {
                const res = await fetch('/api/mannschaften/pools/alle-loeschen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ turnier_id: turnierId })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Löschen.');
                notify(`${data.geloescht} Pool(s) gelöscht.`);
                ladeUndRendere();
            } catch (e) { notify(e.message, 'error'); }
        });
    }

    // --- POOL-MODAL ---
    document.getElementById('neuerPoolBtn').addEventListener('click', () => {
        document.getElementById('poolForm').reset();
        befuelleAltersklassenSelect();
        openModal('poolModal');
    });
    document.getElementById('poolModalClose').addEventListener('click', () => closeModal('poolModal'));
    document.getElementById('poolModalCancel').addEventListener('click', () => closeModal('poolModal'));
    document.getElementById('poolGeschlecht').addEventListener('change', befuelleAltersklassenSelect);
    document.getElementById('poolAltersklasse').addEventListener('change', aktualisiereGewichtsklassenVorschlag);

    document.getElementById('poolForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const gewichtsklassen = document.getElementById('poolGewichtsklassen').value
            .split(',').map(s => s.trim()).filter(Boolean);

        try {
            const res = await fetch('/api/pools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    turnier_id: turnierId,
                    bezeichnung: document.getElementById('poolBezeichnung').value,
                    geschlecht: document.getElementById('poolGeschlecht').value,
                    altersklasse: document.getElementById('poolAltersklasse').value,
                    modus: document.getElementById('poolModus').value,
                    kampfzeit_sekunden: document.getElementById('poolKampfzeit').value,
                    typ: 'mannschaft',
                    mannschafts_gewichtsklassen: gewichtsklassen
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Anlegen.');
            notify('Mannschafts-Pool angelegt.');
            closeModal('poolModal');
            ladeUndRendere();
        } catch (err) { notify(err.message, 'error'); }
    });

    // --- TEAM-MODAL ---
    document.getElementById('teamModalClose').addEventListener('click', () => closeModal('teamModal'));
    document.getElementById('teamModalCancel').addEventListener('click', () => closeModal('teamModal'));
    document.getElementById('teamForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const res = await fetch('/api/mannschaften', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    turnier_id: turnierId,
                    pool_id: document.getElementById('teamPoolId').value,
                    verein: document.getElementById('teamVerein').value,
                    bezeichnung: document.getElementById('teamBezeichnung').value
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Anlegen.');
            notify('Mannschaft angelegt.');
            closeModal('teamModal');
            ladeUndRendere();
        } catch (err) { notify(err.message, 'error'); }
    });

    // --- INIT ---
    (async () => {
        await Promise.all([ladeDjbKlassen(), ladeTurnierMannschaftAltersklassen()]);
        await ladeUndRendere();
    })();
});
