// Einfache Ratenbegrenzung je Absender (Festfenster, im Speicher). Eine Cloud-Instanz reicht für den Zweck; hinter
// mehreren Instanzen würde jede für sich zählen.
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
                e = { start: zeit, anzahl: 0 };
                eintraege.set(schluessel, e);
            }
            e.anzahl += 1;
            return e.anzahl <= max;
        },
        groesse: () => eintraege.size
    };
}

export function clientIp(req, env = process.env) {
    if (env.LIVE_PROXY_VERTRAUEN === 'true') {
        const weitergeleitet = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
        if (weitergeleitet) return weitergeleitet;
    }
    return req.socket?.remoteAddress || 'unbekannt';
}
