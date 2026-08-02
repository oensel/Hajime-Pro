// public/js/dashboard.js

const escapeHtml = (str) => {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

let renderedFights = {};

async function zeigeTurnierAuswahlModal() {
    if (document.getElementById('turnierAuswahlModal')) return;

    try {
        const response = await fetch('/api/turniere');
        if (!response.ok) throw new Error('Fehler beim Laden der Turniere.');
        const turniere = await response.json();

        if (turniere.length === 0) {
            alert('Keine aktiven Turniere in der Datenbank vorhanden.');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'turnierAuswahlModal';
        modal.style = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(17, 24, 39, 0.95);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        `;

        let selectOptions = turniere.map(t => `<option value="${t.id}">${escapeHtml(t.bezeichnung)} (${t.ort || ''})</option>`).join('');

        modal.innerHTML = `
            <div style="background: #1f2937; border: 2px solid #374151; border-radius: 8px; padding: 32px; width: 90%; max-width: 450px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); color: #f3f4f6;">
                <div style="font-size: 40px; color: #ff9800; margin-bottom: 16px;">🏆</div>
                <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Turnier auswählen</h2>
                <p style="margin: 0 0 24px 0; font-size: 13px; color: #9ca3af; font-weight: 600;">Bitte wählen Sie das Turnier für das Live-Dashboard aus:</p>
                
                <form id="turnierAuswahlForm" style="display: flex; flex-direction: column; gap: 16px;">
                    <select id="turnierAuswahlSelect" style="padding: 10px 14px; border: 1px solid #4b5563; border-radius: 4px; background: #111827; color: #ffffff; font-size: 14px; font-weight: bold; width: 100%; box-sizing: border-box; outline: none; cursor: pointer;">
                        ${selectOptions}
                    </select>
                    <button type="submit" style="background: #ff9800; color: #ffffff; border: none; padding: 12px; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; transition: background 0.2s;" onmouseover="this.style.background='#e65100'" onmouseout="this.style.background='#ff9800'">Dashboard laden</button>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        const form = document.getElementById('turnierAuswahlForm');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const selectedId = document.getElementById('turnierAuswahlSelect').value;
            localStorage.setItem('aktiveTurnierId', selectedId);
            document.body.removeChild(modal);
            window.location.reload();
        });

    } catch (err) {
        alert('Fehler beim Laden der Turniere: ' + err.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    let turnierId = params.get('turnierId') || localStorage.getItem('aktiveTurnierId');

    if (params.get('turnierId')) {
        localStorage.setItem('aktiveTurnierId', params.get('turnierId'));
    }

    if (!turnierId) {
        zeigeTurnierAuswahlModal();
        return;
    }

    // Live Scoreboard Channel Listener
    const channel = new BroadcastChannel('judo_scoreboard');
    channel.onmessage = (event) => {
        const s = event.data;
        if (!s || !s.matId) return;

        // Falls sich die Kampf-ID geändert hat (neuer Kampf geladen), sofort Dashboard aktualisieren
        if (s.fightId && s.fightId !== renderedFights[s.matId]) {
            loadDashboard();
            return;
        }

        // Dynamische Kampffarbe (Blau oder Rot) im Dashboard für den aktiven Kampf übernehmen
        const matCard = document.querySelector(`[data-mat-id="${s.matId}"]`);
        if (matCard) {
            const fighter2Box = matCard.querySelector('.fighter2-box');
            if (fighter2Box) {
                if (s.fighter2Color === 'rot') {
                    fighter2Box.style.background = '#dc3545'; // Red background
                    fighter2Box.style.borderColor = '#bd2130';
                } else {
                    fighter2Box.style.background = '#007bff'; // Blue background
                    fighter2Box.style.borderColor = '#0056b3';
                }
            }
        }
    };

    async function loadDashboard() {
        try {
            const response = await fetch(`/api/pools/dashboard?turnierId=${turnierId}&_t=${Date.now()}`);
            if (!response.ok) throw new Error('Fehler beim Laden der Dashboard-Daten.');
            const data = await response.json();

            // Rendered Fights Map aktualisieren
            data.mats.forEach(m => {
                renderedFights[m.id] = m.currentFight ? m.currentFight.id : null;
            });

            renderMats(data.mats);
            renderUnassigned(data.unassignedPools);

            // Den aktuellen Zustand der Steuerung abfragen, um Farbe und Status sofort zu synchronisieren
            channel.postMessage({ type: 'request_state' });

        } catch (err) {
            console.error('[Dashboard Error]:', err);
        }
    }

    function renderMats(mats) {
        const grid = document.getElementById('matsGrid');
        if (!grid) return;

        if (mats.length === 0) {
            grid.innerHTML = '<div class="empty-text">Keine Wettkampfflächen für dieses Turnier konfiguriert.</div>';
            return;
        }

        grid.innerHTML = mats.map(mat => {
            // Current fight rendering
            let currentFightHtml = '';
            if (mat.currentFight) {
                const f = mat.currentFight;
                const nameW = f.kaempfer1_vorname ? `${f.kaempfer1_vorname} ${f.kaempfer1_nachname}` : 'Freilos';
                const clubW = f.kaempfer1_verein ? ` (${f.kaempfer1_verein})` : '';
                const nameB = f.kaempfer2_vorname ? `${f.kaempfer2_vorname} ${f.kaempfer2_nachname}` : 'Freilos';
                const clubB = f.kaempfer2_verein ? ` (${f.kaempfer2_verein})` : '';

                const isRot = f.fighter2Color === 'rot';
                const f2Bg = isRot ? '#dc3545' : '#007bff';
                const f2Border = isRot ? '#bd2130' : '#0056b3';

                currentFightHtml = `
                    <div class="current-fight-box active">
                        <span class="current-label">Laufender Kampf</span>
                        <div class="current-fight-class">${escapeHtml(f.pool_bezeichnung)}</div>
                        <div class="current-fighters" style="display: flex; flex-direction: row; align-items: center; margin-top: 12px; margin-bottom: 8px; width: 100%;">
                            <!-- Blau / Rot (linksbündig, Name & Verein untereinander, links abgerundet) -->
                            <div class="fighter2-box" style="width: 50%; text-align: left; font-size: 14px; font-weight: 700; color: #ffffff; padding: 10px 14px; background: ${f2Bg}; border: 1.5px solid ${f2Border}; border-radius: 8px 0 0 8px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; display: flex; flex-direction: column; gap: 2px; box-sizing: border-box;">
                                <span>${escapeHtml(nameB)}</span>
                                <span style="font-size: 11px; color: rgba(255,255,255,0.85); font-weight: 600;">${escapeHtml(clubB)}</span>
                            </div>

                            <!-- Weiß (rechtsbündig, Name & Verein untereinander, rechts abgerundet) -->
                            <div style="width: 50%; text-align: right; font-size: 14px; font-weight: 700; color: #1f2937; padding: 10px 14px; background: #ffffff; border: 1.5px solid #d1d5db; border-left: none; border-radius: 0 8px 8px 0; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; display: flex; flex-direction: column; gap: 2px; box-sizing: border-box;">
                                <span>${escapeHtml(nameW)}</span>
                                <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">${escapeHtml(clubW)}</span>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                currentFightHtml = `
                    <div class="current-fight-box">
                        <span class="current-label" style="background-color: var(--border); color: var(--text-muted);">Pause</span>
                        <div style="font-weight: 700; color: var(--text-muted); margin: 8px 0; font-size: 14px;">Kein aktiver Kampf</div>
                    </div>
                `;
            }

            // Next fights rendering
            let nextFightsHtml = '';
            if (mat.nextFights && mat.nextFights.length > 0) {
                nextFightsHtml = mat.nextFights.map((f, idx) => {
                    const nameW = f.kaempfer1_vorname ? `${f.kaempfer1_vorname} ${f.kaempfer1_nachname}` : 'Freilos';
                    const nameB = f.kaempfer2_vorname ? `${f.kaempfer2_vorname} ${f.kaempfer2_nachname}` : 'Freilos';
                    return `
                        <div class="next-fight-row">
                            <div class="next-fight-nr">${idx + 1}</div>
                            <div class="next-fight-details">
                                <span>${escapeHtml(nameW)}</span>
                                <span style="color: var(--text-muted); font-size: 11px; margin: 0 4px;">vs</span>
                                <span>${escapeHtml(nameB)}</span>
                            </div>
                            <div style="font-size: 11px; font-weight: 700; color: var(--text-muted);">${escapeHtml(f.pool_bezeichnung)}</div>
                        </div>
                    `;
                }).join('');
            } else {
                nextFightsHtml = '<div class="empty-text" style="font-size: 12px;">Keine anstehenden Kämpfe</div>';
            }

            // Active pools list & progress rendering
            let poolsHtml = '';
            if (mat.pools && mat.pools.length > 0) {
                poolsHtml = mat.pools.map(p => {
                    let barClass = 'waiting';
                    if (p.status === 'beendet') barClass = 'finished';
                    else if (p.status === 'aktiv') barClass = 'active';

                    const remaining = p.gesamt_kaempfe - p.beendete_kaempfe;
                    return `
                        <div class="pool-progress-item">
                            <div class="pool-progress-header">
                                <span style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 250px;">${escapeHtml(p.bezeichnung)}</span>
                                <span style="color: ${p.status === 'beendet' ? '#2e7d32' : p.status === 'aktiv' ? '#007bff' : 'var(--text-muted)'};">noch ${remaining} Kämpfe</span>
                            </div>
                            <div class="pool-progress-bar-wrapper">
                                <div class="pool-progress-bar ${barClass}" style="width: ${p.progress}%;"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                poolsHtml = '<div class="empty-text" style="font-size: 12px;">Keine Pools zugeordnet</div>';
            }

            return `
                <div class="mat-card" data-mat-id="${mat.id}">
                    <div class="mat-header">
                        <span class="mat-name">${escapeHtml(mat.bezeichnung)}</span>
                        <span class="material-icons" style="color: var(--text-muted);">sports_kabaddi</span>
                    </div>
                    
                    ${currentFightHtml}
                    
                    <div class="next-fights-section">
                        <div class="section-title">Als nächstes (Nächste 3)</div>
                        ${nextFightsHtml}
                    </div>
                    
                    <div class="pools-progress-section">
                        <div class="section-title">Pools & Fortschritt</div>
                        ${poolsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderUnassigned(pools) {
        const list = document.getElementById('unassignedList');
        if (!list) return;

        if (pools.length === 0) {
            list.innerHTML = '<div class="empty-text">Keine weiteren Pools in der Warteschlange.</div>';
            return;
        }

        list.innerHTML = pools.map(p => `
            <div class="unassigned-badge">
                <span class="material-icons">hourglass_bottom</span>
                <span>${escapeHtml(p.bezeichnung)}</span>
            </div>
        `).join('');
    }

    // Initial load
    loadDashboard();

    // Auto-refresh alle 2 Sekunden für reaktionsschnelle Aktualisierung nach Kampfende
    setInterval(loadDashboard, 2000);
});
