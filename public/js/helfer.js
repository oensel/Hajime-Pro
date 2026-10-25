// Helfer-App (Spec Helferverwaltung 5): Turniere der eigenen Vereine, offene Dienste, Meine Dienste, Profil.
// Spricht nur /api/helfer/* (und /api/vereine für die Vereinssuche). Bindet menu.js bewusst nicht ein:
// apiFetch übernimmt dessen Verhalten (Bearer-Token, bei 401 zur Anmeldung). Navigation über den Hash
// (#turniere, #turnier=<id>, #dienste, #aufgaben, #profil), damit die Zurück-Taste funktioniert.
// Alle Daten werden per textContent/createElement eingesetzt, nie per innerHTML.
import { platzText, gruppiereNachBezeichnung, datumText, wartetAufFreischaltung } from '/js/shared/helferAnzeige.js';
import { heuteBerlin, faelligkeitText, statusText, gruppiereAufgaben, zaehleOffene, tageBis } from '/js/shared/orgaAnzeige.js';
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

const zeitraum = (von, bis, versatz = 0) => `${versatz < 0 ? 'Vortag ' : ''}${formatiereMinuten(von)} – ${formatiereMinuten(bis)}`;

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
            el('span', { class: 'hf-slot-zeit', text: zeitraum(slot.von_min, slot.bis_min, slot.tag_versatz) }),
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
    inhalt.append(mitbringlisteBlock(turnierId));
    return inhalt;
}

// ---------- Mitbringliste (Orga-Planer) ----------

/**
 * Block „Mitbringliste“ eines Turniers: Einträge (Titel, Menge, wer), Formular „Ich bringe mit“ und Löschen der eigenen.
 * Lädt lazy nach dem Zeichnen der Ansicht; ohne Mitbringliste (404) oder bei Fehlern bleibt der Block unsichtbar.
 */
function mitbringlisteBlock(turnierId) {
    const block = el('section', { class: 'hf-gruppe hf-mitbring', id: 'hfMitbringliste', hidden: true });
    const url = `/api/helfer/orga/mitbringliste?turnierId=${encodeURIComponent(turnierId)}`;

    async function lade(fokus) {
        const { ok, daten } = await apiFetch(url);
        if (!ok || !daten || !Array.isArray(daten.eintraege)) return;
        block.replaceChildren(...zeichne(daten.eintraege));
        block.hidden = false;
        if (fokus) { const ziel = block.querySelector(fokus); if (ziel) ziel.focus({ preventScroll: true }); }
    }

    function zeichne(eintraege) {
        const fehlerZeile = el('p', { class: 'hf-fehler', role: 'alert', id: 'hfMitbringFehler' });
        const liste = eintraege.length === 0
            ? el('p', { class: 'hf-meta', text: 'Noch nichts eingetragen.' })
            : el('ul', { class: 'hf-liste' }, eintraege.map((e) => {
                const loeschen = e.eigen ? el('button', {
                    type: 'button', class: 'hf-knopf hf-knopf-zweit', text: 'Löschen', 'data-mitbring-loeschen': e.id,
                    'aria-label': `Eintrag „${e.titel}“ löschen`
                }) : null;
                if (loeschen) {
                    loeschen.addEventListener('click', async () => {
                        loeschen.disabled = true;
                        fehlerZeile.textContent = '';
                        try {
                            const r = await apiFetch(`/api/helfer/orga/mitbringliste/${e.id}`, { method: 'DELETE' });
                            if (r.ok) return lade('#hfMitbringTitel');
                            fehlerZeile.textContent = (r.daten && r.daten.error) || 'Löschen fehlgeschlagen.';
                        } catch (err) {
                            if (!(err instanceof AbmeldungFehler)) fehlerZeile.textContent = 'Löschen fehlgeschlagen.';
                        }
                        loeschen.disabled = false;
                    });
                }
                return el('li', { class: 'hf-dienst hf-mitbring-eintrag' + (e.eigen ? ' hf-slot-eigen' : ''), 'data-mitbring-id': e.id },
                    el('div', { class: 'hf-slot-text' },
                        el('span', { class: 'hf-slot-zeit', text: e.menge ? `${e.titel} (${e.menge}×)` : e.titel }),
                        el('span', { class: 'hf-slot-info', text: e.name ? `von ${e.name}` : 'ohne Namen' })),
                    loeschen);
            }));

        const titel = el('input', { type: 'text', id: 'hfMitbringTitel', class: 'hf-eingabe', maxlength: 100, required: true, autocomplete: 'off', placeholder: 'z. B. Kuchen' });
        const menge = el('input', { type: 'number', id: 'hfMitbringMenge', class: 'hf-eingabe hf-eingabe-schmal', min: 1, max: 99999, step: 1, inputmode: 'numeric', placeholder: '1' });
        const absenden = el('button', { type: 'submit', class: 'hf-knopf', text: 'Eintragen' });
        const formular = el('form', { class: 'hf-mitbring-form', novalidate: true },
            el('label', { class: 'hf-feld', for: 'hfMitbringTitel' }, el('span', { text: 'Ich bringe mit' }), titel),
            el('label', { class: 'hf-feld hf-feld-schmal', for: 'hfMitbringMenge' }, el('span', { text: 'Menge (optional)' }), menge),
            absenden);
        formular.addEventListener('submit', async (ereignis) => {
            ereignis.preventDefault();
            fehlerZeile.textContent = '';
            if (!titel.value.trim()) { fehlerZeile.textContent = 'Bitte eintragen, was du mitbringst.'; titel.focus(); return; }
            absenden.disabled = true;
            try {
                const body = { turnierId: Number(turnierId), titel: titel.value.trim() };
                if (menge.value.trim()) body.menge = Number(menge.value);
                const r = await apiFetch('/api/helfer/orga/mitbringliste', { method: 'POST', body });
                if (r.ok) return lade('#hfMitbringTitel');
                fehlerZeile.textContent = (r.daten && r.daten.error) || 'Eintragen fehlgeschlagen.';
            } catch (err) {
                if (!(err instanceof AbmeldungFehler)) fehlerZeile.textContent = 'Eintragen fehlgeschlagen.';
            }
            absenden.disabled = false;
        });
        return [
            el('h2', { class: 'hf-gruppe-titel', text: 'Mitbringliste' }),
            el('p', { class: 'hf-meta', text: 'Kuchen, Getränke & Co. für das Catering: trag ein, was du mitbringst.' }),
            liste, formular, fehlerZeile
        ];
    }

    lade().catch(() => { /* Mitbringliste ist optional */ });
    return block;
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
            el('span', { class: 'hf-slot-zeit', text: zeitraum(dienst.von_min, dienst.bis_min, dienst.tag_versatz) }),
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
        String(a.turnier.datum || '').localeCompare(String(b.turnier.datum || '')) || ((a.tag_versatz || 0) * 1440 + a.von_min) - ((b.tag_versatz || 0) * 1440 + b.von_min) || a.einsatzId - b.einsatzId);
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

