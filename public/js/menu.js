// Fehler im Browser an das Fehlerprotokoll melden (public/js/fehlerMelder.js) und die Fußzeile Impressum/Datenschutz (public/js/rechtsfuss.js)
for (const datei of ['fehlerMelder.js', 'rechtsfuss.js']) { const s = document.createElement('script'); s.src = `/js/${datei}`; document.head.appendChild(s); }
// public/js/navigation.js

// Theme sofort beim Parsen setzen (menu.js steht im <head>), nicht erst nach DOMContentLoaded
// und den Auth-Requests — sonst wird die Seite zuerst hell gerendert und springt dann auf dunkel.
try {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('hajime-theme') || 'light');
} catch (e) { /* localStorage gesperrt: helles Theme bleibt */ }

// Seitenwechsel zwischen zwei Seiten mit Menü als kurze Überblendung statt hartem Neuaufbau (Chrome/Edge/
// Electron; andere Browser ignorieren das). Seitenleiste und Kopfleiste sind auf beiden Seiten gleich und
// bleiben dabei stehen, nur der Inhalt blendet über. Seiten ohne menu.js (Anzeige, Scoreboard) bleiben außen vor.
try {
    const uebergang = document.createElement('style');
    uebergang.textContent = '@view-transition { navigation: auto; }';
    (document.head || document.documentElement).appendChild(uebergang);
} catch (e) { /* ohne Überblendung */ }

// Icon-Schrift des Menüs sofort anfordern (common.css ist zu diesem Zeitpunkt schon geladen), nicht erst,
// wenn die ersten Icons gezeichnet werden — sonst fehlen sie im ersten Bild nach dem Seitenwechsel.
try { document.fonts.load('20px "Material Icons"'); } catch (e) { /* ohne Vorladen */ }

// --- MENÜSTAND ÜBER DEN SEITENWECHSEL MERKEN ---
// Die Sichtbarkeit/Sperre der Menüpunkte hängt an mehreren Serverabfragen; bis sie beantwortet sind, wäre
// das Menü leer. Daher merkt sich jede Seite beim Verlassen den fertigen Stand von Seiten- und Kopfleiste
// (je Turnier und Browser-Tab im sessionStorage), und die nächste Seite zeigt ihn sofort als Platzhalter
// (ohne IDs, ohne Listener), bis das echte Menü fertig gerechnet ist (gibMenueFrei). Rechte prüft ohnehin
// der Server; bei Abmelden, 401 und Vereinswechsel wird der Stand verworfen.
const MENUE_STAND_PRAEFIX = 'hajime-menue:';
let echtesMenueFrei = false;

function menueStandSchluessel() {
    const params = new URLSearchParams(window.location.search);
    return MENUE_STAND_PRAEFIX + (params.get('id') || params.get('turnierId') || '');
}

function vergissMenueStand() {
    echtesMenueFrei = false; // pagehide dieser Seite merkt nichts mehr
    try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const schluessel = sessionStorage.key(i);
            if (schluessel && schluessel.startsWith(MENUE_STAND_PRAEFIX)) sessionStorage.removeItem(schluessel);
        }
    } catch (e) { /* sessionStorage gesperrt */ }
}

// Menüpunkt bzw. Kopfleisten-Knopf → Seiten, auf denen er als aktiv hervorgehoben wird.
const MENUE_AKTIVE_SEITEN = [
    ['nav-turniere', ['turniere.html']],
    ['nav-turnier', ['turnier.html', 'abrechnung.html']],
    ['nav-teilnehmer', ['teilnehmer.html']],
    ['nav-pools', ['pools.html']],
    ['nav-mannschaften', ['mannschaften.html']],
    // Die Zeitplan-Simulation gehört zu den Matten (Button auf matten.html).
    ['nav-matten', ['matten.html', 'zeitplan.html']],
    ['nav-helfer', ['helfer-plan.html']],
    ['nav-kampf', ['kampf.html']],
    ['nav-siegerliste', ['siegerliste.html']],
    ['nav-urkunden', ['urkunden.html']],
    ['nav-urkunden-designer', ['urkunden-designer.html']],
    ['nav-dashboard', ['dashboard.html']],
    ['nav-uebersicht', ['uebersicht.html']],
    ['nav-geraet', ['client.html']],
    ['nav-client-konfig', ['client-konfig.html']],
    ['nav-video-live', ['video-live.html']],
    ['nav-videobeweis', ['videobeweis.html']],
    ['nav-sync-konflikte', ['sync-konflikte.html']],
    ['nav-nachrichten', ['nachrichten.html']],
    ['nav-nutzer', ['admin-nutzer.html']],
    ['nav-mitglieder', ['admin-nutzer.html']],
    ['nav-rechnungen', ['rechnungen.html']],
    ['nav-verein', ['verein.html']],
    ['nav-einladungen', ['admin-einladungen.html']],
    ['nav-erstregistrierungen', ['admin-erstregistrierungen.html']],
    ['nav-vereine', ['admin-vereine.html', 'admin-turniere.html']],
    ['nav-server-update', ['server-update.html']],
    ['nav-sicherung', ['sicherung.html']],
    ['nav-downloads', ['downloads.html']],
    ['nav-protokoll', ['protokoll.html']],
    ['nav-konsole', ['konsole.html']],
    ['hallenServerBtn', ['cluster.html']]
];

function markiereAktivenMenuepunkt(finde) {
    const pfad = window.location.pathname;
    for (const [id, seiten] of MENUE_AKTIVE_SEITEN) {
        const element = finde(id);
        if (element) element.classList.toggle('active', seiten.some(seite => pfad.includes(seite)));
    }
}

// Zeigt den gemerkten Menüstand als Platzhalter; false, wenn es für dieses Turnier noch keinen gibt.
function zeigeMenuePlatzhalter() {
    let html = null;
    try { html = sessionStorage.getItem(menueStandSchluessel()); } catch (e) { /* sessionStorage gesperrt */ }
    if (!html) return false;

    const vorlage = document.createElement('template');
    vorlage.innerHTML = html;
    const teile = Array.from(vorlage.content.children);
    if (teile.length === 0) return false;

    // Hervorhebung gehört zur neuen Seite, nicht zur gemerkten.
    markiereAktivenMenuepunkt(id => vorlage.content.querySelector(`[data-platzhalter-id="${id}"]`));
    teile.forEach(teil => teil.classList.add('menue-platzhalter'));
    document.body.prepend(...teile);
    return true;
}

// Merkt den Stand des echten Menüs: IDs werden zu data-platzhalter-id, damit der Platzhalter auf der
// nächsten Seite nicht mit dem echten Menü kollidiert (getElementById, Test-Locators).
function merkeMenueStand() {
    if (!echtesMenueFrei) return;
    const teile = Array.from(document.querySelectorAll('.app-sidebar, .top-header-bar'))
        .filter(teil => !teil.classList.contains('menue-platzhalter'));
    if (teile.length === 0) return;

    const html = teile.map(teil => {
        const kopie = teil.cloneNode(true);
        kopie.classList.remove('menue-verborgen');
        for (const element of [kopie, ...kopie.querySelectorAll('[id]')]) {
            if (!element.id) continue;
            element.setAttribute('data-platzhalter-id', element.id);
            element.removeAttribute('id');
        }
        kopie.querySelectorAll('.sidebar-nav').forEach(nav => nav.style.removeProperty('visibility'));
        const vereinMenue = kopie.querySelector('[data-platzhalter-id="vereinSwitcherMenu"]');
        if (vereinMenue) vereinMenue.style.display = 'none';
        return kopie.outerHTML;
    }).join('');

    try { sessionStorage.setItem(menueStandSchluessel(), html); } catch (e) { /* sessionStorage voll/gesperrt */ }
}
window.addEventListener('pagehide', merkeMenueStand);

// Ein Sektionstitel (Vorbereitung, Ergebnisse …) steht nur, solange darunter mindestens ein Punkt sichtbar ist.
function aktualisiereMenueSektionen() {
    for (const titel of document.querySelectorAll('.app-sidebar:not(.menue-platzhalter) .menu-sektion-titel')) {
        let sichtbar = false;
        for (let el = titel.nextElementSibling; el && !el.classList.contains('menu-sektion-titel'); el = el.nextElementSibling) {
            if (el.classList.contains('menu-trenner')) continue;
            if (el.style.display !== 'none') { sichtbar = true; break; }
        }
        titel.classList.toggle('leer', !sichtbar);
    }
}

// Alle Sperr-/Versteck-Entscheidungen sind getroffen: echtes Menü zeigen, Platzhalter entfernen.
function gibMenueFrei() {
    const teile = Array.from(document.querySelectorAll('.app-sidebar, .top-header-bar'))
        .filter(teil => !teil.classList.contains('menue-platzhalter'));
    teile.forEach(teil => teil.classList.add('menue-ohne-uebergang'));
    document.getElementById('sidebarNavPrimary')?.style.removeProperty('visibility');
    document.getElementById('sidebarNavTurniere')?.style.removeProperty('visibility');
    document.querySelectorAll('.menue-platzhalter').forEach(teil => teil.remove());
    teile.forEach(teil => teil.classList.remove('menue-verborgen'));
    // Endzustand ohne Übergänge berechnen lassen, erst danach die Übergänge (Hover usw.) wieder zulassen.
    void document.body.offsetHeight;
    teile.forEach(teil => teil.classList.remove('menue-ohne-uebergang'));
    echtesMenueFrei = true;
    merkeMenueStand();
}

// Global fetch wrapper to append X-Steuerung-Password and Authorization headers if available in localStorage
(function() {
    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        
        const pw = localStorage.getItem('steuerung_password');
        if (pw) {
            if (options.headers instanceof Headers) {
                options.headers.set('X-Steuerung-Password', pw);
            } else if (Array.isArray(options.headers)) {
                options.headers.push(['X-Steuerung-Password', pw]);
            } else {
                options.headers['X-Steuerung-Password'] = pw;
            }
        }

        const token = localStorage.getItem('dokume_token');
        if (token) {
            if (options.headers instanceof Headers) {
                options.headers.set('Authorization', `Bearer ${token}`);
            } else if (Array.isArray(options.headers)) {
                options.headers.push(['Authorization', `Bearer ${token}`]);
            } else {
                options.headers['Authorization'] = `Bearer ${token}`;
            }
        }

        return originalFetch(url, options).then(response => {
            if (response.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/verify') && !url.includes('/api/auth/mode') && !url.includes('/api/auth/steuerung-passwort')) {
                localStorage.removeItem('dokume_token');
                localStorage.removeItem('dokume_user');
                vergissMenueStand();
                window.location.href = '/login.html';
            }
            return response;
        });
    };
})();

function showGlobalLoginModal() {
    if (document.getElementById('globalLoginModal')) return;

    const modal = document.createElement('div');
    modal.id = 'globalLoginModal';
    modal.style = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(17, 24, 39, 0.96);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    `;
    
    modal.innerHTML = `
        <div style="background: #1f2937; border: 2px solid #374151; border-radius: 8px; padding: 32px; width: 90%; max-width: 400px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); color: #f3f4f6;">
            <div style="font-size: 40px; color: #3b82f6; margin-bottom: 16px;">🔑</div>
            <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Hajime Pro - Login</h2>
            <p style="margin: 0 0 24px 0; font-size: 13px; color: #9ca3af; font-weight: 600;">Bitte geben Sie das Passwort für den Schreibzugriff ein.</p>
            
            <form id="globalLoginForm" style="display: flex; flex-direction: column; gap: 16px;">
                <input type="password" id="globalLoginPassword" placeholder="Passwort eingeben..." required style="padding: 10px 14px; border: 1px solid #4b5563; border-radius: 4px; background: #111827; color: #ffffff; font-size: 14px; text-align: center; font-weight: bold; width: 100%; box-sizing: border-box; outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#4b5563'">
                <button type="submit" style="background: #3b82f6; color: #ffffff; border: none; padding: 12px; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; transition: background 0.2s;" onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">Bestätigen</button>
            </form>
            <div id="globalLoginError" style="margin-top: 12px; color: #ef4444; font-size: 12px; font-weight: 700; display: none;">Ungültiges Passwort!</div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const form = document.getElementById('globalLoginForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const passwordInput = document.getElementById('globalLoginPassword');
        const errorMsg = document.getElementById('globalLoginError');
        const pw = passwordInput.value;
        
        try {
            const verifyResp = await fetch('/api/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw })
            });
            if (verifyResp.ok) {
                const antwort = await verifyResp.json().catch(() => ({}));
                localStorage.setItem('steuerung_password', pw);
                document.body.removeChild(modal);
                if (antwort.aenderungErforderlich) {
                    zeigePasswortAenderungModal();
                } else {
                    window.location.reload();
                }
            } else {
                errorMsg.style.display = 'block';
                passwordInput.value = '';
                passwordInput.focus();
            }
        } catch (err) {
            errorMsg.innerText = 'Verbindungsfehler: ' + err.message;
            errorMsg.style.display = 'block';
        }
    });
}

