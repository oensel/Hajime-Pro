// mDNS-Ankündigung des Hallen-Servers (Spec Desktop-Client Abschnitt 5.1): Desktop-Clients finden
// den Server über den Dienst _hajime._tcp, Browser erreichen ihn als <MDNS_NAME>.local (z.B.
// turnier.local/download). Im Cluster kündigt nur der Master an — der Zustand wird alle 2 s aus
// sync.modus() übernommen, damit Beförderung/Rückstufung keine eigene Verdrahtung brauchen.
import os from 'os';
import { Bonjour } from 'bonjour-service';
import multicastDns from 'multicast-dns';

const PRUEF_MS = 2000;

export function lokaleIpv4Adressen(netzwerk = os.networkInterfaces()) {
    const ergebnis = [];
    for (const eintraege of Object.values(netzwerk)) {
        for (const e of eintraege || []) {
            if ((e.family === 'IPv4' || e.family === 4) && !e.internal) ergebnis.push(e.address);
        }
    }
    return ergebnis;
}

export function beantworteAnfrage(fragen, { hostname, adressen }) {
    const gesucht = fragen.some(f => String(f.name).toLowerCase() === hostname.toLowerCase() && (f.type === 'A' || f.type === 'ANY'));
    return gesucht ? adressen.map(data => ({ name: hostname, type: 'A', ttl: 120, data })) : [];
}

export function starteAnkuendigung({ name, port, version, knoten, modus }) {
    const hostname = `${name}.local`;
    // Ohne errorCallback wirft bonjour-service intern (Server.errorCallback = err => { throw err })
    // und reißt bei einem Bindungsfehler (EACCES/EADDRINUSE auf UDP 5353, z.B. weil bereits ein
    // anderer mDNS-Responder läuft) den ganzen Prozess mit. Wie beim eigenen mdns-Handler unten nur
    // loggen — die Ankündigung bleibt dann inaktiv, der Server läuft weiter.
    const bonjour = new Bonjour({}, (err) => console.warn('[mDNS] Fehler:', err.message));
    const mdns = multicastDns();
    let dienst = null;
    let aktiv = false;

    // A-Records für <name>.local — damit auch Browser (nicht nur der Desktop-Client) den Namen auflösen.
    mdns.on('query', (anfrage) => {
        if (!aktiv) return;
        const antworten = beantworteAnfrage(anfrage.questions || [], { hostname, adressen: lokaleIpv4Adressen() });
        if (antworten.length) mdns.respond({ answers: antworten });
    });
    mdns.on('error', (err) => console.warn('[mDNS] Fehler:', err.message));

    function abgleichen() {
        const sollAktiv = modus() === 'master';
        if (sollAktiv === aktiv) return;
        aktiv = sollAktiv;
        if (aktiv) {
            dienst = bonjour.publish({ name: `Hajime Pro (${knoten || name})`, type: 'hajime', port, host: hostname, txt: { version, knoten: knoten || '', rolle: 'master' } });
            console.log(`[mDNS] Kündige ${hostname}:${port} an.`);
        } else if (dienst) {
            dienst.stop();
            dienst = null;
            console.log('[mDNS] Ankündigung beendet (kein Master).');
        }
    }
    abgleichen();
    const timer = setInterval(abgleichen, PRUEF_MS);
    timer.unref();

    return {
        stoppe() {
            clearInterval(timer);
            aktiv = false;
            bonjour.unpublishAll(() => bonjour.destroy());
            mdns.destroy();
        }
    };
}
