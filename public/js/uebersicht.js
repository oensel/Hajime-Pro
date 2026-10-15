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
    const mannschaftenSection = document.getElementById('mannschaftenSection');
    const mannschaftenGrid = document.getElementById('mannschaftenGrid');

    if (!turnierId) {
        hinweisContainer.innerHTML = `<div class="hinweis-box">Kein Turnier ausgewählt. Bitte die Seite mit <code>?turnierId=&lt;ID&gt;</code> in der URL aufrufen.</div>`;
        return;
    }

    function mannschaftsPoolBlockHtml(pool, mattenNamen = []) {
        const teams = (pool.mannschaften || []).length === 0
            ? `<li class="pool-leer">Keine Mannschaften</li>`
            : pool.mannschaften.map(team => `
                <li class="mannschaft-uebersicht">
                    <div class="teilnehmer-row">
                        <span class="teilnehmer-name"><strong>${escapeHtml(team.bezeichnung)}</strong></span>
                        <span class="teilnehmer-verein">${escapeHtml(team.verein || '')}</span>
                    </div>
                    ${team.mitglieder.length === 0
                        ? '<div class="pool-leer">Keine Kämpfer zugeordnet</div>'
                        : team.mitglieder.map(m => `
                    <div class="teilnehmer-row">
                        <span class="teilnehmer-name">${escapeHtml(m.nachname)}, ${escapeHtml(m.vorname)}</span>
                        <span class="teilnehmer-verein">${escapeHtml(m.gewichtsklasse ? `${m.gewichtsklasse}kg` : '')}</span>
                    </div>`).join('')}
                </li>`).join('');
        return `
            <div class="pool-block">
                <div class="pool-block-header">${escapeHtml(pool.bezeichnung)}${mattenNamen.length ? ` <span style="font-weight: 600; opacity: 0.75;">· ${escapeHtml(mattenNamen.join(', '))}</span>` : ''}</div>
                <ul class="teilnehmer-liste">${teams}</ul>
            </div>
        `;
    }

    // Mannschaften je Alters-/Geschlechtsklasse in einem Container über die ganze Breite; die Teams
    // aller Pools dieser Klasse stehen darin nebeneinander.
    function teamKarteHtml(team) {
        const mitglieder = team.mitglieder.length === 0
            ? `<div class="pool-leer">Keine Kämpfer zugeordnet</div>`
            : team.mitglieder.map(m => `
                <div class="teilnehmer-row">
                    <span class="teilnehmer-name">${escapeHtml(m.nachname)}, ${escapeHtml(m.vorname)}</span>
                    <span class="teilnehmer-verein">${escapeHtml(m.gewichtsklasse ? `${m.gewichtsklasse}kg` : '')}</span>
                </div>`).join('');
        return `
            <div class="team-card">
                <div class="team-head"><strong>${escapeHtml(team.bezeichnung)}</strong><span>${escapeHtml(team.verein || '')}</span></div>
                ${mitglieder}
            </div>`;
    }

    const altersklasseRang = (ak) => {
        const m = String(ak || '').match(/\d+/);
        return m ? parseInt(m[0], 10) : 999;
    };
    const geschlechtRang = (g) => ({ weiblich: 0, männlich: 1, mixed: 2 }[String(g).toLowerCase()] ?? 3);
    const geschlechtLabel = (g) => (String(g).toLowerCase() === 'mixed' ? 'mixed' : g);

    function mannschaftsKlassenHtml(pools, mattenNamenVon) {
        const klassen = new Map();
        for (const pool of pools) {
            const key = `${pool.altersklasse}|${pool.geschlecht}`;
            if (!klassen.has(key)) klassen.set(key, { altersklasse: pool.altersklasse, geschlecht: pool.geschlecht, pools: [] });
            klassen.get(key).pools.push(pool);
        }
        return [...klassen.values()]
            .sort((a, b) => altersklasseRang(a.altersklasse) - altersklasseRang(b.altersklasse)
                || geschlechtRang(a.geschlecht) - geschlechtRang(b.geschlecht))
            .map(k => {
                const teams = k.pools.flatMap(p => p.mannschaften || []);
                const systeme = [...new Set(k.pools.map(p => String(p.modus || '').replace('Jeder-gegen-Jeden', 'Jeder gegen Jeden').replace(/-/g, ' ')))].filter(Boolean);
                const matten = [...new Set(k.pools.flatMap(p => mattenNamenVon(p)))];
                const info = [`${teams.length} ${teams.length === 1 ? 'Team' : 'Teams'}`, ...systeme, matten.join(', ')].filter(Boolean).join(' · ');
                return `
                    <section class="klassen-container">
                        <div class="klassen-header">
                            <span class="material-icons">groups_2</span>
                            <span class="klassen-titel">${escapeHtml(k.altersklasse)} ${escapeHtml(geschlechtLabel(k.geschlecht))}</span>
                            <span class="klassen-info">${escapeHtml(info)}</span>
                        </div>
                        ${teams.length === 0
                            ? '<div class="pool-leer">Keine Mannschaften</div>'
                            : `<div class="team-grid">${teams.map(teamKarteHtml).join('')}</div>`}
                    </section>`;
            }).join('');
    }

    function poolBlockHtml(pool) {
        if (pool.typ === 'mannschaft') return mannschaftsPoolBlockHtml(pool);
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

            // Mannschafts-Pools stehen gesondert unter "Mannschaften", nicht auf den Matten.
            const mannschaftsPools = new Map();
            const mattenNamen = new Map((data.mats || []).map(m => [m.id, m.bezeichnung]));
            const ohneMannschaften = (pools) => (pools || []).filter(p => {
                if (p.typ !== 'mannschaft') return true;
                mannschaftsPools.set(p.id, p);
                return false;
            });
            const mats = (data.mats || []).map(m => ({ ...m, pools: ohneMannschaften(m.pools) }));
            const unzugeordnet = ohneMannschaften(data.unzugeordnetePools);

            if (mats.length === 0) {
                matsGrid.innerHTML = `<div class="empty-text">Keine Wettkampfflächen für dieses Turnier konfiguriert.</div>`;
            } else {
                matsGrid.innerHTML = mats.map((mat, i) => matCardHtml(mat, i + 1)).join('');
            }

            if (mannschaftsPools.size > 0) {
                mannschaftenSection.style.display = 'block';
                mannschaftenGrid.innerHTML = mannschaftsKlassenHtml([...mannschaftsPools.values()], (pool) => {
                    const matteIds = new Set([pool.kampfflaeche_id, ...(pool.matten_ids || [])].filter(id => id != null));
                    return [...matteIds].map(id => mattenNamen.get(id)).filter(Boolean);
                });
            } else {
                mannschaftenSection.style.display = 'none';
                mannschaftenGrid.innerHTML = '';
            }

            if (unzugeordnet.length > 0) {
                unassignedSection.style.display = 'block';
                unassignedGrid.innerHTML = unzugeordnet.map(poolBlockHtml).join('');
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