// Erzwungene Änderung des Start-Passworts (vom Installationsskript erzeugt): erscheint bei der ersten
// Anmeldung mit diesem Passwort und lässt sich nicht schließen. Das bisherige Passwort steht schon
// in localStorage (der fetch-Wrapper sendet es als Nachweis mit).
function zeigePasswortAenderungModal() {
    if (document.getElementById('passwortAenderungModal')) return;

    const modal = document.createElement('div');
    modal.id = 'passwortAenderungModal';
    modal.style = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(17, 24, 39, 0.96); z-index: 999999; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;';
    const feld = 'padding: 10px 14px; border: 1px solid #4b5563; border-radius: 4px; background: #111827; color: #ffffff; font-size: 14px; text-align: center; font-weight: bold; width: 100%; box-sizing: border-box; outline: none;';
    modal.innerHTML = `
        <div style="background: #1f2937; border: 2px solid #374151; border-radius: 8px; padding: 32px; width: 90%; max-width: 400px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); color: #f3f4f6;">
            <div style="font-size: 40px; color: #3b82f6; margin-bottom: 16px;">🔑</div>
            <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Passwort ändern</h2>
            <p style="margin: 0 0 24px 0; font-size: 13px; color: #9ca3af; font-weight: 600;">Das bei der Installation erzeugte Passwort muss geändert werden. Bitte vergeben Sie ein eigenes Passwort für den Schreibzugriff (mindestens 8 Zeichen).</p>
            <form id="passwortAenderungForm" style="display: flex; flex-direction: column; gap: 16px;">
                <input type="password" id="passwortAenderungNeu" placeholder="Neues Passwort" autocomplete="new-password" required minlength="8" style="${feld}">
                <input type="password" id="passwortAenderungWiederholung" placeholder="Neues Passwort wiederholen" autocomplete="new-password" required minlength="8" style="${feld}">
                <button type="submit" style="background: #3b82f6; color: #ffffff; border: none; padding: 12px; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;">Passwort speichern</button>
            </form>
            <div id="passwortAenderungFehler" style="margin-top: 12px; color: #ef4444; font-size: 12px; font-weight: 700; display: none;"></div>
        </div>
    `;
    document.body.appendChild(modal);

    const fehler = document.getElementById('passwortAenderungFehler');
    const zeigeFehler = (text) => {
        fehler.innerText = text;
        fehler.style.display = 'block';
    };
    document.getElementById('passwortAenderungForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const neu = document.getElementById('passwortAenderungNeu').value;
        const wiederholung = document.getElementById('passwortAenderungWiederholung').value;
        if (neu !== wiederholung) {
            zeigeFehler('Die beiden Eingaben stimmen nicht überein.');
            return;
        }
        try {
            const resp = await fetch('/api/auth/steuerung-passwort', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ neuesPasswort: neu })
            });
            const daten = await resp.json().catch(() => ({}));
            if (resp.ok) {
                localStorage.setItem('steuerung_password', neu);
                window.location.reload();
            } else {
                zeigeFehler(daten.error || 'Das Passwort konnte nicht gespeichert werden.');
            }
        } catch (err) {
            zeigeFehler('Verbindungsfehler: ' + err.message);
        }
    });
    document.getElementById('passwortAenderungNeu').focus();
}