// ---------- Meine Aufgaben (Orga-Planer) ----------

function setzeAufgabenZaehler(anzahl) {
    const marke = document.getElementById('hfAufgabenZaehler');
    if (!marke) return;
    marke.hidden = !anzahl;
    marke.textContent = anzahl ? String(anzahl) : '';
    marke.setAttribute('aria-label', anzahl === 1 ? '1 offene Aufgabe' : `${anzahl} offene Aufgaben`);
}

/** Zähler am Reiter „Aufgaben“; Fehler (z. B. keine Orga-Routen) bleiben stumm. */
function aktualisiereAufgabenZaehler() {
    apiFetch('/api/helfer/orga/meine')
        .then(({ ok, daten }) => { if (ok && daten && Array.isArray(daten.aufgaben)) setzeAufgabenZaehler(zaehleOffene(daten.aufgaben)); })
        .catch(() => { /* Zähler ist optional */ });
}

/** Link „Nachrichten“ mit Zähler ungelesener Unterhaltungen; erscheint nur, wo es das Postfach gibt (Cloud). */
function aktualisiereNachrichtenZaehler() {
    apiFetch('/api/nachrichten/ungelesen')
        .then(({ ok, daten }) => {
            if (!ok || !daten || typeof daten.anzahl !== 'number') return;
            document.getElementById('hfNachrichtenLink').hidden = false;
            const zaehler = document.getElementById('hfNachrichtenZaehler');
            zaehler.textContent = String(daten.anzahl);
            zaehler.hidden = daten.anzahl === 0;
        })
        .catch(() => { /* Postfach ist optional */ });
}
aktualisiereNachrichtenZaehler();

const AUFGABEN_GRUPPEN = [
    { schluessel: 'ueberfaellig', titel: 'Überfällig', klasse: 'hf-gruppe-ueberfaellig' },
    { schluessel: 'dieseWoche', titel: 'Diese Woche', klasse: '' },
    { schluessel: 'spaeter', titel: 'Später', klasse: '' }
];

function aufgabeZeile(a, heute, beiAenderung, fehlerText) {
    const erledigt = !!(a.status && a.status.status === 'erledigt');
    const ueberfaellig = !erledigt && (tageBis(a.faellig_am, heute) ?? 0) < 0;
    const kasten = el('input', {
        type: 'checkbox', class: 'hf-haken', id: `hfAufgabe${a.id}`, 'data-aufgabe-id': a.id,
        'aria-describedby': `hfAufgabeInfo${a.id}`
    });
    kasten.checked = erledigt;
    kasten.addEventListener('change', () => beiAenderung(a, kasten.checked));
    const meta = [a.turnier, a.eltern_titel ? `zu „${a.eltern_titel}“` : null].filter(Boolean).join(' · ');
    return el('li', { class: 'hf-aufgabe' + (erledigt ? ' hf-aufgabe-erledigt' : ''), 'data-aufgabe-zeile': a.id },
        el('label', { class: 'hf-haken-feld', for: `hfAufgabe${a.id}` }, kasten,
            el('span', { class: 'hf-haken-kasten', 'aria-hidden': 'true' })),
        el('div', { class: 'hf-slot-text', id: `hfAufgabeInfo${a.id}` },
            el('label', { class: 'hf-aufgabe-titel', for: `hfAufgabe${a.id}`, text: a.titel }),
            meta ? el('span', { class: 'hf-slot-info', text: meta }) : null,
            el('span', { class: 'hf-slot-info' + (ueberfaellig ? ' hf-ueberfaellig' : ''),
                text: `${erledigt ? 'Erledigt' : faelligkeitText(a.faellig_am, heute)} · ${statusText(a.status)}` })),
        fehlerText ? el('p', { class: 'hf-fehler', role: 'alert', text: fehlerText }) : null);
}

