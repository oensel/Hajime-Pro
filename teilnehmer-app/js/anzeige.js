// Anzeigetexte der Teilnehmer-App (Spec Abschnitt 4). Rein, ohne DOM: läuft im Browser und in den Unit-Tests.
export function gewichtText(gewichtsklasse) {
    return gewichtsklasse ? `${String(gewichtsklasse).replace(/^-/, '−')} kg` : '';
}

export function klassenTitel({ altersklasse, geschlecht }) {
    const g = geschlecht === 'w' ? 'weiblich' : geschlecht === 'm' ? 'männlich' : '';
    return [altersklasse, g].filter(Boolean).join(' ');
}

export function klasseText({ altersklasse, geschlecht, gewichtsklasse }) {
    const gewicht = gewichtText(gewichtsklasse);
    return [altersklasse, geschlecht, gewicht].filter(Boolean).join(' ');
}

export function matteText(bezeichnung) {
    const b = String(bezeichnung ?? '').trim();
    if (!b) return '';
    return /^\d+$/.test(b) ? `Matte ${b}` : b;
}

// Kurzform für den Matten-Block der Kachel: "Matte 2" und "2" werden "2", eigene Namen bleiben erhalten.
export function matteKurz(bezeichnung) {
    const b = String(bezeichnung ?? '').trim();
    const m = /^matte\s+(.+)$/i.exec(b);
    return m ? m[1] : b;
}

const HINWEIS = {
    nicht_ausgelost: 'noch nicht ausgelost',
    ohne_matte: 'noch keine Matte zugeteilt',
    verspaetet: 'nachgemeldet, Einteilung folgt',
    nicht_erschienen: 'nicht erschienen'
};

function kampfText(t) {
    switch (t.zustand) {
        case 'laeuft': return { text: 'läuft jetzt', art: 'laeuft' };
        case 'als_naechstes': return { text: 'als Nächstes', art: 'bald' };
        case 'in_n': return { text: t.abstand === 1 ? 'in 1 Kampf' : `in ${t.abstand} Kämpfen`, art: 'bald' };
        case 'wartet_auf_gegner': return { text: 'wartet auf Gegner', art: 'info' };
        case 'keine_weiteren': return { text: 'keine weiteren Kämpfe', art: 'info' };
        default: return null;
    }
}

export function kachelZeilen(t) {
    const titel = `${t.vorname ?? ''} ${t.nachname ?? ''}`.trim();
    const zeile1 = [klasseText(t), matteText(t.matteBezeichnung)].filter(Boolean).join(' · ');
    if (t.zustand === 'abgeschlossen') {
        const platz = Number.isInteger(t.platz) && t.platz >= 1 && t.platz <= 3 ? ` · Platz ${t.platz}` : '';
        return { titel, zeile1, zeile2: null, zeile3: `Abgeschlossen${platz}`, art: 'fertig' };
    }
    const kampf = kampfText(t);
    if (kampf) return { titel, zeile1, zeile2: `nächster Kampf: ${kampf.text}`, zeile3: null, art: kampf.art };
    return { titel, zeile1, zeile2: HINWEIS[t.zustand] ?? null, zeile3: null, art: 'info' };
}

// Alter aus den Zeiten der Cloud (nicht der Geräteuhr): der Uplink sendet spätestens alle 60 s ein Lebenszeichen.
export function verbindung({ empfangenAm, serverzeit, stand } = {}, schwelleSekunden = 180) {
    const empfangen = Date.parse(empfangenAm);
    const jetzt = Date.parse(serverzeit);
    if (Number.isNaN(empfangen) || Number.isNaN(jetzt)) return { verbunden: false, text: 'Kein Stand bekannt' };
    const uhrzeit = new Date(Date.parse(stand) || empfangen).toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
    });
    const verbunden = (jetzt - empfangen) / 1000 <= schwelleSekunden;
    return { verbunden, text: verbunden ? `Stand von ${uhrzeit}` : `Stand von ${uhrzeit} · Halle nicht verbunden` };
}

export function poolStatus({ status, gesamt, beendet, laeuft }) {
    if (status === 'abgeschlossen') return { text: 'Abgeschlossen', art: 'fertig' };
    if (!gesamt) return { text: 'Noch nicht ausgelost', art: 'info' };
    if (laeuft > 0) return { text: 'Läuft', art: 'laeuft' };
    const rest = gesamt - beendet;
    if (rest <= 0) return { text: 'In Prüfung', art: 'info' };
    return { text: rest === 1 ? 'Noch 1 Kampf' : `Noch ${rest} Kämpfe`, art: 'info' };
}

export function kampfStatus(k) {
    switch (k.status) {
        case 'beendet': return { text: `${k.p1 ?? 0}:${k.p2 ?? 0} · beendet`, art: 'fertig' };
        case 'freilos': return { text: 'Freilos', art: 'info' };
        case 'gestartet': return { text: 'läuft', art: 'laeuft' };
        case 'bereit':
        case 'vorbereiten':
            if (k.abstand === 0) return { text: 'als Nächstes', art: 'bald' };
            if (Number.isInteger(k.abstand)) return { text: k.abstand === 1 ? 'in 1 Kampf' : `in ${k.abstand} Kämpfen`, art: 'bald' };
            return { text: 'bereit', art: 'info' };
        default: return { text: 'wartet auf Gegner', art: 'info' };
    }
}

export function kaempferAnzeige(k) {
    return k ? { name: k.name, verein: k.verein || '' } : { name: 'offen', verein: '' };
}

export function kampfLink(turnierKey, kampf) {
    return `#/t/${encodeURIComponent(turnierKey)}/pool/${kampf.poolId}/kaempfe/${kampf.id}`;
}