// Baut Seitenleiste, Kopfleiste, Snackbar und Dialoge, sobald <body> existiert (noch vor dem ersten
// Zeichnen der Seite), statt erst nach DOMContentLoaded und den Auth-Requests: so ist das Menü beim
// Seitenwechsel sofort da. Ob Menüpunkte sichtbar/gesperrt sind, entscheidet danach initialisiereMenue().
let menueGeruestGebaut = false;
function baueMenueGeruest() {
    if (menueGeruestGebaut) return;
    menueGeruestGebaut = true;

    // 1. Die HTML-Struktur der Navigation inkl. Snackbar und Modal definieren
    const brandingBar = document.createElement('div');
    brandingBar.className = 'nav-shell-wrapper';
    brandingBar.innerHTML = `
        <div class="app-sidebar">
            <div class="sidebar-brand" title="Hajime Pro">
                <img src="hajime_pro.png" height="60">
            </div>
            <nav class="sidebar-nav sidebar-nav-turniere" id="sidebarNavTurniere" style="visibility: hidden;">
                <a href="/turniere.html" class="menu-item" id="nav-turniere">
                    <span class="material-icons">calendar_month</span>
                    <span class="menu-text">Alle Turniere</span>
                </a>
            </nav>
            <nav class="sidebar-nav" id="sidebarNavPrimary" style="visibility: hidden;">
                <div class="menu-sektion-titel" id="nav-sek-vorbereitung">Vorbereitung</div>
                <a href="/turnier.html" class="menu-item" id="nav-turnier">
                    <span class="material-icons">emoji_events</span>
                    <span class="menu-text">Turnierdaten</span>
                </a>
                <div class="menu-gruppe" id="nav-orga">
                    <button type="button" class="menu-item menu-gruppe-kopf" id="nav-orga-kopf" aria-expanded="true" aria-controls="nav-orga-liste" title="Orga">
                        <span class="material-icons">fact_check</span>
                        <span class="menu-text">Orga</span>
                        <span class="material-icons menu-gruppe-pfeil" id="nav-orga-pfeil" aria-hidden="true">expand_more</span>
                    </button>
                    <ul class="menu-untermenue" id="nav-orga-liste">
                        <li><a href="/helfer-plan.html" class="menu-item menu-subitem" id="nav-helfer"><span class="menu-text">Helfer</span></a></li>
                        <li class="menu-aufgaben" id="nav-orga-aufgaben">
                            <a href="/orga.html" class="menu-item menu-subitem" id="nav-orga-uebersicht"><span class="menu-text">Aufgaben</span><span class="menu-item-badge" id="nav-orga-aufgaben-zaehler" style="display: none;"></span></a>
                            <button type="button" class="menu-aufgaben-pfeil" id="nav-orga-aufgaben-pfeil" aria-expanded="true" aria-controls="nav-orga-kategorien" title="Aufgaben auf- oder zuklappen">
                                <span class="material-icons" id="nav-orga-aufgaben-pfeil-icon" aria-hidden="true">expand_more</span>
                            </button>
                            <ul class="menu-untermenue menu-kategorien" id="nav-orga-kategorien">
                                <li><a href="#" class="menu-item menu-subitem" id="nav-orga-technik" data-ohne-turnier style="display: none;"><span class="menu-text">Technik</span><span class="menu-item-badge" style="display: none;"></span></a></li>
                                <li><a href="#" class="menu-item menu-subitem" id="nav-orga-catering" data-ohne-turnier style="display: none;"><span class="menu-text">Catering</span><span class="menu-item-badge" style="display: none;"></span></a></li>
                                <li><a href="#" class="menu-item menu-subitem" id="nav-orga-medaillen" data-ohne-turnier style="display: none;"><span class="menu-text">Medaillen und Pokale</span><span class="menu-item-badge" style="display: none;"></span></a></li>
                            </ul>
                        </li>
                    </ul>
                </div>
                <a href="/teilnehmer.html" class="menu-item" id="nav-teilnehmer">
                    <span class="material-icons">badge</span>
                    <span class="menu-text">Teilnehmer</span>
                </a>
                <a href="/pools.html" class="menu-item" id="nav-pools">
                    <span class="material-icons">groups</span>
                    <span class="menu-text">Pools</span>
                    <span class="material-icons menu-item-warning" id="nav-pools-warning" style="display: none;" title="Mindestens ein Pool wartet auf Ergebnisprüfung">warning</span>
                    <span class="menu-item-badge" id="nav-pools-badge" style="display: none;"></span>
                </a>
                <a href="/mannschaften.html" class="menu-item" id="nav-mannschaften">
                    <span class="material-icons">groups_2</span>
                    <span class="menu-text">Mannschaften</span>
                    <span class="material-icons menu-item-warning" id="nav-mannschaften-warning" style="display: none;" title="Mindestens ein Mannschafts-Pool wartet auf Ergebnisprüfung">warning</span>
                </a>
                <a href="/matten.html" class="menu-item" id="nav-matten">
                    <span class="material-icons">layers</span>
                    <span class="menu-text">Matten</span>
                </a>
                <div class="menu-sektion-titel" id="nav-sek-kontrolle">Kontrolle</div>
                <a href="/kampf.html" class="menu-item" id="nav-kampf">
                    <span class="material-icons">sports_kabaddi</span>
                    <span class="menu-text">Kämpfe</span>
                </a>
                <a href="/video-live.html" class="menu-item" id="nav-video-live" style="display: none;">
                    <span class="material-icons">videocam</span>
                    <span class="menu-text">Video live</span>
                </a>
                <a href="/videobeweis.html" class="menu-item" id="nav-videobeweis" style="display: none;">
                    <span class="material-icons">video_library</span>
                    <span class="menu-text">Video-Archiv</span>
                </a>
                <div class="menu-sektion-titel" id="nav-sek-ergebnisse">Ergebnisse</div>
                <a href="/urkunden.html" class="menu-item" id="nav-urkunden">
                    <span class="material-icons">workspace_premium</span>
                    <span class="menu-text">Urkunden</span>
                </a>
                <a href="/siegerliste.html" class="menu-item" id="nav-siegerliste">
                    <span class="material-icons">military_tech</span>
                    <span class="menu-text">Siegerliste</span>
                </a>
                <div class="menu-sektion-titel" id="nav-sek-ansichten">Ansichten</div>
                <a href="/dashboard.html" class="menu-item" id="nav-dashboard">
                    <span class="material-icons">dashboard</span>
                    <span class="menu-text">Dashboard</span>
                </a>
                <a href="/uebersicht.html" class="menu-item" id="nav-uebersicht">
                    <span class="material-icons">travel_explore</span>
                    <span class="menu-text">Wer kämpft wo</span>
                </a>
            </nav>
            <nav class="sidebar-nav-unten" id="sidebarNavUnten">
                <div class="menu-sektion-titel" id="nav-sek-verwaltung">Verwaltung</div>
                <a href="/verein.html" class="menu-item" id="nav-verein" data-ohne-turnier style="display: none;">
                    <span class="material-icons">domain</span>
                    <span class="menu-text">Verein</span>
                </a>
                <a href="/admin-nutzer.html" class="menu-item" id="nav-mitglieder" data-ohne-turnier style="display: none;">
                    <span class="material-icons">manage_accounts</span>
                    <span class="menu-text">Mitglieder<span class="menu-badge" id="nav-mitglieder-zaehler" style="display: none;"></span></span>
                </a>
                <a href="/rechnungen.html" class="menu-item" id="nav-rechnungen" data-ohne-turnier style="display: none;">
                    <span class="material-icons">receipt_long</span>
                    <span class="menu-text">Rechnungen</span>
                </a>
                <a href="/urkunden-designer.html" class="menu-item" id="nav-urkunden-designer">
                    <span class="material-icons">palette</span>
                    <span class="menu-text">Urkunden-Designer</span>
                </a>
                <a href="/helfer.html" class="menu-item" id="nav-helfer-app" data-ohne-turnier style="display: none;">
                    <span class="material-icons">handshake</span>
                    <span class="menu-text">Helfer-App</span>
                </a>
                <a href="/nachrichten.html" class="menu-item" id="nav-nachrichten" data-ohne-turnier style="display: none;">
                    <span class="material-icons">mail</span>
                    <span class="menu-text">Nachrichten<span class="menu-badge" id="nav-nachrichten-zaehler" style="display: none;"></span></span>
                </a>
                <a href="/downloads.html" class="menu-item" id="nav-downloads" data-ohne-turnier style="display: none;">
                    <span class="material-icons">download</span>
                    <span class="menu-text">Downloads</span>
                </a>
                <a href="/protokoll.html" class="menu-item" id="nav-protokoll" data-ohne-turnier style="display: none;">
                    <span class="material-icons">history</span>
                    <span class="menu-text">Protokoll</span>
                </a>
                <a href="/sync-konflikte.html" class="menu-item" id="nav-sync-konflikte" style="display: none;">
                    <span class="material-icons">sync_problem</span>
                    <span class="menu-text">Sync-Konflikte</span>
                    <span class="menu-item-badge" id="nav-sync-konflikte-badge" style="display: none;"></span>
                </a>
                <a href="/client-konfig.html" class="menu-item" id="nav-client-konfig" style="display: none;">
                    <span class="material-icons">settings</span>
                    <span class="menu-text">Client-Konfig</span>
                </a>
                <div class="menu-trenner" id="nav-super-trenner" role="separator" style="display: none;"></div>
                <a href="/admin-nutzer.html" class="menu-item" id="nav-nutzer" data-ohne-turnier style="display: none;">
                    <span class="material-icons">admin_panel_settings</span>
                    <span class="menu-text">Benutzer</span>
                </a>
                <a href="/admin-einladungen.html" class="menu-item" id="nav-einladungen" data-ohne-turnier style="display: none;">
                    <span class="material-icons">forward_to_inbox</span>
                    <span class="menu-text">Einladungen</span>
                </a>
                <a href="/admin-erstregistrierungen.html" class="menu-item" id="nav-erstregistrierungen" data-ohne-turnier style="display: none;">
                    <span class="material-icons">verified_user</span>
                    <span class="menu-text">Erstregistrierungen<sup class="menu-sup" id="nav-erstregistrierungen-zaehler" style="display: none;"></sup></span>
                </a>
                <a href="/admin-vereine.html" class="menu-item" id="nav-vereine" data-ohne-turnier style="display: none;">
                    <span class="material-icons">groups</span>
                    <span class="menu-text">Vereine</span>
                </a>
                <a href="/server-update.html" class="menu-item" id="nav-server-update" data-ohne-turnier style="display: none;">
                    <span class="material-icons">system_update</span>
                    <span class="menu-text">Server-Update</span>
                </a>
                <a href="/sicherung.html" class="menu-item" id="nav-sicherung" data-ohne-turnier style="display: none;">
                    <span class="material-icons">backup</span>
                    <span class="menu-text">Sicherung</span>
                </a>
                <a href="/konsole.html" class="menu-item" id="nav-konsole" data-ohne-turnier style="display: none;">
                    <span class="material-icons">terminal</span>
                    <span class="menu-text">Konsole</span>
                </a>
            </nav>
            <button type="button" class="sidebar-collapse-btn" id="sidebarCollapseBtn" title="Navigation einklappen" aria-label="Navigation einklappen">
                <span class="material-icons" id="sidebarCollapseIcon">keyboard_double_arrow_left</span>
            </button>
        </div>

        <div class="menue-hintergrund" id="menueHintergrund"></div>

        <div class="top-header-bar">
            <button type="button" class="menue-knopf" id="menueKnopf" aria-label="Menü öffnen" aria-expanded="false">
                <span class="material-icons">menu</span>
            </button>
            <h1 class="top-header-title" id="topHeaderTitle"></h1>
            <div class="top-header-right">
            <div class="verein-switcher" id="vereinSwitcher" style="display: none;">
                <button type="button" class="verein-switcher-btn" id="vereinSwitcherBtn">
                    <span class="material-icons" style="font-size: 18px;">apartment</span>
                    <span id="vereinSwitcherName"></span>
                    <span class="material-icons verein-switcher-caret" id="vereinSwitcherCaret" style="display: none;">expand_more</span>
                </button>
                <div class="verein-switcher-menu" id="vereinSwitcherMenu" style="display: none;"></div>
            </div>
            <div class="top-header-actions">
            <span class="theme-toggle nur-anzeige" id="cloudAnzeige" title="Cloud-Server" role="img" aria-label="Cloud-Server" style="display: none;">
                <span class="material-icons">cloud</span>
            </span>
            <div class="profil-menue-huelle">
                <button type="button" class="theme-toggle" id="profileBtn" title="Mein Profil" aria-haspopup="menu" aria-expanded="false">
                    <span class="material-icons">account_circle</span>
                    <span class="profil-badge" id="profilBadge" style="display: none;"></span>
                </button>
                <div class="verein-switcher-menu profil-menue" id="profilMenue" role="menu" style="display: none;">
                    <a href="/profil.html" class="verein-switcher-item" role="menuitem">Mein Profil</a>
                    <a href="/nachrichten.html" class="verein-switcher-item" role="menuitem" id="profilMenueNachrichten">Nachrichten<span class="menu-badge" id="profilMenueZaehler" style="display: none;"></span></a>
                </div>
            </div>
            <button type="button" class="theme-toggle" id="themeToggle" title="Ansicht umschalten">
                <span class="material-icons" id="themeIcon">dark_mode</span>
            </button>
            <button type="button" class="theme-toggle" id="teilnehmerAppBtn" title="Teilnehmer-App" style="display: none;">
                <span class="material-icons">phone_iphone</span>
            </button>
            <a href="/cluster.html" class="theme-toggle theme-toggle-text" id="hallenServerBtn" title="Status des Server-Clusters" style="display: none;">
                <span class="material-icons">dns</span>
            </a>
            <button type="button" class="theme-toggle" id="logoutBtn" title="Abmelden" style="color: #ef4444; border: none; background: transparent; cursor: pointer;">
                <span class="material-icons">logout</span>
            </button>
            </div>
            </div>
        </div>

        <!-- DYNAMISCHE MATERIAL DESIGN NOTIFICATION SNACKBAR (PERFEKT IN DER LÜCKE COPOSITIONIERT) -->
        <div id="materialSnackbar" style="display: none; position: fixed; top: 90px; left: 50%; transform: translateX(-50%); background-color: #2e7d32; color: #ffffff; padding: 14px 28px; border-radius: 4px; box-shadow: 0 4px 10px rgba(0,0,0,0.15); z-index: 10000; align-items: center; gap: 12px; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; animation: snackbarFadeInTop 0.3s ease-out;">
            <span class="material-icons" style="font-size: 20px;">check_circle_outline</span>
            <span id="snackbarText"></span>
        </div>


        <!-- OPTISCH ANSPRECHENDER MATERIAL CONFIRM DIALOG -->
        <div id="customConfirmModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(2px); z-index: 10000; align-items: center; justify-content: center; transition: all 0.2s;">
            <div class="mdc-card" style="max-width: 420px; padding: 24px; border-radius: 4px; border: 2px solid var(--border); box-shadow: var(--shadow); background-color: var(--bg-card); animation: modalPulse 0.2s ease-out;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <span class="material-icons" id="modalIcon" style="font-size: 28px; color: var(--primary);">help_outline</span>
                    <h2 id="modalTitle" style="margin: 0; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Aktion bestätigen</h2>
                </div>
                <p id="modalMessage" style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5; color: var(--text-main);"></p>
                <div style="display: flex; justify-content: flex-end; gap: 12px;">
                    <button type="button" class="btn btn-outlined" id="modalCancelBtn" style="padding: 8px 20px; font-size: 12px;">Abbrechen</button>
                    <button type="button" class="btn btn-raised" id="modalConfirmBtn" style="padding: 8px 20px; font-size: 12px;">Fortfahren</button>
                </div>
            </div>
        </div>

        <!-- MATERIAL TEXTEINGABE-DIALOG (Ersatz für window.prompt) -->
        <div id="customPromptModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(2px); z-index: 9999; align-items: center; justify-content: center; transition: all 0.2s;">
            <div class="mdc-card" style="max-width: 420px; width: 90%; padding: 24px; border-radius: 4px; border: 2px solid var(--border); box-shadow: var(--shadow); background-color: var(--bg-card); animation: modalPulse 0.2s ease-out;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <span class="material-icons" id="promptModalIcon" style="font-size: 28px; color: var(--primary);">edit</span>
                    <h2 id="promptModalTitle" style="margin: 0; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Eingabe</h2>
                </div>
                <p id="promptModalMessage" style="margin: 0 0 12px 0; font-size: 14px; line-height: 1.5; color: var(--text-main);"></p>
                <form id="promptModalForm">
                    <input type="text" id="promptModalInput" style="width: 100%; box-sizing: border-box; padding: 10px 14px; margin-bottom: 24px; font-size: 14px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-main); color: var(--text-main); outline: none;">
                    <div style="display: flex; justify-content: flex-end; gap: 12px;">
                        <button type="button" class="btn btn-outlined" id="promptModalCancelBtn" style="padding: 8px 20px; font-size: 12px;">Abbrechen</button>
                        <button type="submit" class="btn btn-raised" id="promptModalConfirmBtn" style="padding: 8px 20px; font-size: 12px;">Übernehmen</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- LADE-MODAL für kurze, nicht abbrechbare Hintergrundaktionen (z.B. Pools aufteilen) -->
        <div id="customLoadingModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(2px); z-index: 9999; align-items: center; justify-content: center; transition: all 0.2s;">
            <div class="mdc-card" style="max-width: 320px; padding: 24px 32px; border-radius: 4px; border: 2px solid var(--border); box-shadow: var(--shadow); background-color: var(--bg-card); animation: modalPulse 0.2s ease-out; display: flex; align-items: center; gap: 16px;">
                <span class="material-icons icon-spin" style="font-size: 28px; color: var(--primary);">sync</span>
                <p id="loadingModalMessage" style="margin: 0; font-size: 14px; font-weight: 700; color: var(--text-main);">Bitte warten…</p>
            </div>
        </div>
    `;

    // Elemente flach in den Body einfügen, um die CSS-Hierarchie zu wahren
    while (brandingBar.firstChild) {
        document.body.insertBefore(brandingBar.firstChild, document.body.firstChild);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const currentPath = window.location.pathname;
    // orga-aufgabe.html führt die Aufgaben-ID in `id`; das Turnier steht dort in `turnierId`.
    const turnierId = currentPath.includes('orga-aufgabe.html')
        ? urlParams.get('turnierId')
        : (urlParams.get('id') || urlParams.get('turnierId'));

    // Turnier-ID sofort an die Menü-Links hängen, noch bevor window.hajimeAktualisiereMenueSperren
    // existiert: Seiten-Skripte (z.B. pools.js beim ersten Laden) sperren Menüpunkte teils, während
    // diese Initialisierung noch auf Serverantworten wartet. Die Sperre sichert den Link als
    // Backup und stellt ihn beim Entsperren wieder her — ohne Turnier-ID landete man sonst z.B.
    // auf matten.html ohne Parameter, wo das Menü nur noch "Turniere" zeigt.
    if (turnierId) {
        document.querySelectorAll('.menu-item').forEach(link => {
            const href = link.getAttribute('href');
            if (href && href !== '#') {
                if (href.includes('turniere.html') || link.hasAttribute('data-ohne-turnier')) return;
                const paramName = href.includes('turnier.html') ? 'id' : 'turnierId';
                link.setAttribute('href', `${href}${href.includes('?') ? '&' : '?'}${paramName}=${turnierId}`);
            }
        });
    }

    // Eingeklappte Seitenleiste sofort anwenden, sonst springt der Inhalt nach dem Laden zur Seite.
    try {
        document.body.classList.toggle('sidebar-collapsed', localStorage.getItem('hajime-sidebar-collapsed') === 'true');
    } catch (e) { /* localStorage gesperrt: ausgeklappt */ }

    // Bis initialisiereMenue() fertig ist, steht der zuletzt gesehene Menüstand als Platzhalter da;
    // das echte Menü rechnet verborgen im Hintergrund und wird in gibMenueFrei() getauscht.
    if (zeigeMenuePlatzhalter()) {
        document.querySelectorAll('.app-sidebar:not(.menue-platzhalter), .top-header-bar:not(.menue-platzhalter)')
            .forEach(el => el.classList.add('menue-verborgen'));
    }
}

if (document.body) {
    baueMenueGeruest();
} else {
    // menu.js steht im <head>: auf das Anlegen von <body> warten. Der Beobachter läuft als Microtask
    // noch in derselben Parser-Aufgabe, also bevor der Browser zum ersten Mal zeichnet.
    const bodyBeobachter = new MutationObserver(() => {
        if (!document.body) return;
        bodyBeobachter.disconnect();
        baueMenueGeruest();
    });
    bodyBeobachter.observe(document.documentElement, { childList: true });
}

document.addEventListener('DOMContentLoaded', () => {
    baueMenueGeruest();
    initialisiereMenue().catch((error) => {
        console.error('Fehler beim Aufbau des Menüs:', error);
        gibMenueFrei();
    });
});

async function initialisiereMenue() {
    // --- AUTHENTIFIZIERUNGSPRÜFUNG ---
    try {
        const resp = await fetch('/api/auth/mode');
        const data = await resp.json();
        if (data.passwordRequired) {
            const savedPw = localStorage.getItem('steuerung_password');
            if (!savedPw) {
                showGlobalLoginModal();
                return;
            } else {
                const verifyResp = await fetch('/api/auth/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: savedPw })
                });
                if (!verifyResp.ok) {
                    localStorage.removeItem('steuerung_password');
                    showGlobalLoginModal();
                    return;
                }
                const antwort = await verifyResp.json().catch(() => ({}));
                if (antwort.aenderungErforderlich) {
                    zeigePasswortAenderungModal();
                    return;
                }
            }
        }
    } catch (err) {
        console.error('Fehler bei der Berechtigungsprüfung:', err);
    }
    const urlParams = new URLSearchParams(window.location.search);
    const currentPath = window.location.pathname;
    // orga-aufgabe.html führt die Aufgaben-ID in `id`; das Turnier steht dort in `turnierId`.
    const turnierId = currentPath.includes('orga-aufgabe.html')
        ? urlParams.get('turnierId')
        : (urlParams.get('id') || urlParams.get('turnierId'));


    // Hilfsfunktion: Macht Menüpunkte sichtbar, aber blockiert die Klickbarkeit vollständig
    // (für Schritte, die noch nicht erreichbar sind, z.B. Pools ohne Teilnehmer)
    const sperreMenuePunkte = (idListe) => {
        for (const id of idListe) {
            const link = document.getElementById(id);
            if (!link) continue;

            // Ursprünglichen Link (inkl. turnierId-Parameter) sichern, damit entsperreMenuePunkte
            // ihn bei einer späteren Live-Neubewertung (z.B. nach dem Anlegen von Pools) wieder
            // herstellen kann, statt dauerhaft auf "#" zu verharren.
            if (!link.classList.contains('disabled')) {
                link.dataset.hrefBackup = link.getAttribute('href');
            }
            link.classList.add('disabled');
            link.setAttribute('href', '#');
            link.style.pointerEvents = 'none';
        }
    };

    // Hilfsfunktion: Gegenstück zu sperreMenuePunkte — gibt zuvor gesperrte Menüpunkte wieder
    // frei, sobald die Voraussetzung dafür erfüllt ist (z.B. nach dem Anlegen von Pools).
    const entsperreMenuePunkte = (idListe) => {
        for (const id of idListe) {
            const link = document.getElementById(id);
            if (!link) continue;

            if (link.dataset.hrefBackup) {
                link.setAttribute('href', link.dataset.hrefBackup);
                delete link.dataset.hrefBackup;
            }
            link.classList.remove('disabled');
            link.style.pointerEvents = '';
        }
    };

    // Pools: erst auswählbar, sobald mindestens zwei Teilnehmer kampfbereit sind (weniger
    // ergibt keine sinnvolle Poolbildung) oder bereits Pools existieren. Wird initial beim Seitenaufruf geprüft und danach
    // erneut von teilnehmer.js nach jeder Statusänderung eines Teilnehmers.
    const pruefePoolsMenuSperre = async (tId) => {
        try {
            const response = await fetch(`/api/teilnehmer?turnierId=${tId}`);
            const teilnehmer = await response.json();
            const kampfbereitAnzahl = Array.isArray(teilnehmer)
                ? teilnehmer.filter(t => t.status === 'kampfbereit').length
                : 0;

            // Auch mit bestehenden Pools bleibt der Punkt frei: sind die Kämpfe gelaufen, gelten die Teilnehmer
            // nicht mehr als "kampfbereit", der Pool wartet aber auf Ergebnisprüfung/Abschluss (Warn-Badge).
            let hatPools = false;
            if (kampfbereitAnzahl < 2) {
                const pools = await fetch(`/api/pools/details?turnierId=${tId}`).then(r => r.json()).catch(() => []);
                hatPools = Array.isArray(pools) && pools.length > 0;
            }

            if (kampfbereitAnzahl < 2 && !hatPools) {
                sperreMenuePunkte(['nav-pools']);
            } else {
                entsperreMenuePunkte(['nav-pools']);
            }
        } catch (error) {
            console.error('Fehler bei der Pools-Menü-Validierung:', error);
            sperreMenuePunkte(['nav-pools']);
        }
    };

    // Matten: erst auswählbar, sobald mindestens ein Pool existiert — Einzel- ODER Mannschafts-Pool
    // (letztere liefert /api/pools/details bewusst nicht). Wird initial geprüft und danach erneut
    // von pools.js/mannschaften.js nach jedem Anlegen/Löschen von Pools.
    const pruefeMattenMenuSperre = async (tId) => {
        try {
            const poolsResponse = await fetch(`/api/pools/details?turnierId=${tId}`);
            let pools = await poolsResponse.json();
            if (!Array.isArray(pools) || pools.length === 0) {
                pools = await fetch(`/api/mannschaften/pools?turnierId=${tId}`).then(r => r.json()).catch(() => []);
            }

            if (!Array.isArray(pools) || pools.length === 0) {
                sperreMenuePunkte(['nav-matten']);
            } else {
                entsperreMenuePunkte(['nav-matten']);
            }
        } catch (error) {
            console.error('Fehler bei der Matten-Menü-Validierung:', error);
            sperreMenuePunkte(['nav-matten']);
        }
    };

    // Kampf (und Siegerliste, die dieselbe Voraussetzung teilt): erst auswählbar, sobald
    // mindestens einer Kampffläche (Matte) ein Pool zugeordnet wurde. Wird initial geprüft und
    // danach erneut von pools.js (Pools an-/abgelegt) sowie matten.js (Zuordnung
    // gesetzt/aufgehoben).
    const pruefeKampfMenuSperre = async (tId) => {
        try {
            const kampfflaechenResponse = await fetch(`/api/pools/kampfflaechen?turnierId=${tId}`);
            const kampfflaechenData = await kampfflaechenResponse.json();
            const kampfflaechen = Array.isArray(kampfflaechenData?.kampfflaechen) ? kampfflaechenData.kampfflaechen : [];
            const hatZugeordneteMatte = kampfflaechen.some(kf => Array.isArray(kf.pools) && kf.pools.length > 0);

            if (!hatZugeordneteMatte) {
                sperreMenuePunkte(['nav-kampf', 'nav-siegerliste']);
            } else {
                entsperreMenuePunkte(['nav-kampf', 'nav-siegerliste']);
            }
        } catch (error) {
            console.error('Fehler bei der Kampf-Menü-Validierung:', error);
            sperreMenuePunkte(['nav-kampf', 'nav-siegerliste']);
        }
    };

    // Gelbes Achtung-Icon am Menüpunkt "Pools": erscheint, sobald mindestens ein
    // (Einzelwettkampf-)Pool im Status "Ergebnisse prüfen" (kaempfe_beendet) auf die
    // manuelle Tischbestätigung wartet, und verschwindet wieder, sobald keiner mehr in
    // diesem Status ist. Der Statuswechsel passiert serverseitig beim Kampfende auf
    // kampf.html/matten.html, wo kein Skript diese Prüfung direkt anstößt — daher zusätzlich
    // per Intervall unten periodisch neu bewertet, nicht nur reaktiv.
    const pruefePoolsErgebnisWarnung = async (tId) => {
        const badge = document.getElementById('nav-pools-warning');
        if (!badge) return;

        try {
            const response = await fetch(`/api/pools/details?turnierId=${tId}`);
            const pools = await response.json();
            const hatWartendePools = Array.isArray(pools) && pools.some(p => p.status === 'kaempfe_beendet');
            badge.style.display = hatWartendePools ? 'inline-block' : 'none';
        } catch (error) {
            console.error('Fehler bei der Prüfung offener Pool-Ergebnisse:', error);
        }
    };

    // Gelbes Achtung-Icon am Menüpunkt "Mannschaften": exaktes Pendant zu
    // pruefePoolsErgebnisWarnung oben, nur für Mannschafts-Pools (die bewusst nicht in
    // /api/pools/details auftauchen, siehe pruefePoolsErgebnisWarnung), daher eigener Endpunkt
    // und eigenes Badge statt Wiederverwendung von nav-pools-warning.
    const pruefeMannschaftenErgebnisWarnung = async (tId) => {
        const badge = document.getElementById('nav-mannschaften-warning');
        if (!badge) return;

        try {
            const response = await fetch(`/api/mannschaften/pools?turnierId=${tId}`);
            const pools = await response.json();
            const hatWartendePools = Array.isArray(pools) && pools.some(p => p.status === 'kaempfe_beendet');
            badge.style.display = hatWartendePools ? 'inline-block' : 'none';
        } catch (error) {
            console.error('Fehler bei der Prüfung offener Mannschafts-Pool-Ergebnisse:', error);
        }
    };

    // Globaler Zugriffspunkt für andere Skripte (teilnehmer.js, pools.js, matten.js, mannschaften.js),
    // um nach einer eigenen Änderung gezielt einzelne Menü-Sperren live neu zu bewerten, ohne die
    // gesamte Seite neu laden zu müssen. bereiche: Teilmenge aus ['pools', 'matten', 'kampf', 'mannschaften'].
    window.hajimeAktualisiereMenueSperren = async (bereiche = ['pools', 'matten', 'kampf', 'mannschaften']) => {
        const params = new URLSearchParams(window.location.search);
        const aktiveTurnierId = params.get('id') || params.get('turnierId');
        if (!aktiveTurnierId) return;

        const aufgaben = [];
        if (bereiche.includes('pools')) aufgaben.push(pruefePoolsMenuSperre(aktiveTurnierId));
        if (bereiche.includes('matten')) aufgaben.push(pruefeMattenMenuSperre(aktiveTurnierId));
        if (bereiche.includes('kampf')) aufgaben.push(pruefeKampfMenuSperre(aktiveTurnierId));
        if (bereiche.includes('pools')) aufgaben.push(pruefePoolsErgebnisWarnung(aktiveTurnierId));
        if (bereiche.includes('mannschaften')) aufgaben.push(pruefeMannschaftenErgebnisWarnung(aktiveTurnierId));
        await Promise.all(aufgaben);
    };

    // Hilfsfunktion: Blendet Menüpunkte vollständig aus (für Zugriffsbeschränkungen, nicht
    // nur temporär unerreichbare Schritte)
    const versteckeMenuePunkte = (idListe) => {
        for (const id of idListe) {
            const link = document.getElementById(id);
            if (!link) continue;

            link.style.display = 'none';
        }
    };

    // Orga und Helferplan ausblenden (Rolle ohne Admin-Recht bzw. Turnier ohne Planungs-Tools); die Gruppe verschwindet ganz.
    const versteckeOrgaPunkte = () => {
        versteckeMenuePunkte(['nav-helfer', 'nav-orga-uebersicht', 'nav-orga-technik', 'nav-orga-catering', 'nav-orga-medaillen']);
        versteckeMenuePunkte(['nav-orga']);
    };

    // Funktionen des Turniers (Assistent in turnier.html, src/shared/turnierFunktionen.js): ausgeschaltete Funktionen verlieren ihre
    // Menüpunkte; Knöpfe auf den Seiten (data-funktion="…") und das Kopfzeilen-Symbol verbirgt die CSS-Klasse fkt-aus-<Schlüssel> am body.
    const FUNKTION_MENUE = {
        urkunden: ['nav-urkunden', 'nav-urkunden-designer'],
        anzeige: ['nav-dashboard', 'nav-uebersicht'],
        video: ['nav-videobeweis'],
        streaming: ['nav-video-live']
    };
    const wendeTurnierFunktionenAn = async (roh) => {
        const { normalisiereFunktionen, FUNKTIONEN } = await import('/js/shared/turnierFunktionen.js');
        const funktionen = normalisiereFunktionen(roh);
        window.hajimeFunktionen = funktionen;
        for (const schluessel of FUNKTIONEN) document.body.classList.toggle(`fkt-aus-${schluessel}`, !funktionen[schluessel]);
        for (const [schluessel, ids] of Object.entries(FUNKTION_MENUE)) {
            if (!funktionen[schluessel]) versteckeMenuePunkte(ids);
        }
    };

    // --- BENUTZERSTATUS EINMALIG LADEN (für Freigabe- und Vereins-Prüfung) ---
    let currentUser = null;
    try {
        const meResp = await fetch('/api/auth/me');
        if (meResp.ok) {
            const meData = await meResp.json();
            currentUser = meData.user;
        }
    } catch (error) {
        console.error('Fehler beim Laden des Benutzerstatus:', error);
    }

    // Im Offline-Modus (lokaler Kiosk-Betrieb) gelten keine Vereins-Einschränkungen,
    // analog zur Server-Middleware.
    let istOffline = false;
    let syncRolle = null;
    let configGeladen = false;
    try {
        const configResp = await fetch('/api/config');
        if (configResp.ok) {
            const config = await configResp.json();
            istOffline = !!config.isOffline;
            syncRolle = config.syncRolle || null;
            configGeladen = true;
        }
    } catch (error) {
        console.error('Fehler beim Laden der System-Konfiguration:', error);
    }

    // Cloud-Server: Cloud-Symbol oben rechts (nur Anzeige, am Hallen-Server fehlt es).
    const cloudAnzeige = document.getElementById('cloudAnzeige');
    if (cloudAnzeige && configGeladen && !istOffline) cloudAnzeige.style.display = '';

    // --- MENÜ-RECHTE NACH ROLLE (Helferverwaltung, src/shared/menueRechte.js) ---
    // Nur in der Cloud: reine Helfer (oder Konten ohne freigegebene Rolle im aktiven Verein) sehen kein
    // Verwaltungsmenü. Im Einzelbenutzerbetrieb (Hallen-Server, Client-Gerät) bleibt alles wie bisher; ebenso,
    // wenn Konfiguration, Benutzer oder Regeln nicht ladbar sind (der Server prüft die Rechte ohnehin selbst).
    let menueRechte = null;
    try {
        menueRechte = await import('/js/shared/menueRechte.js');
    } catch (error) {
        console.error('Menü-Rechte nicht ladbar:', error);
    }
    const einzelbenutzer = !configGeladen || istOffline || !currentUser || !menueRechte;
    const rechte = menueRechte
        ? menueRechte.menueFuerRolle({
            rolle: currentUser && currentUser.verein_rolle,
            istSuperAdmin: !!(currentUser && currentUser.super_admin_aktiv),
            einzelbenutzer
        })
        : { verwaltung: true, helferPlan: true, nutzer: false, helferApp: false };
    const verwaltbar = !einzelbenutzer ? menueRechte.verwaltbareVereine(currentUser.vereine) : [];

    if (!rechte.verwaltung) {
        // Aktiver Verein ist nur ein Helfer-Verein (oder noch nicht freigegeben), es gibt aber einen
        // verwaltbaren: dorthin wechseln, statt die Verwaltung zu verweigern.
        if (verwaltbar.length > 0 && !menueRechte.istHelferFreieSeite(currentPath)) {
            try {
                const resp = await fetch('/api/vereine/aktiv', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ vereinId: verwaltbar[0].verein_id })
                });
                if (resp.ok) {
                    vergissMenueStand();
                    window.location.reload();
                    return;
                }
            } catch (error) {
                console.error('Wechsel in einen verwaltbaren Verein fehlgeschlagen:', error);
            }
        }
        // Keine Verwaltung: zur Helfer-App (ohne jeden Verein wie bisher zur Vereinsauswahl).
        if (!menueRechte.istHelferFreieSeite(currentPath)) {
            const ohneVerein = !Array.isArray(currentUser.vereine) || currentUser.vereine.length === 0;
            window.location.href = ohneVerein ? '/verein_auswahl.html' : '/helfer.html';
            return;
        }
    }

    // --- GENEHMIGUNGS-HINWEIS: freizugebende Benutzer, die auf Prüfung warten ---
    // Läuft auf jeder Seite (menu.js ist überall eingebunden), damit weder der Super-Admin
    // (Erstregistrierungen, /api/vereine/super/pending) noch ein einfaches freigegebenes
    // Vereinsmitglied (weitere Funktionäre des eigenen Vereins, /api/vereine/pending) die
    // Warteschlange erst durch Aufrufen von profil.html bzw. turniere.html entdecken muss. Beide
    // Zählungen laufen unabhängig voneinander und addieren sich zu einer Zahl auf dem Profil-Icon
    // — ein Benutzer kann durchaus beides zugleich sein (z.B. der Super-Admin in seinem eigenen
    // Verein). window.hajimeAktualisiereGenehmigungsHinweis ist der globale Zugriffspunkt, damit
    // profil.html/turniere.html den Hinweis nach einer eigenen Freigabe-/Ablehnungs-Aktion sofort
    // live aktualisieren können, ohne auf einen Seiten-Reload angewiesen zu sein.
    window.hajimeAktualisiereGenehmigungsHinweis = async () => {
        const erstZaehler = document.getElementById('nav-erstregistrierungen-zaehler');
        if (erstZaehler) erstZaehler.style.display = 'none';
        const mitgliederZaehler = document.getElementById('nav-mitglieder-zaehler');
        if (mitgliederZaehler) mitgliederZaehler.style.display = 'none';

        if (currentUser && currentUser.super_admin_aktiv) {
            try {
                const resp = await fetch('/api/vereine/super/pending');
                if (resp.ok) {
                    const pending = await resp.json();
                    const n = Array.isArray(pending) ? pending.length : 0;
                    if (erstZaehler && n > 0) {
                        erstZaehler.textContent = String(n);
                        erstZaehler.title = `${n} offene Erstregistrierung${n === 1 ? '' : 'en'}`;
                        erstZaehler.style.display = '';
                    }
                }
            } catch (error) {
                console.error('Fehler beim Laden der Erstregistrierungs-Warteschlange:', error);
            }
        }

        // Beitrittsanfragen des eigenen Vereins (roter Kreis am Menüpunkt „Mitglieder“). Liefert 403, wenn das Konto in
        // keinem Verein Admin ist — das ist kein Fehlerfall, sondern schlicht "keine Genehmigungsrechte".
        try {
            const resp = await fetch('/api/vereine/pending');
            if (resp.ok) {
                const pending = await resp.json();
                const n = Array.isArray(pending) ? pending.length : 0;
                if (mitgliederZaehler && n > 0) {
                    mitgliederZaehler.textContent = String(n);
                    mitgliederZaehler.title = `${n} offene Beitrittsanfrage${n === 1 ? '' : 'n'}`;
                    mitgliederZaehler.style.display = '';
                }
            }
        } catch (error) {
            console.error('Fehler beim Laden der Beitrittsanfragen-Warteschlange:', error);
        }
    };
    await window.hajimeAktualisiereGenehmigungsHinweis();

    // --- NACHRICHTEN: roter Kreis mit der Zahl ungelesener Unterhaltungen am Profil-Icon (Super-Admins zusätzlich am Menüpunkt) ---
    // Die Route gibt es nur in der Cloud; ohne sie (404) bleibt alles ausgeblendet und das Profil-Icon führt direkt zum Profil.
    window.hajimeAktualisiereNachrichten = async () => {
        try {
            const resp = await fetch('/api/nachrichten/ungelesen');
            if (!resp.ok) return;
            const { anzahl } = await resp.json();
            window.hajimeNachrichtenAktiv = true;
            for (const id of ['profilBadge', 'nav-nachrichten-zaehler', 'profilMenueZaehler']) {
                const el = document.getElementById(id);
                if (!el) continue;
                el.textContent = String(anzahl);
                el.title = `${anzahl} ungelesene Nachricht${anzahl === 1 ? '' : 'en'}`;
                el.style.display = anzahl > 0 ? '' : 'none';
            }
        } catch (error) {
            console.error('Fehler beim Laden der Nachrichten-Anzahl:', error);
        }
    };
    if (!einzelbenutzer) {
        await window.hajimeAktualisiereNachrichten();
        setInterval(() => { if (!document.hidden) window.hajimeAktualisiereNachrichten(); }, 60000);
    }

    // Nach einem Rollenwechsel (anderer Verein oder Super-Admin-Modus) zeigt die App den Zustand, den die Rolle nach
    // dem Login sähe: Startseite der Rolle (Turniere bzw. Helfer-App), keine Reste des vorigen Turniers. verein =
    // gewählter Verein aus currentUser.vereine, null für den Super-Admin-Modus.
    window.hajimeNachRollenwechsel = (verein) => {
        const verwaltet = !verein || einzelbenutzer || (menueRechte && menueRechte.verwaltbareVereine([verein]).length > 0);
        try { localStorage.removeItem('aktiveTurnierId'); } catch { /* localStorage nicht verfügbar */ }
        vergissMenueStand();
        window.location.href = verwaltet ? '/turniere.html' : '/helfer.html';
    };

    // --- AKTIVER VEREIN IN DER KOPFLEISTE (Anzeige + Wechsler bei mehreren Vereinen) ---
    // Ein Benutzer ist immer mindestens einem Verein zugeordnet (keine anonymen Anmeldungen);
    // bei mehreren Mitgliedschaften kann er hier den gerade "aktiven" Verein wechseln, der
    // bestimmt, welches Turnier/welche Daten er in der App sieht (siehe hatVereinsZugriffAufTurnier
    // in src/utils/vereinHelper.js).
    (function initVereinSwitcher() {
        const vereine = currentUser && Array.isArray(currentUser.vereine) ? currentUser.vereine : [];
        // Super-Admins (Cloud) bekommen zusätzlich den Eintrag „Super-Admin“: globale Rechte; in einem Verein
        // gelten nur die Rechte der Rolle dort (Server und Menü).
        const kannSuperAdminModus = !!(currentUser && currentUser.ist_super_admin) && !einzelbenutzer;
        const imSuperAdminModus = kannSuperAdminModus && !!currentUser.super_admin_aktiv;
        if (vereine.length === 0 && !kannSuperAdminModus) return;

        const switcher = document.getElementById('vereinSwitcher');
        const btn = document.getElementById('vereinSwitcherBtn');
        const nameEl = document.getElementById('vereinSwitcherName');
        const caret = document.getElementById('vereinSwitcherCaret');
        const menu = document.getElementById('vereinSwitcherMenu');
        if (!switcher || !btn || !nameEl || !menu) return;

        const aktiverVerein = vereine.find(v => v.verein_id === currentUser.verein_id) || vereine[0];
        nameEl.textContent = imSuperAdminModus || !aktiverVerein ? 'Super-Admin' : aktiverVerein.name;
        switcher.style.display = '';

        if (vereine.length + (kannSuperAdminModus ? 1 : 0) <= 1) {
            btn.classList.add('no-dropdown');
            return;
        }

        caret.style.display = '';

        const schliesseMenu = () => { menu.style.display = 'none'; };

        // Als aktiven Verein der Verwaltung bietet der Wechsler in der Cloud nur Vereine an, in denen das Konto
        // Benutzer oder Admin ist (Spec 3.3); reine Helfer- und wartende Vereine stehen nur zur Ansicht da.
        // Super-Admins und der Einzelbenutzerbetrieb wechseln wie bisher frei.
        const verwaltbareIds = new Set(verwaltbar.map(v => v.verein_id));
        const darfWechseln = (v) => einzelbenutzer || !!currentUser.ist_super_admin || verwaltbareIds.has(v.verein_id);
        const rollenText = (menueRechte && menueRechte.ROLLEN_TEXT) || {};
        const statusText = (v) => {
            if (!v.freigegeben) return 'Freigabe ausstehend';
            return v.rolle && rollenText[v.rolle] ? `Freigegeben · ${rollenText[v.rolle]}` : 'Freigegeben';
        };

        const superItem = () => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `verein-switcher-item${imSuperAdminModus ? ' aktiv' : ''}`;
            item.dataset.superAdmin = '1';
            const name = document.createElement('span');
            name.textContent = 'Super-Admin';
            const status = document.createElement('span');
            status.className = 'verein-switcher-item-status';
            status.textContent = 'Alle Vereine verwalten';
            item.append(name, status);
            return item;
        };

        menu.replaceChildren(...(kannSuperAdminModus ? [superItem()] : []), ...vereine.map(v => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `verein-switcher-item${!imSuperAdminModus && v.verein_id === aktiverVerein.verein_id ? ' aktiv' : ''}`;
            item.dataset.vereinId = String(v.verein_id);
            const name = document.createElement('span');
            name.textContent = v.name;
            const status = document.createElement('span');
            status.className = 'verein-switcher-item-status';
            status.textContent = statusText(v);
            item.append(name, status);
            if (!darfWechseln(v) && (imSuperAdminModus || v.verein_id !== aktiverVerein.verein_id)) {
                item.disabled = true;
                item.title = 'Nur für die Helfer-App: hier fehlt die Rolle Benutzer oder Admin.';
                item.style.opacity = '0.55';
                item.style.cursor = 'default';
            }
            return item;
        }));

        menu.querySelectorAll('.verein-switcher-item:not([disabled])').forEach(item => {
            item.addEventListener('click', async () => {
                const wechselZuSuperAdmin = item.dataset.superAdmin === '1';
                const vereinId = item.getAttribute('data-verein-id');
                if (wechselZuSuperAdmin ? imSuperAdminModus : (!imSuperAdminModus && parseInt(vereinId) === aktiverVerein.verein_id)) {
                    schliesseMenu();
                    return;
                }
                try {
                    const resp = await fetch('/api/vereine/aktiv', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(wechselZuSuperAdmin ? { superAdmin: true } : { vereinId })
                    });
                    const data = await resp.json();
                    if (!resp.ok) throw new Error(data.error || 'Vereinswechsel fehlgeschlagen');
                    window.hajimeNachRollenwechsel(wechselZuSuperAdmin ? null : vereine.find(v => String(v.verein_id) === String(vereinId)));
                } catch (err) {
                    schliesseMenu();
                    if (window.zeigeNotification) window.zeigeNotification(err.message, 'error');
                    else alert(err.message);
                }
            });
        });

        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? '' : 'none';
        });
        document.addEventListener('click', (event) => {
            if (!switcher.contains(event.target)) schliesseMenu();
        });
    })();

    // --- CLIENT-GERÄT (SYNC_ROLLE=client, Notebook/Tablet an Matte oder Waage) ---
    // Es gibt nur Waage, Scoreboard und Mattenleitung (die Verwaltung liegt am Hallen-Server,
    // siehe src/sync/clientApi.js). Die Menü-Sperren-Prüfungen des Servers entfallen.
    if (syncRolle === 'client') {
        const clientTurnierId = turnierId || localStorage.getItem('aktiveTurnierId');
        versteckeMenuePunkte(['nav-turniere', 'nav-turnier', 'nav-pools', 'nav-mannschaften', 'nav-matten', 'nav-helfer', 'nav-orga', 'nav-siegerliste', 'nav-urkunden', 'nav-urkunden-designer', 'nav-dashboard', 'nav-uebersicht']);
        const nav = document.getElementById('sidebarNavPrimary');
        const suffix = clientTurnierId ? `?turnierId=${clientTurnierId}` : '';
        const teilnehmerLink = document.getElementById('nav-teilnehmer');
        if (teilnehmerLink) {
            teilnehmerLink.setAttribute('href', `/teilnehmer.html${suffix}`);
            teilnehmerLink.querySelector('.menu-text').textContent = 'Waage';
        }
        const kampfLink = document.getElementById('nav-kampf');
        if (kampfLink) kampfLink.setAttribute('href', `/kampf.html${suffix}`);
        if (nav) {
            const zusatz = (id, href, icon, text) => {
                const a = document.createElement('a');
                a.href = href;
                a.className = 'menu-item';
                a.id = id;
                a.innerHTML = `<span class="material-icons">${icon}</span><span class="menu-text">${text}</span>`;
                return a;
            };
            nav.insertBefore(zusatz('nav-geraet', '/client.html', 'devices', 'Gerät'), nav.firstChild);
            nav.appendChild(zusatz('nav-scoreboard', `/steuerung.html${suffix}`, 'scoreboard', 'Scoreboard'));
        }
        markiereAktivenMenuepunkt(id => document.getElementById(id));
        gibMenueFrei();
        return;
    }

    // Nachzügler-Zähler am Menüpunkt "Pools" (alle Rollen außer client): wird von pools.js gesetzt, solange pools.html offen ist.
    const poolsBadge = document.getElementById('nav-pools-badge');
    window.hajimeAktualisiereNachzuegler = () => {
        if (!poolsBadge) return;
        const anzahl = window.hajimeNachzueglerZaehler || 0;
        poolsBadge.textContent = String(anzahl);
        poolsBadge.style.display = anzahl > 0 ? 'inline-block' : 'none';
        poolsBadge.title = anzahl > 0 ? `${anzahl} Nachzügler warten auf einen Pool` : '';
    };
    window.hajimeAktualisiereNachzuegler();

    // Auf allen anderen Seiten holt das Menü den Zähler selbst (einmal beim Start, dann periodisch);
    // auf pools.html aktualisiert pools.js ihn zusätzlich nach jeder Änderung.
    let nachzueglerTurnierId = null;
    try { nachzueglerTurnierId = turnierId || localStorage.getItem('aktiveTurnierId'); } catch { /* localStorage nicht verfügbar */ }
    if (nachzueglerTurnierId && poolsBadge) {
        const holeNachzueglerZaehler = async () => {
            if (document.hidden) return;
            try {
                const antwort = await fetch(`/api/pools/nachzuegler?turnierId=${encodeURIComponent(nachzueglerTurnierId)}`);
                if (!antwort.ok) return; // 403/404 (kein Zugriff, Turnier fehlt): Zähler bleibt unverändert
                const daten = await antwort.json();
                const mitVorschlag = (daten.nachzuegler || []).filter(n => n.vorschlag).length;
                window.hajimeNachzueglerZaehler = mitVorschlag + (daten.imSammelpool || 0);
                window.hajimeAktualisiereNachzuegler();
            } catch { /* Netzwerkfehler: still ignorieren */ }
        };
        holeNachzueglerZaehler();
        setInterval(holeNachzueglerZaehler, 30000);
    }

    // --- TEILNEHMER-APP (Schalter am Hallen-Server, public/js/teilnehmerApp.js): Icon links vom Cluster-Symbol ---
    if (istOffline && !document.getElementById('teilnehmerAppSkript')) {
        const skript = document.createElement('script');
        skript.id = 'teilnehmerAppSkript';
        skript.src = '/js/teilnehmerApp.js';
        skript.onload = () => window.TeilnehmerApp && window.TeilnehmerApp.init();
        document.head.appendChild(skript);
    }

    // --- SERVER-CLUSTER (Hallen-Server mit CLUSTER_KNOTEN, siehe src/cluster/) ---
    // Zugang zur Cluster-Seite nur über den Knopf "Hallen-Server" in der Kopfzeile; auf dem Secondary zusätzlich ein Hinweis, dass nur gelesen werden kann.
    if (syncRolle === 'server') {
        // Kopplung neuer Client-Geräte (QR-Code + 6-stelliger Code) gibt es nur am Hallen-Server.
        const clientKonfigLink = document.getElementById('nav-client-konfig');
        if (clientKonfigLink) clientKonfigLink.style.display = '';
        // Video live / Video-Archiv (Sektion Kontrolle): nur sichtbar, wenn im gewählten Turnier eine Kamera live aufnimmt
        // bzw. Clips vorhanden sind (Clips liegen nur am Hallen-Server). Auf der eigenen Seite bleibt der Punkt immer stehen.
        const videoLiveLink = document.getElementById('nav-video-live');
        const videoLink = document.getElementById('nav-videobeweis');
        const aktualisiereVideoMenue = async () => {
            if (document.hidden) return; // versteckter Tab fragt nicht ab
            try {
                const antwort = await fetch(`/api/video/status${turnierId ? `?turnierId=${encodeURIComponent(turnierId)}` : ''}`, { cache: 'no-store' });
                if (!antwort.ok) return;
                const status = await antwort.json();
                // Ausgeschaltete Funktionen des Turniers bleiben weg, auch wenn gerade aufgenommen wird oder Clips da sind.
                const funktionen = window.hajimeFunktionen || {};
                if (videoLiveLink) {
                    const zeigen = (status.live || []).length > 0 || currentPath.includes('video-live.html');
                    videoLiveLink.style.display = zeigen && funktionen.streaming !== false ? '' : 'none';
                }
                if (videoLink) {
                    const zeigen = (status.clips || 0) > 0 || currentPath.includes('videobeweis.html');
                    videoLink.style.display = zeigen && funktionen.video !== false ? '' : 'none';
                }
            } catch (fehler) {
                // Menü bleibt beim letzten Stand
            }
        };
        aktualisiereVideoMenue();
        setInterval(aktualisiereVideoMenue, 15000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) aktualisiereVideoMenue(); });
        // Sync-Konflikte: Menüpunkt mit Zähler der offenen Konflikte (hohe Priorität: rot).
        const syncKonflikteLink = document.getElementById('nav-sync-konflikte');
        if (syncKonflikteLink) {
            // Erst sichtbar, wenn es offene Konflikte gibt (oder auf der eigenen Seite).
            const syncKonflikteBadge = document.getElementById('nav-sync-konflikte-badge');
            const aktualisiereSyncKonflikte = async () => {
                try {
                    const antwort = await fetch('/api/sync/konflikte', { cache: 'no-store' });
                    if (!antwort.ok) return;
                    const konflikte = await antwort.json();
                    const anzahl = konflikte.length;
                    syncKonflikteBadge.textContent = anzahl > 99 ? '99+' : String(anzahl);
                    syncKonflikteBadge.style.display = anzahl > 0 ? 'inline-block' : 'none';
                    syncKonflikteBadge.classList.toggle('hoch', konflikte.some(k => k.prioritaet === 'hoch'));
                    syncKonflikteLink.style.display = anzahl > 0 || currentPath.includes('sync-konflikte.html') ? '' : 'none';
                    syncKonflikteLink.title = anzahl > 0 ? `${anzahl} offene${anzahl === 1 ? 'r' : ''} Sync-Konflikt${anzahl === 1 ? '' : 'e'}` : '';
                } catch (fehler) {
                    // Zähler bleibt beim letzten Stand
                }
            };
            window.hajimeAktualisiereSyncKonflikte = aktualisiereSyncKonflikte;
            aktualisiereSyncKonflikte();
            setInterval(aktualisiereSyncKonflikte, 10000);
        }
        // Button "Hallen-Server" in der Kopfzeile (links vom Logout) führt zur Cluster-Statusseite;
        // ohne CLUSTER_KNOTEN zeigt cluster.html einen entsprechenden Hinweis.
        const hallenServerBtn = document.getElementById('hallenServerBtn');
        if (hallenServerBtn) hallenServerBtn.style.display = '';
        // Icon-Farbe nach Anzahl erreichbarer Server: alle online = grün, im Cluster nur einer
        // von zwei = gelb, eigener Server nicht erreichbar = rot. Ohne Cluster gibt es nur einen.
        const hallenServerIcon = hallenServerBtn?.querySelector('.material-icons');
        const zeigeServerAnzahl = (online, gesamt) => {
            if (!hallenServerIcon) return;
            const farbe = online === 0 ? '#c62828' : online < gesamt ? '#f9a825' : '#2e7d32';
            hallenServerIcon.style.color = farbe;
            hallenServerBtn.title = `Status des Server-Clusters – ${online} von ${gesamt} Server${gesamt === 1 ? '' : 'n'} online`;
            hallenServerBtn.dataset.serverOnline = `${online}/${gesamt}`;
        };
        const holeClusterStatus = async () => {
            try {
                const antwort = await fetch('/api/cluster/status', { cache: 'no-store' });
                if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
                const status = await antwort.json();
                if (status.aktiv) zeigeServerAnzahl(1 + (status.partner ? 1 : 0), 2);
                else zeigeServerAnzahl(1, 1);
                return status;
            } catch (error) {
                const gesamt = hallenServerBtn?.dataset.serverOnline?.endsWith('/2') ? 2 : 1;
                zeigeServerAnzahl(0, gesamt);
                throw error;
            }
        };
        setInterval(() => holeClusterStatus().catch(() => {}), 5000);
        try {
            const status = await holeClusterStatus();
            const cluster = status.aktiv ? { aktiv: true, ...status.eigen } : status;
            if (cluster.aktiv) {
                if (cluster.rolle !== 'master' && !document.getElementById('secondaryBanner')) {
                    const banner = document.createElement('div');
                    banner.id = 'secondaryBanner';
                    banner.textContent = `Secondary (${cluster.knoten}) – nur lesend. Schreibzugriffe nur am Master über die VIP.`;
                    banner.style.cssText = 'position: fixed; top: 0; left: 50%; transform: translateX(-50%); z-index: 100000; background: #f9a825; color: #000; font-weight: bold; font-size: 13px; padding: 6px 16px; border-radius: 0 0 6px 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.25);';
                    document.body.appendChild(banner);
                }
            }
        } catch (error) {
            console.warn('Cluster-Status nicht lesbar:', error);
        }
    }

    // Verein gewählt, aber Beitritt noch nicht freigegeben: Vereinsverwaltung (eigenes Turnier
    // anlegen/bearbeiten, Pools, Matten, ...) bleibt gesperrt. Seit der Helferverwaltung landen solche
    // Cloud-Konten oben schon in der Helfer-App (rechte.verwaltung ist ohne freigegebene Rolle false);
    // hier kommen nur noch an: Super-Admins, deren aktiver Verein noch nicht freigegeben ist (sie behalten
    // die Verwaltung), und wartende Konten auf helfer-freien Seiten mit menu.js (profil.html), denen die
    // Turnier-Menüpunkte ausgeblendet werden.
    const wartetAufFreigabe = !!(currentUser && currentUser.verein_id && !currentUser.verein_freigegeben);

    // Initialpasswort (von einem Super-Admin vergeben): zuerst ein eigenes Passwort festlegen
    if (currentUser && currentUser.muss_passwort_aendern && !currentPath.includes('profil.html')) {
        window.location.href = '/profil.html?passwortAendern=1';
        return;
    }

    // Cloud: Vertrag zur Auftragsverarbeitung für Admins des aktiven Vereins (public/js/avVertrag.js fragt den Stand selbst ab)
    if (configGeladen && !istOffline && currentUser && currentUser.verein_rolle === 'admin' && !currentUser.super_admin_aktiv) {
        const s = document.createElement('script');
        s.src = '/js/avVertrag.js';
        document.head.appendChild(s);
    }

    if (wartetAufFreigabe) {
        versteckeMenuePunkte(['nav-turnier', 'nav-teilnehmer', 'nav-pools', 'nav-mannschaften', 'nav-matten', 'nav-helfer', 'nav-orga', 'nav-kampf', 'nav-siegerliste', 'nav-urkunden', 'nav-urkunden-designer', 'nav-dashboard', 'nav-uebersicht']);

        const istErlaubteSeite = currentPath.includes('turniere.html') || currentPath.includes('profil.html') || currentPath.includes('teilnehmer.html') || currentPath.includes('turnier-ansicht.html') || currentPath.includes('nachrichten.html') ||
            (rechte.nutzer && (currentPath.includes('admin-nutzer.html') || currentPath.includes('admin-einladungen.html') || currentPath.includes('admin-erstregistrierungen.html') || currentPath.includes('admin-vereine.html') || currentPath.includes('admin-turniere.html') || currentPath.includes('server-update.html') || currentPath.includes('sicherung.html') || currentPath.includes('protokoll.html') || currentPath.includes('konsole.html')));
        if (!istErlaubteSeite) {
            window.location.href = '/turniere.html';
            return;
        }
    } else {
        // --- STUFEN-VALIDIERUNG DER SICHTBARKEIT ---
        // Direkt nach der Anmeldung (kein Turnier ausgewählt) darf nur "Turniere" sichtbar sein.
        if (!turnierId) {
            versteckeMenuePunkte(['nav-turnier', 'nav-teilnehmer', 'nav-pools', 'nav-mannschaften', 'nav-matten', 'nav-helfer', 'nav-orga', 'nav-kampf', 'nav-siegerliste', 'nav-urkunden', 'nav-urkunden-designer', 'nav-dashboard', 'nav-uebersicht']);
        } else {
            await Promise.all([
                pruefePoolsMenuSperre(turnierId),
                pruefeMattenMenuSperre(turnierId),
                pruefeKampfMenuSperre(turnierId),
                pruefePoolsErgebnisWarnung(turnierId),
                pruefeMannschaftenErgebnisWarnung(turnierId)
            ]);

            // Periodische Neubewertung: der Statuswechsel eines Pools auf "kaempfe_beendet"
            // passiert serverseitig beim Kampfende (kampf.html/matten.html), ohne dass eines
            // dieser Skripte die Menü-Sperren-Prüfung aktiv anstößt — Polling deckt das ab,
            // unabhängig davon, auf welcher Seite gerade gearbeitet wird.
            setInterval(() => pruefePoolsErgebnisWarnung(turnierId), 15000);
            setInterval(() => pruefeMannschaftenErgebnisWarnung(turnierId), 15000);

            // --- TURNIERNAME ALS ÜBERSCHRIFT IN DER KOPFLEISTE ---
            // Wird für alle Nutzer geladen (nicht nur für die Vereins-Prüfung unten), damit die
            // Kopfleiste auf jeder Seite mit aktivem Turnier dessen Namen zeigt.
            try {
                const turnierResp = await fetch(`/api/turniere/${turnierId}`);
                if (turnierResp.ok) {
                    const turnier = await turnierResp.json();

                    const topHeaderTitle = document.getElementById('topHeaderTitle');

                    if (topHeaderTitle) {
                        // Formatiert das Datum garantiert als DD.MM.YYYY
                        const deutschesDatum = turnier.datum 
                            ? new Date(turnier.datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) 
                            : '';
                        
                        topHeaderTitle.textContent = turnier.bezeichnung + ' ' + deutschesDatum + ' (' + turnier.ort + ')';
                    }

                    // --- POOLS-SICHTBARKEIT: pools.html verwaltet ausschließlich Einzelwettkampf-
                    // Pools (Mannschafts-Pools laufen komplett getrennt über mannschaften.html,
                    // siehe CLAUDE.md) — ohne Einzel-Altersklassen gäbe es dort nichts zu tun.
                    let einzelKeys = [];
                    if (Array.isArray(turnier.altersklassen)) {
                        einzelKeys = turnier.altersklassen;
                    } else if (turnier.altersklassen && typeof turnier.altersklassen === 'object') {
                        einzelKeys = Object.keys(turnier.altersklassen);
                    }
                    if (einzelKeys.length === 0) {
                        versteckeMenuePunkte(['nav-pools']);
                    }

                    // --- MANNSCHAFTEN-SICHTBARKEIT: nur wenn das Turnier überhaupt ---
                    // Mannschafts-Altersklassen austrägt (sonst gibt es dort nichts zu verwalten).
                    const hatMannschaftsKlassen = Array.isArray(turnier.mannschafts_altersklassen) && turnier.mannschafts_altersklassen.length > 0;
                    if (!hatMannschaftsKlassen) {
                        versteckeMenuePunkte(['nav-mannschaften']);
                    }

                    // --- PLANUNGS-TOOLS: ohne den Haken im Turnier gibt es keinen Helferplan im Menü ---
                    if (turnier.planungs_tools === false) {
                        versteckeOrgaPunkte();
                    }

                    // --- FUNKTIONEN: Urkunden, Anzeigen, Video usw. nach den Schaltern im Turnier ---
                    await wendeTurnierFunktionenAn(turnier.funktionen);

                    // --- VEREINS-SICHTBARKEIT: Nutzer außerhalb des ausrichtenden Vereins ---
                    // dürfen nur die Teilnehmer-Ansicht (gefiltert auf den eigenen Verein) sehen.
                    if (currentUser && !istOffline) {
                        // Super-Admins dürfen die Turniere aller Vereine verwalten
                        const gehoertZuEigenemVerein = !!(currentUser.super_admin_aktiv || (currentUser.verein_id && turnier.verein_id === currentUser.verein_id));

                        if (!gehoertZuEigenemVerein) {
                            // Bei einem fremden Verein dürfen nur "Turniere" und "Teilnehmer" sichtbar sein.
                            // Das Anlegen/Bearbeiten-Popup (früher eigene Seite waage.html) bleibt auf
                            // teilnehmer.html erreichbar: Gastvereine melden ihre eigenen Athlet:innen
                            // darüber selbst an bzw. bearbeiten sie (siehe "Bearbeiten"/"Hinzufügen" in
                            // teilnehmer.js) — der Zugriff auf fremde Teilnehmer wird dabei serverseitig
                            // in teilnehmerController.js verhindert.
                            versteckeMenuePunkte(['nav-turnier', 'nav-pools', 'nav-mannschaften', 'nav-matten', 'nav-helfer', 'nav-orga', 'nav-kampf', 'nav-siegerliste', 'nav-urkunden', 'nav-urkunden-designer', 'nav-dashboard', 'nav-uebersicht']);

                            const eingeschraenkteSeiten = ['turnier.html', 'pools.html', 'matten.html', 'zeitplan.html', 'helfer-plan.html', 'orga.html', 'orga-aufgabe.html', 'kampf.html', 'siegerliste.html', 'urkunden.html', 'urkunden-designer.html', 'dashboard.html', 'uebersicht.html'];
                            if (eingeschraenkteSeiten.some(seite => currentPath.includes(seite))) {
                                window.location.href = `/teilnehmer.html?turnierId=${turnierId}`;
                                return;
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Fehler beim Laden des Turniernamens:', error);
            }
        }
    }

    // --- MENÜ NACH ROLLE (nur Cloud, siehe menueFuerRolle oben) ---
    // Ohne Verwaltungsrecht (reiner Helfer) bleibt nur die Helfer-App; „Helfer“ (Helferplan) ab Rolle Benutzer,
    // „Nutzer“ nur für Super-Admins.
    if (!rechte.verwaltung) {
        versteckeMenuePunkte(['nav-turniere', 'nav-turnier', 'nav-teilnehmer', 'nav-pools', 'nav-mannschaften', 'nav-matten', 'nav-helfer', 'nav-orga', 'nav-kampf', 'nav-siegerliste', 'nav-urkunden', 'nav-urkunden-designer', 'nav-dashboard', 'nav-uebersicht']);
    }
    if (!rechte.helferPlan) {
        versteckeOrgaPunkte();
        // Orga und Helferplan sind Admin-Sache: wer nur Benutzer ist, landet bei den Teilnehmern
        if (['orga.html', 'orga-aufgabe.html', 'helfer-plan.html', 'admin-nutzer.html'].some(seite => currentPath.includes(seite)) && turnierId) {
            window.location.href = `/teilnehmer.html?turnierId=${encodeURIComponent(turnierId)}`;
            return;
        }
    }
    const helferAppLink = document.getElementById('nav-helfer-app');
    if (helferAppLink && rechte.helferApp) helferAppLink.style.display = '';
    const nutzerLink = document.getElementById('nav-nutzer');
    if (nutzerLink && rechte.nutzer) {
        nutzerLink.style.display = '';
    }
    // Mitglieder (Beitrittsanfragen, Rollen): Admins des aktiven Vereins, nur Cloud; Super-Admins nutzen „Benutzer“
    const mitgliederLink = document.getElementById('nav-mitglieder');
    if (mitgliederLink && !einzelbenutzer && !rechte.nutzer && rechte.helferPlan) mitgliederLink.style.display = '';
    // Verein (Stammdaten, Rechnungsangaben, Bankverbindung, Vertrag): nur Cloud, Admins des aktiven Vereins (und Super-Admins mit aktivem Verein)
    const vereinLink = document.getElementById('nav-verein');
    const vereinVerwaltbar = !einzelbenutzer && rechte.helferPlan && currentUser && currentUser.verein_id;
    if (vereinLink && vereinVerwaltbar) {
        vereinLink.href = `/verein.html?vereinId=${encodeURIComponent(currentUser.verein_id)}`;
        vereinLink.style.display = '';
    }
    // Rechnungen (Liste aller Startgeld-Rechnungen des Vereins als Ausrichter): nur, wenn es schon Rechnungen gibt
    const rechnungenLink = document.getElementById('nav-rechnungen');
    if (rechnungenLink && vereinVerwaltbar) {
        rechnungenLink.href = `/rechnungen.html?vereinId=${encodeURIComponent(currentUser.verein_id)}`;
        fetch(`/api/abrechnung/verein/${encodeURIComponent(currentUser.verein_id)}/rechnungen/anzahl`)
            .then((resp) => (resp.ok ? resp.json() : null))
            .then((daten) => { if (daten && daten.anzahl > 0) rechnungenLink.style.display = ''; })
            .catch(() => { /* ohne Auskunft bleibt der Punkt weg */ });
    }
    const vereineLink = document.getElementById('nav-vereine');
    if (vereineLink && rechte.nutzer) {
        vereineLink.style.display = '';
    }
    // Einladungen (auch ohne Verein): Super-Admins; Vereins-Admins laden über „Mitglieder hinzufügen“ ein.
    // Erstregistrierungen: nur Super-Admins
    const einladungenLink = document.getElementById('nav-einladungen');
    if (einladungenLink && !einzelbenutzer && rechte.nutzer) einladungenLink.style.display = '';
    const erstregistrierungenLink = document.getElementById('nav-erstregistrierungen');
    if (erstregistrierungenLink && rechte.nutzer) erstregistrierungenLink.style.display = '';
    const serverUpdateLink = document.getElementById('nav-server-update');
    if (serverUpdateLink && rechte.nutzer) {
        serverUpdateLink.style.display = '';
    }
    // Protokoll (nur Cloud): Admins des aktiven Vereins sehen ihre Vereine, Super-Admins alles
    const protokollLink = document.getElementById('nav-protokoll');
    if (protokollLink && !einzelbenutzer && rechte.protokoll) protokollLink.style.display = '';
    // Konsole (Fehlerprotokoll, nur Cloud): Super-Admins
    const konsoleLink = document.getElementById('nav-konsole');
    if (konsoleLink && !einzelbenutzer && rechte.nutzer) konsoleLink.style.display = '';
    // Downloads (Installer und Updates, nur Cloud): freigeschaltete Benutzer, Admins und Super-Admins
    const downloadsLink = document.getElementById('nav-downloads');
    if (downloadsLink && !einzelbenutzer && rechte.verwaltung) downloadsLink.style.display = '';
    const sicherungLink = document.getElementById('nav-sicherung');
    // Die Sicherung gibt es nur in der Cloud (/api/sicherung)
    if (sicherungLink && rechte.nutzer && !einzelbenutzer) sicherungLink.style.display = '';
    // Super-Admins: Benutzer, Vereine und Server-Update stehen im oberen Bereich der Seitenleiste (nicht unten)
    // Nachrichten (nur Cloud): Super-Admins mit eigenem Menüpunkt, alle anderen über das Profil-Icon
    const nachrichtenLink = document.getElementById('nav-nachrichten');
    if (nachrichtenLink && !einzelbenutzer && rechte.nutzer) nachrichtenLink.style.display = '';
    // Ein Trenner grenzt die Super-Admin-Punkte von den allgemeinen Punkten darüber ab
    const superTrenner = document.getElementById('nav-super-trenner');
    if (superTrenner && rechte.nutzer) superTrenner.style.display = '';

    // --- AKTIVEN REITER HERVORHEBEN ---
    markiereAktivenMenuepunkt(id => document.getElementById(id));

    // Erst jetzt sind alle Sperr-/Versteck-Entscheidungen (Freigabe, Turnierauswahl, Vereins-
    // zugehörigkeit, Stufen-Voraussetzungen) getroffen — die Menüpunkte waren bis hierhin bewusst
    // unsichtbar (bzw. stand der gemerkte Stand als Platzhalter da), damit sie nicht kurz erscheinen
    // und sofort wieder verschwinden.
    aktualisiereMenueSektionen();
    gibMenueFrei();

    // Später ein-/ausgeblendete Punkte (Zähler, Rollen, Orga nach dem Laden) ziehen die Sektionstitel nach
    const echteSidebar = document.querySelector('.app-sidebar:not(.menue-platzhalter)');
    if (echteSidebar) {
        new MutationObserver(aktualisiereMenueSektionen)
            .observe(echteSidebar, { subtree: true, attributes: true, attributeFilter: ['style'] });
    }

    initialisiereOrgaMenue();

    // --- ORGA-UNTERMENÜ (aufklappbar, Zähler aus /api/orga und /api/helfer/orga/meine) ---
    function initialisiereOrgaMenue() {
        const gruppe = document.getElementById('nav-orga');
        const kopf = document.getElementById('nav-orga-kopf');
        const liste = document.getElementById('nav-orga-liste');
        if (!gruppe || !kopf || !liste) return;
        const SPEICHER_KEY = 'hajime-orga-menue-offen';
        const suche = new URLSearchParams(window.location.search);
        const aufgabeId = currentPath.includes('orga-aufgabe.html') ? suche.get('id') : null;
        const seiteIstOrga = currentPath.includes('orga.html') || currentPath.includes('orga-aufgabe.html')
            || currentPath.includes('helfer-plan.html');

        let offen = true;
        try { if (localStorage.getItem(SPEICHER_KEY) === 'false') offen = false; } catch { /* ohne Speicher: offen */ }
        if (seiteIstOrga) offen = true;
        const zeige = (o) => {
            kopf.setAttribute('aria-expanded', String(o));
            gruppe.classList.toggle('zugeklappt', !o);
            document.getElementById('nav-orga-pfeil').textContent = o ? 'expand_more' : 'chevron_right';
        };
        zeige(offen);
        kopf.addEventListener('click', () => {
            // Eingeklappte Seitenleiste (nur Icons, auch die schmale Leiste bis 850 px; am Handy ist es eine Schublade mit Untermenü): kein Untermenü, der Klick öffnet die Orga-Übersicht.
            if (document.body.classList.contains('sidebar-collapsed') || window.matchMedia('(min-width: 601px) and (max-width: 850px)').matches) {
                const uebersicht = document.getElementById('nav-orga-uebersicht');
                const ziel = uebersicht && uebersicht.style.display !== 'none' ? uebersicht : document.getElementById('nav-helfer');
                window.location.href = ziel.getAttribute('href');
                return;
            }
            const neu = kopf.getAttribute('aria-expanded') !== 'true';
            zeige(neu);
            try { localStorage.setItem(SPEICHER_KEY, String(neu)); } catch { /* ohne Speicher */ }
        });

        // „Aufgaben“ lässt sich separat zuklappen; auf einer Kategorie-Seite bleibt sie offen, damit die aktive Zeile sichtbar ist
        const aufgabenPfeil = document.getElementById('nav-orga-aufgaben-pfeil');
        const aufgabenGruppe = document.getElementById('nav-orga-aufgaben');
        if (aufgabenPfeil && aufgabenGruppe) {
            const AUFGABEN_KEY = 'hajime-orga-aufgaben-offen';
            let aufgabenOffen = true;
            try { if (localStorage.getItem(AUFGABEN_KEY) === 'false') aufgabenOffen = false; } catch { /* ohne Speicher: offen */ }
            if (aufgabeId) aufgabenOffen = true;
            const zeigeAufgaben = (o) => {
                aufgabenPfeil.setAttribute('aria-expanded', String(o));
                aufgabenGruppe.classList.toggle('zugeklappt', !o);
                document.getElementById('nav-orga-aufgaben-pfeil-icon').textContent = o ? 'expand_more' : 'chevron_right';
            };
            zeigeAufgaben(aufgabenOffen);
            aufgabenPfeil.addEventListener('click', () => {
                const neu = aufgabenPfeil.getAttribute('aria-expanded') !== 'true';
                zeigeAufgaben(neu);
                try { localStorage.setItem(AUFGABEN_KEY, String(neu)); } catch { /* ohne Speicher */ }
            });
        }

        // Aktiv-Markierung (Technik & Co. folgen nach dem Laden der Aufgaben)
        if (seiteIstOrga) kopf.classList.add('active');
        if (currentPath.includes('orga.html')) {
            document.getElementById('nav-orga-uebersicht').classList.add('active');
        }

        if (!turnierId || gruppe.style.display === 'none') return;
        const setzeZaehler = (a, text) => {
            const z = a && a.querySelector('.menu-item-badge');
            if (!z) return;
            z.textContent = text;
            z.style.display = text ? '' : 'none';
        };
        const ZIELE = { technik_bereitstellen: 'nav-orga-technik', catering: 'nav-orga-catering', medaillen: 'nav-orga-medaillen' };

        // Seiten rufen das nach Änderungen erneut auf (neue Kategorie), damit das Menü ohne Neuladen stimmt
        const ladeEintraege = () => fetch(`/api/orga?turnierId=${encodeURIComponent(turnierId)}&nurLesen=1`).then((r) => (r.ok ? r.json() : null)).then((daten) => {
            if (!daten || !Array.isArray(daten.phasen)) return;
            // Eigene Kategorien (neue Kategorie auf orga.html) hängen unter „Aufgaben“, neu aufgebaut bei jedem Laden
            const kategorien = document.getElementById('nav-orga-kategorien');
            kategorien.querySelectorAll('.nav-orga-eigene').forEach((li) => li.remove());
            let summeErledigt = 0;
            let summeGesamt = 0;
            for (const aufgabe of daten.phasen.flatMap((p) => p.aufgaben || []).filter((x) => x.art === 'kategorie')) {
                const li = document.createElement('li');
                li.className = 'nav-orga-eigene';
                const link = document.createElement('a');
                link.className = 'menu-item menu-subitem';
                link.setAttribute('href', `/orga-aufgabe.html?id=${aufgabe.id}&turnierId=${encodeURIComponent(turnierId)}`);
                const name = document.createElement('span');
                name.className = 'menu-text';
                name.textContent = aufgabe.titel;
                const zaehler = document.createElement('span');
                zaehler.className = 'menu-item-badge';
                zaehler.style.display = 'none';
                link.append(name, zaehler);
                li.appendChild(link);
                kategorien.appendChild(li);
                const st = aufgabe.status;
                if (st && st.gesamt > 0 && (aufgabe.kinder || []).length) {
                    setzeZaehler(link, `${st.erledigt}/${st.gesamt}`);
                    summeErledigt += st.erledigt;
                    summeGesamt += st.gesamt;
                }
                if (aufgabeId && String(aufgabe.id) === String(aufgabeId)) link.classList.add('active');
            }
            for (const aufgabe of daten.phasen.flatMap((p) => p.aufgaben || [])) {
                const a = document.getElementById(ZIELE[aufgabe.vorlage_key]);
                if (!a) continue;
                a.setAttribute('href', `/orga-aufgabe.html?id=${aufgabe.id}&turnierId=${encodeURIComponent(turnierId)}`);
                a.style.display = '';
                const st = aufgabe.status;
                if (st && st.gesamt > 0) {
                    setzeZaehler(a, `${st.erledigt}/${st.gesamt}`);
                    summeErledigt += st.erledigt;
                    summeGesamt += st.gesamt;
                }
                if (aufgabeId && String(aufgabe.id) === String(aufgabeId)) a.classList.add('active');
            }
            // Summe aller Kategorien hinter „Aufgaben“, damit der Stand auch zugeklappt sichtbar bleibt
            setzeZaehler(document.getElementById('nav-orga-uebersicht'), summeGesamt > 0 ? `${summeErledigt}/${summeGesamt}` : '');
            if (aufgabeId && !liste.querySelector('.menu-subitem.active')) {
                document.getElementById('nav-orga-uebersicht').classList.add('active');
            }
        }).catch(() => { /* ohne Zähler weiter */ });
        window.hajimeAktualisiereOrgaMenue = ladeEintraege;
        ladeEintraege();
    }

    // --- GLOBALER DARKMODE TOGGLE ---
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    if (themeToggle && themeIcon) {
        const savedTheme = localStorage.getItem('hajime-theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        themeIcon.innerText = savedTheme === 'dark' ? 'light_mode' : 'dark_mode';

        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('hajime-theme', newTheme);
            themeIcon.innerText = newTheme === 'dark' ? 'light_mode' : 'dark_mode';
        });
    }

    // --- SIDEBAR EIN-/AUSKLAPPEN ---
    const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
    const sidebarCollapseIcon = document.getElementById('sidebarCollapseIcon');
    if (sidebarCollapseBtn && sidebarCollapseIcon) {
        const anwendenSidebarZustand = (eingeklappt) => {
            document.body.classList.toggle('sidebar-collapsed', eingeklappt);
            sidebarCollapseIcon.innerText = eingeklappt ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left';
            sidebarCollapseBtn.title = eingeklappt ? 'Navigation ausklappen' : 'Navigation einklappen';
            sidebarCollapseBtn.setAttribute('aria-label', sidebarCollapseBtn.title);
        };

        const gespeichertEingeklappt = localStorage.getItem('hajime-sidebar-collapsed') === 'true';
        anwendenSidebarZustand(gespeichertEingeklappt);

        sidebarCollapseBtn.addEventListener('click', () => {
            const neuerZustand = !document.body.classList.contains('sidebar-collapsed');
            localStorage.setItem('hajime-sidebar-collapsed', String(neuerZustand));
            anwendenSidebarZustand(neuerZustand);
        });
        sidebarCollapseBtn.dataset.bereit = '1'; // Klick-Handler ist gebunden (Tests warten darauf)
    }

    // --- MENÜ-SCHUBLADE AM HANDY (CSS: common.css, bis 600 px) ---
    const menueKnopf = document.getElementById('menueKnopf');
    const menueHintergrund = document.getElementById('menueHintergrund');
    if (menueKnopf && menueHintergrund) {
        const setzeMenueOffen = (offen) => {
            document.body.classList.toggle('menue-offen', offen);
            menueKnopf.setAttribute('aria-expanded', String(offen));
        };
        menueKnopf.addEventListener('click', () => setzeMenueOffen(!document.body.classList.contains('menue-offen')));
        menueHintergrund.addEventListener('click', () => setzeMenueOffen(false));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setzeMenueOffen(false); });
        document.querySelector('.app-sidebar')?.addEventListener('click', (e) => {
            if (e.target.closest('a[href]')) setzeMenueOffen(false);
        });
        menueKnopf.dataset.bereit = '1';
    }

    // --- PROFIL HANDLER ---
    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) {
        const profilMenue = document.getElementById('profilMenue');
        // Mit Nachrichten (Cloud) öffnet das Profil-Icon ein kleines Menü, sonst geht es direkt zum Profil.
        profileBtn.addEventListener('click', (e) => {
            if (!profilMenue || !window.hajimeNachrichtenAktiv) { window.location.href = '/profil.html'; return; }
            e.stopPropagation();
            const offen = profilMenue.style.display !== 'none';
            profilMenue.style.display = offen ? 'none' : 'block';
            profileBtn.setAttribute('aria-expanded', String(!offen));
        });
        document.addEventListener('click', () => {
            if (profilMenue) profilMenue.style.display = 'none';
            profileBtn.setAttribute('aria-expanded', 'false');
        });
    }

    // --- LOGOUT HANDLER ---
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('dokume_token');
            localStorage.removeItem('dokume_user');
            vergissMenueStand();
            window.location.href = '/login.html';
        });
    }
}

