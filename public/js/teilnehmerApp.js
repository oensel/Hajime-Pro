// Teilnehmer-App am Hallen-Server: Icon in der Kopfleiste (Farbe = Zustand, wie das Cluster-Symbol) und Dialog zum Ein-/Ausschalten
// (docs/specs/2026-10-22-teilnehmer-app-schalter-design.md). Von menu.js nachgeladen; die Matten-Seite lauscht auf das Ereignis
// "teilnehmerapp:status" (window), das bei jeder Abfrage ausgelöst wird.
(function () {
    const FARBEN = { grau: '#9e9e9e', rot: '#c62828', gelb: '#f9a825', gruen: '#2e7d32' };
    const VERBORGEN = ['cloud_nicht_konfiguriert', 'kein_turnier'];
    const WARNUNG = 'Beim Einschalten werden Namen, Vereine und Paarungen der Teilnehmer in die Cloud gesendet.';
    const INTERNET = 'Braucht eine Internetverbindung an diesem Rechner (z. B. USB-Tethering). Die Verbindung wird regelmäßig geprüft.';

    let turnierId = null;
    let status = null;
    let timer = null;
    let dialog = null;

    function ermittleTurnierId() {
        const params = new URLSearchParams(window.location.search);
        const aus = params.get('turnierId') || params.get('id');
        if (aus) return aus;
        try { return localStorage.getItem('aktiveTurnierId'); } catch { return null; }
    }

    async function holeStatus() {
        try {
            const antwort = await fetch(`/api/live-app/status?turnierId=${encodeURIComponent(turnierId)}`, { cache: 'no-store' });
            if (!antwort.ok) return null;
            return await antwort.json();
        } catch {
            return null;
        }
    }

    function zeigeIcon() {
        const knopf = document.getElementById('teilnehmerAppBtn');
        if (!knopf) return;
        const sichtbar = !!status && !VERBORGEN.includes(status.grund);
        knopf.style.display = sichtbar ? '' : 'none';
        if (!sichtbar) return;
        const icon = knopf.querySelector('.material-icons');
        if (icon) icon.style.color = FARBEN[status.zustand] || FARBEN.grau;
        knopf.title = status.grundText && !status.verfuegbar && !status.aktiv ? status.grundText : status.text;
        knopf.dataset.zustand = status.zustand;
    }

    async function aktualisiere() {
        if (document.hidden && status) return;
        status = await holeStatus();
        zeigeIcon();
        if (dialog && !dialog.hidden) zeigeDialog();
        window.dispatchEvent(new CustomEvent('teilnehmerapp:status', { detail: status }));
    }

    function baueDialog() {
        const wurzel = document.createElement('div');
        wurzel.id = 'teilnehmerAppDialog';
        wurzel.className = 'ta-overlay';
        wurzel.hidden = true;
        wurzel.setAttribute('role', 'dialog');
        wurzel.setAttribute('aria-modal', 'true');
        wurzel.innerHTML = `
            <div class="ta-dialog">
                <h3>Teilnehmer-App</h3>
                <p class="ta-status"><span class="ta-punkt" id="taPunkt"></span><span id="taStatusText"></span></p>
                <label class="ta-schalter"><input type="checkbox" id="taSchalter"> Daten an die Teilnehmer-App senden</label>
                <p class="ta-warnung" id="taWarnung" hidden>${WARNUNG}</p>
                <p class="ta-grund" id="taGrund" hidden></p>
                <p class="ta-hinweis">${INTERNET}</p>
                <p class="ta-hinweis" id="taSender" hidden></p>
                <p class="ta-fehler" id="taFehler" hidden></p>
                <div class="ta-zugang" id="taZugang" hidden>
                    <h4>Zugang für Besucher</h4>
                    <p class="ta-hinweis">Die Teilnehmer-App zeigt Daten nur Besuchern, die den ausgehängten QR-Code gescannt haben. Hängen Sie ihn nur in der Halle aus.</p>
                    <p class="ta-hinweis" id="taZugangText"></p>
                    <div class="ta-zugang-knoepfe">
                        <a class="btn btn-outlined" id="taAushang" href="#" target="_blank" rel="noopener">QR-Code für den Aushang</a>
                        <button type="button" class="btn btn-outlined" id="taErneuern">Neuen Code erzeugen</button>
                        <button type="button" class="btn btn-outlined" id="taSperren">Zugang sperren</button>
                    </div>
                    <p class="ta-fehler" id="taZugangFehler" hidden></p>
                </div>
                <div class="ta-aktionen">
                    <button type="button" class="btn btn-outlined" id="taEinschalten" hidden>Einschalten</button>
                    <button type="button" class="btn btn-outlined" id="taSchliessen">Schließen</button>
                </div>
            </div>`;
        document.body.appendChild(wurzel);
        const schalter = wurzel.querySelector('#taSchalter');
        schalter.addEventListener('change', () => {
            if (schalter.checked) {
                wurzel.querySelector('#taWarnung').hidden = false;
                wurzel.querySelector('#taEinschalten').hidden = false;
            } else {
                setze(false);
            }
        });
        wurzel.querySelector('#taEinschalten').addEventListener('click', () => setze(true));
        wurzel.querySelector('#taErneuern').addEventListener('click', erneuereZugang);
        wurzel.querySelector('#taSperren').addEventListener('click', () => sperreZugang());
        wurzel.querySelector('#taSchliessen').addEventListener('click', schliesse);
        wurzel.addEventListener('click', (e) => { if (e.target === wurzel) schliesse(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !wurzel.hidden) schliesse(); });
        return wurzel;
    }

    function zeigeDialog() {
        if (!status || !dialog) return;
        const warteAufBestaetigung = !dialog.querySelector('#taEinschalten').hidden;
        dialog.querySelector('#taPunkt').style.background = FARBEN[status.zustand] || FARBEN.grau;
        dialog.querySelector('#taStatusText').textContent = status.text;
        const schalter = dialog.querySelector('#taSchalter');
        // Ein eingeschaltetes Turnier lässt sich immer ausschalten, auch wenn es inzwischen abgeschlossen ist.
        schalter.disabled = !status.verfuegbar && !status.aktiv;
        if (!warteAufBestaetigung) schalter.checked = !!status.aktiv;
        const grund = dialog.querySelector('#taGrund');
        grund.hidden = !status.grundText;
        grund.textContent = status.grundText || '';
        const sender = dialog.querySelector('#taSender');
        sender.hidden = !(status.aktiv && status.senderKnoten);
        sender.textContent = status.senderKnoten ? `Sendet: ${status.senderKnoten}` : '';
        const zugangBox = dialog.querySelector('#taZugang');
        zugangBox.hidden = !status.aktiv;
        dialog.querySelector('#taAushang').href = `/live-aushang.html?turnierId=${encodeURIComponent(turnierId)}`;
        if (status.aktiv && !zugang && !zugangLaedt) ladeZugang();
    }

    // --- Zugangscode (QR-Code für den Aushang) ---
    let zugang = null;
    let zugangLaedt = false;

    function zeigeZugang() {
        if (!dialog) return;
        const text = dialog.querySelector('#taZugangText');
        const sperre = dialog.querySelector('#taSperren');
        if (!zugang) { text.textContent = 'Der Zugang wird geladen …'; return; }
        const bis = zugang.gueltigBis ? new Date(zugang.gueltigBis).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : null;
        text.textContent = zugang.gesperrt
            ? 'Der Zugang ist gesperrt: Besucher sehen nichts, bis Sie ihn freigeben.'
            : `Der Code gilt${bis ? ` bis ${bis} Uhr (Ende des Turniertags)` : ''}. „Neuen Code erzeugen“ macht ausgehängte QR-Codes sofort ungültig.`;
        sperre.textContent = zugang.gesperrt ? 'Zugang freigeben' : 'Zugang sperren';
    }

    function zugangFehler(meldung) {
        const feld = dialog && dialog.querySelector('#taZugangFehler');
        if (!feld) return;
        feld.textContent = meldung || '';
        feld.hidden = !meldung;
    }

    async function zugangAnfrage(pfad, methode, body) {
        const antwort = await fetch(`/api/live-app/zugang${pfad}`, {
            method: methode, cache: 'no-store',
            ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
        });
        const daten = await antwort.json().catch(() => ({}));
        if (!antwort.ok) throw new Error(daten.error || `Fehler ${antwort.status}`);
        return daten;
    }

    async function ladeZugang() {
        zugangLaedt = true;
        zugangFehler('');
        try {
            zugang = await zugangAnfrage(`?turnierId=${encodeURIComponent(turnierId)}`, 'GET');
        } catch (e) {
            zugang = null;
            zugangFehler(e.message);
        } finally {
            zugangLaedt = false;
            zeigeZugang();
        }
    }

    async function erneuereZugang() {
        const text = 'Einen neuen Code erzeugen? Alle bereits ausgehängten QR-Codes werden sofort ungültig und müssen neu gedruckt werden.';
        const ok = window.zeigeZentraleBestaetigung ? await window.zeigeZentraleBestaetigung(text, 'Neuen Code erzeugen', 'qr_code') : window.confirm(text);
        if (!ok) return;
        zugangFehler('');
        try {
            zugang = await zugangAnfrage('/erneuern', 'POST', { turnierId: Number(turnierId) });
        } catch (e) {
            zugangFehler(e.message);
        }
        zeigeZugang();
    }

    async function sperreZugang() {
        zugangFehler('');
        try {
            zugang = await zugangAnfrage('/sperren', 'POST', { turnierId: Number(turnierId), gesperrt: !(zugang && zugang.gesperrt) });
        } catch (e) {
            zugangFehler(e.message);
        }
        zeigeZugang();
    }

    async function setze(aktiv) {
        const fehler = dialog.querySelector('#taFehler');
        fehler.hidden = true;
        try {
            const antwort = await fetch('/api/live-app/schalter', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnierId: Number(turnierId), aktiv })
            });
            const daten = await antwort.json().catch(() => ({}));
            if (!antwort.ok) throw new Error(daten.error || `Fehler ${antwort.status}`);
        } catch (e) {
            fehler.textContent = e.message;
            fehler.hidden = false;
        }
        dialog.querySelector('#taWarnung').hidden = true;
        dialog.querySelector('#taEinschalten').hidden = true;
        await aktualisiere();
    }

    function schliesse() {
        if (!dialog) return;
        dialog.hidden = true;
        dialog.querySelector('#taWarnung').hidden = true;
        dialog.querySelector('#taEinschalten').hidden = true;
    }

    // einschalten: der Hinweis auf der Mattenseite öffnet den Dialog gleich im Bestätigungsschritt.
    function oeffneDialog({ einschalten = false } = {}) {
        if (!dialog) dialog = baueDialog();
        dialog.hidden = false;
        dialog.querySelector('#taFehler').hidden = true;
        zugang = null;
        zeigeDialog();
        if (einschalten && status && status.verfuegbar && !status.aktiv) {
            dialog.querySelector('#taSchalter').checked = true;
            dialog.querySelector('#taWarnung').hidden = false;
            dialog.querySelector('#taEinschalten').hidden = false;
        }
    }

    function init() {
        const knopf = document.getElementById('teilnehmerAppBtn');
        turnierId = ermittleTurnierId();
        if (!knopf || !turnierId || timer) return;
        knopf.addEventListener('click', () => oeffneDialog());
        aktualisiere();
        timer = setInterval(aktualisiere, 5000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) aktualisiere(); });
    }

    window.TeilnehmerApp = { init, oeffneDialog, letzterStatus: () => status, aktualisiere };
})();
