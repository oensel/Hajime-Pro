// Einfache Ratenbegrenzung je Absender (Festfenster, im Speicher). Eine Cloud-Instanz reicht für den Zweck; hinter
// mehreren Instanzen würde jede für sich zählen.
import net from 'node:net';

// beiVollstand: was geschieht mit einem neuen Schlüssel, wenn die Tabelle voll ist und nichts abgelaufen ist?
//   'verdraengen' (Standard, öffentliche App-API): der älteste Eintrag fliegt, damit neue Nutzer bedient werden.
//   'sperren' (Fehlversuche am Ingest): der neue Schlüssel wird abgewiesen, laufende Zähler bleiben erhalten; ein
//   Angreifer mit vielen Adressen kann so keine Zähler zurücksetzen.
export function erzeugeRatenbegrenzung({
    fensterMs = 60_000, max = 300, jetzt = Date.now, maxEintraege = 10_000, beiVollstand = 'verdraengen'
} = {}) {
    const eintraege = new Map();

    function bereinige(zeit) {
        for (const [schluessel, e] of eintraege) {
            if (zeit - e.start >= fensterMs) eintraege.delete(schluessel);
        }
    }

    return {
        erlaube(schluessel) {
            const zeit = jetzt();
            let e = eintraege.get(schluessel);
            if (!e || zeit - e.start >= fensterMs) {
                if (!e && eintraege.size >= maxEintraege) {
                    bereinige(zeit);
                    if (eintraege.size >= maxEintraege) {
                        if (beiVollstand === 'sperren') return false;
                        while (eintraege.size >= maxEintraege) eintraege.delete(eintraege.keys().next().value);
                    }
                }
                e = { start: zeit, anzahl: 0 };
                eintraege.set(schluessel, e);
            }
            e.anzahl += 1;
            return e.anzahl <= max;
        },
        groesse: () => eintraege.size
    };
}

// Entfernt Port, eckige Klammern und Zonen-ID, damit "203.0.113.7:51234" und "[2001:db8::1]:443" als Adresse gelten.
function normalisiereAdresse(roh) {
    let a = String(roh || '').trim();
    const klammer = /^\[([^\]]+)\](?::\d+)?$/.exec(a);
    if (klammer) a = klammer[1];
    else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(a)) a = a.slice(0, a.lastIndexOf(':'));
    return a.replace(/%.*$/, '');
}

let proxyHinweisGegeben = false;

// Absenderadresse. Hinter einem vertrauenswürdigen Proxy (LIVE_PROXY_VERTRAUEN=true) zählt X-Forwarded-For vom Ende
// der Kette: der eigene Proxy hängt die Adresse hinten an, was ein Client selbst vorn mitschickt, ist frei erfunden.
// LIVE_PROXY_HOPS gibt an, wie viele vertrauenswürdige Proxys in der Kette stehen (Standard 1). Lässt sich keine gültige
// Adresse ermitteln, gilt die Socket-Adresse (alle Clients teilen sich dann ein Limit) und der Betreiber bekommt einmal
// einen Hinweis im Log, damit eine Fehlkonfiguration des Proxys nicht unbemerkt bleibt.
export function clientIp(req, env = process.env, log = console) {
    const socket = req.socket?.remoteAddress || 'unbekannt';
    if (env.LIVE_PROXY_VERTRAUEN !== 'true') return socket;
    const hops = Math.max(1, Math.floor(Number(env.LIVE_PROXY_HOPS) || 1));
    const teile = String(req.headers?.['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const kandidat = normalisiereAdresse(teile[teile.length - hops]);
    if (kandidat && net.isIP(kandidat)) return kandidat;
    if (!proxyHinweisGegeben) {
        proxyHinweisGegeben = true;
        log.warn('[LiveCloud] LIVE_PROXY_VERTRAUEN=true, aber X-Forwarded-For enthält keine gültige Adresse (LIVE_PROXY_HOPS prüfen); die Ratenbegrenzung zählt vorerst je Proxy-Adresse');
    }
    return socket;
}
