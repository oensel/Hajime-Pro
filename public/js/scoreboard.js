import { berechneKaempferPatches } from '/js/shared/kampfProgression.js';
import { berechneGruppenUeberkreuzHalbfinalPatches } from '/js/shared/gruppenUeberkreuzProgression.js';
import { letztesKampfEndeProTeilnehmer, pruefeKampfPause } from '/js/shared/pausenRegel.js';

// Global fetch wrapper to append X-Steuerung-Password and Authorization headers if available in
// localStorage. steuerung.html lädt bewusst kein menu.js (das würde die Sidebar-Navigation der
// übrigen Verwaltungsseiten mitbringen), das ist aber die einzige Stelle, die sonst den
// "dokume_token" als Authorization-Header anhängt — ohne ihn schlagen alle API-Routen mit
// requireAuth (z.B. GET /api/kampfflaechen, /api/kaempfe) mit 401 fehl, auch wenn der Operator im
// selben Browser bereits als Vereinsmitglied eingeloggt ist.
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

        return originalFetch(url, options);
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

/* ==========================================================================
   GEMEINSAME VARIABLEN & KANAL
   ========================================================================== */
const channel = new BroadcastChannel('judo_scoreboard');

// Live-Uhrzeit oben rechts im Vorschau-Overlay (#vorschauUhrzeit in anzeige.html). Läuft
// unabhängig vom BroadcastChannel-State lokal in jedem Dokument, das scoreboard.js lädt (auch
// im eingebetteten iframe der Steuerung) — die Uhrzeit ist überall gleich, ein Broadcast wäre
// unnötig. Sichtbar wird sie ohnehin nur, während das Overlay selbst angezeigt wird.
function aktualisiereVorschauUhrzeit() {
    const el = document.getElementById('vorschauUhrzeit');
    if (el) el.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
aktualisiereVorschauUhrzeit();
setInterval(aktualisiereVorschauUhrzeit, 1000);

/* ==========================================================================
   LOGIK FÜR DAS STEUERFENSTER (KAMPFRICHTERTISCH)
   ========================================================================== */
let timerInterval = null;
let osaeIntervalW = null;
let osaeIntervalB = null;

let currentFightId = null;
let kaempfer1_id = null;
let kaempfer2_id = null;
let pool_kampfzeit = 240;
let selectedMatId = null;

// "Nicht angetreten" ist nur zulässig, solange die Kampfzeit für diesen Kampf noch nicht
// gestartet wurde — sobald beide Kämpfer angetreten sind (Uhr läuft/lief), gilt stattdessen
// Kiken-gachi (Verletzung) oder Hansoku-make (Disqualifikation).
let kampfGestartet = false;

let offlineState = null;
let isOfflineMode = false;
try {
    if (localStorage.getItem('isOfflineMode') === 'true') {
        isOfflineMode = true;
        offlineState = JSON.parse(localStorage.getItem('offlineState') || 'null');
    }
} catch (e) {
    console.error("Fehler beim Wiederherstellen des Offline-Status:", e);
}

// Pausenwarnung: der als naechstes wartende Kampf und der Kampf danach (Tausch-Ziel), sobald
// pruefeUndZeigePausenwarnung() ein Pausenproblem fuer den naechsten Kampf festgestellt hat.
let pausenWarnungKampf = null;
let pausenWarnungDanach = null;
let pausenWarnungIntervall = null;

let state = {
    nameW: "Kämpfer Weiß", 
    clubW: "JC Musterstadt", 
    ipponW: 0,
    wazaW: 0,
    yukoW: 0,
    shidoW: 0,
    behandlungW: 0,
    nichtAngetretenW: false,
    hansokuDirektW: false,
    hanteiSiegerW: false,
    osaeW: 0,
    osaeRunningW: false,
    nameB: "Kämpfer 2",
    clubB: "DJK Beispielort",
    ipponB: 0,
    wazaB: 0,
    yukoB: 0,
    shidoB: 0,
    behandlungB: 0,
    nichtAngetretenB: false,
    hansokuDirektB: false,
    hanteiSiegerB: false,
    osaeB: 0,
    osaeRunningB: false,
    timeString: "04:00",
    isGoldenScore: false,
    timeColor: "#ffc107",
    fighter2Color: "blau",
    overlayMode: "none", // Erlaubt: "none", "time", "hansokumake", "ippon", "goldenscoresieg", "hantei", "hanteisieg", "kiken", "nichtangetreten", "vorschau"
    poolName: "Senioren | M | -81kg",
    timeRunning: false,
    vorschauKaempfe: [], // Für overlayMode "vorschau": bis zu 3 Einträge {nameW,clubW,nameB,clubB,pool}
    vorschauMatte: ""
};

let currentSeconds = 240;
let maxGsSeconds = 60;
// Ob Golden Score für den aktuell geladenen Pool überhaupt angeboten wird (siehe
// naechstenKampfHolen() — kommt aus pool.golden_score_aktiv). false bedeutet: bei
// Gleichstand direkt zur Hantei-Entscheidung, kein Golden Score verfügbar. Default true,
// damit Kämpfe ohne Pool-Zuordnung (z.B. manuelles URL-Setup) sich wie bisher verhalten.
let gsAktiv = true;
let isRunning = false;

let keyTimestamps = {};
let keyHoldingStates = {};

function playHorn() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(180, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.5);
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 1.5);
    } catch(e) { console.log("Audio Fehler:", e); }
}

function changeFighterColorSlider(isRot) {
    state.fighter2Color = isRot ? 'rot' : 'blau';
    const panelInput = document.getElementById('panelB');
    if(panelInput) {
        panelInput.className = isRot ? "kaempfer rot-control" : "kaempfer blau-control";
    }
    const panelPreview = document.getElementById('panelBPreview');
    if(panelPreview) {
        panelPreview.className = isRot ? "rot" : "blau";
    }
    update();

    // Reine Live-Anzeige-Info für externe Anzeigetafeln (global.liveColors, nicht Teil des
    // Kampfergebnisses) — im Offline-Modus gibt es keinen erreichbaren Server dafür, der
    // fetch() würde nur einen Konsolenfehler erzeugen (siehe QA-Bericht F7).
    if (currentFightId && !isOfflineMode) {
        window.Datenzugriff.setzeLiveFarbe(currentFightId, state.fighter2Color)
            .catch(err => console.error("Fehler beim Speichern der Kämpferfarbe im Backend:", err));
    }
}

function changeScore(color, type, value) {
    let key = type + color;
    let current = state[key] + value;

    // Golden Score (Sudden Death): die erste Wertung — egal ob Ippon, Waza-Ari oder Yuko —
    // entscheidet den Kampf sofort für den Kämpfer, der sie erzielt hat. Nur bei tatsächlicher
    // Vergabe (value > 0) und solange noch kein Sieg-Grund aktiv ist (verhindert mehrfaches
    // Auslösen bei versehentlichem Doppelklick). Läuft über triggerGoldenScoreWin() statt
    // triggerIpponWin(), damit das "IPPON"-Banner nicht erscheint — der Sieg kam ja nicht
    // zwingend durch einen echten Ippon zustande.
    const gewinntDurchGoldenScore = state.isGoldenScore && value > 0 && state.overlayMode === 'none';

    if (type === 'waza') {
        let newVal = Math.max(0, current);
        if (newVal >= 2) {
            state['ippon' + color] = 1;
            state['waza' + color] = 0;
            if (state.isGoldenScore) triggerGoldenScoreWin();
            else triggerIpponWin();
        } else {
            state[key] = newVal;
            if (gewinntDurchGoldenScore) triggerGoldenScoreWin();
        }
    } else if (type === 'ippon') {
        state[key] = Math.max(0, current);
        if (state[key] === 1 && value > 0) {
            if (state.isGoldenScore) triggerGoldenScoreWin();
            else triggerIpponWin();
        } else if (state[key] === 0 && value < 0 && (state.overlayMode === 'ippon' || state.overlayMode === 'goldenscoresieg')) {
            // Sieg-auslösender Ippon wurde versehentlich vergeben und wieder zurückgenommen —
            // der Kampf läuft weiter, die Zeit kann per START wieder gestartet werden.
            state.overlayMode = 'none';
        }
    } else {
        state[key] = Math.max(0, current);
        if (gewinntDurchGoldenScore) triggerGoldenScoreWin();
    }
    update();
}

function changeShido(color, value) {
    let current = state['shido' + color] + value;
    state['shido' + color] = Math.max(0, current);

    if (state['shido' + color] >= 3) {
        triggerHansokumakeWin(color === 'W' ? 'B' : 'W');
    }
    update();
}

// Ein Athlet darf zweimal medizinisch versorgt werden (kleinere/größere Blutung). Bei der
// dritten notwendigen Versorgung erklärt der Kampfrichter den Gegner automatisch zum Sieger
// durch Kiken-gachi (Sieg durch Rückzug/Aufgabe).
function changeBehandlung(color, value) {
    let current = state['behandlung' + color] + value;
    state['behandlung' + color] = Math.max(0, current);

    if (state['behandlung' + color] >= 3) {
        triggerKikenGachiWin(color === 'W' ? 'B' : 'W');
    }
    update();
}

function triggerKikenGachiWin(winnerColor) {
    stopAllTimers();
    state.overlayMode = "kiken";
    playHorn();
    update();
}

function triggerIpponWin() {
    stopAllTimers();
    state.overlayMode = "ippon";
    playHorn();
    update();
}

// Sieg durch die erste Wertung im Golden Score (Sudden Death, siehe changeScore). Bewusst OHNE
// das "IPPON"-Banner (im Gegensatz zu triggerIpponWin) — der Sieg kam nicht zwingend durch einen
// echten Ippon zustande, daher wäre dieses Banner irreführend. Wer gewonnen hat, ergibt sich
// weiterhin korrekt aus den tatsächlich erzielten Wertungen (siehe ergebnisSenden()).
function triggerGoldenScoreWin() {
    stopAllTimers();
    state.overlayMode = "goldenscoresieg";
    playHorn();
    update();
}

// Artikel 18.2: schwere Verstöße (z.B. gefährliche Technik, unsportliches Verhalten) führen
// zu einem sofortigen, direkten Hansoku-make OHNE vorherige Shidos. "color" ist der Kämpfer,
// der den Verstoß begangen hat und disqualifiziert wird — der Gegner gewinnt automatisch.
// Nutzt bewusst ein eigenes Flag statt state.shidoW/B = 3, damit die Shido-Kärtchen in
// anzeige.html dadurch NICHT verändert werden (ein direktes Hansoku-make ist kein
// akkumulierter 3. Shido, sondern ein eigenständiger Sieg-Grund). Jederzeit klickbar (auch vor
// dem Start der Kampfzeit, z.B. bei einem Verstoß während der Verbeugung). Der Button ist ein
// Toggle auf die Banner-Anzeige: ein erneuter Klick (während aktiv) macht die Meldung wieder
// rückgängig, genau wie bei triggerNichtAngetreten.
function triggerDirectHansokumake(color) {
    if (state['hansokuDirekt' + color]) {
        state['hansokuDirekt' + color] = false;
        state.overlayMode = 'none';
        update();
        return;
    }

    state['hansokuDirekt' + color] = true;
    triggerHansokumakeWin(color === 'W' ? 'B' : 'W');
}

function triggerHansokumakeWin(winnerColor) {
    stopAllTimers();
    state.overlayMode = "hansokumake";
    playHorn();
    update();
}

// Kämpfer "color" tritt nicht an (z.B. Verletzung, kein Erscheinen) — der Gegner gewinnt
// automatisch mit vollem Wertungspunkt (10). Eigener Sieg-Grund/Overlay statt Ippon, damit
// "Nicht angetreten" nicht fälschlich als regulärer Ippon-Sieg angezeigt wird.
// Nur zulässig, solange die Kampfzeit noch nicht gestartet wurde — der Button ist danach
// deaktiviert (siehe update()), diese Prüfung ist zusätzliche Absicherung.
// Der Button verwandelt sich beim Aktivieren in ein Banner (siehe update()); ein erneuter
// Klick darauf (derselbe Funktionsaufruf) macht die Meldung wieder rückgängig.
function triggerNichtAngetreten(color) {
    if (state['nichtAngetreten' + color]) {
        state['nichtAngetreten' + color] = false;
        state.overlayMode = 'none';
        update();
        return;
    }

    if (kampfGestartet) return;
    state['nichtAngetreten' + color] = true;
    triggerNichtAngetretenWin(color === 'W' ? 'B' : 'W');
}

