// Inhalt des Kopplungs-QR-Codes auf matten.html: eine gewöhnliche URL zur Download-Seite des
// Hallen-Servers mit dem Kopplungscode im Fragment, z.B. http://192.168.1.5:3000/download#code=123456.
// Mit der normalen Kamera-App gescannt öffnet sie die Download-Seite (Android-App laden); die
// App selbst liest daraus Server-Adresse und Code und koppelt in einem Schritt.
// Gemeinsam genutzt vom Server-Frontend (Erzeugen) und von der App (Lesen).

export function baueKopplungsUrl(serverUrl, code) {
    const basis = String(serverUrl).replace(/\/+$/, '');
    return `${basis}/download#code=${String(code).replace(/\D/g, '')}`;
}

// Cloud-Live: die Cloud führt ein Turnier live; die Geräte bekommen als Server-Adresse den turnierbezogenen Pfad
// <cloud>/turnierlive/<schluessel> (Status, Kopplung und /db hängen darunter), der Code steht im Fragment.
const CLOUD_PFAD = /^\/turnierlive\/([A-Za-z0-9_-]{22})(\/download)?\/?$/;

export function baueCloudKopplungsUrl(cloudUrl, schluessel, code) {
    const basis = String(cloudUrl).replace(/\/+$/, '');
    return `${basis}/turnierlive/${schluessel}#code=${String(code).replace(/\D/g, '')}`;
}

// Liefert { serverUrl, code } oder null, wenn der Text kein Kopplungs-QR ist.
export function leseKopplungsUrl(text) {
    let url;
    try {
        url = new URL(String(text).trim());
    } catch (e) {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const cloud = CLOUD_PFAD.exec(url.pathname);
    if (url.pathname !== '/download' && !cloud) return null;
    const code = new URLSearchParams(url.hash.replace(/^#/, '')).get('code');
    if (!code || !/^\d{6}$/.test(code)) return null;
    return { serverUrl: cloud ? `${url.origin}/turnierlive/${cloud[1]}` : url.origin, code };
}

// Eingabe des Anwenders ("192.168.1.5", "turnier.local:3000", "http://…/") -> Basis-URL.
export function normalisiereServerAdresse(eingabe) {
    let text = String(eingabe || '').trim();
    if (!text) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
    try {
        return new URL(text).origin;
    } catch (e) {
        return '';
    }
}
