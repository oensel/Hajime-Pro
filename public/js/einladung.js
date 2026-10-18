// Einladungsseite (Orga-Planer): ?token=… aus der Mail. Zeigt, zu welchem Verein man eingeladen ist, und legt ein
// Konto an bzw. bestätigt mit dem Passwort des bestehenden Kontos. Bindet menu.js und helfer.js bewusst nicht ein:
// ein 401 (falsches Passwort) darf nicht zur Anmeldung umleiten, sondern wird am Feld angezeigt.
// Nach Erfolg wird die Sitzung wie beim Login abgelegt (dokume_token / dokume_user).
// Alle Daten werden per textContent eingesetzt, nie per innerHTML.

const TOKEN_SCHLUESSEL = 'dokume_token';
const USER_SCHLUESSEL = 'dokume_user';
const MIN_PASSWORT = 8;
const ZIEL = '/helfer.html#aufgaben';
const HINWEIS_UNGUELTIG = 'Dieser Einladungslink ist ungültig, abgelaufen oder wurde schon verwendet. Bitte die Turnierleitung deines Vereins, dir die Einladung erneut zu schicken.';
const HINWEIS_RATE = 'Zu viele Versuche. Bitte warte einige Minuten und versuche es dann erneut.';

const bereich = document.getElementById('einladungInhalt');
const token = new URLSearchParams(window.location.search).get('token') || '';

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

function zeigeUngueltig(text = HINWEIS_UNGUELTIG) {
    bereich.replaceChildren(el('div', { class: 'hf-leer' },
        el('h1', { class: 'hf-titel', text: 'Einladung nicht gültig' }),
        el('p', { text }),
        el('p', {}, el('a', { href: '/login.html', text: 'Zur Anmeldung' }))));
}

/** Ein Feld mit Beschriftung, Hinweis und Fehlerzeile (Fehler neben dem Feld, verschwindet bei Eingabe). */
function feld({ id, label, typ = 'text', autocomplete, hinweis, wert = '', nurLesen = false }) {
    const eingabe = el('input', { class: 'hf-eingabe', id, name: id, type: typ, autocomplete, value: wert, readonly: nurLesen });
    const fehler = el('p', { class: 'hf-fehler', id: `${id}Fehler`, role: 'alert' });
    const beschreibung = [hinweis ? `${id}Hinweis` : null, `${id}Fehler`].filter(Boolean).join(' ');
    eingabe.setAttribute('aria-describedby', beschreibung);
    const zeigeFehler = (text) => {
        fehler.textContent = text || '';
        if (text) eingabe.setAttribute('aria-invalid', 'true'); else eingabe.removeAttribute('aria-invalid');
    };
    eingabe.addEventListener('input', () => zeigeFehler(''));
    const knoten = el('div', { class: 'hf-feld' },
        el('label', { for: id, text: label }),
        eingabe,
        hinweis ? el('p', { class: 'hf-meta', id: `${id}Hinweis`, text: hinweis }) : null,
        fehler);
    return { knoten, eingabe, zeigeFehler };
}

function speichereSitzung(daten) {
    try {
        localStorage.setItem(TOKEN_SCHLUESSEL, daten.token);
        localStorage.setItem(USER_SCHLUESSEL, JSON.stringify(daten.user));
    } catch (e) { /* localStorage gesperrt: die Anmeldeseite führt weiter */ }
}

