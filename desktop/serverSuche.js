// Findet den Hallen-Server per mDNS (Dienst _hajime._tcp, angekündigt von src/sync/ankuendigung.js)
// — unabhängig davon, ob das Betriebssystem .local-Namen auflöst. Gibt die URL mit IPv4-Adresse
// zurück. Ein Master beendet die Suche sofort, sonst entscheidet waehleServer nach Ablauf.
import { Bonjour } from 'bonjour-service';
import { waehleServer } from './updateLogik.js';

export function sucheServer({ timeoutMs = 5000 } = {}) {
    return new Promise((resolve) => {
        // Fehler-Callback wie in ankuendigung.js: ein belegter/gesperrter UDP-Port 5353 darf die
        // App nie abstürzen lassen — die Suche endet dann einfach ohne Treffer (Timeout).
        const bonjour = new Bonjour({}, (err) => console.warn('[mDNS] Fehler bei der Serversuche:', err.message));
        const kandidaten = [];
        let fertig = false;
        const ende = (ergebnis) => {
            if (fertig) return;
            fertig = true;
            clearTimeout(timer);
            browser.stop();
            bonjour.destroy();
            resolve(ergebnis);
        };
        const browser = bonjour.find({ type: 'hajime' }, (dienst) => {
            const ipv4 = (dienst.addresses || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || (dienst.referer && dienst.referer.address);
            if (!ipv4) return;
            const kandidat = { url: `http://${ipv4}:${dienst.port}`, rolle: dienst.txt && dienst.txt.rolle, version: dienst.txt && dienst.txt.version };
            kandidaten.push(kandidat);
            if (kandidat.rolle === 'master') ende(kandidat);
        });
        const timer = setTimeout(() => ende(waehleServer(kandidaten)), timeoutMs);
    });
}