function triggerNichtAngetretenWin(winnerColor) {
    stopAllTimers();
    state.overlayMode = "nichtangetreten";
    update();
}

// Kampfrichter-Entscheidung (Hantei) bei echtem Gleichstand nach Ablauf der Zeit ohne (oder
// nach abgelaufener) Golden Score — siehe Art. 13.3b. Nur klickbar, während overlayMode
// "hantei" ist (Zeit abgelaufen, Entscheidung noch offen; siehe update() für die
// Sichtbarkeitssteuerung der Buttons). Ein erneuter Klick auf den bereits aktiven Button macht
// die Entscheidung wieder rückgängig (zurück in den Warte-Zustand "hantei").
function triggerHanteiSieg(color) {
    if (state['hanteiSieger' + color]) {
        state['hanteiSieger' + color] = false;
        state.overlayMode = 'hantei';
        update();
        return;
    }

    if (state.overlayMode !== 'hantei') return;
    stopAllTimers();
    state['hanteiSieger' + color] = true;
    state.overlayMode = 'hanteisieg';
    playHorn();
    update();
}

function toggleOsae(color) {
    const oppColor = color === 'W' ? 'B' : 'W';
    
    if (state['osaeRunning' + color]) {
        // Stoppen
        clearInterval(color === 'W' ? osaeIntervalW : osaeIntervalB);
        state['osaeRunning' + color] = false;
        
        let btn = document.getElementById('btnOsae' + color);
        if (btn) btn.innerText = "Osaekomi Start";
    } else {
        // Starten
        if (state['osaeRunning' + oppColor]) {
            toggleOsae(oppColor);
        }
        
        state['osaeRunning' + color] = true;
        let btn = document.getElementById('btnOsae' + color);
        if (btn) btn.innerText = "Osaekomi Stop";
        
        let interval = setInterval(() => {
            if (isRunning || state['osaeRunning' + color]) { // Zählt auch bei Timer-Stopp weiter
                state['osae' + color]++;
                
                // Osaekomi Wertungsregeln
                let osaeTime = state['osae' + color];
                if (osaeTime === 5) {
                    state['yuko' + color]++;
                }
                if (state.isGoldenScore) {
                    if (osaeTime === 10) {
                        state['waza' + color] = 1;
                        state['yuko' + color] = Math.max(0, state['yuko' + color] - 1);
                        triggerWazaWin();
                    }
                } else {
                    if (osaeTime === 10 && state['waza' + color] === 0) {
                        state['waza' + color] = 1;
                        state['yuko' + color] = Math.max(0, state['yuko' + color] - 1);
                    } else if (osaeTime === 10 && state['waza' + color] === 1) {
                        state['ippon' + color] = 1;
                        state['waza' + color] = 0;
                        state['yuko' + color] = Math.max(0, state['yuko' + color] - 1);
                        triggerIpponWin();
                    } else if (osaeTime === 20) {
                        state['ippon' + color] = 1;
                        state['waza' + color] = 0;
                        triggerIpponWin();
                    }
                }
                
                update();
            }
        }, 1000);
        
        if (color === 'W') osaeIntervalW = interval;
        else osaeIntervalB = interval;
    }
    update();
}

function triggerWazaWin() {
    stopAllTimers();
    playHorn();
    update();
}

function stopAllTimers() {
    clearInterval(timerInterval);
    clearInterval(osaeIntervalW);
    clearInterval(osaeIntervalB);
    
    isRunning = false;
    state.osaeRunningW = false;
    state.osaeRunningB = false;
    
    ['btnStartStop', 'btnStartStopLive'].forEach(id => {
        let btnSS = document.getElementById(id);
        if (btnSS) {
            btnSS.innerText = "START";
            btnSS.classList.remove('btn-stop');
        }
    });
    let btnOW = document.getElementById('btnOsaeW');
    if (btnOW) btnOW.innerText = "Osaekomi Start";
    let btnOB = document.getElementById('btnOsaeB');
    if (btnOB) btnOB.innerText = "Osaekomi Start";
}

function resetOsae(color) {
    if(state['osaeRunning' + color]) toggleOsae(color);
    state['osae' + color] = 0;
    update();
}

function activateGoldenScore() {
    if (state.isGoldenScore) return;

    state.isGoldenScore = true;
    stopAllTimers();
    resetOsae('W');
    resetOsae('B');
    state.overlayMode = "none";

    currentSeconds = 0;
    formatTime();
    update();
    toggleTimer();
}

function updateGsLimit() {
    let input = document.getElementById('gsLimitInput');
    if (input) {
        maxGsSeconds = parseInt(input.value);
        if (isNaN(maxGsSeconds) || maxGsSeconds < 0) maxGsSeconds = 0;
    }
}

// Wendet die pro Pool in pools.html konfigurierten Golden-Score-Einstellungen auf die
// aktuelle Steuerung an (aufgerufen beim Laden eines Kampfes — siehe naechstenKampfHolen()
// und den URL-Parameter-Zweig weiter unten). Ist Golden Score für den Pool deaktiviert, wird
// das Zeitlimit-Feld ausgeblendet, da es dann irrelevant ist.
function wendeGoldenScoreEinstellungenAn(aktiv, maxSekunden) {
    // SQLite (Offline-Modus) liefert boolean-Spalten oft als 0/1 statt echtem true/false
    // zurück — nur ein expliziter falscher Wert (false, 0, "0") gilt als deaktiviert, alles
    // andere (inkl. undefined/null bei Kämpfen ohne Pool-Kontext) bleibt beim bisherigen
    // Standardverhalten (Golden Score aktiv).
    gsAktiv = !(aktiv === false || aktiv === 0 || aktiv === '0');
    maxGsSeconds = (gsAktiv && maxSekunden) ? parseInt(maxSekunden, 10) || 0 : 0;

    const input = document.getElementById('gsLimitInput');
    const container = document.getElementById('gsLimitContainer');
    if (input) input.value = maxGsSeconds > 0 ? maxGsSeconds : '';
    if (container) container.style.display = gsAktiv ? '' : 'none';
}

function toggleTimer() {
    if (isRunning) {
        stopAllTimers();
        state.timeRunning = false;
        update();
    } else {
        if (state.overlayMode === "time") {
            // Reguläre Kampfzeit abgelaufen, Gleichstand und eine Golden-Score-Zeit konfiguriert
            // (Art. 13.3b) — START aktiviert in diesem Fall direkt Golden Score, statt eines
            // separaten Buttons.
            let isDraw = (state.ipponW === state.ipponB && state.wazaW === state.wazaB && state.yukoW === state.yukoB);
            if (isDraw && gsAktiv && !state.isGoldenScore) {
                activateGoldenScore();
            }
            return;
        }
        if (state.overlayMode !== "none") return;

        isRunning = true;
        kampfGestartet = true;
        state.timeRunning = true;
        ['btnStartStop', 'btnStartStopLive'].forEach(id => {
            let btnSS = document.getElementById(id);
            if (btnSS) {
                btnSS.innerText = "STOPP";
                btnSS.classList.add('btn-stop');
            }
        });

        clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            if (!state.isGoldenScore) {
                if (currentSeconds > 0) currentSeconds--;
                
                if (currentSeconds === 0) {
                    if (state.osaeRunningW || state.osaeRunningB) {
                        clearInterval(timerInterval);
                        state.timeRunning = false;
                    } else {
                        stopAllTimers();
                        state.timeRunning = false;
                        playHorn();
                        
                        // Artikel 13.3b: Golden Score darf ausschließlich bei absolutem Gleichstand
                        // von Ippon, Waza-Ari UND Yuko angeboten werden (Shido zählt hier bewusst
                        // NICHT mit, siehe Artikel 18.1 — 1-2 Shido dürfen niemals über den Sieg in
                        // der Normalzeit entscheiden). Führt ein Kämpfer technisch, ist der Kampf
                        // sofort regulär beendet, kein Golden Score verfügbar.
                        // Bei Gleichstand OHNE für diesen Pool aktivierten Golden Score (siehe
                        // gsAktiv, pro Pool in pools.html einstellbar) direkt zur
                        // Kampfrichter-Entscheidung (Hantei). In jedem anderen Fall (kein
                        // Gleichstand, oder Gleichstand MIT aktiviertem Golden Score) bleibt
                        // overlayMode "time" (Signal für "Zeit abgelaufen") — toggleTimer() erkennt
                        // den Golden-Score-Fall und aktiviert sie beim nächsten START automatisch.
                        let isDraw = (state.ipponW === state.ipponB && state.wazaW === state.wazaB && state.yukoW === state.yukoB);
                        state.overlayMode = (isDraw && !gsAktiv) ? "hantei" : "time";
                    }
                }
            } else {
                // maxGsSeconds <= 0 bedeutet "unbegrenzt" (aktuelle IJF-Regeln: Golden Score ohne
                // Zeitlimit) — die Sekunden laufen dann nur als Anzeige unbegrenzt hoch, ohne
                // jemals automatisch zur Hantei-Entscheidung zu zwingen.
                currentSeconds++;
                if (maxGsSeconds > 0 && currentSeconds >= maxGsSeconds) {
                    if (state.osaeRunningW || state.osaeRunningB) {
                        clearInterval(timerInterval);
                        state.timeRunning = false;
                    } else {
                        stopAllTimers();
                        state.timeRunning = false;
                        playHorn();

                        let isDraw = (state.ipponW === state.ipponB && state.wazaW === state.wazaB && state.yukoW === state.yukoB);
                        state.overlayMode = isDraw ? "hantei" : "time";
                    }
                }
            }
            formatTime();
            update();
        }, 1000);
    }
}

function resetTimer() {
    stopAllTimers();
    resetOsae('W');
    resetOsae('B');
    state.isGoldenScore = false;
    kampfGestartet = false;

    updateGsLimit();

    state.overlayMode = "none";
    state.timeRunning = false;
    state.shidoW = 0; state.shidoB = 0;
    state.behandlungW = 0; state.behandlungB = 0;
    state.nichtAngetretenW = false; state.nichtAngetretenB = false;
    state.hansokuDirektW = false; state.hansokuDirektB = false;
    state.hanteiSiegerW = false; state.hanteiSiegerB = false;
    state.ipponW = 0; state.wazaW = 0; state.yukoW = 0;
    state.ipponB = 0; state.wazaB = 0; state.yukoB = 0;
    
    let durationSelect = document.getElementById('matchDuration');
    if (durationSelect) {
        currentSeconds = parseInt(durationSelect.value);
    } else {
        currentSeconds = 240;
    }
    
    formatTime();
    update();
}

// Sicherheitsabfrage für den "RESET ALL"-Button, damit er nicht versehentlich mitten im Kampf
// alles auf Null setzt. resetTimer() selbst bleibt ungefragt aufrufbar (z.B. beim Ändern der
// Kampfzeit oder automatisch nach dem Senden eines Ergebnisses).
function resetTimerBestaetigen() {
    if (confirm('Wirklich alles zurücksetzen? Alle Wertungen und die Kampfzeit werden auf Null gesetzt.')) {
        resetTimer();
    }
}

function formatTime() {
    let mins = Math.floor(currentSeconds / 60);
    let secs = currentSeconds % 60;
    state.timeString = (mins < 10 ? "0" : "") + mins + ":" + (secs < 10 ? "0" : "") + secs;
}

// Schließt nur die echten Vollbild-Overlays (TIME, HANTEI, VORSCHAU auf die nächsten Kämpfe).
// Die übrigen overlayMode-Zustände (ippon/hansokumake/kiken/nichtangetreten/hanteisieg/
// goldenscoresieg) zeigen kein Overlay, sondern nur ein Banner in der Anzeige, und werden über
// ihre eigenen Sieg-Buttons rückgängig gemacht, nicht über diesen Button.
function closeOverlay() {
    if (state.overlayMode !== 'time' && state.overlayMode !== 'hantei' && state.overlayMode !== 'vorschau') return;
    state.overlayMode = "none";
    update();
}

/* ==========================================================================
   TASTATUR HOTKEYS (OPTIMIERTE HELD-ERKENNUNG)
   ========================================================================== */
