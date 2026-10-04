// Kopplung der Android-App mit dem Hallen-Server: QR-Code scannen oder Adresse + Code eintragen,
// den Code gegen das gemeinsame Geheimnis tauschen (POST /api/client/koppeln, dieselbe Schnittstelle
// wie beim Desktop-Client), Verbindung speichern und die Turnierdaten einmal vollständig laden,
// damit das Gerät danach auch ohne WLAN arbeiten kann.
import { leseKopplungsUrl, normalisiereServerAdresse } from '/js/shared/kopplungsQr.js';

const mobil = window.HajimeMobil;
const el = (id) => document.getElementById(id);
const meldung = (text, fehler = false) => {
    el('meldung').textContent = text;
    el('meldung').className = fehler ? 'fehler' : '';
};

async function koppeln(serverAdresse, codeEingabe) {
    const serverUrl = normalisiereServerAdresse(serverAdresse);
    const code = String(codeEingabe || '').replace(/\D/g, '');
    if (!serverUrl) return meldung('Bitte die Adresse des Hallen-Servers eintragen.', true);
    if (code.length !== 6) return meldung('Der Kopplungscode hat 6 Ziffern.', true);
    meldung('Verbinde …');
    let resp;
    try {
        resp = await mobil.echteFetch(`${serverUrl}/api/client/koppeln`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, clientId: 'android-app' }),
            signal: AbortSignal.timeout(8000)
        });
    } catch (err) {
        return meldung(`Server unter ${serverUrl} nicht erreichbar – ist das Gerät im Turnier-WLAN?`, true);
    }
    if (resp.status === 401) return meldung('Code falsch.', true);
    if (resp.status === 429) return meldung('Zu viele Fehlversuche – bitte kurz warten.', true);
    if (!resp.ok) return meldung(`Kopplung fehlgeschlagen (HTTP ${resp.status}).`, true);
    const { secret } = await resp.json();
    mobil.speichereVerbindung({ serverUrl, secret });
    // Mit gespeicherter Verbindung neu laden: boot.js startet dann die Laufzeit (lokale DB +
    // Replikation), und diese Seite wartet im Lade-Modus auf die ersten Turnierdaten.
    location.replace('/verbinden.html?laden=1');
}

async function ladeTurnierdaten() {
    el('ansichtKoppeln').style.display = 'none';
    el('ansichtLaden').style.display = '';
    el('nochmalBtn').style.display = 'none';
    el('ladeText').textContent = 'Turnierdaten werden geladen …';
    meldung('');
    const laufzeit = await mobil.bereit;
    const instanz = await laufzeit.kern.warteAufInstanz();
    if (!instanz) {
        el('ladeText').textContent = 'Das Gerät ist gekoppelt, aber auf dem Hallen-Server ist noch kein Turnier aktiv.';
        el('nochmalBtn').style.display = '';
        return;
    }
    await laufzeit.kern.leerlauf();
    location.replace('/client.html');
}

// ---------- QR-Scanner ----------
let stream = null;
let frame = null;

function stoppeScanner() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    el('scannerContainer').style.display = 'none';
}

async function starteScanner() {
    const video = el('previewVideo');
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (err) {
        return meldung(`Kamera nicht verfügbar: ${err.message}`, true);
    }
    video.srcObject = stream;
    await video.play();
    el('scannerContainer').style.display = 'flex';
    const leinwand = document.createElement('canvas');
    const ctx = leinwand.getContext('2d', { willReadFrequently: true });
    const tick = () => {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            leinwand.width = video.videoWidth;
            leinwand.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, leinwand.width, leinwand.height);
            const bild = ctx.getImageData(0, 0, leinwand.width, leinwand.height);
            const treffer = window.jsQR(bild.data, bild.width, bild.height, { inversionAttempts: 'dontInvert' });
            if (treffer) {
                const kopplung = leseKopplungsUrl(treffer.data);
                if (kopplung) {
                    stoppeScanner();
                    el('serverEingabe').value = kopplung.serverUrl;
                    el('codeEingabe').value = kopplung.code;
                    koppeln(kopplung.serverUrl, kopplung.code);
                    return;
                }
                meldung('Das ist kein Kopplungs-QR-Code des Hallen-Servers.', true);
            }
        }
        frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
}

// ---------- Start ----------
el('startScanBtn').addEventListener('click', starteScanner);
el('stopScanBtn').addEventListener('click', stoppeScanner);
el('koppelnBtn').addEventListener('click', () => koppeln(el('serverEingabe').value, el('codeEingabe').value));
el('nochmalBtn').addEventListener('click', ladeTurnierdaten);

const parameter = new URLSearchParams(location.search);
if (mobil.verbindung && parameter.get('laden')) {
    ladeTurnierdaten();
} else {
    // Gekoppelt und "neu koppeln" gewählt (oder noch nie gekoppelt): bisherige Adresse vorbelegen.
    if (mobil.verbindung) el('serverEingabe').value = mobil.verbindung.serverUrl;
    // Aufruf aus der Kamera-App/dem Browser mit Kopplungs-Link (…/download#code=…) landet nicht hier;
    // ein eingefügter Link im Adressfeld wird aber wie ein Scan behandelt.
    el('serverEingabe').addEventListener('change', () => {
        const kopplung = leseKopplungsUrl(el('serverEingabe').value);
        if (kopplung) {
            el('serverEingabe').value = kopplung.serverUrl;
            el('codeEingabe').value = kopplung.code;
        }
    });
}
