// Startseite eines Client-Geräts (client.html): zeigt das Turnier, verlinkt Waage/Scoreboard/
// Mattenleitung (mit Turnier- und Matten-Parametern) und lässt die Matte dieses Geräts wählen.
// Die Mattenwahl wird auf dem Gerät gespeichert (/api/sync/client/matte) und gilt für Scoreboard
// und Mattenleitung; ein Wechsel im Betrieb fragt vorher nach.
document.addEventListener('DOMContentLoaded', async () => {
    const turnierText = document.getElementById('clientTurnier');
    const matteSelect = document.getElementById('clientMatteSelect');

    let turnier = null;
    try {
        const turniere = await fetch('/api/turniere').then(r => (r.ok ? r.json() : []));
        turnier = turniere[0] || null;
    } catch (e) {
        turnier = null;
    }
    if (!turnier) {
        turnierText.textContent = 'Noch keine Turnierdaten — bitte einmal mit dem Hallen-Server verbinden.';
        return;
    }
    turnierText.textContent = `${turnier.bezeichnung} (${turnier.datum || ''})`;
    localStorage.setItem('aktiveTurnierId', turnier.id);

    const matten = await fetch(`/api/kampfflaechen?turnierId=${turnier.id}`).then(r => r.json());
    for (const matte of matten) {
        const opt = document.createElement('option');
        opt.value = matte.id;
        opt.textContent = matte.bezeichnung;
        matteSelect.appendChild(opt);
    }

    const setzeLinks = (matteId) => {
        document.getElementById('linkWaage').href = `/teilnehmer.html?turnierId=${turnier.id}`;
        document.getElementById('linkScoreboard').href = `/steuerung.html?turnierId=${turnier.id}${matteId ? `&matId=${matteId}` : ''}`;
        document.getElementById('linkMattenleitung').href = `/kampf.html?turnierId=${turnier.id}`;
    };

    const aktuell = await fetch('/api/sync/client/matte').then(r => (r.ok ? r.json() : {})).catch(() => ({}));
    if (aktuell.matte_id) matteSelect.value = String(aktuell.matte_id);
    setzeLinks(aktuell.matte_id);

    matteSelect.addEventListener('change', async () => {
        const gewaehlt = matteSelect.value;
        const ergebnis = await window.wechsleClientMatte(gewaehlt, aktuell.matte_id);
        if (ergebnis) {
            aktuell.matte_id = Number(gewaehlt);
        } else {
            matteSelect.value = aktuell.matte_id ? String(aktuell.matte_id) : '';
        }
        setzeLinks(aktuell.matte_id);
    });
});