// Da jedes Dokument, das scoreboard.js lädt, seine eigene, isolierte Kopie von state/
// toggleTimer/toggleOsae/resetOsae besitzt, würden Hotkeys innerhalb des in steuerung.html
// eingebetteten iframes (anzeige.html) sonst einen eigenen, unsynchronisierten "Schatten"-
// Timer erzeugen, sobald der Fokus dort liegt (z.B. nach einem Klick auf einen der
// iframe-Buttons) — inklusive Broadcasts mit falschen Werten. Daher: in steuerung.html rufen
// die Hotkeys ihre lokalen Funktionen auf, im eingebetteten iframe werden sie an das
// Elternfenster (window.parent) weitergeleitet. Auf der echten Anzeigetafel (Top-Level-Fenster
// am Fernseher) werden gar keine Hotkey-Listener registriert.
let hotkeyToggleTimer = null;
let hotkeyToggleOsae = null;
let hotkeyResetOsae = null;

if (document.getElementById('matchDuration')) {
    hotkeyToggleTimer = toggleTimer;
    hotkeyToggleOsae = toggleOsae;
    hotkeyResetOsae = resetOsae;
} else if (window.self !== window.top) {
    hotkeyToggleTimer = () => window.parent.toggleTimer();
    hotkeyToggleOsae = (color) => window.parent.toggleOsae(color);
    hotkeyResetOsae = (color) => window.parent.resetOsae(color);
}

if (hotkeyToggleTimer) {
    document.addEventListener('keydown', function(event) {
        // Prevent accidental page reload via F5 or Ctrl+R / Cmd+R
        if (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')) {
            event.preventDefault();
            return;
        }

        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT')) {
            return;
        }

        let key = event.key.toUpperCase();

        if (key === 'W' || key === 'ARROWUP') {
            event.preventDefault();
            hotkeyToggleTimer();
            return;
        }
        if (key === 'A' || key === 'D' || key === 'ARROWLEFT' || key === 'ARROWRIGHT') {
            event.preventDefault();
            if (!keyHoldingStates[key]) {
                keyHoldingStates[key] = true;
                keyTimestamps[key] = Date.now();
            }
        }
    });

    document.addEventListener('keyup', function(event) {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT')) {
            return;
        }

        let key = event.key.toUpperCase();

        if (keyHoldingStates[key]) {
            event.preventDefault();
            keyHoldingStates[key] = false;
            const holdDuration = Date.now() - keyTimestamps[key];

            if (key === 'A' || key === 'ARROWLEFT') {
                if (holdDuration >= 500) hotkeyResetOsae('W');
                else hotkeyToggleOsae('W');
            } else if (key === 'D' || key === 'ARROWRIGHT') {
                if (holdDuration >= 500) hotkeyResetOsae('B');
                else hotkeyToggleOsae('B');
            }
        }
    });
}

/* ==========================================================================
   ANZEIGE-UPDATE & BROADCAST-SYNCHRONISATION
   ========================================================================== */
function update() {
    let pName = document.getElementById('poolName');
    let nW = document.getElementById('nameW');
    let cW = document.getElementById('clubW');
    let nB = document.getElementById('nameB');
    let cB = document.getElementById('clubB');

    if (pName) state.poolName = pName.value;
    if (nW) state.nameW = nW.value;
    if (cW) state.clubW = cW.value;
    if (nB) state.nameB = nB.value;
    if (cB) state.clubB = cB.value;
        
    let previewNameW = document.getElementById('previewNameW');
    let previewClubW = document.getElementById('previewClubW');
    let previewNameB = document.getElementById('previewNameB');
    let previewClubB = document.getElementById('previewClubB');
    if (previewNameW) previewNameW.innerText = state.nameW;
    if (previewClubW) previewClubW.innerText = state.clubW;
    if (previewNameB) previewNameB.innerText = state.nameB;
    if (previewClubB) previewClubB.innerText = state.clubB;

    let previewMeta = document.getElementById('previewMeta');
    if (previewMeta) previewMeta.innerText = state.poolName;

    if (document.getElementById('previewIpponW')) document.getElementById('previewIpponW').innerText = state.ipponW;
    if (document.getElementById('previewWazaW')) document.getElementById('previewWazaW').innerText = state.wazaW;
    if (document.getElementById('previewYukoW')) document.getElementById('previewYukoW').innerText = state.yukoW;
    if (document.getElementById('previewIpponB')) document.getElementById('previewIpponB').innerText = state.ipponB;
    if (document.getElementById('previewWazaB')) document.getElementById('previewWazaB').innerText = state.wazaB;
    if (document.getElementById('previewYukoB')) document.getElementById('previewYukoB').innerText = state.yukoB;

    const pShidoW = document.getElementById('previewShidoTextW');
    const pShidoB = document.getElementById('previewShidoTextB');
    if (pShidoW) pShidoW.innerText = state.shidoW;
    if (pShidoB) pShidoB.innerText = state.shidoB;

    const pBehandlungW = document.getElementById('previewBehandlungW');
    const pBehandlungB = document.getElementById('previewBehandlungB');
    if (pBehandlungW) pBehandlungW.innerText = state.behandlungW;
    if (pBehandlungB) pBehandlungB.innerText = state.behandlungB;

    const osaeW = document.getElementById('previewOsaeW');
    if (osaeW) {
        osaeW.innerText = state.osaeW < 10 ? "0" + state.osaeW : state.osaeW;
        osaeW.classList.toggle('show-osae', state.osaeW > 0 || state.osaeRunningW);
    }
    const osaeB = document.getElementById('previewOsaeB');
    if (osaeB) {
        osaeB.innerText = state.osaeB < 10 ? "0" + state.osaeB : state.osaeB;
        osaeB.classList.toggle('show-osae', state.osaeB > 0 || state.osaeRunningB);
    }

    const timerEl = document.getElementById('previewTimer');
    if (timerEl) {
        timerEl.innerText = state.timeString;
        if (state.overlayMode === "time") timerEl.style.color = "#dc3545"; 
        else if (!state.timeRunning) timerEl.style.color = "#ffc107"; 
        else timerEl.style.color = "#ffffff"; 
    }

    if (document.getElementById('previewOvTime')) document.getElementById('previewOvTime').style.display = (state.overlayMode === "time") ? "flex" : "none";
    if (document.getElementById('previewOvHantei')) document.getElementById('previewOvHantei').style.display = (state.overlayMode === "hantei") ? "flex" : "none";

    const previewGsIndicator = document.getElementById('previewGsIndicator');
    if (previewGsIndicator) previewGsIndicator.style.display = state.isGoldenScore ? 'block' : 'none';

    // "Overlay schließen" nur sichtbar, solange tatsächlich ein Overlay angezeigt wird.
    const btnCloseOverlay = document.getElementById('btnCloseOverlay');
    if (btnCloseOverlay) btnCloseOverlay.style.display = (state.overlayMode === 'time' || state.overlayMode === 'hantei' || state.overlayMode === 'vorschau') ? 'inline-block' : 'none';

    // "Ergebnis senden"/"Nächsten Kampf holen" existieren zweifach im Markup (Hauptbedienung +
    // Kurzzugriff neben der Live-Vorschau), daher hier für beide Fundstellen synchron halten.
    const isFinished = state.overlayMode === 'ippon' ||
                       state.overlayMode === 'hansokumake' ||
                       state.overlayMode === 'kiken' ||
                       state.overlayMode === 'nichtangetreten' ||
                       state.overlayMode === 'time' ||
                       state.overlayMode === 'hantei' ||
                       state.overlayMode === 'hanteisieg' ||
                       state.overlayMode === 'goldenscoresieg';

    ['btnErgebnisSenden', 'btnErgebnisSendenLive'].forEach(id => {
        const btnSenden = document.getElementById(id);
        if (btnSenden) btnSenden.style.display = (currentFightId && isFinished) ? 'inline-block' : 'none';
    });
    ['btnNaechsterKampf', 'btnNaechsterKampfLive'].forEach(id => {
        const btnHolen = document.getElementById(id);
        if (btnHolen) btnHolen.style.display = !currentFightId ? 'inline-block' : 'none';
    });

    ['btnStartStop', 'btnStartStopLive'].forEach(id => {
        const btnStartStop = document.getElementById(id);
        if (btnStartStop) btnStartStop.disabled = (currentFightId === null);
    });

    // "Nicht angetreten": Button wird bei Aktivierung zum Banner (Klick darauf macht es
    // rückgängig, siehe triggerNichtAngetreten). Nur vor dem ersten Start der Kampfzeit
    // zulässig, und nicht mehr auswählbar, sobald die Gegenseite bereits aktiv ist. Sobald die
    // Kampfzeit gestartet wurde, wird der Button komplett ausgeblendet (nicht nur deaktiviert) —
    // "Nicht angetreten" kann per Definition nur vor Kampfbeginn erklärt werden.
    const syncNaButton = (btn, aktiv, gegnerAktiv) => {
        if (!btn) return;
        btn.style.display = kampfGestartet ? 'none' : 'inline-block';
        btn.disabled = !aktiv && (kampfGestartet || gegnerAktiv);
    };
    const aktivNaW = !!state.nichtAngetretenW;
    const aktivNaB = !!state.nichtAngetretenB;
    syncNaButton(document.getElementById('btnLiveNaW'), aktivNaW, aktivNaB);
    syncNaButton(document.getElementById('btnLiveNaB'), aktivNaB, aktivNaW);

    // "Hantei-Sieg": nur sichtbar, solange overlayMode "hantei" ist (Zeit abgelaufen,
    // Gleichstand, keine/abgelaufene Golden Score — Art. 13.3b) oder bereits für diesen
    // Kämpfer entschieden wurde (damit der Button für ein Rückgängig erreichbar bleibt).
    const aktivHanteiW = !!state.hanteiSiegerW;
    const aktivHanteiB = !!state.hanteiSiegerB;
    const btnHanteiSiegW = document.getElementById('btnHanteiSiegW');
    if (btnHanteiSiegW) {
        btnHanteiSiegW.style.display = (state.overlayMode === 'hantei' || aktivHanteiW) ? 'inline-block' : 'none';
        btnHanteiSiegW.disabled = !aktivHanteiW && aktivHanteiB;
    }
    const btnHanteiSiegB = document.getElementById('btnHanteiSiegB');
    if (btnHanteiSiegB) {
        btnHanteiSiegB.style.display = (state.overlayMode === 'hantei' || aktivHanteiB) ? 'inline-block' : 'none';
        btnHanteiSiegB.disabled = !aktivHanteiB && aktivHanteiW;
    }

    state.matId = selectedMatId;
    state.fightId = currentFightId;
    channel.postMessage(state);
}

/* ==========================================================================
   INITIALISIERUNG & URL-PARAMETER PARSEN & COLLAPSE SEKTIONEN
   ========================================================================== */
if (document.getElementById('matchDuration')) {
    window.onload = async () => {
        resetTimer();
        await ladeMatten();
        await pruefeUndZeigePausenwarnung();
        await ladeMattenUebersicht();

        const steuerungKorrekturAbbrechenBtn = document.getElementById('steuerungKorrekturAbbrechenBtn');
        if (steuerungKorrekturAbbrechenBtn) {
            steuerungKorrekturAbbrechenBtn.addEventListener('click', () => {
                document.getElementById('steuerungResultModal').style.display = 'none';
            });
        }
        const steuerungKorrekturSpeichernBtn = document.getElementById('steuerungKorrekturSpeichernBtn');
        if (steuerungKorrekturSpeichernBtn) {
            steuerungKorrekturSpeichernBtn.addEventListener('click', speichereSteuerungKorrektur);
        }

        // Die Pause verstreicht mit der echten Uhrzeit, nicht mit App-Ereignissen — daher
        // zusätzlich zu den ereignisgetriebenen Aufrufen (Kampf geladen, Ergebnis gesendet,
        // getauscht) auch regelmäßig neu prüfen, damit eine anfangs zu knappe Pause automatisch
        // als behoben erkannt wird, sobald genug Zeit vergangen ist.
        if (pausenWarnungIntervall) clearInterval(pausenWarnungIntervall);
        pausenWarnungIntervall = setInterval(() => {
            pruefeUndZeigePausenwarnung();
            ladeMattenUebersicht();
        }, 20000);

        const offlineImportInput = document.getElementById('offlineImportInput');
        if (offlineImportInput) {
            offlineImportInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (evt) => {
                    try {
                        const data = JSON.parse(evt.target.result);
                        if (!data.turnierId || !data.kampfflaecheId || !Array.isArray(data.kaempfe)) {
                            throw new Error('Ungültiges Dateiformat. Bitte exportierte Mattendatei verwenden.');
                        }

                        offlineState = data;
                        isOfflineMode = true;
                        localStorage.setItem('offlineState', JSON.stringify(offlineState));
                        localStorage.setItem('isOfflineMode', 'true');

                        updateConnectionModeUI();
                        populateOfflineMats();
                        pruefeUndZeigePausenwarnung();
                        ladeMattenUebersicht();

                        zeigeNotification(`Offline-Daten für ${data.kampfflaecheBezeichnung} geladen!`, 'success');
                    } catch (err) {
                        alert('Fehler beim Einlesen: ' + err.message);
                    } finally {
                        offlineImportInput.value = '';
                    }
                };
                reader.readAsText(file);
            });
        }
    };
    channel.onmessage = function(event) {
        if (event.data && event.data.type === 'request_state') {
            update();
        }
    };
}

