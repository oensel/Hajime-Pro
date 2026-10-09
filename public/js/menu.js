// public/js/navigation.js

// Theme sofort beim Parsen setzen (menu.js steht im <head>), nicht erst nach DOMContentLoaded
// und den Auth-Requests — sonst wird die Seite zuerst hell gerendert und springt dann auf dunkel.
try {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('hajime-theme') || 'light');
} catch (e) { /* localStorage gesperrt: helles Theme bleibt */ }

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
            if (response.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/verify') && !url.includes('/api/auth/mode')) {
                localStorage.removeItem('dokume_token');
                localStorage.removeItem('dokume_user');
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
                localStorage.setItem('steuerung_password', pw);
                document.body.removeChild(modal);
                window.location.reload();
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

document.addEventListener('DOMContentLoaded', async () => {
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
            }
        }
    } catch (err) {
        console.error('Fehler bei der Berechtigungsprüfung:', err);
    }
    // 1. Die HTML-Struktur der Navigation inkl. Snackbar und Modal definieren
    const brandingBar = document.createElement('div');
    brandingBar.className = 'nav-shell-wrapper';
    brandingBar.innerHTML = `
        <div class="app-sidebar">
            <div class="sidebar-brand" title="Hajime Pro">
                <img src="hajime_pro.png" height="60">
            </div>
            <nav class="sidebar-nav" id="sidebarNavPrimary" style="visibility: hidden;">
                <a href="/turniere.html" class="menu-item" id="nav-turniere">
                    <span class="material-icons">calendar_month</span>
                    <span class="menu-text">anstehende Turniere</span>
                </a>
                <a href="/turnier.html" class="menu-item" id="nav-turnier">
                    <span class="material-icons">emoji_events</span>
                    <span class="menu-text">Turnier</span>
                </a>
                <a href="/teilnehmer.html" class="menu-item" id="nav-teilnehmer">
                    <span class="material-icons">badge</span>
                    <span class="menu-text">Teilnehmer</span>
                </a>
                <a href="/pools.html" class="menu-item" id="nav-pools">
                    <span class="material-icons">groups</span>
                    <span class="menu-text">Pools</span>
                    <span class="material-icons menu-item-warning" id="nav-pools-warning" style="display: none;" title="Mindestens ein Pool wartet auf Ergebnisprüfung">warning</span>
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
                <a href="/kampf.html" class="menu-item" id="nav-kampf">
                    <span class="material-icons">sports_kabaddi</span>
                    <span class="menu-text">Kampf</span>
                </a>
                <a href="/siegerliste.html" class="menu-item" id="nav-siegerliste">
                    <span class="material-icons">military_tech</span>
                    <span class="menu-text">Siegerliste</span>
                </a>
                <a href="/urkunden.html" class="menu-item" id="nav-urkunden">
                    <span class="material-icons">workspace_premium</span>
                    <span class="menu-text">Urkunden</span>
                </a>
                <a href="/urkunden-designer.html" class="menu-item" id="nav-urkunden-designer">
                    <span class="material-icons">design_services</span>
                    <span class="menu-text">Urkunden-Designer</span>
                </a>
            </nav>
            <nav class="sidebar-nav" id="sidebarNavSecondary" style="visibility: hidden;">
                <a href="/dashboard.html" class="menu-item" id="nav-dashboard">
                    <span class="material-icons">dashboard</span>
                    <span class="menu-text">Dashboard</span>
                </a>
                <a href="/uebersicht.html" class="menu-item" id="nav-uebersicht">
                    <span class="material-icons">travel_explore</span>
                    <span class="menu-text">Übersicht</span>
                </a>
            </nav>
            <nav class="sidebar-nav-unten" id="sidebarNavUnten">
                <a href="/sync-konflikte.html" class="menu-item" id="nav-sync-konflikte" style="display: none;">
                    <span class="material-icons">sync_problem</span>
                    <span class="menu-text">Sync-Konflikte</span>
                    <span class="menu-item-badge" id="nav-sync-konflikte-badge" style="display: none;"></span>
                </a>
                <a href="/client-konfig.html" class="menu-item" id="nav-client-konfig" style="display: none;">
                    <span class="material-icons">settings</span>
                    <span class="menu-text">Client-Konfig</span>
                </a>
            </nav>
            <div class="sidebar-footer">
                <button type="button" class="menu-item sidebar-collapse-btn" id="sidebarCollapseBtn" title="Navigation einklappen">
                    <span class="material-icons" id="sidebarCollapseIcon">keyboard_double_arrow_left</span>
                    <span class="menu-text">Einklappen</span>
                </button>
            </div>
        </div>

        <div class="top-header-bar">
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
            <button type="button" class="theme-toggle" id="profileBtn" title="Mein Profil">
                <span class="material-icons">account_circle</span>
                <span class="nav-badge" id="superAdminNavBadge" style="display: none;"></span>
            </button>
            <button type="button" class="theme-toggle" id="themeToggle" title="Ansicht umschalten">
                <span class="material-icons" id="themeIcon">dark_mode</span>
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
    const turnierId = urlParams.get('id') || urlParams.get('turnierId');
    const currentPath = window.location.pathname;

    // Turnier-ID sofort an die Menü-Links hängen, noch bevor window.hajimeAktualisiereMenueSperren
    // existiert: Seiten-Skripte (z.B. pools.js beim ersten Laden) sperren Menüpunkte teils, während
    // diese Initialisierung noch auf Serverantworten wartet. Die Sperre sichert den Link als
    // Backup und stellt ihn beim Entsperren wieder her — ohne Turnier-ID landete man sonst z.B.
    // auf matten.html ohne Parameter, wo das Menü nur noch "anstehende Turniere" zeigt.
    if (turnierId) {
        document.querySelectorAll('.menu-item').forEach(link => {
            const href = link.getAttribute('href');
            if (href && href !== '#') {
                if (href.includes('turniere.html')) return;
                const paramName = href.includes('turnier.html') ? 'id' : 'turnierId';
                link.setAttribute('href', `${href}?${paramName}=${turnierId}`);
            }
        });
    }

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

    // Matten: erst auswählbar, sobald mindestens ein Pool existiert. Wird initial geprüft und
    // danach erneut von pools.js nach jedem Anlegen/Löschen von Pools.
    const pruefeMattenMenuSperre = async (tId) => {
        try {
            const poolsResponse = await fetch(`/api/pools/details?turnierId=${tId}`);
            const pools = await poolsResponse.json();

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
        const badge = document.getElementById('superAdminNavBadge');
        const profileBtn = document.getElementById('profileBtn');
        if (!badge || !profileBtn) return;

        let anzahl = 0;
        const teile = [];

        if (currentUser && currentUser.ist_super_admin) {
            try {
                const resp = await fetch('/api/vereine/super/pending');
                if (resp.ok) {
                    const pending = await resp.json();
                    const n = Array.isArray(pending) ? pending.length : 0;
                    if (n > 0) {
                        anzahl += n;
                        teile.push(`${n} Erstregistrierung${n === 1 ? '' : 'en'}`);
                    }
                }
            } catch (error) {
                console.error('Fehler beim Laden der Erstregistrierungs-Warteschlange:', error);
            }
        }

        // Peer-Warteschlange (weitere Funktionäre des eigenen Vereins) — relevant für jedes
        // freigegebene Vereinsmitglied, unabhängig vom Super-Admin-Status. Liefert 403, wenn der
        // Benutzer in keinem Verein freigegebenes Mitglied ist — das ist kein Fehlerfall, sondern
        // schlicht "keine Genehmigungsrechte", daher stillschweigend übersprungen.
        try {
            const resp = await fetch('/api/vereine/pending');
            if (resp.ok) {
                const pending = await resp.json();
                const n = Array.isArray(pending) ? pending.length : 0;
                if (n > 0) {
                    anzahl += n;
                    teile.push(`${n} Beitrittsanfrage${n === 1 ? '' : 'n'}`);
                }
            }
        } catch (error) {
            console.error('Fehler beim Laden der Beitrittsanfragen-Warteschlange:', error);
        }

        if (anzahl > 0) {
            badge.textContent = String(anzahl);
            badge.title = `${teile.join(', ')} wartet/warten auf Prüfung`;
            badge.style.display = 'inline-block';
            profileBtn.title = `Mein Profil — ${teile.join(', ')} wartet/warten auf Prüfung`;
        } else {
            badge.style.display = 'none';
            profileBtn.title = 'Mein Profil';
        }
    };
    await window.hajimeAktualisiereGenehmigungsHinweis();

    // --- AKTIVER VEREIN IN DER KOPFLEISTE (Anzeige + Wechsler bei mehreren Vereinen) ---
    // Ein Benutzer ist immer mindestens einem Verein zugeordnet (keine anonymen Anmeldungen);
    // bei mehreren Mitgliedschaften kann er hier den gerade "aktiven" Verein wechseln, der
    // bestimmt, welches Turnier/welche Daten er in der App sieht (siehe hatVereinsZugriffAufTurnier
    // in src/utils/vereinHelper.js).
    (function initVereinSwitcher() {
        const vereine = currentUser && Array.isArray(currentUser.vereine) ? currentUser.vereine : [];
        if (vereine.length === 0) return;

        const switcher = document.getElementById('vereinSwitcher');
        const btn = document.getElementById('vereinSwitcherBtn');
        const nameEl = document.getElementById('vereinSwitcherName');
        const caret = document.getElementById('vereinSwitcherCaret');
        const menu = document.getElementById('vereinSwitcherMenu');
        if (!switcher || !btn || !nameEl || !menu) return;

        const aktiverVerein = vereine.find(v => v.verein_id === currentUser.verein_id) || vereine[0];
        nameEl.textContent = aktiverVerein.name;
        switcher.style.display = '';

        if (vereine.length === 1) {
            btn.classList.add('no-dropdown');
            return;
        }

        caret.style.display = '';

        const schliesseMenu = () => { menu.style.display = 'none'; };

        menu.innerHTML = vereine.map(v => `
            <button type="button" class="verein-switcher-item${v.verein_id === aktiverVerein.verein_id ? ' aktiv' : ''}" data-verein-id="${v.verein_id}">
                <span>${v.name}</span>
                <span class="verein-switcher-item-status">${v.freigegeben ? 'Freigegeben' : 'Freigabe ausstehend'}</span>
            </button>
        `).join('');

        menu.querySelectorAll('.verein-switcher-item').forEach(item => {
            item.addEventListener('click', async () => {
                const vereinId = item.getAttribute('data-verein-id');
                if (parseInt(vereinId) === aktiverVerein.verein_id) {
                    schliesseMenu();
                    return;
                }
                try {
                    const resp = await fetch('/api/vereine/aktiv', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ vereinId })
                    });
                    const data = await resp.json();
                    if (!resp.ok) throw new Error(data.error || 'Vereinswechsel fehlgeschlagen');
                    window.location.reload();
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

    // Im Offline-Modus (lokaler Kiosk-Betrieb) gelten keine Vereins-Einschränkungen,
    // analog zur Server-Middleware.
    let istOffline = false;
    let syncRolle = null;
    try {
        const configResp = await fetch('/api/config');
        if (configResp.ok) {
            const config = await configResp.json();
            istOffline = !!config.isOffline;
            syncRolle = config.syncRolle || null;
        }
    } catch (error) {
        console.error('Fehler beim Laden der System-Konfiguration:', error);
    }

    // --- CLIENT-GERÄT (SYNC_ROLLE=client, Notebook/Tablet an Matte oder Waage) ---
    // Es gibt nur Waage, Scoreboard und Mattenleitung (die Verwaltung liegt am Hallen-Server,
    // siehe src/sync/clientApi.js). Die Menü-Sperren-Prüfungen des Servers entfallen.
    if (syncRolle === 'client') {
        const clientTurnierId = turnierId || localStorage.getItem('aktiveTurnierId');
        versteckeMenuePunkte(['nav-turniere', 'nav-turnier', 'nav-pools', 'nav-mannschaften', 'nav-matten', 'nav-siegerliste', 'nav-urkunden', 'nav-urkunden-designer', 'nav-dashboard', 'nav-uebersicht']);
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
            if (currentPath.includes('client.html')) document.getElementById('nav-geraet').classList.add('active');
        }
        if (currentPath.includes('teilnehmer.html')) document.getElementById('nav-teilnehmer')?.classList.add('active');
        if (currentPath.includes('kampf.html')) document.getElementById('nav-kampf')?.classList.add('active');
        document.getElementById('sidebarNavPrimary')?.style.removeProperty('visibility');
        document.getElementById('sidebarNavSecondary')?.style.removeProperty('visibility');
        return;
    }

    // --- SERVER-CLUSTER (Hallen-Server mit CLUSTER_KNOTEN, siehe src/cluster/) ---
    // Menüpunkt "Cluster"; auf dem Secondary zusätzlich ein Hinweis, dass nur gelesen werden kann.
    if (syncRolle === 'server') {
        // Kopplung neuer Client-Geräte (QR-Code + 6-stelliger Code) gibt es nur am Hallen-Server.
        const clientKonfigLink = document.getElementById('nav-client-konfig');
        if (clientKonfigLink) {
            clientKonfigLink.style.display = '';
            if (currentPath.includes('client-konfig.html')) clientKonfigLink.classList.add('active');
        }
        // Sync-Konflikte: Menüpunkt mit Zähler der offenen Konflikte (hohe Priorität: rot).
        const syncKonflikteLink = document.getElementById('nav-sync-konflikte');
        if (syncKonflikteLink) {
            syncKonflikteLink.style.display = '';
            if (currentPath.includes('sync-konflikte.html')) syncKonflikteLink.classList.add('active');
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
        if (hallenServerBtn) {
            hallenServerBtn.style.display = '';
            if (currentPath.includes('cluster.html')) hallenServerBtn.classList.add('active');
        }
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
                const nav = document.getElementById('sidebarNavSecondary');
                if (nav && !document.getElementById('nav-cluster')) {
                    const a = document.createElement('a');
                    a.href = '/cluster.html';
                    a.className = 'menu-item';
                    a.id = 'nav-cluster';
                    a.innerHTML = '<span class="material-icons">dns</span><span class="menu-text">Cluster</span>';
                    nav.appendChild(a);
                    if (currentPath.includes('cluster.html')) a.classList.add('active');
                }
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
    // anlegen/bearbeiten, Pools, Matten, ...) bleibt gesperrt. teilnehmer.html ist trotzdem
    // erreichbar — das deckt den Gastverein-Fall ab (eigene Athlet:innen bei EINEM FREMDEN,
    // bereits veröffentlichten Turnier anmelden; serverseitig ohnehin auf den eigenen Verein
    // beschränkt, siehe teilnehmerController.js), ohne auf die eigene Freigabe warten zu müssen.
    const wartetAufFreigabe = !!(currentUser && currentUser.verein_id && !currentUser.verein_freigegeben);

    if (wartetAufFreigabe) {
        versteckeMenuePunkte(['nav-turnier', 'nav-teilnehmer', 'nav-pools', 'nav-mannschaften', 'nav-matten', 'nav-kampf', 'nav-siegerliste', 'nav-urkunden', 'nav-urkunden-designer', 'nav-dashboard', 'nav-uebersicht']);

        const istErlaubteSeite = currentPath.includes('turniere.html') || currentPath.includes('profil.html') || currentPath.includes('teilnehmer.html');
        if (!istErlaubteSeite) {
            window.location.href = '/turniere.html';
            return;
        }
    } else {
        // --- STUFEN-VALIDIERUNG DER SICHTBARKEIT ---
        // Direkt nach der Anmeldung (kein Turnier ausgewählt) darf nur "Turniere" sichtbar sein.
        if (!turnierId) {
            versteckeMenuePunkte(['nav-turnier', 'nav-teilnehmer', 'nav-pools', 'nav-mannschaften', 'nav-matten', 'nav-kampf', 'nav-siegerliste', 'nav-urkunden', 'nav-urkunden-designer', 'nav-dashboard', 'nav-uebersicht']);
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

                    // --- VEREINS-SICHTBARKEIT: Nutzer außerhalb des ausrichtenden Vereins ---
                    // dürfen nur die Teilnehmer-Ansicht (gefiltert auf den eigenen Verein) sehen.
                    if (currentUser && !istOffline) {
                        const gehoertZuEigenemVerein = !!(currentUser.verein_id && turnier.verein_id === currentUser.verein_id);

                        if (!gehoertZuEigenemVerein) {
                            // Bei einem fremden Verein dürfen nur "Turniere" und "Teilnehmer" sichtbar sein.
                            // Das Anlegen/Bearbeiten-Popup (früher eigene Seite waage.html) bleibt auf
                            // teilnehmer.html erreichbar: Gastvereine melden ihre eigenen Athlet:innen
                            // darüber selbst an bzw. bearbeiten sie (siehe "Bearbeiten"/"Hinzufügen" in
                            // teilnehmer.js) — der Zugriff auf fremde Teilnehmer wird dabei serverseitig
                            // in teilnehmerController.js verhindert.
                            versteckeMenuePunkte(['nav-turnier', 'nav-pools', 'nav-mannschaften', 'nav-matten', 'nav-kampf', 'nav-siegerliste', 'nav-urkunden', 'nav-urkunden-designer', 'nav-dashboard', 'nav-uebersicht']);

                            const eingeschraenkteSeiten = ['turnier.html', 'pools.html', 'matten.html', 'kampf.html', 'siegerliste.html', 'urkunden.html', 'urkunden-designer.html', 'dashboard.html', 'uebersicht.html'];
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

    // Erst jetzt sind alle Sperr-/Versteck-Entscheidungen (Freigabe, Turnierauswahl, Vereins-
    // zugehörigkeit, Stufen-Voraussetzungen) getroffen — die Menüpunkte waren bis hierhin bewusst
    // unsichtbar, damit sie nicht kurz erscheinen und sofort wieder verschwinden.
    document.getElementById('sidebarNavPrimary')?.style.removeProperty('visibility');
    document.getElementById('sidebarNavSecondary')?.style.removeProperty('visibility');

    // --- AKTIVEN REITER HERVORHEBEN ---
    if (currentPath.includes('turniere.html')) document.getElementById('nav-turniere')?.classList.add('active');
    if (currentPath.includes('turnier.html')) document.getElementById('nav-turnier')?.classList.add('active');
    if (currentPath.includes('teilnehmer.html')) document.getElementById('nav-teilnehmer')?.classList.add('active');
    if (currentPath.includes('pools.html')) document.getElementById('nav-pools')?.classList.add('active');
    if (currentPath.includes('mannschaften.html')) document.getElementById('nav-mannschaften')?.classList.add('active');
    if (currentPath.includes('matten.html')) document.getElementById('nav-matten')?.classList.add('active');
    if (currentPath.includes('kampf.html')) document.getElementById('nav-kampf')?.classList.add('active');
    if (currentPath.includes('siegerliste.html')) document.getElementById('nav-siegerliste')?.classList.add('active');
    if (currentPath.includes('urkunden.html')) document.getElementById('nav-urkunden')?.classList.add('active');
    if (currentPath.includes('urkunden-designer.html')) document.getElementById('nav-urkunden-designer')?.classList.add('active');
    if (currentPath.includes('dashboard.html')) document.getElementById('nav-dashboard')?.classList.add('active');
    if (currentPath.includes('uebersicht.html')) document.getElementById('nav-uebersicht')?.classList.add('active');

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
        };

        const gespeichertEingeklappt = localStorage.getItem('hajime-sidebar-collapsed') === 'true';
        anwendenSidebarZustand(gespeichertEingeklappt);

        sidebarCollapseBtn.addEventListener('click', () => {
            const neuerZustand = !document.body.classList.contains('sidebar-collapsed');
            localStorage.setItem('hajime-sidebar-collapsed', String(neuerZustand));
            anwendenSidebarZustand(neuerZustand);
        });
    }

    // --- PROFIL HANDLER ---
    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) {
        profileBtn.addEventListener('click', () => {
            window.location.href = '/profil.html';
        });
    }

    // --- LOGOUT HANDLER ---
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('dokume_token');
            localStorage.removeItem('dokume_user');
            window.location.href = '/login.html';
        });
    }
});

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