// --- GLOBALE WINDOW EXPORTS FÜR ALLE SKRIPTE ---
let snackbarHideTimeout = null;
window.zeigeNotification = (nachricht, typ = 'success') => {
    const snackbar = document.getElementById('materialSnackbar');
    const snackbarText = document.getElementById('snackbarText');
    if (!snackbar || !snackbarText) return;

    snackbarText.innerText = nachricht;

    // Farbanpassung je nach Status (Erfolg = Grün, Fehler = Rot)
    if (typ === 'error') {
        snackbar.style.backgroundColor = '#b83232'; // Tatami-Rot bei Fehlern
        snackbar.querySelector('.material-icons').innerText = 'error_outline';
    } else {
        snackbar.style.backgroundColor = '#2e7d32'; // Judo-Grün bei Erfolg
        snackbar.querySelector('.material-icons').innerText = 'check_circle_outline';
    }

    snackbar.style.display = 'flex';

    // Vorherigen Timer löschen, sonst kann ein älterer Aufruf (z.B. bei schnell
    // aufeinanderfolgenden Aktionen wie zwei Drag&Drop-Verschiebungen) die Meldung eines
    // neueren Aufrufs vorzeitig wieder ausblenden.
    if (snackbarHideTimeout) clearTimeout(snackbarHideTimeout);
    snackbarHideTimeout = setTimeout(() => {
        snackbar.style.display = 'none';
        snackbarHideTimeout = null;
    }, 4500);
};


