// Entscheidung, ob und wo der Update-Knopf der Cluster-Seite erscheint (Spec 2026-10-14-cluster-update-design.md).
// Rein und ohne Abhängigkeiten, damit Server und Tests dieselbe Regel nutzen.
const VERSION = /^\d+\.\d+\.\d+$/;

export function istVersion(v) {
    return typeof v === 'string' && VERSION.test(v);
}

export function vergleicheVersionen(a, b) {
    if (!istVersion(a) || !istVersion(b)) return null;
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    }
    return 0;
}

const nein = (grund) => ({ knopf: false, aktion: null, ziel: null, grund });

// rolle: 'master' | 'secondary'. Es wird immer der ÄLTERE Server aktualisiert, bei Gleichstand der Secondary.
export function entscheideUpdate({ eigeneVersion, partnerVersion, neuesteVersion, rolle, laeuft }) {
    if (laeuft) return nein('Ein Update läuft bereits.');
    if (!istVersion(eigeneVersion)) return nein('Die eigene Version ist unbekannt.');
    if (!istVersion(partnerVersion)) return nein('Die Version des Partners ist nicht bekannt (Partner nicht erreichbar).');
    if (!istVersion(neuesteVersion)) return nein('Das neueste Release ist nicht prüfbar (kein Internet?).');
    if (vergleicheVersionen(neuesteVersion, eigeneVersion) <= 0) return nein('Dieser Server ist auf dem neuesten Stand.');
    if (vergleicheVersionen(neuesteVersion, partnerVersion) < 0) return nein('Der Partner hat bereits eine neuere Version als das bekannte Release.');

    const gegenPartner = vergleicheVersionen(eigeneVersion, partnerVersion);
    if (gegenPartner > 0) return nein('Der andere Server ist älter und wird zuerst aktualisiert.');
    if (gegenPartner === 0 && rolle !== 'secondary') return nein('Zuerst den Secondary aktualisieren.');
    return { knopf: true, aktion: rolle === 'master' ? 'nach_uebergabe' : 'direkt', ziel: neuesteVersion, grund: null };
}

// Der Master stößt das Update des Secondary an (Aufruf über die VIP): Sicht des Masters auf den Partner.
// Erlaubt nur, was der Secondary für sich selbst auch dürfte (aktion 'direkt'): er ist nicht neuer als der Master und
// nicht auf dem neuesten Release. Den Master selbst aktualisiert weiter dessen eigener Knopf (mit Übergabe).
export function entscheidePartnerUpdate({ eigeneVersion, rolle, partner, neuesteVersion }) {
    if (rolle !== 'master') return nein('Nur der Master stößt das Update des Secondary an.');
    if (!partner) return nein('Der Secondary ist nicht erreichbar.');
    if (partner.rolle !== 'secondary') return nein('Der Partner ist nicht Secondary.');
    if (!istVersion(eigeneVersion)) return nein('Die eigene Version ist unbekannt.');
    if (!istVersion(partner.version)) return nein('Die Version des Secondary ist nicht bekannt.');
    if (!istVersion(neuesteVersion)) return nein('Das neueste Release ist nicht prüfbar (kein Internet?).');
    if (partner.updateLaeuft) return nein('Auf dem Secondary läuft bereits ein Update.');
    if (vergleicheVersionen(neuesteVersion, partner.version) <= 0) return nein('Der Secondary ist auf dem neuesten Stand.');
    if (vergleicheVersionen(partner.version, eigeneVersion) > 0) return nein('Der Secondary ist neuer als der Master: den Master mit „Übergeben und aktualisieren“ aktualisieren.');
    if (vergleicheVersionen(neuesteVersion, eigeneVersion) < 0) return nein('Der Master hat bereits eine neuere Version als das bekannte Release.');
    return { knopf: true, aktion: 'partner', ziel: neuesteVersion, grund: null };
}
