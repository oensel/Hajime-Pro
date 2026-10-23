// Turnier-Ansicht (Ziel des Direktlinks aus der Mail "Turnier teilen"): Turnierdaten nur lesend. Freigeschaltete
// Mitglieder (mindestens Rolle "Benutzer" im aktiven Verein) sehen zusätzlich "Teilnehmer anmelden" (die bestehende
// Anmeldung für Fremdvereine, nur solange die Anmeldung läuft); alle anderen sehen nur die Daten und einen Hinweis.
// Alle Daten werden per textContent eingesetzt, nie per innerHTML.
const bereich = document.getElementById('ansichtInhalt');
const turnierId = new URLSearchParams(window.location.search).get('id') || '';

const STATUS_TEXT = {
    entwurf: 'Entwurf',
    veroeffentlicht: 'Anmeldung läuft',
    anmeldung_geschlossen: 'Anmeldung geschlossen',
    in_durchfuehrung: 'In Durchführung',
    abgeschlossen: 'Abgeschlossen',
    abgesagt: 'Abgesagt'
};

function el(tag, attribute = {}, ...kinder) {
    const knoten = document.createElement(tag);
    for (const [name, wert] of Object.entries(attribute)) {
        if (wert == null || wert === false) continue;
        if (name === 'class') knoten.className = wert;
        else if (name === 'text') knoten.textContent = wert;
        else knoten.setAttribute(name, wert === true ? '' : String(wert));
    }
    for (const kind of kinder.flat()) if (kind != null && kind !== false) knoten.append(kind);
    return knoten;
}

function zeile(icon, text) {
    return el('div', { class: 'ansicht-zeile' }, el('span', { class: 'material-icons', text: icon }), el('span', { text }));
}

function datumText(wert) {
    if (!wert) return '';
    return String(wert).slice(0, 10).split('-').reverse().join('.');
}

function altersklassenText(ak) {
    const schluessel = Array.isArray(ak) ? ak : (ak && typeof ak === 'object' ? Object.keys(ak) : []);
    return schluessel.map((k) => k.replace('_', ' ')).join(', ');
}

function zeigeFehler(text) {
    bereich.replaceChildren(el('p', { class: 'ansicht-fehler', text }), el('a', { href: '/turniere.html', text: 'Zur Turnierliste' }));
}

async function starte() {
    if (!/^\d+$/.test(turnierId)) return zeigeFehler('Dieser Link ist ungültig.');
    let turnier;
    let user = null;
    try {
        const antwort = await fetch(`/api/turniere/${encodeURIComponent(turnierId)}`);
        if (antwort.status === 403 || antwort.status === 404) {
            return zeigeFehler('Dieses Turnier ist nicht (mehr) sichtbar.');
        }
        if (!antwort.ok) throw new Error();
        turnier = await antwort.json();
        const me = await fetch('/api/auth/me');
        if (me.ok) user = (await me.json()).user;
    } catch {
        return zeigeFehler('Das Turnier konnte nicht geladen werden. Bitte versuche es später noch einmal.');
    }

    const { rolleReicht } = await import('/js/shared/rollen.js');
    const freigeschaltet = !!(user && user.verein_freigegeben && rolleReicht(user.verein_rolle, 'benutzer'));
    const anmeldungOffen = turnier.status_effektiv === 'veroeffentlicht';

    const ort = [turnier.plz, turnier.ort].filter(Boolean).join(' ');
    const ak = altersklassenText(turnier.altersklassen);
    const mak = altersklassenText(turnier.mannschafts_altersklassen);
    const aktionen = el('div', { class: 'ansicht-aktionen' });
    if (turnier.hat_ausschreibung) {
        const knopf = el('button', { type: 'button', class: 'btn btn-outlined', text: 'Ausschreibung ansehen' });
        knopf.addEventListener('click', () => window.zeigeAusschreibung(turnier.id, turnier.bezeichnung));
        aktionen.append(knopf);
    }
    if (freigeschaltet && anmeldungOffen) {
        aktionen.append(el('a', { class: 'btn btn-raised', href: `/teilnehmer.html?turnierId=${encodeURIComponent(turnier.id)}`, text: 'Teilnehmer anmelden' }));
    }

    let hinweis = null;
    if (!freigeschaltet) {
        hinweis = user && !user.verein_id
            ? 'Du hast noch keinem Verein beigetreten. Wähle deinen Verein, damit ein Admin dich freischalten kann – danach kannst du Teilnehmer anmelden.'
            : 'Dein Konto ist noch nicht freigeschaltet. Bis ein Admin deines Vereins dich freigibt, kannst du die Turnierdaten ansehen, aber keine Teilnehmer anmelden.';
    } else if (!anmeldungOffen) {
        hinweis = 'Für dieses Turnier läuft derzeit keine Anmeldung.';
    }
    if (hinweis && user && !user.verein_id) aktionen.append(el('a', { class: 'btn btn-raised', href: '/verein_auswahl.html', text: 'Verein wählen' }));

    document.title = `Hajime Pro - ${turnier.bezeichnung}`;
    bereich.replaceChildren(
        el('h1', { text: turnier.bezeichnung }),
        el('span', { class: 'ansicht-status', text: STATUS_TEXT[turnier.status_effektiv] || turnier.status_effektiv || '' }),
        turnier.datum ? zeile('calendar_today', `Datum: ${datumText(turnier.datum)}`) : null,
        ort ? zeile('place', `Ort: ${ort}${turnier.bundesland ? ` (${turnier.bundesland})` : ''}`) : null,
        turnier.ausrichter ? zeile('business', `Ausrichter: ${turnier.ausrichter}`) : null,
        zeile('layers', `Matten: ${turnier.anzahl_kampfflaechen}`),
        ak ? zeile('military_tech', `Altersklassen: ${ak}`) : null,
        mak ? zeile('groups_2', `Mannschaften: ${mak}`) : null,
        zeile('groups', `Gemeldete Teilnehmer: ${turnier.teilnehmer_anzahl || 0}`),
        turnier.anmeldeschluss ? zeile('timer', `Anmeldefrist: ${datumText(turnier.anmeldeschluss)}`) : null,
        hinweis ? el('p', { class: 'ansicht-hinweis', text: hinweis }) : null,
        aktionen);
}

starte();