// optionen.compact = true verkleinert den Dialog (schmaler, weniger Innenabstand, kleineres
// Icon) für kurze Ja/Nein-Fragen zu leicht rückgängig zu machenden Aktionen (z.B. Bulk-
// Statusumschaltungen) — Standardgröße bleibt für alle anderen Aufrufer unverändert.
window.zeigeZentraleBestaetigung = (nachricht, titel = "Aktion bestätigen", icon = "help_outline", optionen = {}) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        const txtMsg = document.getElementById('modalMessage');
        const txtTitle = document.getElementById('modalTitle');
        const icoEl = document.getElementById('modalIcon');
        const btnConfirm = document.getElementById('modalConfirmBtn');
        const btnCancel = document.getElementById('modalCancelBtn');

        if (!modal || !txtMsg) {
            resolve(confirm(nachricht));
            return;
        }

        txtMsg.innerText = nachricht;
        txtTitle.innerText = titel;
        icoEl.innerText = icon;
        btnConfirm.innerText = optionen.confirmText || 'Fortfahren';
        btnCancel.innerText = optionen.cancelText || 'Abbrechen';

        const karte = modal.querySelector('.mdc-card');
        if (karte) {
            if (optionen.compact) {
                karte.style.maxWidth = '320px';
                karte.style.padding = '16px';
            } else {
                karte.style.maxWidth = '';
                karte.style.padding = '';
            }
        }

        modal.style.display = 'flex';

        const schliessen = (ergebnis) => {
            modal.style.display = 'none';
            btnConfirm.replaceWith(btnConfirm.cloneNode(true));
            btnCancel.replaceWith(btnCancel.cloneNode(true));
            resolve(ergebnis);
        };

        document.getElementById('modalConfirmBtn').addEventListener('click', () => schliessen(true));
        document.getElementById('modalCancelBtn').addEventListener('click', () => schliessen(false));
    });
};

