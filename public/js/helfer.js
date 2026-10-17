// Helfer-App (Spec Helferverwaltung 5): Turniere der eigenen Vereine, offene Dienste, Meine Dienste, Profil.
// Spricht nur /api/helfer/* (und /api/vereine für die Vereinssuche). Bindet menu.js bewusst nicht ein:
// apiFetch übernimmt dessen Verhalten (Bearer-Token, bei 401 zur Anmeldung). Navigation über den Hash
// (#turniere, #turnier=<id>, #dienste, #profil), damit die Zurück-Taste funktioniert.
// Alle Daten werden per textContent/createElement eingesetzt, nie per innerHTML.
import { platzText, gruppiereNachBezeichnung, datumText, wartetAufFreischaltung } from '/js/shared/helferAnzeige.js';
import { formatiereMinuten } from '/js/shared/helferZeit.js';
import { ansichtProfil } from '/js/helferProfil.js';

const TOKEN_SCHLUESSEL = 'dokume_token';
const FRIST_TEXT = 'Bitte melde dich bei der Turnierleitung.';
const FEHLER_TEXTE = {
    ueberlappung: 'Das überschneidet sich mit einem deiner Dienste.',
    voll: 'Gerade vergeben',
    frist: FRIST_TEXT
};

/** Abbruch nach 401: die Seite wechselt bereits zur Anmeldung, nichts mehr anzeigen. */
class AbmeldungFehler extends Error {}

export function abmelden() {
    try {
        localStorage.removeItem(TOKEN_SCHLUESSEL);
        localStorage.removeItem('dokume_user');
    } catch (e) { /* localStorage gesperrt */ }
    window.location.href = '/login.html';
}

/**
 * fetch mit Bearer-Token und JSON. Liefert { ok, status, daten }; bei 401 Abmeldung.
 * @param {string} url
 * @param {{ method?: string, body?: object }} [optionen]
 */
export async function apiFetch(url, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    let token = null;
    try { token = localStorage.getItem(TOKEN_SCHLUESSEL); } catch (e) { /* gesperrt */ }
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const antwort = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (antwort.status === 401) {
        abmelden();
        throw new AbmeldungFehler('Nicht angemeldet.');
    }
    let daten = null;
    try { daten = await antwort.json(); } catch (e) { /* leere Antwort */ }
    return { ok: antwort.ok, status: antwort.status, daten };
}

/** Lädt JSON oder wirft mit der Meldung des Servers. */
export async function ladeJson(url) {
    const { ok, daten } = await apiFetch(url);
    if (!ok) throw new Error((daten && daten.error) || 'Laden fehlgeschlagen.');
    return daten;
}

/**
 * Element erzeugen: el('p', { class: 'x', text: 'Hallo' }, kind1, 'Text'). Strings werden Textknoten.
 * Attribute mit Präfix "on" werden Ereignisse.
 */
export function el(tag, attribute = {}, ...kinder) {
    const knoten = document.createElement(tag);
    for (const [name, wert] of Object.entries(attribute)) {
        if (wert == null || wert === false) continue;
        if (name === 'class') knoten.className = wert;
        else if (name === 'text') knoten.textContent = wert;
        else if (name.startsWith('on')) knoten.addEventListener(name.slice(2), wert);
        else knoten.setAttribute(name, wert === true ? '' : String(wert));
    }
    for (const kind of kinder.flat()) {
        if (kind != null && kind !== false) knoten.append(kind);
    }
    return knoten;
}

export function leer(titel, hinweis) {
    return el('div', { class: 'hf-leer' }, el('h2', { text: titel }), hinweis ? el('p', { text: hinweis }) : null);
}

const zeitraum = (von, bis) => `${formatiereMinuten(von)} – ${formatiereMinuten(bis)}`;

function fehlerAnzeige(meldung, zurueck) {
    return el('div', {},
        zurueck ? kopfzeile('Fehler', null) : null,
        el('p', { class: 'hf-hinweis hf-hinweis-fehler', role: 'alert', text: meldung }));
}

