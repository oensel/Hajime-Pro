// Menü und Ausklapp-Panels der Steuerung (steuerung.html). Reine Oberfläche: die Scoreboard-Logik
// (scoreboard.js, video.js, durchsage.js) greift weiter über dieselben Element-IDs zu und bleibt unberührt.
(function () {
    const einzeln = (s) => document.querySelector(s);
    const alle = (s) => Array.from(document.querySelectorAll(s));
    const drawer = einzeln('#stDrawer');
    const scrim = einzeln('#stScrim');
    let aktuell = null;

    function schliesse() {
        aktuell = null;
        drawer.classList.remove('aktiv');
        scrim.classList.remove('aktiv');
        drawer.setAttribute('aria-hidden', 'true');
        alle('.st-nav-btn').forEach((b) => b.classList.remove('aktiv'));
    }

    function oeffne(name) {
        if (aktuell === name) return schliesse();
        const panel = einzeln(`.st-panel[data-st-panel="${name}"]`);
        if (!panel) return;
        aktuell = name;
        alle('.st-panel').forEach((p) => p.classList.toggle('aktiv', p === panel));
        einzeln('#stDrawerTitel').textContent = panel.dataset.stTitel;
        drawer.classList.toggle('breit', name === 'pool');
        alle('.st-nav-btn').forEach((b) => b.classList.toggle('aktiv', b.dataset.stOeffne === name));
        drawer.classList.add('aktiv');
        scrim.classList.add('aktiv');
        drawer.setAttribute('aria-hidden', 'false');
    }

    alle('[data-st-oeffne]').forEach((b) => b.addEventListener('click', () => oeffne(b.dataset.stOeffne)));
    einzeln('#stDrawerZu').addEventListener('click', schliesse);
    scrim.addEventListener('click', schliesse);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !aktuell) return;
        // Offene Dialoge (Ergebnis korrigieren, Hantei) haben Vorrang
        const dialogOffen = ['steuerungResultModal', 'hanteiDecisionModal'].some((id) => {
            const m = document.getElementById(id);
            return m && m.style.display !== 'none';
        });
        if (!dialogOffen) schliesse();
    });

    // Kopfleiste: Matte, Pool, Kampfzeit aus den Einstellungsfeldern (werden vom Scoreboard programmatisch gesetzt)
    function aktualisiereKopf() {
        const mat = document.getElementById('matSelect');
        const pool = document.getElementById('poolName');
        const zeit = document.getElementById('matchDuration');
        const matText = mat && mat.selectedOptions[0] ? mat.selectedOptions[0].textContent.trim().replace(/^Matte\s*/i, '') : '';
        einzeln('#stChipMatte').textContent = matText || '–';
        einzeln('#stChipPool').textContent = (pool && pool.value.trim()) || '–';
        einzeln('#stChipZeit').textContent = zeit && zeit.selectedOptions[0] ? zeit.selectedOptions[0].textContent : '–';
        const rec = document.getElementById('videoAktiv');
        einzeln('#stBadgeVideo').hidden = !(rec && rec.checked);
    }
    setInterval(aktualisiereKopf, 1000);
    aktualisiereKopf();

    // Pools in Prüfung (meldet scoreboard.js): Zähler am Menüpunkt "Pool"
    window.addEventListener('hajime:pool-pruefung', (e) => {
        const n = (e.detail && e.detail.anzahl) || 0;
        const badge = einzeln('#stBadgePool');
        badge.hidden = n === 0;
        badge.textContent = String(n);
    });

    // Kommende Kämpfe: Streifen unter der Steuerung + Zähler am Menüpunkt (liest die gerenderte Liste)
    const liste = document.getElementById('steuerungUpcomingList');
    function aktualisiereNaechste() {
        const zeilen = liste ? Array.from(liste.children).filter((z) => z.querySelector('.st-k-pool')) : [];
        const badge = einzeln('#stBadgeKaempfe');
        badge.hidden = zeilen.length === 0;
        badge.textContent = String(zeilen.length);
        const box = einzeln('#stNextItems');
        box.textContent = '';
        zeilen.slice(0, 3).forEach((z) => {
            const el = document.createElement('div');
            el.className = 'st-nx';
            // Klasse (Pool) groß, darüber kleine Nummer und ggf. Pool-Start-Badge, darunter die Paarung
            const kopf = document.createElement('small');
            kopf.textContent = z.querySelector('.st-k-nr').textContent;
            if (z.dataset.poolStart === '1') {
                const marke = document.createElement('span');
                marke.className = 'st-poolstart';
                marke.textContent = 'Pool-Start';
                kopf.append(' ', marke);
            }
            const klasse = document.createElement('div');
            klasse.className = 'st-nx-klasse';
            // Der Pool-Name der Liste enthält das Badge als Kindelement: nur den eigenen Text nehmen
            klasse.textContent = Array.from(z.querySelector('.st-k-pool').childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
            const namen = document.createElement('span');
            namen.className = 'st-nx-namen';
            namen.textContent = z.querySelector('.st-k-namen').textContent;
            el.append(kopf, klasse, namen);
            el.addEventListener('click', () => oeffne('kaempfe'));
            box.appendChild(el);
        });
        einzeln('#stNext').hidden = zeilen.length === 0;
    }
    if (liste) {
        new MutationObserver(aktualisiereNaechste).observe(liste, { childList: true });
        aktualisiereNaechste();
    }
})();
