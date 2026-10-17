// Zeitplan-Simulation (zeitplan.html): rechnet aus Beginn und Ø Kampfzeit je Altersklasse, wann die Pools
// auf den Matten ungefähr fertig sind. Rein lesend, siehe src/shared/zeitPrognose.js (simuliereZeitplan).
(function () {
    const turnierId = new URLSearchParams(window.location.search).get('turnierId') || localStorage.getItem('aktiveTurnierId');
    const klassenEl = document.getElementById('zeitplanKlassen');
    const meldungEl = document.getElementById('zeitplanMeldung');
    const ergebnisEl = document.getElementById('zeitplanErgebnis');
    const beginnEl = document.getElementById('zeitplanBeginn');
    const knopf = document.getElementById('zeitplanSimulieren');

    function escapeHtml(text) {
        return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function uhrzeit(ms, beginnMs) {
        const text = new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const tage = Math.floor((new Date(ms).setHours(0, 0, 0, 0) - new Date(beginnMs).setHours(0, 0, 0, 0)) / 86400000);
        return tage > 0 ? `${text} (+${tage} Tag)` : text;
    }

    // Eingabefelder je Altersklasse der auf Matten verteilten Pools, vorbelegt mit der Pool-Kampfzeit.
    async function ladeKlassen() {
        if (!turnierId) { meldungEl.textContent = 'Kein Turnier gewählt.'; return; }
        const resp = await fetch(`/api/pools/kampfflaechen?turnierId=${encodeURIComponent(turnierId)}`);
        const daten = await resp.json();
        if (!resp.ok) { meldungEl.textContent = daten.error || 'Daten konnten nicht geladen werden.'; return; }
        const aufMatte = (daten.pools || []).filter(p => p.kampflaeche_id);
        const ohneMatte = (daten.pools || []).filter(p => !p.kampflaeche_id).length;
        const klassen = new Map();
        for (const p of aufMatte) if (!klassen.has(p.altersklasse)) klassen.set(p.altersklasse, p.kampfzeit_sekunden || 240);
        klassenEl.innerHTML = [...klassen].map(([klasse, sek]) => `
            <label class="zeitplan-feld">
                <span>${escapeHtml(klasse)}: Ø Kampfzeit (Sek.)</span>
                <input type="number" min="10" step="10" data-altersklasse="${escapeHtml(klasse)}" value="${sek}">
            </label>`).join('');
        if (aufMatte.length === 0) {
            meldungEl.textContent = 'Es sind noch keine Pools auf Matten verteilt. Bitte zuerst Pools bilden und auf Matten verteilen.';
            knopf.disabled = true;
        } else if (ohneMatte > 0) {
            meldungEl.textContent = `${ohneMatte} Pool(s) ohne Matte sind nicht in der Simulation enthalten.`;
        }
    }

    async function simuliere() {
        meldungEl.textContent = '';
        const [h, m] = (beginnEl.value || '09:00').split(':').map(Number);
        const beginn = new Date();
        beginn.setHours(h, m, 0, 0);
        const kampfzeitJeAltersklasse = {};
        klassenEl.querySelectorAll('input[data-altersklasse]').forEach(i => {
            const wert = Number(i.value);
            if (wert > 0) kampfzeitJeAltersklasse[i.dataset.altersklasse] = wert;
        });
        const resp = await fetch('/api/pools/zeitplan-simulation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turnierId, beginn: beginn.toISOString(), kampfzeitJeAltersklasse })
        });
        const daten = await resp.json();
        if (!resp.ok) { meldungEl.textContent = daten.error || 'Simulation fehlgeschlagen.'; return; }
        const beginnMs = beginn.getTime();
        ergebnisEl.innerHTML = daten.matten.map(matte => `
            <div class="zeitplan-matte" data-matte-id="${matte.matteId}">
                <h2>${escapeHtml(matte.bezeichnung)}</h2>
                <table class="zeitplan-tabelle">
                    <tbody>
                        ${matte.pools.map(p => `<tr class="zeitplan-pool"><td>${escapeHtml(p.bezeichnung)}</td><td>${p.kaempfe} Kämpfe</td><td class="zeitplan-ende">ca. ${uhrzeit(p.endeMs, beginnMs)}</td></tr>`).join('')}
                        <tr class="zeitplan-gesamt"><td colspan="2">Ende der Matte</td><td class="zeitplan-ende zeitplan-matten-ende">ca. ${uhrzeit(matte.endeMs, beginnMs)}</td></tr>
                    </tbody>
                </table>
            </div>`).join('');
    }

    knopf.addEventListener('click', simuliere);
    ladeKlassen();
})();