function kopfzeile(titel, untertitel) {
    return el('div', { class: 'hf-kopfzeile' },
        el('a', { class: 'hf-zurueck', href: '#turniere', 'aria-label': 'Zurück zu den Turnieren' },
            el('span', { 'aria-hidden': 'true', text: '←' })),
        el('div', { class: 'hf-kopfzeile-text' },
            el('h1', { class: 'hf-titel', text: titel }),
            untertitel ? el('p', { class: 'hf-meta', text: untertitel }) : null));
}

// ---------- Turniere ----------

function dienstBadge(anzahl) {
    if (!anzahl) return el('span', { class: 'hf-badge hf-badge-leise', text: 'Alle Dienste besetzt' });
    return el('span', { class: 'hf-badge', text: anzahl === 1 ? '1 Dienst offen' : `${anzahl} Dienste offen` });
}

async function ansichtTurniere() {
    const [turniere, profil] = await Promise.all([
        ladeJson('/api/helfer/turniere'),
        ladeJson('/api/helfer/profil').catch(() => null)
    ]);
    const inhalt = el('div', {}, el('h1', { class: 'hf-titel hf-titel-seite', text: 'Turniere' }));
    if (turniere.length === 0) {
        inhalt.append(wartetAufFreischaltung(profil && profil.vereine)
            ? leer('Noch nicht freigeschaltet', 'Deine Registrierung muss noch freigeschaltet werden.')
            : leer('Keine Turniere', 'Sobald einer deiner Vereine ein Turnier veröffentlicht, erscheint es hier.'));
        return inhalt;
    }
    const liste = el('ul', { class: 'hf-karten' });
    for (const t of turniere) {
        const meta = [datumText(t.datum), t.ort].filter(Boolean).join(' · ');
        liste.append(el('li', {},
            el('a', { class: 'hf-turnier-karte', href: `#turnier=${t.id}` },
                el('div', { class: 'hf-karte-kopf' },
                    el('h2', { class: 'hf-karte-titel', text: t.bezeichnung }),
                    dienstBadge(t.offeneDienste)),
                el('p', { class: 'hf-meta', text: meta }),
                t.verein_name ? el('p', { class: 'hf-meta', text: t.verein_name }) : null)));
    }
    inhalt.append(liste);
    return inhalt;
}

// ---------- Offene Dienste eines Turniers ----------

// Meldung zu einem Slot, die nach dem Neuladen der Dienste-Liste wieder erscheint ({ slotId, text }).
let slotMeldung = null;

const slotSelektor = (slotId) => `[data-slot-id="${Number(slotId)}"]`;

async function eintragen(slot, knopf, fehlerZeile) {
    knopf.disabled = true;
    fehlerZeile.textContent = '';
    const { ok, daten } = await apiFetch('/api/helfer/einsaetze', { method: 'POST', body: { slotId: slot.slotId } });
    if (ok) return zeige({ fokus: slotSelektor(slot.slotId) });
    const code = daten && daten.code;
    // Der Stand kann sich geändert haben (Slot voll, Frist, eigener Dienst woanders): Liste neu laden,
    // die Meldung bleibt am Slot bzw. oben stehen, falls der Slot nicht mehr angeboten wird.
    slotMeldung = { slotId: slot.slotId, text: FEHLER_TEXTE[code] || (daten && daten.error) || 'Eintragen fehlgeschlagen.' };
    return zeige({ fokus: `${slotSelektor(slot.slotId)} .hf-fehler, .hf-slot-meldung` });
}

function slotZeile(slot, fristAbgelaufen) {
    const fehlerZeile = el('p', { class: 'hf-fehler', role: 'alert', tabindex: '-1' });
    if (slotMeldung && slotMeldung.slotId === slot.slotId) {
        fehlerZeile.textContent = slotMeldung.text;
        slotMeldung = null;
    }
    let aktion;
    if (slot.eingetragen) {
        aktion = el('span', { class: 'hf-badge hf-badge-erfolg', text: 'Eingetragen' });
    } else if (!fristAbgelaufen) {
        aktion = el('button', { type: 'button', class: 'hf-knopf', text: 'Eintragen' });
        aktion.addEventListener('click', () => eintragen(slot, aktion, fehlerZeile)
            .catch(e => { if (!(e instanceof AbmeldungFehler)) { fehlerZeile.textContent = e.message; aktion.disabled = false; } }));
    }
    return el('li', { class: 'hf-slot' + (slot.eingetragen ? ' hf-slot-eigen' : ''), 'data-slot-id': slot.slotId, tabindex: '-1' },
        el('div', { class: 'hf-slot-text' },
            el('span', { class: 'hf-slot-zeit', text: zeitraum(slot.von_min, slot.bis_min) }),
            el('span', { class: 'hf-slot-info', text: slot.eingetragen ? 'Du bist eingetragen' : platzText(slot.frei) })),
        aktion,
        fehlerZeile);
}