// URL-Parameter parsen, falls vorhanden (auf Steuerung-Seite)
window.addEventListener('DOMContentLoaded', async () => {
    // --- AUTHENTIFIZIERUNGSPRÜFUNG ---
    try {
        const resp = await fetch('/api/auth/mode');
        const data = await resp.json();
        if (data.passwordRequired) {
            const isSteuerung = window.location.pathname.includes('steuerung.html') || window.location.pathname.includes('kampf.html') || document.getElementById('btnOsaeW') !== null;
            if (isSteuerung) {
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
        }
    } catch (err) {
        console.error('Fehler bei der Berechtigungsprüfung:', err);
    }

    const params = new URLSearchParams(window.location.search);
    if (params.has('nameW') || params.has('poolName')) {
        const nameWVal = params.get('nameW') || "";
        const clubWVal = params.get('clubW') || "";
        const nameBVal = params.get('nameB') || "";
        const clubBVal = params.get('clubB') || "";
        const poolNameVal = params.get('poolName') || "";
        const durationVal = params.get('duration') || "240";
        // gsAktiv fehlt bei älteren/manuellen Links (kein Pool-Kontext) -> Standardverhalten
        // wie bisher (Golden Score aktiv, Zeitlimit aus dem gsMax-Parameter oder unbegrenzt).
        const gsAktivVal = params.has('gsAktiv') ? params.get('gsAktiv') !== '0' : true;
        const gsMaxVal = params.get('gsMax') || null;
        wendeGoldenScoreEinstellungenAn(gsAktivVal, gsMaxVal);

        currentFightId = params.get('id') ? parseInt(params.get('id'), 10) : null;
        kaempfer1_id = params.get('k1_id') ? parseInt(params.get('k1_id'), 10) : null;
        kaempfer2_id = params.get('k2_id') ? parseInt(params.get('k2_id'), 10) : null;
        pool_kampfzeit = parseInt(durationVal, 10) || 240;

        const inputNW = document.getElementById('nameW');
        const inputCW = document.getElementById('clubW');
        const inputNB = document.getElementById('nameB');
        const inputCB = document.getElementById('clubB');
        const inputPool = document.getElementById('poolName');
        const selectDur = document.getElementById('matchDuration');

        if (inputNW) inputNW.value = nameWVal;
        if (inputCW) inputCW.value = clubWVal;
        if (inputNB) inputNB.value = nameBVal;
        if (inputCB) inputCB.value = clubBVal;
        if (inputPool) inputPool.value = poolNameVal;
        
        if (selectDur) {
            let hasOpt = false;
            for (let i = 0; i < selectDur.options.length; i++) {
                if (selectDur.options[i].value === durationVal) {
                    selectDur.selectedIndex = i;
                    hasOpt = true;
                    break;
                }
            }
            if (!hasOpt) {
                const opt = document.createElement('option');
                opt.value = durationVal;
                opt.textContent = `${Math.floor(durationVal / 60)} Minuten`;
                opt.selected = true;
                selectDur.appendChild(opt);
            }
        }

        state.nameW = nameWVal;
        state.clubW = clubWVal;
        state.nameB = nameBVal;
        state.clubB = clubBVal;
        state.poolName = poolNameVal;
        
        currentSeconds = pool_kampfzeit;
        formatTime();
        update();
    }
});

if (!document.getElementById('matchDuration')) {
    // Auf der echten Anzeigetafel am Fernseher bleibt die Seitenzuordnung wie bisher (Blau/Rot
    // links, Weiß rechts) — das ist dort bewusst so und richtig. Wird anzeige.html aber als
    // Live-Vorschau in steuerung.html eingebettet (?swap=1 im iframe-src), spiegelt sich die
    // Perspektive: dort steht Weiß bereits links, Blau/Rot rechts. Damit beide Ansichten beim
    // Vergleich nicht seitenverkehrt wirken, wird die Reihenfolge dann per CSS getauscht, ohne
    // dass die echte Anzeigetafel (ohne den Parameter) davon betroffen ist.
    if (new URLSearchParams(window.location.search).has('swap')) {
        const grid = document.querySelector('.grid');
        if (grid) grid.classList.add('swapped');
    }

    // Bedien-Buttons (+/-) für die Live-Vorschau in steuerung.html (?controls=1 im iframe-src).
    // Diese Buttons rufen bewusst NICHT die eigenen (lokalen) changeScore/changeShido/
    // changeBehandlung dieses Dokuments auf, sondern die des Eltern-Fensters (window.parent) —
    // denn jedes Dokument, das scoreboard.js lädt, hat seinen eigenen isolierten "state". Nur
    // steuerung.html besitzt den vollständigen, korrekten state (inkl. currentFightId), den auch
    // "Ergebnis senden" ausliest. So bleiben Klicks im eingebetteten iframe und der Button-Klick
    // im Hauptpanel technisch identisch. Aus Sicherheitsgründen nur aktiv, wenn dieses Dokument
    // tatsächlich in einem iframe läuft (window.self !== window.top) — auf der echten
    // Anzeigetafel am Fernseher (Top-Level-Fenster) hätte window.parent.changeScore sonst keine
    // sinnvolle Wirkung (parent === window, eigener unvollständiger state).
    if (new URLSearchParams(window.location.search).has('controls') && window.self !== window.top) {
        injiziereBedienButtons();
    }

    channel.onmessage = function(event) {
        const data = event.data;
        const panelB = document.getElementById('panelB');
        if (panelB) panelB.className = data.fighter2Color;

        document.getElementById('outNameW').innerText = data.nameW;
        document.getElementById('outClubW').innerText = data.clubW;
        document.getElementById('outIpponW').innerText = data.outIpponW !== undefined ? data.outIpponW : data.ipponW;
        document.getElementById('outWazaW').innerText = data.wazaW;
        document.getElementById('outYukoW').innerText = data.yukoW;

        document.getElementById('outNameB').innerText = data.nameB;
        document.getElementById('outClubB').innerText = data.clubB;
        document.getElementById('outIpponB').innerText = data.ipponB;
        document.getElementById('outWazaB').innerText = data.wazaB;
        document.getElementById('outYukoB').innerText = data.yukoB;

        document.getElementById('outMeta').innerText = data.poolName;

        for(let i=1; i<=3; i++) {
            let shidoWEl = document.getElementById('shidoW_' + i);
            let shidoBEl = document.getElementById('shidoB_' + i);
            if (shidoWEl) shidoWEl.classList.toggle('active', data.shidoW >= i);
            if (shidoBEl) shidoBEl.classList.toggle('active', data.shidoB >= i);
        }

        // Zwei kostenlose medizinische Versorgungen pro Athlet, daher nur 2 Anzeige-Symbole
        // (die 3. Versorgung beendet den Kampf sofort durch Kiken-gachi, siehe changeBehandlung).
        for(let i=1; i<=2; i++) {
            let behandlungWEl = document.getElementById('behandlungW_' + i);
            let behandlungBEl = document.getElementById('behandlungB_' + i);
            if (behandlungWEl) behandlungWEl.classList.toggle('active', data.behandlungW >= i);
            if (behandlungBEl) behandlungBEl.classList.toggle('active', data.behandlungB >= i);
        }

        const osaeW = document.getElementById('outOsaeW');
        if (osaeW) {
            osaeW.innerText = data.osaeW < 10 ? "0" + data.osaeW : data.osaeW;
            osaeW.classList.toggle('show-osae', data.osaeW > 0 || data.osaeRunningW);
        }

        const osaeB = document.getElementById('outOsaeB');
        if (osaeB) {
            osaeB.innerText = data.osaeB < 10 ? "0" + data.osaeB : data.osaeB;
            osaeB.classList.toggle('show-osae', data.osaeB > 0 || data.osaeRunningB);
        }

        // Nicht angetreten, Hansoku-make, Kiken-gachi und Ippon laufen alle über dasselbe
        // kleine gelbe Banner an der Seite des jeweils betroffenen Kämpfers, statt über ein
        // Vollbild-Overlay. Nicht angetreten/Hansoku-make/Kiken-gachi betreffen den
        // unterlegenen Kämpfer (der Grund liegt bei ihm), Ippon dagegen den Kämpfer, der ihn
        // erzielt hat.
        let bannerTextW = '';
        let bannerTextB = '';
        if (data.overlayMode === 'nichtangetreten') {
            if (data.nichtAngetretenW) bannerTextW = 'NICHT ANGETRETEN';
            if (data.nichtAngetretenB) bannerTextB = 'NICHT ANGETRETEN';
        } else if (data.overlayMode === 'hansokumake') {
            if (data.shidoW >= 3 || data.hansokuDirektW) bannerTextW = 'HANSOKU-MAKE';
            if (data.shidoB >= 3 || data.hansokuDirektB) bannerTextB = 'HANSOKU-MAKE';
        } else if (data.overlayMode === 'kiken') {
            if (data.behandlungW >= 3) bannerTextW = 'AUFGABE';
            if (data.behandlungB >= 3) bannerTextB = 'AUFGABE';
        } else if (data.overlayMode === 'ippon') {
            if (data.ipponW > 0) bannerTextW = 'IPPON';
            if (data.ipponB > 0) bannerTextB = 'IPPON';
        }
        // Bewusst KEIN Fall für overlayMode "goldenscoresieg": ein Sieg durch die erste Wertung
        // im Golden Score zeigt kein Banner (siehe triggerGoldenScoreWin()) — der Kampf ist
        // trotzdem beendet (overlayMode ≠ "none" reicht für "isFinished"/Ergebnis senden).
        else if (data.overlayMode === 'hanteisieg') {
            if (data.hanteiSiegerW) bannerTextW = 'HANTEI-SIEG';
            if (data.hanteiSiegerB) bannerTextB = 'HANTEI-SIEG';
        }

        const bannerW = document.getElementById('bannerW');
        if (bannerW) {
            bannerW.textContent = bannerTextW;
            bannerW.classList.toggle('active', !!bannerTextW);
        }
        const bannerB = document.getElementById('bannerB');
        if (bannerB) {
            bannerB.textContent = bannerTextB;
            bannerB.classList.toggle('active', !!bannerTextB);
        }

        // Nur vorhanden, wenn injiziereBedienButtons() lief (?controls=1) — spiegelt den
        // Start/Stop-Zustand des echten Osaekomi-Buttons in steuerung.html.
        const iframeBtnOsaeW = document.getElementById('iframeBtnOsaeW');
        if (iframeBtnOsaeW) iframeBtnOsaeW.textContent = data.osaeRunningW ? 'Osaekomi Stop' : 'Osaekomi Start';
        const iframeBtnOsaeB = document.getElementById('iframeBtnOsaeB');
        if (iframeBtnOsaeB) iframeBtnOsaeB.textContent = data.osaeRunningB ? 'Osaekomi Stop' : 'Osaekomi Start';

        // Hansoku-make im iframe: immer klickbar, nur die Gegenseite wird gesperrt, solange die
        // eine Seite bereits aktiv ist.
        const iframeBtnHansokuW = document.getElementById('iframeBtnHansokuW');
        if (iframeBtnHansokuW) iframeBtnHansokuW.disabled = !data.hansokuDirektW && data.hansokuDirektB;
        const iframeBtnHansokuB = document.getElementById('iframeBtnHansokuB');
        if (iframeBtnHansokuB) iframeBtnHansokuB.disabled = !data.hansokuDirektB && data.hansokuDirektW;

        const timerEl = document.getElementById('outTimer');
        if (timerEl) {
            timerEl.innerText = data.timeString;
            if (data.overlayMode === "time") timerEl.style.color = "#dc3545"; 
            else if (!data.timeRunning) timerEl.style.color = "#ffc107"; 
            else timerEl.style.color = "#ffffff"; 
        }

        const gsInd = document.getElementById('outGsIndicator');
        if (gsInd) gsInd.style.display = data.isGoldenScore ? 'block' : 'none';

        if (document.getElementById('ovTime')) document.getElementById('ovTime').style.display = (data.overlayMode === "time") ? "flex" : "none";

        let ovHantei = document.getElementById('ovHantei');
        if (ovHantei) ovHantei.style.display = (data.overlayMode === "hantei") ? "flex" : "none";

        const ovVorschau = document.getElementById('ovVorschau');
        if (ovVorschau) {
            ovVorschau.style.display = (data.overlayMode === 'vorschau') ? 'flex' : 'none';
            const kaempfe = data.vorschauKaempfe || [];

            const matteEl = document.getElementById('vorschauMatte');
            if (matteEl) matteEl.textContent = data.vorschauMatte || '';

            // Der Farbbalken für Kämpfer 2 folgt der aktuellen Farbeinstellung der Steuerung
            // (blau oder rot, siehe changeFighterColorSlider) statt fest "blau" zu sein.
            const stripB1 = document.getElementById('vorschauStripB1');
            if (stripB1) stripB1.className = 'vorschau-strip ' + (data.fighter2Color || 'blau');

            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val || '';
            };

            [1, 2, 3].forEach(i => {
                const card = document.getElementById('vorschauCard' + i);
                if (!card) return;
                const kampf = kaempfe[i - 1];
                card.style.display = (i === 1 || kampf) ? 'block' : 'none';

                setText('vorschauPool' + i, kampf ? kampf.pool : '');
                setText('vorschauNameW' + i, kampf ? kampf.nameW : '');
                setText('vorschauClubW' + i, kampf ? kampf.clubW : '');
                setText('vorschauNameB' + i, kampf ? kampf.nameB : '');
                setText('vorschauClubB' + i, kampf ? kampf.clubB : '');
            });
        }
    };
}

