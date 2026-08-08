// Wiederverwendbares Overlay zur Anzeige der Turnier-Ausschreibung (PDF), eingebunden sowohl in
// turniere.html (Klick auf "Ausschreibung ansehen" je Turnierkarte) als auch in turnier.html
// (Vorschau der gerade hinterlegten Datei beim Anlegen/Bearbeiten). Lädt die PDF-Datei bewusst per
// fetch() statt direkt per <iframe src="/api/...">, da die JWT-Authentifizierung per
// Authorization-Header läuft (siehe globaler fetch-Wrapper in menu.js) — ein <iframe> würde diesen
// Header nicht mitschicken und liefe in ein 401.
(function () {
    let objectUrl = null;

    function stelleOverlaySicher() {
        if (document.getElementById('ausschreibungOverlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'ausschreibungOverlay';
        overlay.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); backdrop-filter: blur(2px); z-index: 10000; align-items: center; justify-content: center;';
        overlay.innerHTML = `
            <div style="width: 92%; max-width: 960px; height: 90vh; background: var(--bg-card); border-radius: 4px; box-shadow: var(--shadow); display: flex; flex-direction: column; overflow: hidden;">
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 2px solid var(--border); flex-shrink: 0;">
                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                        <span class="material-icons" style="color: var(--primary);">picture_as_pdf</span>
                        <span id="ausschreibungOverlayTitel" style="font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Ausschreibung</span>
                    </div>
                    <span class="material-icons" id="ausschreibungOverlaySchliessen" title="Schließen" style="cursor: pointer; color: var(--text-muted); flex-shrink: 0;">close</span>
                </div>
                <div id="ausschreibungOverlayBody" style="flex: 1; position: relative; background: #525659;">
                    <iframe id="ausschreibungOverlayFrame" style="border: none; width: 100%; height: 100%;"></iframe>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('ausschreibungOverlaySchliessen').addEventListener('click', window.schliesseAusschreibung);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) window.schliesseAusschreibung();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.style.display !== 'none') window.schliesseAusschreibung();
        });
    }

    window.schliesseAusschreibung = function () {
        const overlay = document.getElementById('ausschreibungOverlay');
        if (overlay) overlay.style.display = 'none';
        const frame = document.getElementById('ausschreibungOverlayFrame');
        if (frame) frame.src = 'about:blank';
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
        }
    };

    // turnierId: ID des Turniers, dessen Ausschreibung angezeigt werden soll.
    // titel: Anzeigename im Overlay-Kopf (z.B. der Turniername).
    window.zeigeAusschreibung = async function (turnierId, titel) {
        stelleOverlaySicher();
        const overlay = document.getElementById('ausschreibungOverlay');
        const frame = document.getElementById('ausschreibungOverlayFrame');
        const titelEl = document.getElementById('ausschreibungOverlayTitel');
        if (titelEl) titelEl.textContent = titel || 'Ausschreibung';

        overlay.style.display = 'flex';
        frame.src = 'about:blank';

        try {
            const response = await fetch(`/api/turniere/${turnierId}/ausschreibung`);
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Ausschreibung konnte nicht geladen werden.');
            }
            const blob = await response.blob();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = URL.createObjectURL(blob);
            frame.src = objectUrl;
        } catch (err) {
            window.schliesseAusschreibung();
            if (window.zeigeNotification) window.zeigeNotification(err.message, 'error');
            else alert(err.message);
        }
    };

    // Vorschau einer lokal ausgewählten, noch nicht gespeicherten PDF-Datei (z.B. direkt nach der
    // Dateiauswahl in turnier.html, bevor "Speichern" geklickt wurde) — braucht keinen fetch,
    // da die Datei bereits als File-Objekt im Browser vorliegt.
    window.zeigeAusschreibungDatei = function (file, titel) {
        stelleOverlaySicher();
        const overlay = document.getElementById('ausschreibungOverlay');
        const frame = document.getElementById('ausschreibungOverlayFrame');
        const titelEl = document.getElementById('ausschreibungOverlayTitel');
        if (titelEl) titelEl.textContent = titel || 'Ausschreibung';

        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(file);
        frame.src = objectUrl;
        overlay.style.display = 'flex';
    };
})();
