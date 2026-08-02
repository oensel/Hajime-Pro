// public/js/navigation.js

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
            <div class="sidebar-brand" title="by Bastian Haas">
                <img src="hajime_pro.png" height="60">
            </div>
            <nav class="sidebar-nav">
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
                <a href="/waage.html" class="menu-item" id="nav-waage">
                    <span class="material-icons">scale</span>
                    <span class="menu-text">Waage</span>
                </a>
                <a href="/pools.html" class="menu-item" id="nav-pools">
                    <span class="material-icons">groups</span>
                    <span class="menu-text">Pools</span>
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
            </nav>
            <nav class="sidebar-nav">
                <a href="/dashboard.html" class="menu-item" id="nav-dashboard">
                    <span class="material-icons">dashboard</span>
                    <span class="menu-text">Dashboard</span>
                </a>
                <a href="/uebersicht.html" class="menu-item" id="nav-uebersicht">
                    <span class="material-icons">travel_explore</span>
                    <span class="menu-text">Übersicht</span>
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
            <div class="top-header-actions">
            <button type="button" class="theme-toggle" id="profileBtn" title="Mein Profil">
                <span class="material-icons">account_circle</span>
            </button>
            <button type="button" class="theme-toggle" id="themeToggle" title="Ansicht umschalten">
                <span class="material-icons" id="themeIcon">dark_mode</span>
            </button>
            <button type="button" class="theme-toggle" id="logoutBtn" title="Abmelden" style="color: #ef4444; border: none; background: transparent; cursor: pointer;">
                <span class="material-icons">logout</span>
            </button>
            </div>
        </div>

        <!-- DYNAMISCHE MATERIAL DESIGN NOTIFICATION SNACKBAR (PERFEKT IN DER LÜCKE COPOSITIONIERT) -->
        <div id="materialSnackbar" style="display: none; position: fixed; top: 90px; left: 50%; transform: translateX(-50%); background-color: #2e7d32; color: #ffffff; padding: 14px 28px; border-radius: 4px; box-shadow: 0 4px 10px rgba(0,0,0,0.15); z-index: 10000; align-items: center; gap: 12px; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; animation: snackbarFadeInTop 0.3s ease-out;">
            <span class="material-icons" style="font-size: 20px;">check_circle_outline</span>
            <span id="snackbarText"></span>
        </div>


        <!-- OPTISCH ANSPRECHENDER MATERIAL CONFIRM DIALOG -->
        <div id="customConfirmModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(2px); z-index: 9999; align-items: center; justify-content: center; transition: all 0.2s;">
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
    `;

    // Elemente flach in den Body einfügen, um die CSS-Hierarchie zu wahren
    while (brandingBar.firstChild) {
        document.body.insertBefore(brandingBar.firstChild, document.body.firstChild);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const turnierId = urlParams.get('id') || urlParams.get('turnierId');
    const currentPath = window.location.pathname;

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
    // ergibt keine sinnvolle Poolbildung). Wird initial beim Seitenaufruf geprüft und danach
    // erneut von teilnehmer.js nach jeder Statusänderung eines Teilnehmers.
    const pruefePoolsMenuSperre = async (tId) => {
        try {
            const response = await fetch(`/api/teilnehmer?turnierId=${tId}`);
            const teilnehmer = await response.json();
            const kampfbereitAnzahl = Array.isArray(teilnehmer)
                ? teilnehmer.filter(t => t.status === 'kampfbereit').length
                : 0;

            if (kampfbereitAnzahl < 2) {
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

    // Globaler Zugriffspunkt für andere Skripte (teilnehmer.js, pools.js, matten.js), um nach
    // einer eigenen Änderung gezielt einzelne Menü-Sperren live neu zu bewerten, ohne die
    // gesamte Seite neu laden zu müssen. bereiche: Teilmenge aus ['pools', 'matten', 'kampf'].
    window.hajimeAktualisiereMenueSperren = async (bereiche = ['pools', 'matten', 'kampf']) => {
        const params = new URLSearchParams(window.location.search);
        const aktiveTurnierId = params.get('id') || params.get('turnierId');
        if (!aktiveTurnierId) return;

        const aufgaben = [];
        if (bereiche.includes('pools')) aufgaben.push(pruefePoolsMenuSperre(aktiveTurnierId));
        if (bereiche.includes('matten')) aufgaben.push(pruefeMattenMenuSperre(aktiveTurnierId));
        if (bereiche.includes('kampf')) aufgaben.push(pruefeKampfMenuSperre(aktiveTurnierId));
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

    // Im Offline-Modus (lokaler Kiosk-Betrieb) gelten keine Vereins-Einschränkungen,
    // analog zur Server-Middleware.
    let istOffline = false;
    try {
        const configResp = await fetch('/api/config');
        if (configResp.ok) {
            istOffline = !!(await configResp.json()).isOffline;
        }
    } catch (error) {
        console.error('Fehler beim Laden der System-Konfiguration:', error);
    }

    // Verein gewählt, aber Beitritt noch nicht freigegeben: Nur die Turnierübersicht
    // darf angesehen werden, ohne jegliche Aktionen (auch keine Anlage/Bearbeitung).
    const wartetAufFreigabe = !!(currentUser && currentUser.verein_id && !currentUser.verein_freigegeben);

    if (wartetAufFreigabe) {
        versteckeMenuePunkte(['nav-turnier', 'nav-waage', 'nav-teilnehmer', 'nav-pools', 'nav-matten', 'nav-kampf', 'nav-siegerliste', 'nav-dashboard', 'nav-uebersicht']);

        const istErlaubteSeite = currentPath.includes('turniere.html') || currentPath.includes('profil.html');
        if (!istErlaubteSeite) {
            window.location.href = '/turniere.html';
            return;
        }
    } else {
        // --- STUFEN-VALIDIERUNG DER SICHTBARKEIT ---
        // Direkt nach der Anmeldung (kein Turnier ausgewählt) darf nur "Turniere" sichtbar sein.
        if (!turnierId) {
            versteckeMenuePunkte(['nav-turnier', 'nav-waage', 'nav-teilnehmer', 'nav-pools', 'nav-matten', 'nav-kampf', 'nav-siegerliste', 'nav-dashboard', 'nav-uebersicht']);
        } else {
            document.querySelectorAll('.menu-item').forEach(link => {
                const href = link.getAttribute('href');
                if (href && href !== '#') {
                    if (href.includes('turniere.html')) return;
                    const paramName = href.includes('turnier.html') ? 'id' : 'turnierId';
                    link.setAttribute('href', `${href}?${paramName}=${turnierId}`);
                }
            });

            await Promise.all([
                pruefePoolsMenuSperre(turnierId),
                pruefeMattenMenuSperre(turnierId),
                pruefeKampfMenuSperre(turnierId)
            ]);

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

                    // --- VEREINS-SICHTBARKEIT: Nutzer außerhalb des ausrichtenden Vereins ---
                    // dürfen nur die Teilnehmer-Ansicht (gefiltert auf den eigenen Verein) sehen.
                    if (currentUser && !istOffline) {
                        const gehoertZuEigenemVerein = !!(currentUser.verein_id && turnier.verein_id === currentUser.verein_id);

                        if (!gehoertZuEigenemVerein) {
                            // Bei einem fremden Verein dürfen nur "Turniere" und "Teilnehmer" sichtbar sein.
                            versteckeMenuePunkte(['nav-turnier', 'nav-waage', 'nav-pools', 'nav-matten', 'nav-kampf', 'nav-siegerliste', 'nav-dashboard', 'nav-uebersicht']);

                            const eingeschraenkteSeiten = ['turnier.html', 'waage.html', 'pools.html', 'matten.html', 'kampf.html', 'siegerliste.html', 'dashboard.html', 'uebersicht.html'];
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

    // --- AKTIVEN REITER HERVORHEBEN ---
    if (currentPath.includes('turniere.html')) document.getElementById('nav-turniere')?.classList.add('active');
    if (currentPath.includes('turnier.html')) document.getElementById('nav-turnier')?.classList.add('active');
    if (currentPath.includes('waage.html')) document.getElementById('nav-waage')?.classList.add('active');
    if (currentPath.includes('teilnehmer.html')) document.getElementById('nav-teilnehmer')?.classList.add('active');
    if (currentPath.includes('pools.html')) document.getElementById('nav-pools')?.classList.add('active');
    if (currentPath.includes('matten.html')) document.getElementById('nav-matten')?.classList.add('active');
    if (currentPath.includes('kampf.html')) document.getElementById('nav-kampf')?.classList.add('active');
    if (currentPath.includes('siegerliste.html')) document.getElementById('nav-siegerliste')?.classList.add('active');
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


window.zeigeZentraleBestaetigung = (nachricht, titel = "Aktion bestätigen", icon = "help_outline") => {
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