// Fügt in anzeige.html (nur im ?controls=1-Kontext) kleine +/- Bedien-Buttons unter den
// Ippon/Waza-Ari/Yuko-Zahlen sowie neben Shido/Behandlung ein. Siehe Aufrufstelle oben für die
// Begründung, warum diese Buttons window.parent.changeScore/... statt der lokalen Funktionen
// aufrufen.
function injiziereBedienButtons() {
    function knopf(text, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'iframe-ctrl-btn';
        b.textContent = text;
        b.addEventListener('click', onClick);
        return b;
    }

    const scoreTypen = { ippon: 'Ippon', waza: 'Waza', yuko: 'Yuko' };
    Object.keys(scoreTypen).forEach(type => {
        ['W', 'B'].forEach(color => {
            const num = document.getElementById('out' + scoreTypen[type] + color);
            const box = num ? num.closest('.box') : null;
            if (!box) return;
            const wrap = document.createElement('div');
            wrap.className = 'iframe-ctrl-scores';
            wrap.appendChild(knopf('+', () => window.parent.changeScore(color, type, 1)));
            wrap.appendChild(knopf('–', () => window.parent.changeScore(color, type, -1)));
            box.appendChild(wrap);
        });
    });

    function beschrifteteGruppe(label, onMinus, onPlus) {
        const grp = document.createElement('div');
        grp.className = 'iframe-ctrl-group';
        const labelEl = document.createElement('div');
        labelEl.className = 'iframe-ctrl-label';
        labelEl.textContent = label;
        const btnRow = document.createElement('div');
        btnRow.className = 'iframe-ctrl-group-buttons';
        btnRow.appendChild(knopf('+', onPlus));
        btnRow.appendChild(knopf('–', onMinus));
        grp.appendChild(labelEl);
        grp.appendChild(btnRow);
        return grp;
    }

    ['W', 'B'].forEach(color => {
        const shidoCard = document.getElementById('shido' + color + '_1');
        const container = shidoCard ? shidoCard.closest('.shido-container') : null;
        if (!container) return;

        const shidoGrp = beschrifteteGruppe('Shido', () => window.parent.changeShido(color, -1), () => window.parent.changeShido(color, 1));
        const behGrp = beschrifteteGruppe('Behandlung', () => window.parent.changeBehandlung(color, -1), () => window.parent.changeBehandlung(color, 1));

        const row = document.createElement('div');
        row.className = 'iframe-ctrl-row';
        // Reihenfolge an die tatsächliche Position von Shido/Behandlung im jeweiligen Panel
        // angleichen (bei Weiß steht Behandlung links, bei Blau/Rot rechts, siehe HTML-Struktur).
        if (color === 'W') {
            row.appendChild(behGrp);
            row.appendChild(shidoGrp);
        } else {
            row.appendChild(shidoGrp);
            row.appendChild(behGrp);
        }
        container.appendChild(row);

        // Osaekomi Start/Reset bleiben als zentrierte Gruppe unter der Osaekomi-Anzeige.
        // Hansoku-make sitzt NICHT in dieser Gruppe, sondern separat, direkt am äußeren
        // Bildschirmrand des jeweiligen Kämpfer-Panels (links bei Weiß, rechts bei Blau/Rot) —
        // siehe .iframe-ctrl-hansoku-edge in scoreboard.css. "Sieger Hantei" lebt NICHT im
        // iframe, sondern in steuerung.html selbst, an derselben Stelle wie "Nicht angetreten"
        // (siehe btnHanteiSiegW/B dort). Der Osaekomi-Button-Text sowie die Sichtbarkeit/Sperre
        // von Hansoku-make spiegeln den laufenden Zustand — siehe channel.onmessage weiter
        // unten, das dieselbe ID nutzt, um bei jedem Broadcast zu synchronisieren.
        const osaeDisplay = document.getElementById('outOsae' + color);
        const osaeSlot = osaeDisplay ? osaeDisplay.closest('.osae-slot') : null;
        if (osaeSlot) {
            const hansokuBtn = document.createElement('button');
            hansokuBtn.type = 'button';
            hansokuBtn.id = 'iframeBtnHansoku' + color;
            hansokuBtn.className = 'iframe-ctrl-osae-btn iframe-ctrl-hansoku-edge';
            hansokuBtn.title = 'Art. 18.2: schwerer Verstoß, sofortige Disqualifikation ohne vorherige Shidos';
            hansokuBtn.textContent = 'Hansoku-make';
            hansokuBtn.addEventListener('click', () => window.parent.triggerDirectHansokumake(color));
            osaeSlot.appendChild(hansokuBtn);

            const osaeRow = document.createElement('div');
            osaeRow.className = 'iframe-ctrl-osae-row';

            const startBtn = document.createElement('button');
            startBtn.type = 'button';
            startBtn.id = 'iframeBtnOsae' + color;
            startBtn.className = 'iframe-ctrl-osae-btn';
            startBtn.textContent = 'Osaekomi Start';
            startBtn.addEventListener('click', () => window.parent.toggleOsae(color));

            const resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.className = 'iframe-ctrl-osae-btn';
            resetBtn.textContent = 'Reset';
            resetBtn.addEventListener('click', () => window.parent.resetOsae(color));

            osaeRow.appendChild(startBtn);
            osaeRow.appendChild(resetBtn);
            osaeSlot.appendChild(osaeRow);
        }
    });
}

function toggleCollapse(contentId, arrowId) {
    const content = document.getElementById(contentId);
    const arrow = document.getElementById(arrowId);
    
    if (content && arrow) {
        const isCollapsed = window.getComputedStyle(content).display === "none";
        if (isCollapsed) {
            content.style.display = "block";
            content.classList.remove('collapsed-state');
            arrow.classList.remove("collapsed");
            arrow.innerText = "▲";
        } else {
            content.style.display = "none";
            content.classList.add('collapsed-state');
            arrow.classList.add("collapsed");
            arrow.innerText = "▼";
        }
    }
}

/* ==========================================================================
   MATERIAL-NOTIFICATION (MITTIG) (NEU)
   ========================================================================== */
function zeigeNotification(nachricht, typ = 'success') {
    let notif = document.getElementById('centerNotification');
    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'centerNotification';
        document.body.appendChild(notif);
    }
    
    notif.className = `material-notification-center ${typ}`;
    
    const icon = typ === 'error' ? '❌' : '✅';
    notif.innerHTML = `<span>${icon}</span> <span>${nachricht}</span>`;
    
    notif.style.position = 'fixed';
    notif.style.top = '50%';
    notif.style.left = '50%';
    notif.style.transform = 'translate(-50%, -50%)';
    notif.style.backgroundColor = typ === 'error' ? '#b83232' : '#2e7d32';
    notif.style.color = '#ffffff';
    notif.style.padding = '16px 24px';
    notif.style.borderRadius = '8px';
    notif.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    notif.style.fontFamily = 'Arial, sans-serif';
    notif.style.fontSize = '16px';
    notif.style.fontWeight = 'bold';
    notif.style.display = 'flex';
    notif.style.alignItems = 'center';
    notif.style.gap = '12px';
    notif.style.zIndex = '10000';
    notif.style.opacity = '1';
    notif.style.transition = 'opacity 0.3s ease';
    
    setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => {
            if (notif.parentNode) {
                notif.parentNode.removeChild(notif);
            }
        }, 300);
    }, 3000);
}

/* ==========================================================================
   DYNAMISCHE MATTEN-AUSWAHL & KAMPF-INTEGRATION (NEU)
   ========================================================================== */
const escapeHtml = (str) => {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

async function zeigeTurnierAuswahlModal() {
    if (document.getElementById('turnierAuswahlModal')) return;

    try {
        const response = await fetch('/api/turniere');
        if (!response.ok) throw new Error('Fehler beim Laden der Turniere.');
        const turniere = await response.json();

        if (turniere.length === 0) {
            zeigeNotification('Keine aktiven Turniere in der Datenbank vorhanden.', 'error');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'turnierAuswahlModal';
        modal.style = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(17, 24, 39, 0.95);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        `;

        let selectOptions = turniere.map(t => `<option value="${t.id}">${escapeHtml(t.bezeichnung)} (${t.ort || ''})</option>`).join('');

        modal.innerHTML = `
            <div style="background: #1f2937; border: 2px solid #374151; border-radius: 8px; padding: 32px; width: 90%; max-width: 450px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); color: #f3f4f6;">
                <div style="font-size: 40px; color: #ff9800; margin-bottom: 16px;">🏆</div>
                <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Turnier auswählen</h2>
                <p style="margin: 0 0 24px 0; font-size: 13px; color: #9ca3af; font-weight: 600;">Es wurde keine Turnier-ID übermittelt. Bitte wählen Sie das aktive Turnier aus:</p>
                
                <form id="turnierAuswahlForm" style="display: flex; flex-direction: column; gap: 16px;">
                    <select id="turnierAuswahlSelect" style="padding: 10px 14px; border: 1px solid #4b5563; border-radius: 4px; background: #111827; color: #ffffff; font-size: 14px; font-weight: bold; width: 100%; box-sizing: border-box; outline: none; cursor: pointer;">
                        ${selectOptions}
                    </select>
                    <button type="submit" style="background: #ff9800; color: #ffffff; border: none; padding: 12px; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; transition: background 0.2s;" onmouseover="this.style.background='#e65100'" onmouseout="this.style.background='#ff9800'">Auswählen</button>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        const form = document.getElementById('turnierAuswahlForm');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const selectedId = document.getElementById('turnierAuswahlSelect').value;
            localStorage.setItem('aktiveTurnierId', selectedId);
            document.body.removeChild(modal);
            window.location.reload();
        });

    } catch (err) {
        zeigeNotification('Fehler beim Laden der Turniere: ' + err.message, 'error');
    }
}