async function ansichtDienste(turnierId) {
    const { ok, daten } = await apiFetch(`/api/helfer/turniere/${turnierId}/dienste`);
    if (!ok) return fehlerAnzeige((daten && daten.error) || 'Laden fehlgeschlagen.', true);
    const { turnier, fristAbgelaufen, dienste } = daten;
    const inhalt = el('div', {},
        kopfzeile(turnier.bezeichnung, [datumText(turnier.datum), turnier.ort].filter(Boolean).join(' · ')));
    if (fristAbgelaufen) {
        inhalt.append(el('p', { class: 'hf-hinweis', text: `Eintragen ist nicht mehr möglich. ${FRIST_TEXT}` }));
    }
    const gruppen = gruppiereNachBezeichnung(dienste);
    const abschnitte = gruppen.map(gruppe => el('section', { class: 'hf-gruppe' },
        el('h2', { class: 'hf-gruppe-titel', text: gruppe.bezeichnung }),
        el('ul', { class: 'hf-liste' }, gruppe.slots.map(s => slotZeile(s, fristAbgelaufen)))));
    // Meldung zu einem Slot, der nach dem Neuladen nicht mehr angeboten wird (z. B. inzwischen voll)
    if (slotMeldung) {
        inhalt.append(el('p', { class: 'hf-hinweis hf-hinweis-fehler hf-slot-meldung', role: 'alert', tabindex: '-1', text: slotMeldung.text }));
        slotMeldung = null;
    }
    if (gruppen.length === 0) inhalt.append(leer('Keine offenen Dienste', 'Alle Dienste dieses Turniers sind besetzt.'));
    else inhalt.append(...abschnitte);
    return inhalt;
}

// ---------- Meine Dienste ----------

async function austragen(dienst, knopf, fehlerZeile) {
    knopf.disabled = true;
    fehlerZeile.textContent = '';
    const { ok, daten } = await apiFetch(`/api/helfer/einsaetze/${dienst.einsatzId}`, { method: 'DELETE' });
    if (ok) return zeige({ fokus: 'h1' });
    const code = daten && daten.code;
    fehlerZeile.textContent = code === 'frist' ? FRIST_TEXT : ((daten && daten.error) || 'Austragen fehlgeschlagen.');
    knopf.disabled = code === 'frist';
}

function dienstZeile(dienst) {
    const fehlerZeile = el('p', { class: 'hf-fehler', role: 'alert' });
    let aktion = null;
    if (dienst.darfAustragen) {
        aktion = el('button', { type: 'button', class: 'hf-knopf hf-knopf-zweit', text: 'Austragen' });
        aktion.addEventListener('click', () => austragen(dienst, aktion, fehlerZeile)
            .catch(e => { if (!(e instanceof AbmeldungFehler)) { fehlerZeile.textContent = e.message; aktion.disabled = false; } }));
    } else {
        fehlerZeile.textContent = FRIST_TEXT;
        fehlerZeile.classList.add('hf-fehler-leise');
    }
    return el('li', { class: 'hf-dienst' },
        el('div', { class: 'hf-slot-text' },
            el('span', { class: 'hf-slot-zeit', text: zeitraum(dienst.von_min, dienst.bis_min) }),
            el('span', { class: 'hf-slot-info', text: dienst.taetigkeit })),
        aktion,
        fehlerZeile);
}