// Lade-Modal für kurze, nicht abbrechbare Hintergrundaktionen (z.B. Pools aufteilen, Pool auf
// eine Matte verschieben) — blendet die Seite ab, damit während des Requests keine weitere
// Aktion angestoßen werden kann.
window.zeigeLadeModal = (nachricht = 'Bitte warten…') => {
    const modal = document.getElementById('customLoadingModal');
    const txtMsg = document.getElementById('loadingModalMessage');
    if (!modal) return;
    if (txtMsg) txtMsg.innerText = nachricht;
    modal.style.display = 'flex';
};

window.versteckeLadeModal = () => {
    const modal = document.getElementById('customLoadingModal');
    if (modal) modal.style.display = 'none';
};

// Ersatz für window.prompt() im Look der Anwendung — löst mit dem eingegebenen Text auf,
// oder mit null bei Abbruch.
window.zeigeTextEingabe = (nachricht, titel = "Eingabe", platzhalter = "", startwert = "") => {
    return new Promise((resolve) => {
        const modal = document.getElementById('customPromptModal');
        const txtMsg = document.getElementById('promptModalMessage');
        const txtTitle = document.getElementById('promptModalTitle');

        if (!modal || !document.getElementById('promptModalForm')) {
            resolve(prompt(nachricht, startwert));
            return;
        }

        // Formular (inkl. Abbrechen-Button) klonen, um Listener aus vorherigen Aufrufen zu
        // entfernen — gleiches Prinzip wie bei den Buttons im Bestätigungsdialog.
        const altesForm = document.getElementById('promptModalForm');
        const form = altesForm.cloneNode(true);
        altesForm.replaceWith(form);

        const input = form.querySelector('#promptModalInput');
        const btnCancel = form.querySelector('#promptModalCancelBtn');

        txtMsg.innerText = nachricht;
        txtTitle.innerText = titel;
        input.placeholder = platzhalter;
        input.value = startwert;
        modal.style.display = 'flex';
        setTimeout(() => { input.focus(); input.select(); }, 50);

        const schliessen = (ergebnis) => {
            modal.style.display = 'none';
            resolve(ergebnis);
        };

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const wert = input.value.trim();
            schliessen(wert ? wert : null);
        });
        btnCancel.addEventListener('click', () => schliessen(null));
    });
};