async function ladeMatten() {
    try {
        updateConnectionModeUI();

        if (isOfflineMode && offlineState) {
            populateOfflineMats();
            return;
        }

        const params = new URLSearchParams(window.location.search);
        let turnierId = params.get('turnierId') || localStorage.getItem('aktiveTurnierId');
        
        if (params.get('turnierId')) {
            localStorage.setItem('aktiveTurnierId', params.get('turnierId'));
        }

        if (!turnierId) {
            await zeigeTurnierAuswahlModal();
            return;
        }

        const matten = await window.Datenzugriff.ladeKampfflaechen(turnierId);
        
        const selectEl = document.getElementById('matSelect');
        if (selectEl) {
            selectEl.innerHTML = '';
            
            // Client-Gerät: ohne matId-Parameter gilt die auf dem Gerät gewählte Matte; mit
            // Parameter wird sie übernommen, falls auf dem Gerät noch keine gewählt ist.
            const geraeteMatte = await window.Datenzugriff.clientMatte();
            if (window.Datenzugriff.rolle() === 'client' && params.get('matId') && !geraeteMatte) {
                await window.wechsleClientMatte(params.get('matId'), null);
            }
            const initialMatId = params.get('matId') || geraeteMatte;

            matten.forEach((m, idx) => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.bezeichnung;
                
                if (initialMatId && String(m.id) === String(initialMatId)) {
                    opt.selected = true;
                    selectedMatId = m.id;
                } else if (!initialMatId && idx === 0) {
                    opt.selected = true;
                    selectedMatId = m.id;
                }
                selectEl.appendChild(opt);
            });
        }
    } catch (err) {
        console.error(err);
        zeigeNotification(err.message, 'error');
    }
}

// Beim Auswählen einer Wettkampffläche direkt den aktuellen Kampf laden (naechstenKampfHolen()
// nimmt bereits bevorzugt einen bereits "gestartet"en Kampf, sonst den nächsten "bereit"en/
// "angelegt"en — genau "aktueller Kampf, sonst nächster Kampf"). Danach einmal RESET ALL, damit
// Zeit/Wertungen sauber auf dem frisch geladenen Kampf stehen, ohne die dafür sonst nötige
// Sicherheitsabfrage (resetTimerBestaetigen) — das ist hier kein riskanter manueller Klick,
// sondern Teil des automatischen Ladevorgangs.
async function updateSelectedMat(val) {
    // Client-Gerät: die Matte gehört zum Gerät — ein Wechsel im Betrieb fragt vorher nach
    // (ausstehende Änderungen, laufender Kampf, anderes Gerät auf der Ziel-Matte).
    if (window.Datenzugriff.rolle() === 'client' && val && String(val) !== String(selectedMatId || '')) {
        const gewechselt = await window.wechsleClientMatte(val, selectedMatId);
        if (!gewechselt) {
            const selectEl = document.getElementById('matSelect');
            if (selectEl && selectedMatId) selectEl.value = String(selectedMatId);
            return;
        }
    }
    selectedMatId = val ? parseInt(val, 10) : null;
    if (selectedMatId) {
        await naechstenKampfHolen();
        resetTimer();
    }
}

async function naechstenKampfHolen() {
    if (!selectedMatId) {
        zeigeNotification("Bitte wählen Sie zuerst eine Matte aus.", "error");
        return;
    }
    
    try {
        let naechster;

        if (isOfflineMode && offlineState) {
            naechster = offlineState.kaempfe.find(k => k.status === 'gestartet');
            if (!naechster) {
                naechster = offlineState.kaempfe.find(k => k.status === 'bereit');
            }
            if (!naechster) {
                naechster = offlineState.kaempfe.find(k => k.status === 'angelegt');
            }
        } else {
            const kaempfe = await window.Datenzugriff.ladeKaempfeDerMatte(selectedMatId);

            naechster = kaempfe.find(k => k.status === 'gestartet');
            if (!naechster) {
                naechster = kaempfe.find(k => k.status === 'bereit');
            }
            if (!naechster) {
                naechster = kaempfe.find(k => k.status === 'angelegt');
            }
        }
        
        if (!naechster) {
            zeigeNotification("Keine anstehenden Kämpfe auf dieser Matte gefunden.", "error");
            return;
        }
        
        currentFightId = naechster.id;
        kaempfer1_id = naechster.kaempfer1_id;
        kaempfer2_id = naechster.kaempfer2_id;
        pool_kampfzeit = naechster.pool_kampfzeit || 240;
        wendeGoldenScoreEinstellungenAn(naechster.pool_golden_score_aktiv, naechster.pool_golden_score_max_sekunden);

        const nameWVal = `${naechster.kaempfer1_nachname || ''}, ${naechster.kaempfer1_vorname || ''}`;
        // Mannschaftskampf: Team-Name statt persönlichem Verein des Judoka anzeigen — die
        // Begegnung wird zwischen zwei Mannschaften ausgetragen, nicht zwischen zwei Vereinen.
        const clubWVal = naechster.mannschaftskampf_id ? (naechster.mannschaft1_bezeichnung || '') : (naechster.kaempfer1_verein || '');
        const nameBVal = `${naechster.kaempfer2_nachname || ''}, ${naechster.kaempfer2_vorname || ''}`;
        const clubBVal = naechster.mannschaftskampf_id ? (naechster.mannschaft2_bezeichnung || '') : (naechster.kaempfer2_verein || '');
        const poolNameVal = naechster.pool_bezeichnung || '';
        
        const inputNW = document.getElementById('nameW');
        const inputCW = document.getElementById('clubW');
        const inputNB = document.getElementById('nameB');
        const inputCB = document.getElementById('clubB');
        const inputPool = document.getElementById('poolName');
        const selectDur = document.getElementById('matchDuration');
        
        if (inputNW) inputNW.value = nameWVal;
        if (inputCW) inputCW.value = clubWVal;
        if (inputNB) inputNB.value = nameBVal;
        if (inputCB) inputCB.value = clubBVal;
        if (inputPool) inputPool.value = poolNameVal;
        
        if (selectDur) {
            let hasOpt = false;
            for (let i = 0; i < selectDur.options.length; i++) {
                if (selectDur.options[i].value === String(pool_kampfzeit)) {
                    selectDur.selectedIndex = i;
                    hasOpt = true;
                    break;
                }
            }
            if (!hasOpt) {
                const opt = document.createElement('option');
                opt.value = pool_kampfzeit;
                opt.textContent = `${Math.floor(pool_kampfzeit / 60)} Minuten`;
                opt.selected = true;
                selectDur.appendChild(opt);
            }
        }
        
        state.nameW = nameWVal;
        state.clubW = clubWVal;
        state.nameB = nameBVal;
        state.clubB = clubBVal;
        state.poolName = poolNameVal;
        
        state.shidoW = 0; state.shidoB = 0;
        state.behandlungW = 0; state.behandlungB = 0;
        state.nichtAngetretenW = false; state.nichtAngetretenB = false;
        state.hansokuDirektW = false; state.hansokuDirektB = false;
        state.hanteiSiegerW = false; state.hanteiSiegerB = false;
        state.ipponW = 0; state.wazaW = 0; state.yukoW = 0;
        state.ipponB = 0; state.wazaB = 0; state.yukoB = 0;
        // Schließt u.a. die Vorschau auf die nächsten Kämpfe (overlayMode "vorschau"), die nach
        // "Ergebnis senden" angezeigt wurde — sobald der nächste Kampf geladen ist, hat sie
        // ihren Zweck erfüllt.
        state.overlayMode = 'none';
        kampfGestartet = false;

        if (naechster.status === 'bereit') {
            if (isOfflineMode && offlineState) {
                naechster.status = 'gestartet';
                localStorage.setItem('offlineState', JSON.stringify(offlineState));
            } else {
                // Wie bisher nicht blockierend: scheitert der Start (z.B. Matte pausiert), bleibt der
                // Kampf trotzdem geladen.
                const start = await window.Datenzugriff.aktualisiereKampf(naechster.id, { status: 'gestartet' });
                if (!start.ok) console.warn('Kampf konnte nicht als gestartet markiert werden:', start.fehler);
            }
        }
        
        currentSeconds = pool_kampfzeit;
        formatTime();
        update();

        const slider = document.getElementById('colorToggleSlider');
        changeFighterColorSlider(slider ? slider.checked : false);

        zeigeNotification(`Kampf geladen und gestartet: ${nameWVal} vs ${nameBVal}`, 'success');
        await pruefeUndZeigePausenwarnung();
        await ladeMattenUebersicht();
    } catch (err) {
        zeigeNotification("Fehler beim Laden des nächsten Kampfes: " + err.message, 'error');
    }
}

function zeigeHanteiModal() {
    return new Promise((resolve) => {
        const modal = document.getElementById('hanteiDecisionModal');
        const btnW = document.getElementById('btnHanteiW');
        const btnB = document.getElementById('btnHanteiB');
        
        if (!modal || !btnW || !btnB) {
            const ans = confirm("Der Score ist ausgeglichen. Hat KÄMPFER WEISS (Links) gewonnen?");
            resolve(ans ? 'W' : 'B');
            return;
        }

        const colorEl = document.getElementById('colorSelect');
        const activeColor = colorEl ? colorEl.value : 'blue';

        if (activeColor === 'red') {
            btnB.style.backgroundColor = '#dc3545';
            btnB.textContent = 'Gewinner rot';
        } else {
            btnB.style.backgroundColor = '#007bff';
            btnB.textContent = 'Gewinner blau';
        }

        modal.style.display = 'flex';

        btnW.onclick = () => {
            modal.style.display = 'none';
            resolve('W');
        };

        btnB.onclick = () => {
            modal.style.display = 'none';
            resolve('B');
        };
    });
}

