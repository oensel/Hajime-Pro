// public/js/overlay.js
// Treibt overlay.html an: liest ?matte=<kampfflaeche_id> aus der URL, pollt periodisch den
// aktuell laufenden Kampf dieser Matte und blendet Kämpfer/Mannschaften + Alters-/Gewichtsklasse
// ein. Gedacht als OBS-Browser-Source (separater Prozess ohne Zugriff auf den BroadcastChannel,
// den scoreboard.js für steuerung.html/anzeige.html nutzt) — daher Polling über die normale API
// statt BroadcastChannel.

const POLL_INTERVAL_MS = 4000;

const params = new URLSearchParams(window.location.search);
const kampfflaecheId = params.get('matte');

const bar = document.getElementById('overlayBar');
const elPool = document.getElementById('overlayPool');
const elName1 = document.getElementById('overlayName1');
const elVerein1 = document.getElementById('overlayVerein1');
const elName2 = document.getElementById('overlayName2');
const elVerein2 = document.getElementById('overlayVerein2');

function zeigeFehlendeMatte() {
    document.body.innerHTML = '<div style="position:fixed;top:20px;left:20px;color:#ef4444;' +
        'font-family:Arial,sans-serif;font-weight:700;background:rgba(17,24,39,0.85);' +
        'padding:10px 16px;border-radius:6px;">overlay.html braucht ?matte=&lt;kampfflaeche_id&gt;</div>';
}

function zeigeLoginFormular(fehlermeldung) {
    let form = document.getElementById('overlayLogin');
    if (form) {
        if (fehlermeldung) form.querySelector('.overlay-login-error').style.display = 'block';
        return;
    }

    bar.classList.remove('visible');

    form = document.createElement('div');
    form.id = 'overlayLogin';
    form.className = 'overlay-login';
    form.innerHTML = `
        <h2>Anmeldung für Overlay</h2>
        <form id="overlayLoginForm">
            <input type="email" id="overlayEmail" placeholder="E-Mail" required autocomplete="username">
            <input type="password" id="overlayPassword" placeholder="Passwort" required autocomplete="current-password">
            <button type="submit">Anmelden</button>
        </form>
        <div class="overlay-login-error">Anmeldung fehlgeschlagen.</div>
    `;
    document.body.appendChild(form);

    document.getElementById('overlayLoginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('overlayEmail').value;
        const password = document.getElementById('overlayPassword').value;
        const errEl = form.querySelector('.overlay-login-error');
        errEl.style.display = 'none';

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Anmeldung fehlgeschlagen');

            localStorage.setItem('overlay_token', data.token);
            form.remove();
            ladeAktuellenKampf();
        } catch (err) {
            errEl.textContent = err.message;
            errEl.style.display = 'block';
        }
    });
}

function verstecke() {
    bar.classList.remove('visible');
}

function zeigeKampf(kampf) {
    // Auch bei Mannschaftskämpfen kämpfen zwei einzelne Athlet:innen (kaempfer1/2_id) — die
    // Begegnung (mannschaftskampf_id) liefert nur zusätzlich den Team-/Gewichtsklassen-Kontext
    // für die Pool-Zeile, siehe mannschaftsBegegnungEngine.js.
    const name1 = [kampf.kaempfer1_vorname, kampf.kaempfer1_nachname].filter(Boolean).join(' ');
    const verein1 = kampf.kaempfer1_verein || '';
    const name2 = [kampf.kaempfer2_vorname, kampf.kaempfer2_nachname].filter(Boolean).join(' ');
    const verein2 = kampf.kaempfer2_verein || '';

    if (!name1 || !name2) {
        verstecke();
        return;
    }

    let pool = kampf.pool_bezeichnung || '';
    if (kampf.mannschaftskampf_id) {
        const teams = [kampf.mannschaft1_bezeichnung, kampf.mannschaft2_bezeichnung].filter(Boolean).join(' vs ');
        pool = teams + (kampf.mannschaft_gewichtsklasse ? ` · ${kampf.mannschaft_gewichtsklasse}` : '');
    }

    elPool.textContent = pool;
    elName1.textContent = name1;
    elVerein1.textContent = verein1;
    elName2.textContent = name2;
    elVerein2.textContent = verein2;
    bar.classList.add('visible');
}

async function ladeAktuellenKampf() {
    try {
        const headers = {};
        const token = localStorage.getItem('overlay_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(`/api/kaempfe?kampfflaecheId=${encodeURIComponent(kampfflaecheId)}`, { headers });

        if (response.status === 401) {
            localStorage.removeItem('overlay_token');
            zeigeLoginFormular(true);
            return;
        }
        if (!response.ok) {
            verstecke();
            return;
        }

        const kaempfe = await response.json();
        const laufend = Array.isArray(kaempfe) ? kaempfe.find(k => k.status === 'gestartet') : null;

        if (!laufend) {
            verstecke();
            return;
        }
        zeigeKampf(laufend);
    } catch (err) {
        verstecke();
    }
}

if (!kampfflaecheId) {
    zeigeFehlendeMatte();
} else {
    ladeAktuellenKampf();
    setInterval(ladeAktuellenKampf, POLL_INTERVAL_MS);
}
