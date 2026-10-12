// Einfache Ratenbegrenzung je Absender (Festfenster, im Speicher). Eine Cloud-Instanz reicht für den Zweck; hinter
// mehreren Instanzen würde jede für sich zählen.
import net from 'node:net';

export function erzeugeRatenbegrenzung({ fensterMs = 60_000, max = 300, jetzt = Date.now, maxEintraege = 10_000 } = {}) {
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
                if (eintraege.size >= maxEintraege) bereinige(zeit);
                // Harte Obergrenze: sind danach noch alle Einträge im laufenden Fenster, fliegt der älteste (Map behält
                // die Einfügereihenfolge). So wächst der Speicher auch bei vielen verschiedenen Absendern nicht.
                while (eintraege.size >= maxEintraege) eintraege.delete(eintraege.keys().next().value);
                e = { start: zeit, anzahl: 0 };
                eintraege.set(schluessel, e);
            }
            e.anzahl += 1;
            return e.anzahl <= max;
        },
        groesse: () => eintraege.size
    };
}

// Absenderadresse. Hinter einem vertrauenswürdigen Proxy (LIVE_PROXY_VERTRAUEN=true) zählt X-Forwarded-For vom Ende
// der Kette: der eigene Proxy hängt die Adresse hinten an, was ein Client selbst vorn mitschickt, ist frei erfunden.
// LIVE_PROXY_HOPS gibt an, wie viele vertrauenswürdige Proxys in der Kette stehen (Standard 1).
export function clientIp(req, env = process.env) {
    const socket = req.socket?.remoteAddress || 'unbekannt';
    if (env.LIVE_PROXY_VERTRAUEN !== 'true') return socket;
    const hops = Math.max(1, Math.floor(Number(env.LIVE_PROXY_HOPS) || 1));
    const teile = String(req.headers?.['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const kandidat = teile[teile.length - hops];
    return kandidat && net.isIP(kandidat) ? kandidat : socket;
}