async function ergebnisSenden() {
    if (!currentFightId) {
        zeigeNotification("Kein aktiver Kampf geladen. Bitte laden Sie einen Kampf, um das Ergebnis zu senden.", "error");
        return;
    }

    let winnerColor = null;

    // Determine winner based on scoreboard rules
    // Eine bereits per Hantei-Sieg-Button getroffene Kampfrichter-Entscheidung hat oberste
    // Priorität — dann steht der Sieger schon fest, ohne den Score erneut zu prüfen.
    // Hansokumake (akkumuliert ODER direkt nach Art. 18.2), Kiken-gachi (3. medizinische
    // Versorgung) und Nicht angetreten haben absolute Priorität — in allen Fällen gewinnt
    // der Gegner automatisch, unabhängig vom technischen Punktestand.
    if (state.hanteiSiegerW) {
        winnerColor = 'W';
    } else if (state.hanteiSiegerB) {
        winnerColor = 'B';
    } else if (state.shidoW >= 3 || state.behandlungW >= 3 || state.nichtAngetretenW || state.hansokuDirektW) {
        winnerColor = 'B';
    } else if (state.shidoB >= 3 || state.behandlungB >= 3 || state.nichtAngetretenB || state.hansokuDirektB) {
        winnerColor = 'W';
    } else if (state.ipponW > state.ipponB) {
        winnerColor = 'W';
    } else if (state.ipponB > state.ipponW) {
        winnerColor = 'B';
    } else if (state.wazaW > state.wazaB) {
        winnerColor = 'W';
    } else if (state.wazaB > state.wazaW) {
        winnerColor = 'B';
    } else if (state.yukoW > state.yukoB) {
        winnerColor = 'W';
    } else if (state.yukoB > state.yukoW) {
        winnerColor = 'B';
    } else {
        // Tie: Ask who won via custom modal
        winnerColor = await zeigeHanteiModal();
    }

    let scoreW = 0;
    let scoreB = 0;
    
    if (winnerColor === 'W') {
        if (state.ipponW > 0 || state.shidoB >= 3 || state.behandlungB >= 3 || state.nichtAngetretenB || state.hansokuDirektB) scoreW = 10;
        else if (state.wazaW > 0) scoreW = 7;
        else if (state.yukoW > 0) scoreW = 5;
        else scoreW = 1;
    } else {
        if (state.ipponB > 0 || state.shidoW >= 3 || state.behandlungW >= 3 || state.nichtAngetretenW || state.hansokuDirektW) scoreB = 10;
        else if (state.wazaB > 0) scoreB = 7;
        else if (state.yukoB > 0) scoreB = 5;
        else scoreB = 1;
    }

    let elapsed = pool_kampfzeit - currentSeconds;
    if (state.isGoldenScore) {
        elapsed = pool_kampfzeit + currentSeconds;
    }
    if (elapsed < 0) elapsed = 0;

    const payload = {
        status: 'beendet',
        sieger_id: winnerColor === 'W' ? kaempfer1_id : kaempfer2_id,
        unterbewertung_kaempfer1: scoreW, // kaempfer1 is Weiss
        unterbewertung_kaempfer2: scoreB, // kaempfer2 is Blau/Rot
        kampfzeit_in_sekunden: elapsed
    };

    try {
        if (isOfflineMode && offlineState) {
            const fightIndex = offlineState.kaempfe.findIndex(k => k.id === currentFightId);
            if (fightIndex !== -1) {
                offlineState.kaempfe[fightIndex].status = 'beendet';
                offlineState.kaempfe[fightIndex].sieger_id = payload.sieger_id;
                offlineState.kaempfe[fightIndex].unterbewertung_kaempfer1 = payload.unterbewertung_kaempfer1;
                offlineState.kaempfe[fightIndex].unterbewertung_kaempfer2 = payload.unterbewertung_kaempfer2;
                offlineState.kaempfe[fightIndex].kampfzeit_in_sekunden = payload.kampfzeit_in_sekunden;
                
                // Run tree updates offline
                aktualisiereTurnierOffline(offlineState.kaempfe[fightIndex].pool_id);
                
                localStorage.setItem('offlineState', JSON.stringify(offlineState));
            }
            zeigeNotification("Kampfergebnis lokal gespeichert (Offline-Modus)!", "success");
        } else {
            const ergebnis = await window.Datenzugriff.aktualisiereKampf(currentFightId, payload);
            if (!ergebnis.ok) throw new Error(ergebnis.fehler || 'Fehler beim Aktualisieren des Kampfes auf dem Server.');
            if (ergebnis.ausstehend) {
                zeigeNotification(ergebnis.meldung, "info");
            } else {
                zeigeNotification("Kampfergebnis erfolgreich übermittelt und gespeichert!", "success");
            }
        }
        
        currentFightId = null;
        kaempfer1_id = null;
        kaempfer2_id = null;
        resetTimer();
        await zeigeNaechsteKaempferVorschau();
        await pruefeUndZeigePausenwarnung();
        await ladeMattenUebersicht();
    } catch (err) {
        zeigeNotification("Fehler beim Senden des Ergebnisses: " + err.message, "error");
    }
}

// Nach "Ergebnis senden" zeigt diese Vorschau auf der Anzeige, wer auf dieser Wettkampffläche als
// nächstes und wer danach antritt, damit sich die Kämpfer schon vorbereiten können. Verschwindet
// wieder über "Nächsten Kampf holen" (naechstenKampfHolen()) oder "Overlay schließen"
// (closeOverlay()).
async function zeigeNaechsteKaempferVorschau() {
    if (!selectedMatId) return;
    try {
        let kaempfe;
        if (isOfflineMode && offlineState) {
            kaempfe = offlineState.kaempfe;
        } else {
            try {
                kaempfe = await window.Datenzugriff.ladeKaempfeDerMatte(selectedMatId);
            } catch (err) {
                return;
            }
        }

        const anstehende = kaempfe.filter(k => k.status === 'bereit' || k.status === 'angelegt');
        // Mannschaftskampf: Team-Name statt persönlichem Verein des Judoka (siehe naechstenKampfHolen).
        // pool fließt in die Kartenansicht des Vorschau-Overlays ein (siehe channel.onmessage).
        const naechste = anstehende.slice(0, 3).map(k => ({
            nameW: `${k.kaempfer1_nachname || ''}, ${k.kaempfer1_vorname || ''}`,
            clubW: k.mannschaftskampf_id ? (k.mannschaft1_bezeichnung || '') : (k.kaempfer1_verein || ''),
            nameB: `${k.kaempfer2_nachname || ''}, ${k.kaempfer2_vorname || ''}`,
            clubB: k.mannschaftskampf_id ? (k.mannschaft2_bezeichnung || '') : (k.kaempfer2_verein || ''),
            pool: k.pool_bezeichnung || ''
        }));

        if (naechste.length === 0) return;

        const matSelect = document.getElementById('matSelect');
        state.vorschauMatte = matSelect && matSelect.selectedOptions[0] ? matSelect.selectedOptions[0].textContent : '';
        state.vorschauKaempfe = naechste;
        state.overlayMode = 'vorschau';
        update();
    } catch (err) {
        console.error('Fehler beim Laden der Vorschau auf die nächsten Kämpfe:', err);
    }
}

// Prüft, ob der als nächstes wartende Kampf (der bei "Nächsten Kampf holen" geladen würde) die
// altersklassenabhängige Mindestpause (6 bzw. 10 Minuten, siehe pausenRegel.js) für einen seiner
// beiden Kämpfer seit dessen letztem ECHTEN Kampfende schon einhält, und zeigt bei Bedarf die
// Warnung samt Tauschen-Button an (#pausenWarnungBanner in steuerung.html). Läuft periodisch
// (siehe Intervall in window.onload) sowie nach jedem Ereignis, das die Matten-Warteschlange
// verändert (Kampf geladen, Ergebnis gesendet, getauscht).
async function pruefeUndZeigePausenwarnung() {
    const banner = document.getElementById('pausenWarnungBanner');
    const text = document.getElementById('pausenWarnungText');
    const tauschBtn = document.getElementById('btnPausenTausch');
    if (!banner || !text) return;

    if (!selectedMatId) {
        banner.style.display = 'none';
        pausenWarnungKampf = null;
        pausenWarnungDanach = null;
        return;
    }

    try {
        let kaempfe;
        let pausenwarnungFuer = null; // im Online-Modus bereits vom Server berechnet

        if (isOfflineMode && offlineState) {
            kaempfe = offlineState.kaempfe;
        } else {
            try {
                kaempfe = await window.Datenzugriff.ladeKaempfeDerMatte(selectedMatId);
            } catch (err) {
                return;
            }
        }

        const bereite = kaempfe
            .filter(k => k.status === 'bereit')
            .sort((a, b) => (a.matten_reihenfolge ?? 0) - (b.matten_reihenfolge ?? 0));
        const naechster = bereite[0];
        const danach = bereite[1] || null;

        if (!naechster) {
            banner.style.display = 'none';
            pausenWarnungKampf = null;
            pausenWarnungDanach = null;
            return;
        }

        let pruefung;
        if (isOfflineMode && offlineState) {
            const letztesEnde = letztesKampfEndeProTeilnehmer(kaempfe);
            pruefung = pruefeKampfPause(naechster, naechster.pool_altersklasse, letztesEnde, Date.now());
        } else {
            // Server liefert die Prüfung bereits mit (kampfflaecheId-Antwort von getKaempfe)
            pruefung = naechster.pausenwarnung ? { ok: false, ...naechster.pausenwarnung } : { ok: true, kaempfer: [] };
        }

        if (pruefung.ok) {
            banner.style.display = 'none';
            pausenWarnungKampf = null;
            pausenWarnungDanach = null;
            return;
        }

        const namenProId = {
            [naechster.kaempfer1_id]: `${naechster.kaempfer1_vorname || ''} ${naechster.kaempfer1_nachname || ''}`.trim(),
            [naechster.kaempfer2_id]: `${naechster.kaempfer2_vorname || ''} ${naechster.kaempfer2_nachname || ''}`.trim()
        };
        const details = pruefung.kaempfer.map(k => {
            const minuten = Math.ceil(k.fehlendeSekunden / 60);
            return `${namenProId[k.id] || 'Kämpfer'} (noch ${minuten} Min. Pause nötig)`;
        }).join(', ');
        text.textContent = `⚠️ Pausenproblem beim nächsten Kampf: ${details}`;
        banner.style.display = 'flex';
        pausenWarnungKampf = naechster;
        pausenWarnungDanach = danach;

        if (tauschBtn) {
            tauschBtn.disabled = !danach;
            tauschBtn.title = danach ? '' : 'Kein weiterer wartender Kampf auf dieser Matte zum Tauschen verfügbar.';
        }
    } catch (err) {
        console.error('Fehler beim Prüfen der Pausenregel:', err);
    }
}

// Tauscht den als problematisch erkannten nächsten Kampf mit dem danach wartenden Kampf (siehe
// pruefeUndZeigePausenwarnung) — kann mehrfach hintereinander gedrückt werden, falls die Pause
// danach immer noch nicht reicht.
async function tauscheMitNaechstemKampf() {
    if (!pausenWarnungKampf || !pausenWarnungDanach) return;
    try {
        if (isOfflineMode && offlineState) {
            const a = offlineState.kaempfe.find(k => k.id === pausenWarnungKampf.id);
            const b = offlineState.kaempfe.find(k => k.id === pausenWarnungDanach.id);
            if (a && b) {
                const tmp = a.matten_reihenfolge;
                a.matten_reihenfolge = b.matten_reihenfolge;
                b.matten_reihenfolge = tmp;
                localStorage.setItem('offlineState', JSON.stringify(offlineState));
            }
        } else {
            const turnierId = localStorage.getItem('aktiveTurnierId');
            const tausch = await window.Datenzugriff.tauscheReihenfolge(pausenWarnungKampf.id, pausenWarnungDanach.id, turnierId);
            if (!tausch.ok) throw new Error(tausch.fehler || 'Tausch fehlgeschlagen.');
        }
        zeigeNotification('Reihenfolge getauscht.', 'success');
        await pruefeUndZeigePausenwarnung();
        await ladeMattenUebersicht();
    } catch (err) {
        zeigeNotification('Fehler beim Tauschen: ' + err.message, 'error');
    }
}

function formatFighterNameSteuerung(nachname, vorname) {
    if (!nachname && !vorname) return '';
    return `${nachname || ''}${nachname && vorname ? ', ' : ''}${vorname || ''}`.trim();
}

