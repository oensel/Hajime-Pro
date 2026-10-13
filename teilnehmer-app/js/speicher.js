// Sterne und Glocken liegen im Gerät, je Turnier (Spec 6.2, Entscheidung 3/4). Regeln (Plan R5):
// Glocke an => Stern an; Stern aus => Glocke weg. Stern auf einen Teilnehmer: Glocke an. Stern auf einen Verein:
// Glocke aus, "Glocke für alle" und Ausnahmen je Teilnehmer.
const PRAEFIX = 'hajime-live:';

export function erzeugeSpeicher(storage, turnierKey) {
    const name = `${PRAEFIX}${turnierKey}`;
    let zustand = { teilnehmer: {}, vereine: {} };
    try {
        const roh = storage.getItem(name);
        if (roh) {
            const gelesen = JSON.parse(roh);
            if (gelesen && typeof gelesen === 'object') {
                zustand = { teilnehmer: gelesen.teilnehmer || {}, vereine: gelesen.vereine || {} };
                for (const v of Object.values(zustand.vereine)) if (v && !v.abgewaehlt) v.abgewaehlt = {};
            }
        }
    } catch { /* leerer Zustand */ }

    const sichere = () => { try { storage.setItem(name, JSON.stringify(zustand)); } catch { /* nur im Speicher */ } };
    const verein = (v) => zustand.vereine[v] || (zustand.vereine[v] = { glockeAlle: false, ausnahmen: {}, abgewaehlt: {} });
    // Ein Teilnehmer eines verfolgten Vereins gilt als gesternt, solange er nicht ausdrücklich abgewählt wurde
    // (zur Laufzeit ausgewertet: auch später gemeldete Vereinsangehörige sind damit automatisch dabei).
    const abgewaehlt = (key, vereinKey) => {
        const v = vereinKey ? zustand.vereine[vereinKey] : null;
        return !!(v && v.abgewaehlt && v.abgewaehlt[key]);
    };
    const ueberVerein = (key, vereinKey) => !!vereinKey && Object.hasOwn(zustand.vereine, vereinKey) && !abgewaehlt(key, vereinKey);

    return {
        istGesternt: (key, vereinKey) => Object.hasOwn(zustand.teilnehmer, key) || ueberVerein(key, vereinKey),
        stern(key, an, vereinKey) {
            if (an) {
                if (abgewaehlt(key, vereinKey)) delete zustand.vereine[vereinKey].abgewaehlt[key];
                else if (!Object.hasOwn(zustand.teilnehmer, key) && !ueberVerein(key, vereinKey)) zustand.teilnehmer[key] = { glocke: true };
            } else {
                delete zustand.teilnehmer[key];
                if (Object.hasOwn(zustand.vereine, vereinKey || '')) verein(vereinKey).abgewaehlt[key] = true;
            }
            sichere();
        },
        glocke(key, an, vereinKey) {
            if (abgewaehlt(key, vereinKey)) delete zustand.vereine[vereinKey].abgewaehlt[key];
            zustand.teilnehmer[key] = { glocke: !!an };
            sichere();
        },
        hatGlocke(key, vereinKey) {
            if (Object.hasOwn(zustand.teilnehmer, key)) return !!zustand.teilnehmer[key].glocke;
            const v = vereinKey ? zustand.vereine[vereinKey] : null;
            if (!v || abgewaehlt(key, vereinKey)) return false;
            return Object.hasOwn(v.ausnahmen, key) ? !!v.ausnahmen[key] : !!v.glockeAlle;
        },
        abgewaehlt: () => Object.values(zustand.vereine).flatMap(v => Object.keys(v.abgewaehlt || {}).filter(k => v.abgewaehlt[k])),
        vereinGesternt: (vereinKey) => Object.hasOwn(zustand.vereine, vereinKey),
        vereinStern(vereinKey, an) {
            if (an) verein(vereinKey); else delete zustand.vereine[vereinKey];
            sichere();
        },
        vereinGlockeAlle(vereinKey, an) {
            const v = verein(vereinKey);
            v.glockeAlle = !!an;
            v.ausnahmen = {};
            sichere();
        },
        vereinAusnahme(vereinKey, key, an) {
            verein(vereinKey).ausnahmen[key] = !!an;
            sichere();
        },
        anfrage: () => ({ teilnehmer: Object.keys(zustand.teilnehmer), vereine: Object.keys(zustand.vereine) }),
        exportiere: () => JSON.parse(JSON.stringify(zustand))
    };
}

// Entfernt Daten von Turnieren, die die Cloud nicht mehr kennt (kein turnierübergreifender Personenbezug).
export function bereinigeAlte(storage, behalteTurnierKeys) {
    // Auch der zwischengespeicherte Stand der Übersicht (hajime-live:cache:<key>) gehört zum Turnier.
    const behalten = new Set(behalteTurnierKeys.flatMap(k => [`${PRAEFIX}${k}`, `${PRAEFIX}cache:${k}`]));
    const zuLoeschen = [];
    try {
        for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (k && k.startsWith(PRAEFIX) && !behalten.has(k)) zuLoeschen.push(k);
        }
        for (const k of zuLoeschen) storage.removeItem(k);
    } catch { /* Speicher nicht verfügbar */ }
    return zuLoeschen.length;
}

// Turniere, für die dieses Gerät noch eine zwischengespeicherte Übersicht hat (Offline-Start ohne Cloud).
export function gecachteTurniere(storage) {
    const praefix = `${PRAEFIX}cache:`;
    const keys = [];
    try {
        for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (k && k.startsWith(praefix)) keys.push(k.slice(praefix.length));
        }
    } catch { /* Speicher nicht verfügbar */ }
    return keys;
}
