// public/js/uebersicht.js

const escapeHtml = (str) => {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// Klassische Material-Icons kennen keine "counter_N"-Glyphen — die kreisförmigen Ziffern-Icons
// heißen dort "filter_1".."filter_9". Ab der 10. Matte gibt es kein Zahlen-Icon mehr, daher Fallback.
const MATTEN_ICON_FALLBACK = 'sports_martial_arts';
function mattenIcon(position) {
    return position >= 1 && position <= 9 ? `filter_${position}` : MATTEN_ICON_FALLBACK;
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    let turnierId = params.get('turnierId') || params.get('id') || localStorage.getItem('aktiveTurnierId');

    if (params.get('turnierId') || params.get('id')) {
        localStorage.setItem('aktiveTurnierId', turnierId);
    }

    const hinweisContainer = document.getElementById('hinweisContainer');
    const matsGrid = document.getElementById('matsGrid');
    const unassignedSection = document.getElementById('unassignedSection');
    const unassignedGrid = document.getElementById('unassignedGrid');

    if (!turnierId) {
        hinweisContainer.innerHTML = `<div class="hinweis-box">Kein Turnier ausgewählt. Bitte die Seite mit <code>?turnierId=&lt;ID&gt;</code> in der URL aufrufen.</div>`;
        return;
    }

    function poolBlockHtml(pool) {
        const teilnehmerHtml = pool.teilnehmer.length === 0
            ? `<li class="pool-leer">Keine Teilnehmer</li>`
            : pool.teilnehmer.map(t => `
                <li class="teilnehmer-row">
                    <span class="teilnehmer-name">${escapeHtml(t.nachname)}, ${escapeHtml(t.vorname)}</span>
                    <span class="teilnehmer-verein">${escapeHtml(t.verein || '')}</span>
                </li>
            `).join('');

        return `
            <div class="pool-block">
                <div class="pool-block-header">${escapeHtml(pool.bezeichnung)}</div>
                <ul class="teilnehmer-liste">${teilnehmerHtml}</ul>
            </div>
        `;
    }

    function matCardHtml(mat, position) {
        const poolsHtml = mat.pools.length === 0
            ? `<div class="empty-text">Noch keine Pools zugeordnet.</div>`
            : `<div class="mat-pools-grid">${mat.pools.map(poolBlockHtml).join('')}</div>`;

        return `
            <div class="mat-card">
                <div class="mat-header">
                    <span class="material-icons">${mattenIcon(position)}</span>
                    <span class="mat-name">${escapeHtml(mat.bezeichnung)}</span>
                </div>
                ${poolsHtml}
            </div>
        `;
    }

    async function ladeUebersicht() {
        try {
            const response = await fetch(`/api/pools/uebersicht?turnierId=${encodeURIComponent(turnierId)}&_t=${Date.now()}`);
            if (!response.ok) throw new Error('Fehler beim Laden der Übersicht.');
            const data = await response.json();

            hinweisContainer.innerHTML = '';

            if (!data.mats || data.mats.length === 0) {
                matsGrid.innerHTML = `<div class="empty-text">Keine Wettkampfflächen für dieses Turnier konfiguriert.</div>`;
            } else {
                matsGrid.innerHTML = data.mats.map((mat, i) => matCardHtml(mat, i + 1)).join('');
            }

            if (data.unzugeordnetePools && data.unzugeordnetePools.length > 0) {
                unassignedSection.style.display = 'block';
                unassignedGrid.innerHTML = data.unzugeordnetePools.map(poolBlockHtml).join('');
            } else {
                unassignedSection.style.display = 'none';
                unassignedGrid.innerHTML = '';
            }
        } catch (err) {
            console.error('[Uebersicht Error]:', err);
            hinweisContainer.innerHTML = `<div class="hinweis-box">Fehler beim Laden: ${escapeHtml(err.message)}</div>`;
        }
    }

    ladeUebersicht();
    setInterval(ladeUebersicht, 15000);
});
