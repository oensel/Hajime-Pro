// Web-Push der Teilnehmer-App: Unterstützung erkennen, Berechtigung erfragen, Gerät anmelden, Glockenliste übertragen.
import { api } from './api.js';

export function umgebungLesen() {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return {
        hatServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
        hatPushManager: typeof window !== 'undefined' && 'PushManager' in window,
        hatNotification: typeof Notification !== 'undefined',
        berechtigung: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
        istIos: /iPad|iPhone|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
        istInstalliert: typeof window !== 'undefined' && !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true)
    };
}

export function pushStatus(u) {
    if (!u.hatServiceWorker) return 'nicht_unterstuetzt';
    if (!u.hatPushManager || !u.hatNotification) return u.istIos && !u.istInstalliert ? 'ios_installieren' : 'nicht_unterstuetzt';
    if (u.berechtigung === 'denied') return 'blockiert';
    return u.berechtigung === 'granted' ? 'aktiv' : 'bereit';
}

export function pushHinweis(status) {
    if (status === 'blockiert') return 'Benachrichtigungen sind in den Einstellungen deines Geräts blockiert.';
    if (status === 'ios_installieren') return 'Für Benachrichtigungen auf dem iPhone die App zuerst über „Teilen“ zum Home-Bildschirm hinzufügen und von dort öffnen.';
    if (status === 'nicht_unterstuetzt') return 'Dieses Gerät oder dieser Browser unterstützt keine Benachrichtigungen.';
    return null;
}

const base64ZuBytes = (b64) => {
    const roh = atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '='));
    return Uint8Array.from(roh, c => c.charCodeAt(0));
};

const hatGlocken = (liste) => liste.teilnehmer.length > 0 || liste.vereine.length > 0;

async function gleicheAb(turnierKey, speicher) {
    if (pushStatus(umgebungLesen()) !== 'aktiv') return;
    const reg = await navigator.serviceWorker.ready;
    const liste = speicher.glockenliste();
    let abo = await reg.pushManager.getSubscription();
    if (!hatGlocken(liste)) {
        if (abo) await api.pushAbmelden(turnierKey, abo.endpoint).catch(() => {});
        return;
    }
    if (!abo) {
        const { schluessel } = await api.pushSchluessel();
        abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ZuBytes(schluessel) });
    }
    await api.pushAnmelden(turnierKey, { abo: abo.toJSON(), glocken: liste });
}

let zeitgeber = null;
// Bei jeder Änderung von Stern, Glocke oder Verein aufgerufen (im Antippen-Ereignis: die Berechtigungsfrage braucht eine Nutzeraktion).
export function planeAbgleich(turnierKey, speicher) {
    try {
        if (hatGlocken(speicher.glockenliste()) && pushStatus(umgebungLesen()) === 'bereit') {
            Notification.requestPermission().then(() => gleicheAb(turnierKey, speicher)).catch(() => {});
            return;
        }
    } catch { /* ohne Push weiter */ }
    clearTimeout(zeitgeber);
    zeitgeber = setTimeout(() => { gleicheAb(turnierKey, speicher).catch(() => {}); }, 800);
}

// Hinweiszeile für Übersicht und Vereinsansicht: nur, wenn eine Glocke gesetzt ist und etwas zu tun oder zu wissen ist.
export function aktuellerPushHinweis(speicher) {
    try {
        if (!hatGlocken(speicher.glockenliste())) return null;
        return pushHinweis(pushStatus(umgebungLesen()));
    } catch { return null; }
}