async function ansichtMeine() {
    const dienste = await ladeJson('/api/helfer/meine-dienste');
    const inhalt = el('div', {}, el('h1', { class: 'hf-titel hf-titel-seite', text: 'Meine Dienste' }));
    if (dienste.length === 0) {
        inhalt.append(leer('Noch keine Dienste', 'Unter „Turniere“ findest du die offenen Dienste deiner Vereine.'));
        return inhalt;
    }
    // Server liefert aufsteigend nach Datum und Uhrzeit; gruppiert je Tag und Turnier (Reihenfolge bleibt)
    const sortiert = dienste.slice().sort((a, b) =>
        String(a.turnier.datum || '').localeCompare(String(b.turnier.datum || '')) || a.von_min - b.von_min || a.einsatzId - b.einsatzId);
    const gruppen = new Map();
    for (const d of sortiert) {
        const schluessel = `${d.turnier.datum}|${d.turnier.id}`;
        if (!gruppen.has(schluessel)) gruppen.set(schluessel, { turnier: d.turnier, dienste: [] });
        gruppen.get(schluessel).dienste.push(d);
    }
    for (const { turnier, dienste: liste } of gruppen.values()) {
        inhalt.append(el('section', { class: 'hf-gruppe hf-tag' },
            el('h2', { class: 'hf-gruppe-titel' },
                el('span', { class: 'hf-tag-datum', text: datumText(turnier.datum) }),
                el('a', { class: 'hf-tag-turnier', href: `#turnier=${turnier.id}`, text: turnier.name })),
            el('ul', { class: 'hf-liste' }, liste.map(dienstZeile))));
    }
    return inhalt;
}

// ---------- Navigation ----------

function liesRoute() {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const treffer = /^turnier=(\d+)$/.exec(hash);
    if (treffer) return { reiter: 'turniere', turnierId: Number(treffer[1]) };
    if (hash === 'dienste' || hash === 'profil') return { reiter: hash };
    return { reiter: 'turniere' };
}

function markiereNavigation(reiter) {
    for (const link of document.querySelectorAll('.hf-nav a')) {
        if (link.dataset.reiter === reiter) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    }
}

let aufrufNummer = 0;

// Fokus nach dem Zeichnen: auf das Element zum Selektor, sonst auf die Hauptüberschrift; ohne Scrollsprung.
function setzeFokus(bereich, selektor) {
    const ziel = (selektor && bereich.querySelector(selektor)) || bereich.querySelector('h1');
    if (!ziel) return;
    if (!ziel.hasAttribute('tabindex') && !ziel.matches('a[href], button, input, select, textarea')) ziel.setAttribute('tabindex', '-1');
    ziel.focus({ preventScroll: true });
}

/**
 * Zeigt die Ansicht zum aktuellen Hash; spätere Aufrufe verdrängen langsamere frühere.
 * @param {{ fokus?: string }} [optionen] - Selektor für den Fokus danach ('h1' = Hauptüberschrift); ohne: Fokus bleibt
 */
export async function zeige({ fokus } = {}) {
    const nummer = ++aufrufNummer;
    const route = liesRoute();
    markiereNavigation(route.reiter);
    const bereich = document.getElementById('hfInhalt');
    if (!bereich.firstChild) bereich.append(el('p', { class: 'hf-laden', text: 'Wird geladen …' }));
    bereich.setAttribute('aria-busy', 'true');
    let knoten;
    try {
        if (route.turnierId) knoten = await ansichtDienste(route.turnierId);
        else if (route.reiter === 'dienste') knoten = await ansichtMeine();
        else if (route.reiter === 'profil') knoten = await ansichtProfil({ apiFetch, ladeJson, el, abmelden, zeige });
        else knoten = await ansichtTurniere();
    } catch (e) {
        if (e instanceof AbmeldungFehler) return;
        knoten = fehlerAnzeige(e.message || 'Laden fehlgeschlagen.', false);
    }
    // Nur für genau dieses Neuzeichnen gedacht: nicht verbraucht (Fehler beim Laden, andere Ansicht) → verwerfen
    slotMeldung = null;
    if (nummer !== aufrufNummer) return;
    bereich.replaceChildren(knoten);
    bereich.removeAttribute('aria-busy');
    if (fokus) setzeFokus(bereich, fokus);
}

window.addEventListener('hashchange', () => {
    document.getElementById('hfInhalt').replaceChildren();
    window.scrollTo(0, 0);
    slotMeldung = null;
    zeige({ fokus: 'h1' });
});
zeige();