function zeigeFormular(info) {
    const vorhanden = !!info.kontoVorhanden;
    const email = feld({ id: 'email', label: 'E-Mail-Adresse', typ: 'email', wert: info.email, nurLesen: true });
    const vorname = vorhanden ? null : feld({ id: 'vorname', label: 'Vorname', autocomplete: 'given-name' });
    const nachname = vorhanden ? null : feld({ id: 'nachname', label: 'Nachname', autocomplete: 'family-name' });
    const passwort = feld({
        id: 'passwort',
        label: vorhanden ? 'Passwort' : 'Passwort festlegen',
        typ: 'password',
        autocomplete: vorhanden ? 'current-password' : 'new-password',
        hinweis: vorhanden ? 'Mit deinem bestehenden Passwort bestätigen.' : `Mindestens ${MIN_PASSWORT} Zeichen.`
    });
    const knopf = el('button', { type: 'submit', class: 'hf-knopf hf-knopf-breit', text: vorhanden ? 'Beitreten' : 'Konto anlegen' });
    const formularFehler = el('p', { class: 'hf-fehler', id: 'formularFehler', role: 'alert' });

    const form = el('form', { class: 'hf-abschnitt', novalidate: true },
        email.knoten, vorname && vorname.knoten, nachname && nachname.knoten, passwort.knoten, knopf, formularFehler);

    form.addEventListener('submit', async (ereignis) => {
        ereignis.preventDefault();
        formularFehler.textContent = '';
        let fehlerhaft = null;
        const pruefe = (f, text) => { if (text) { f.zeigeFehler(text); fehlerhaft = fehlerhaft || f; } };
        if (!vorhanden) {
            pruefe(vorname, vorname.eingabe.value.trim() ? '' : 'Bitte gib deinen Vornamen ein.');
            pruefe(nachname, nachname.eingabe.value.trim() ? '' : 'Bitte gib deinen Nachnamen ein.');
        }
        const pw = passwort.eingabe.value;
        if (!pw) pruefe(passwort, vorhanden ? 'Bitte gib dein Passwort ein.' : 'Bitte lege ein Passwort fest.');
        else if (!vorhanden && pw.length < MIN_PASSWORT) pruefe(passwort, `Das Passwort muss mindestens ${MIN_PASSWORT} Zeichen lang sein.`);
        if (fehlerhaft) return fehlerhaft.eingabe.focus();

        knopf.disabled = true;
        const beschriftung = knopf.textContent;
        knopf.textContent = 'Einen Moment …';
        try {
            const antwort = await fetch(`/api/einladung/${encodeURIComponent(token)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(vorhanden
                    ? { password: pw }
                    : { password: pw, vorname: vorname.eingabe.value.trim(), nachname: nachname.eingabe.value.trim() })
            });
            let daten = null;
            try { daten = await antwort.json(); } catch (e) { /* leere Antwort */ }
            if (antwort.ok && daten && daten.token) {
                speichereSitzung(daten);
                window.location.href = ZIEL;
                return;
            }
            if (antwort.status === 429) formularFehler.textContent = HINWEIS_RATE;
            else if (antwort.status === 401) {
                passwort.zeigeFehler('Das Passwort stimmt nicht. Bitte versuche es noch einmal.');
                passwort.eingabe.focus();
            } else if (antwort.status === 400 && daten && /ungültig|abgelaufen/.test(daten.error || '')) {
                return zeigeUngueltig();
            } else formularFehler.textContent = (daten && daten.error) || 'Das hat leider nicht geklappt. Bitte versuche es noch einmal.';
        } catch (e) {
            formularFehler.textContent = 'Keine Verbindung zum Server. Bitte prüfe deine Verbindung und versuche es noch einmal.';
        }
        knopf.disabled = false;
        knopf.textContent = beschriftung;
    });

    bereich.replaceChildren(
        el('h1', { class: 'hf-titel hf-titel-seite', text: `Du wurdest zu ${info.vereinName || 'einem Verein'} eingeladen` }),
        el('p', { class: 'hf-meta hf-einladung-einleitung', text: vorhanden
            ? 'Für diese Adresse gibt es schon ein Konto. Bestätige mit deinem Passwort, um beizutreten und deine Aufgaben zu sehen.'
            : 'Lege dein Konto an, um deine Aufgaben zu sehen und abzuhaken.' }),
        form);
    (vorname || passwort).eingabe.focus();
}

async function starte() {
    if (!token) return zeigeUngueltig();
    try {
        const antwort = await fetch(`/api/einladung/${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } });
        let daten = null;
        try { daten = await antwort.json(); } catch (e) { /* leere Antwort */ }
        if (antwort.status === 404) return zeigeUngueltig();
        if (antwort.status === 429) return zeigeUngueltig(HINWEIS_RATE);
        if (!antwort.ok || !daten || !daten.success) return zeigeUngueltig('Die Einladung konnte nicht geladen werden. Bitte versuche es später noch einmal.');
        zeigeFormular(daten);
    } catch (e) {
        zeigeUngueltig('Keine Verbindung zum Server. Bitte prüfe deine Verbindung und lade die Seite neu.');
    }
}

starte();
