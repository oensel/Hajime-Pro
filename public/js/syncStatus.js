// Sync-Statusleiste und Client-Hilfen (CouchDB-Umbau, Spec Abschnitt 4). Klassisches Skript, auf
// den Client-Seiten eingebunden (client.html, steuerung.html, kampf.html, teilnehmer.html).
//  - Client-Gerät: grün "verbunden", gelb "offline – n Änderungen ausstehend", rot bei
//    Replikations-/Konfigurationsfehler, blau während eines Turnierwechsels. Wechselt die
//    Turnier-Instanz, lädt die Seite neu (die alten Daten sind dann verworfen).
//  - Hallen-Server und ohne Sync: keine Leiste (Serverstatus am Icon "Hallen-Server" in menu.js).
//  - window.wechsleClientMatte(neueMatteId, bisherigeMatteId): Mattenwechsel mit Nachfrage.
(function () {
    let letzteInstanz = null;
    let leiste = null;

    function erzeugeLeiste() {
        leiste = document.createElement('div');
        leiste.id = 'syncStatusLeiste';
        leiste.setAttribute('role', 'status');
        leiste.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:10000;padding:6px 12px;border-radius:14px;' +
            'font:600 12px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25);pointer-events:none;';
        document.body.appendChild(leiste);
    }

    function zeige(zustand, text) {
        if (!leiste) erzeugeLeiste();
        const farben = { verbunden: '#2e7d32', offline: '#f9a825', fehler: '#c62828', wechsel: '#1565c0' };
        leiste.style.background = farben[zustand];
        leiste.dataset.zustand = zustand;
        leiste.textContent = text;
    }

    async function aktualisiere() {
        let status;
        try {
            status = await fetch('/api/sync/status', { cache: 'no-store' }).then(r => r.json());
        } catch (e) {
            return;
        }
        if (!status || !status.rolle) return;
        // Hallen-Server: keine Leiste, der Serverstatus steht farbig am Icon "Hallen-Server" (menu.js).
        if (status.rolle === 'server') return;
        if (letzteInstanz && status.instanz_id && status.instanz_id !== letzteInstanz) {
            window.location.reload();
            return;
        }
        if (status.instanz_id) letzteInstanz = status.instanz_id;

        if (status.instanzwechsel_laeuft) zeige('wechsel', 'Turnierwechsel läuft …');
        else if (status.fehler) zeige('fehler', status.update_hinweis ? `${status.fehler} · ${status.update_hinweis}` : status.fehler);
        // Aufgegebenes Selbst-Update des Desktop-Clients: bleibt rot stehen, Verbindungsstatus davor.
        else if (status.update_hinweis) zeige('fehler', `${status.verbunden ? 'verbunden' : 'offline'} · ${status.update_hinweis}`);
        else if (status.verbunden) zeige('verbunden', status.ausstehend ? `verbunden – ${status.ausstehend} werden übertragen` : 'verbunden');
        else zeige('offline', `offline – ${status.ausstehend} Änderung${status.ausstehend === 1 ? '' : 'en'} ausstehend`);
    }

    // Mattenwechsel eines Client-Geräts, im Betrieb mit Nachfrage (ausstehende Änderungen, laufender
    // Kampf, anderer Client auf der Ziel-Matte). Liefert true, wenn gewechselt wurde.
    window.wechsleClientMatte = async function wechsleClientMatte(neueMatteId, bisherigeMatteId) {
        if (!neueMatteId || String(neueMatteId) === String(bisherigeMatteId || '')) return true;
        const pruefung = await fetch(`/api/sync/client/matte/pruefen?matte_id=${encodeURIComponent(neueMatteId)}`)
            .then(r => r.json()).catch(() => ({}));
        if (bisherigeMatteId) {
            const hinweise = [];
            if (pruefung.ausstehend) hinweise.push(`${pruefung.ausstehend} Änderung(en) sind noch nicht zum Server übertragen — sie werden weiter synchronisiert und gehen nicht verloren.`);
            if (pruefung.laufender_kampf) hinweise.push('Auf der bisherigen Matte läuft gerade ein Kampf.');
            if (pruefung.warnung) hinweise.push(pruefung.warnung);
            const text = `Dieses Gerät auf eine andere Matte umstellen?${hinweise.length ? ' ' + hinweise.join(' ') : ''}`;
            const ok = window.zeigeZentraleBestaetigung
                ? await window.zeigeZentraleBestaetigung(text, 'Matte wechseln', 'swap_horiz')
                : confirm(text);
            if (!ok) return false;
        }
        const resp = await fetch('/api/sync/client/matte', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ matte_id: Number(neueMatteId) })
        });
        return resp.ok;
    };

    document.addEventListener('DOMContentLoaded', () => {
        aktualisiere();
        setInterval(aktualisiere, 2000);
    });
})();