// Lädt und rendert die "Kämpfe dieser Matte"-Übersicht (#steuerungUpcomingList /
// #steuerungFinishedList in steuerung.html): kommende Kämpfe rein zur Information, beendete
// Kämpfe zusätzlich mit einer "Korrigieren"-Aktion (analog zu kampf.html). Wird an denselben
// Stellen aufgerufen wie pruefeUndZeigePausenwarnung(), da dieselben Ereignisse (Kampf geladen,
// Ergebnis gesendet, Matte gewechselt, periodisch) die Matten-Warteschlange verändern.
async function ladeMattenUebersicht() {
    const upcomingList = document.getElementById('steuerungUpcomingList');
    const finishedList = document.getElementById('steuerungFinishedList');
    if (!upcomingList || !finishedList) return;
    if (!selectedMatId) {
        upcomingList.innerHTML = '';
        finishedList.innerHTML = '';
        return;
    }

    try {
        let kaempfe;
        if (isOfflineMode && offlineState) {
            kaempfe = offlineState.kaempfe;
        } else {
            try {
                kaempfe = await window.Datenzugriff.ladeKaempfeDerMatte(selectedMatId);
            } catch (err) {
                return;
            }
        }

        const kommende = kaempfe.filter(k => k.status === 'bereit' || k.status === 'angelegt');
        const beendete = kaempfe.filter(k => k.status === 'beendet' || k.status === 'freilos').reverse();

        upcomingList.innerHTML = '';
        if (kommende.length === 0) {
            upcomingList.textContent = 'Keine kommenden Kämpfe auf dieser Matte.';
        } else {
            kommende.forEach((k, idx) => {
                const name1 = formatFighterNameSteuerung(k.kaempfer1_nachname, k.kaempfer1_vorname) || 'noch offen';
                const name2 = formatFighterNameSteuerung(k.kaempfer2_nachname, k.kaempfer2_vorname) || 'noch offen';

                const row = document.createElement('div');
                row.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 13px;';

                const orderSpan = document.createElement('span');
                orderSpan.style.cssText = 'opacity: 0.6; min-width: 24px;';
                orderSpan.textContent = `#${idx + 1}`;

                const poolSpan = document.createElement('span');
                poolSpan.style.cssText = 'font-weight: 700; min-width: 160px;';
                poolSpan.textContent = k.pool_bezeichnung || '';

                const fightersSpan = document.createElement('span');
                fightersSpan.textContent = `${name1} vs ${name2}`;

                row.append(orderSpan, poolSpan, fightersSpan);
                upcomingList.appendChild(row);
            });
        }

        finishedList.innerHTML = '';
        if (beendete.length === 0) {
            finishedList.textContent = 'Noch keine Kämpfe auf dieser Matte beendet.';
        } else {
            beendete.forEach(k => {
                const name1 = formatFighterNameSteuerung(k.kaempfer1_nachname, k.kaempfer1_vorname) || 'Unbekannt';
                const name2 = formatFighterNameSteuerung(k.kaempfer2_nachname, k.kaempfer2_vorname) || 'Unbekannt';

                const row = document.createElement('div');
                row.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 13px; opacity: 0.85;';

                const poolSpan = document.createElement('span');
                poolSpan.style.cssText = 'font-weight: 700; min-width: 160px;';
                poolSpan.textContent = k.pool_bezeichnung || '';

                const fightersSpan = document.createElement('span');
                fightersSpan.style.flex = '1';
                if (k.status === 'freilos') {
                    fightersSpan.textContent = `${name1} vs ${name2} (Freilos)`;
                } else {
                    const sieger1 = k.sieger_id === k.kaempfer1_id;
                    const sieger2 = k.sieger_id === k.kaempfer2_id;
                    fightersSpan.textContent =
                        `${name1}${sieger1 ? ' (Sieger)' : ''} vs ${name2}${sieger2 ? ' (Sieger)' : ''} `
                        + `(${k.unterbewertung_kaempfer1}:${k.unterbewertung_kaempfer2})`;
                }

                row.appendChild(poolSpan);
                row.appendChild(fightersSpan);

                if (k.status !== 'freilos') {
                    const korrigierenBtn = document.createElement('button');
                    korrigierenBtn.type = 'button';
                    korrigierenBtn.className = 'btn-main';
                    korrigierenBtn.style.cssText = 'background-color: #5a6268; font-size: 11px; padding: 4px 10px; margin: 0;';
                    korrigierenBtn.textContent = 'Korrigieren';
                    korrigierenBtn.addEventListener('click', () => oeffneSteuerungKorrekturModal(k));
                    row.appendChild(korrigierenBtn);
                }

                finishedList.appendChild(row);
            });
        }
    } catch (err) {
        console.error('Fehler beim Laden der Matten-Übersicht:', err);
    }
}

// Öffnet das Korrektur-Modal für einen bereits beendeten Kampf (analog zu openResultModal in
// kampf.js) — erlaubt, Sieger/Score/Kampfzeit eines bereits gewerteten Kampfes nachträglich zu
// berichtigen, ohne die komplette Scoreboard-Zustandsmaschine erneut durchspielen zu müssen.
function oeffneSteuerungKorrekturModal(kampf) {
    const modal = document.getElementById('steuerungResultModal');
    const modalKampfId = document.getElementById('steuerungModalKampfId');
    const siegerSelect = document.getElementById('steuerungSiegerSelect');
    const score1 = document.getElementById('steuerungScore1');
    const score2 = document.getElementById('steuerungScore2');
    const scoreLabel1 = document.getElementById('steuerungScoreLabel1');
    const scoreLabel2 = document.getElementById('steuerungScoreLabel2');
    const kampfzeitInput = document.getElementById('steuerungKampfzeitInput');
    if (!modal || !modalKampfId || !siegerSelect) return;

    modalKampfId.value = kampf.id;

    siegerSelect.innerHTML = '';
    const opt1 = document.createElement('option');
    opt1.value = kampf.kaempfer1_id;
    opt1.textContent = formatFighterNameSteuerung(kampf.kaempfer1_nachname, kampf.kaempfer1_vorname) || 'Kämpfer 1';
    siegerSelect.appendChild(opt1);
    const opt2 = document.createElement('option');
    opt2.value = kampf.kaempfer2_id;
    opt2.textContent = formatFighterNameSteuerung(kampf.kaempfer2_nachname, kampf.kaempfer2_vorname) || 'Kämpfer 2';
    siegerSelect.appendChild(opt2);
    siegerSelect.value = kampf.sieger_id;

    scoreLabel1.textContent = `Score ${formatFighterNameSteuerung(kampf.kaempfer1_nachname, kampf.kaempfer1_vorname) || 'Kämpfer 1'}`;
    scoreLabel2.textContent = `Score ${formatFighterNameSteuerung(kampf.kaempfer2_nachname, kampf.kaempfer2_vorname) || 'Kämpfer 2'}`;
    score1.value = kampf.unterbewertung_kaempfer1;
    score2.value = kampf.unterbewertung_kaempfer2;
    kampfzeitInput.value = kampf.kampfzeit_in_sekunden;

    modal.style.display = 'flex';
}

async function speichereSteuerungKorrektur() {
    const modal = document.getElementById('steuerungResultModal');
    const modalKampfId = document.getElementById('steuerungModalKampfId');
    const siegerSelect = document.getElementById('steuerungSiegerSelect');
    const score1 = document.getElementById('steuerungScore1');
    const score2 = document.getElementById('steuerungScore2');
    const kampfzeitInput = document.getElementById('steuerungKampfzeitInput');

    const kampfId = parseInt(modalKampfId.value, 10);
    const payload = {
        status: 'beendet',
        sieger_id: parseInt(siegerSelect.value, 10),
        unterbewertung_kaempfer1: parseInt(score1.value, 10),
        unterbewertung_kaempfer2: parseInt(score2.value, 10),
        kampfzeit_in_sekunden: parseInt(kampfzeitInput.value, 10) || 0
    };

    try {
        if (isOfflineMode && offlineState) {
            const fight = offlineState.kaempfe.find(k => k.id === kampfId);
            if (fight) {
                Object.assign(fight, payload);
                localStorage.setItem('offlineState', JSON.stringify(offlineState));
            }
        } else {
            const korrektur = await window.Datenzugriff.aktualisiereKampf(kampfId, payload);
            if (!korrektur.ok) throw new Error(korrektur.fehler || 'Korrektur fehlgeschlagen.');
        }

        zeigeNotification('Kampfergebnis korrigiert.', 'success');
        modal.style.display = 'none';
        await ladeMattenUebersicht();
        await pruefeUndZeigePausenwarnung();
    } catch (err) {
        zeigeNotification('Fehler beim Korrigieren: ' + err.message, 'error');
    }
}

// Prevent accidental page reload via browser UI buttons (Refresh/Reload)
window.addEventListener('beforeunload', (event) => {
    event.preventDefault();
    event.returnValue = ''; // Required standard for browser to display default warning dialog
});

function updateConnectionModeUI() {
    const textEl = document.getElementById('connectionModeText');
    const exportBtn = document.getElementById('btnOfflineExport');
    
    if (textEl) {
        if (isOfflineMode) {
            textEl.textContent = "Offline (Lokal)";
            textEl.style.color = "#dc3545";
            textEl.style.borderColor = "#dc3545";
        } else {
            textEl.textContent = "Online (WLAN)";
            textEl.style.color = "#28a745";
            textEl.style.borderColor = "#28a745";
        }
    }
    
    if (exportBtn) {
        exportBtn.style.display = isOfflineMode ? "inline-flex" : "none";
    }
}

function populateOfflineMats() {
    if (!offlineState) return;
    selectedMatId = offlineState.kampfflaecheId;
    const matSelect = document.getElementById('matSelect');
    if (matSelect) {
        matSelect.innerHTML = `<option value="${offlineState.kampfflaecheId}">${offlineState.kampfflaecheBezeichnung}</option>`;
        matSelect.value = offlineState.kampfflaecheId;
    }
}

window.offlineExportRun = function() {
    if (!offlineState) {
        alert('Keine Offline-Daten vorhanden.');
        return;
    }
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(offlineState, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `ergebnisse_matte_${offlineState.kampfflaecheId}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
};

// Nutzt dieselbe reine Engine wie der Server (src/services/*.js), statt einer von Hand
// synchron gehaltenen Kopie der Doppel-KO-8/16-Kaskadenlogik. Modus-unabhängig: die Engine
// stützt sich ausschließlich auf die vom Server mitexportierten kaempfer1/2_quelle_kampf_id/
// _typ-Felder (kaempfe.* im Export, siehe src/controllers/offlineController.js), nicht auf
// Array-Position oder reihenfolge_nummer-Konventionen.
function aktualisiereTurnierOffline(poolId) {
    if (!offlineState) return;

    const kaempfe = offlineState.kaempfe.filter(k => k.pool_id === poolId);
    if (kaempfe.length === 0) return;

    // Gruppen-Überkreuz-Halbfinale (HF1/HF2) zuerst: deren Kämpfer kommen aus einer
    // Ranglistenberechnung über die Vorrunde, nicht aus einem einzelnen Quellkampf, und werden
    // daher von berechneKaempferPatches() unten strukturell übersprungen (siehe
    // gruppenUeberkreuzProgression.js). Ohne diesen Aufruf bliebe eine Matte, die während der
    // Gruppenphase offline geht, für immer bei HF1/HF2 stecken.
    const patches = [...berechneGruppenUeberkreuzHalbfinalPatches(kaempfe), ...berechneKaempferPatches(kaempfe)];
    if (patches.length === 0) return;

    for (const patch of patches) {
        const kampf = kaempfe.find(k => k.id === patch.id);
        if (!kampf) continue;

        if (patch.kaempfer1_id !== undefined) {
            kampf.kaempfer1_id = patch.kaempfer1_id;
            const t1Obj = offlineState.teilnehmer.find(t => t.id === patch.kaempfer1_id);
            kampf.kaempfer1_vorname = t1Obj ? t1Obj.vorname : '';
            kampf.kaempfer1_nachname = t1Obj ? t1Obj.nachname : '';
            kampf.kaempfer1_verein = t1Obj ? t1Obj.verein : '';
        }
        if (patch.kaempfer2_id !== undefined) {
            kampf.kaempfer2_id = patch.kaempfer2_id;
            const t2Obj = offlineState.teilnehmer.find(t => t.id === patch.kaempfer2_id);
            kampf.kaempfer2_vorname = t2Obj ? t2Obj.vorname : '';
            kampf.kaempfer2_nachname = t2Obj ? t2Obj.nachname : '';
            kampf.kaempfer2_verein = t2Obj ? t2Obj.verein : '';
        }
        if (patch.status !== undefined) kampf.status = patch.status;
        if (patch.sieger_id !== undefined) kampf.sieger_id = patch.sieger_id;
        if (patch.unterbewertung_kaempfer1 !== undefined) kampf.unterbewertung_kaempfer1 = patch.unterbewertung_kaempfer1;
        if (patch.unterbewertung_kaempfer2 !== undefined) kampf.unterbewertung_kaempfer2 = patch.unterbewertung_kaempfer2;
    }

    // Kaskade erneut prüfen, falls sich durch die Patches weitere Kämpfe ergeben haben
    aktualisiereTurnierOffline(poolId);
}

// steuerung.html/anzeige.html rufen diese Funktionen über inline onclick/onchange/oninput-
// Attribute auf. Als <script type="module"> landen Top-Level-Deklarationen nicht mehr
// automatisch im globalen Scope, daher hier explizit an window binden.
window.changeBehandlung = changeBehandlung;
window.changeFighterColorSlider = changeFighterColorSlider;
window.changeScore = changeScore;
window.changeShido = changeShido;
window.closeOverlay = closeOverlay;
window.ergebnisSenden = ergebnisSenden;
window.naechstenKampfHolen = naechstenKampfHolen;
window.resetOsae = resetOsae;
window.resetTimer = resetTimer;
window.resetTimerBestaetigen = resetTimerBestaetigen;
window.toggleCollapse = toggleCollapse;
window.toggleOsae = toggleOsae;
window.toggleTimer = toggleTimer;
window.triggerDirectHansokumake = triggerDirectHansokumake;
window.triggerHanteiSieg = triggerHanteiSieg;
window.triggerNichtAngetreten = triggerNichtAngetreten;
window.update = update;
window.updateGsLimit = updateGsLimit;
window.updateSelectedMat = updateSelectedMat;
window.tauscheMitNaechstemKampf = tauscheMitNaechstemKampf;