async function ansichtAufgaben() {
    const daten = await ladeJson('/api/helfer/orga/meine');
    const aufgaben = daten.aufgaben || [];
    const heute = heuteBerlin();
    const inhalt = el('div', {}, el('h1', { class: 'hf-titel hf-titel-seite', text: 'Meine Aufgaben' }));
    setzeAufgabenZaehler(zaehleOffene(aufgaben));
    if (aufgaben.length === 0) {
        inhalt.append(leer('Keine Aufgaben', 'Wenn dir jemand eine Aufgabe zuweist, erscheint sie hier.'));
        return inhalt;
    }
    const liste = el('div', {});
    const fehler = new Map();   // Aufgaben-ID → Meldung nach fehlgeschlagenem Speichern
    let erledigtOffen = false;  // „Erledigt“ ist eingeklappt

    // Optimistisch: sofort umsetzen, bei Fehler zurückrollen und die Meldung an der Zeile zeigen.
    const aendern = async (a, erledigt) => {
        const vorher = a.status;
        a.status = { status: erledigt ? 'erledigt' : 'offen', erledigt: erledigt ? 1 : 0, gesamt: 1, quelle: 'manuell' };
        fehler.delete(a.id);
        zeichne(a.id);
        setzeAufgabenZaehler(zaehleOffene(aufgaben));
        try {
            const { ok, daten: antwort } = await apiFetch(`/api/helfer/orga/aufgaben/${a.id}/erledigt`, { method: 'POST', body: { erledigt } });
            if (ok) return;
            fehler.set(a.id, (antwort && antwort.error) || 'Speichern fehlgeschlagen.');
        } catch (e) {
            if (e instanceof AbmeldungFehler) return;
            fehler.set(a.id, 'Speichern fehlgeschlagen. Bitte prüfe deine Verbindung.');
        }
        a.status = vorher;
        zeichne(a.id);
        setzeAufgabenZaehler(zaehleOffene(aufgaben));
    };

    function zeichne(fokusId) {
        const gruppen = gruppiereAufgaben(aufgaben, heute);
        const teile = [];
        for (const g of AUFGABEN_GRUPPEN) {
            if (gruppen[g.schluessel].length === 0) continue;
            teile.push(el('section', { class: `hf-gruppe ${g.klasse}`.trim() },
                el('h2', { class: 'hf-gruppe-titel', text: g.titel }),
                el('ul', { class: 'hf-liste' }, gruppen[g.schluessel].map(a => aufgabeZeile(a, heute, aendern, fehler.get(a.id))))));
        }
        if (gruppen.erledigt.length > 0) {
            const details = el('details', { class: 'hf-gruppe hf-erledigt-gruppe' },
                el('summary', { class: 'hf-gruppe-titel', text: `Erledigt (${gruppen.erledigt.length})` }),
                el('ul', { class: 'hf-liste' }, gruppen.erledigt.map(a => aufgabeZeile(a, heute, aendern, fehler.get(a.id)))));
            if (erledigtOffen) details.open = true;
            details.addEventListener('toggle', () => { erledigtOffen = details.open; });
            teile.push(details);
        }
        liste.replaceChildren(...teile);
        if (fokusId != null) {
            // Die Zeile kann in eine andere Gruppe gewandert sein: Fokus zurück auf ihren Haken
            const ziel = liste.querySelector(`[data-aufgabe-id="${fokusId}"]`);
            const details = ziel && ziel.closest('details');
            if (ziel && !(details && !details.open)) ziel.focus({ preventScroll: true });
            else if (details) details.querySelector('summary').focus({ preventScroll: true });   // eingeklappt: Fokus auf „Erledigt“
        }
    }
    zeichne();
    inhalt.append(liste);
    return inhalt;
}

// ---------- Navigation ----------

function liesRoute() {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const treffer = /^turnier=(\d+)$/.exec(hash);
    if (treffer) return { reiter: 'turniere', turnierId: Number(treffer[1]) };
    if (hash === 'dienste' || hash === 'aufgaben' || hash === 'profil') return { reiter: hash };
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
        else if (route.reiter === 'aufgaben') knoten = await ansichtAufgaben();
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
    if (route.reiter !== 'aufgaben') aktualisiereAufgabenZaehler();
}

window.addEventListener('hashchange', () => {
    document.getElementById('hfInhalt').replaceChildren();
    window.scrollTo(0, 0);
    slotMeldung = null;
    zeige({ fokus: 'h1' });
});
zeige();
