// Reiter „Profil“ der Helfer-App (Spec Helferverwaltung 4.1): Name, E-Mail, Meine Vereine mit Rolle und
// Status, Verein hinzufügen (Autovervollständigung, nur Auswahl aus der Liste), Passwort ändern, Abmelden.
// Die Hilfsfunktionen (apiFetch, el, …) reicht helfer.js herein.
import { filtereVereine } from '/js/shared/helferAnzeige.js';

const ROLLEN_TEXT = { helfer: 'Helfer', benutzer: 'Benutzer', admin: 'Admin' };
const MIN_PASSWORT = 8;

// Meldung, die eine neu gezeichnete Profilansicht übernimmt (z. B. nach dem Hinzufügen eines Vereins)
let ausstehendeMeldung = null;
let vereinsListe = null;

function statusText(verein) {
    if (!verein.freigegeben) return 'Wartet auf Freischaltung';
    return verein.rolle ? `Freigeschaltet als ${ROLLEN_TEXT[verein.rolle] || verein.rolle}` : 'Freigeschaltet';
}

function abschnitt(w, titel, ...inhalt) {
    return w.el('section', { class: 'hf-abschnitt' }, w.el('h2', { class: 'hf-abschnitt-titel', text: titel }), ...inhalt);
}

function vereinZeile(w, verein) {
    const fehler = w.el('p', { class: 'hf-fehler', role: 'alert' });
    const knopf = w.el('button', {
        type: 'button', class: 'hf-icon-knopf', 'aria-label': `${verein.name} entfernen`, title: 'Verein entfernen'
    }, w.el('span', { 'aria-hidden': 'true', text: '✕' }));
    knopf.addEventListener('click', async () => {
        if (!window.confirm(`Mitgliedschaft in „${verein.name}“ wirklich beenden?`)) return;
        knopf.disabled = true;
        fehler.textContent = '';
        try {
            const { ok, daten } = await w.apiFetch(`/api/helfer/profil/verein/${verein.verein_id}`, { method: 'DELETE' });
            if (ok) {
                ausstehendeMeldung = `„${verein.name}“ wurde entfernt.`;
                return w.zeige();
            }
            fehler.textContent = (daten && daten.error) || 'Entfernen fehlgeschlagen.';
        } catch (e) {
            fehler.textContent = e.message;
        }
        knopf.disabled = false;
    });
    return w.el('li', { class: 'hf-verein' },
        w.el('div', { class: 'hf-slot-text' },
            w.el('span', { class: 'hf-verein-name', text: verein.name }),
            w.el('span', { class: 'hf-slot-info' + (verein.freigegeben ? '' : ' hf-wartet'), text: statusText(verein) })),
        knopf,
        fehler);
}

/** Feld „Weiteren Verein hinzufügen“: Combobox mit Liste, Pfeiltasten, Enter und Klick. */
function vereinSuche(w, eigeneVereine) {
    const eingabe = w.el('input', {
        id: 'hfVereinSuche', type: 'text', class: 'hf-eingabe', autocomplete: 'off', role: 'combobox',
        'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'hfVereinListe',
        placeholder: 'Vereinsname eingeben (ab 2 Zeichen)'
    });
    const liste = w.el('ul', { id: 'hfVereinListe', role: 'listbox', class: 'hf-vorschlaege', hidden: true });
    const meldung = w.el('p', { id: 'hfVereinMeldung', class: 'hf-meldung', role: 'status' });
    const senden = w.el('button', { type: 'button', class: 'hf-knopf', text: 'Anfrage senden', disabled: true });
    let treffer = [];
    let aktiv = -1;
    let gewaehlt = null;

    const schliessen = () => {
        liste.hidden = true;
        eingabe.setAttribute('aria-expanded', 'false');
        eingabe.removeAttribute('aria-activedescendant');
        aktiv = -1;
    };
    const markiere = (index) => {
        aktiv = index;
        [...liste.children].forEach((option, i) => option.setAttribute('aria-selected', i === index ? 'true' : 'false'));
        if (index >= 0) {
            eingabe.setAttribute('aria-activedescendant', liste.children[index].id);
            liste.children[index].scrollIntoView({ block: 'nearest' });
        }
    };
    const waehle = (verein) => {
        eingabe.value = verein.name;
        schliessen();
        if (eigeneVereine.some(v => v.verein_id === verein.id)) {
            gewaehlt = null;
            meldung.textContent = `Du bist bereits Mitglied in „${verein.name}“.`;
        } else {
            gewaehlt = verein;
            meldung.textContent = '';
        }
        senden.disabled = !gewaehlt;
    };
    const zeigeTreffer = async () => {
        gewaehlt = null;
        senden.disabled = true;
        meldung.textContent = '';
        if (eingabe.value.trim().length < 2) return schliessen();
        if (!vereinsListe) {
            try {
                vereinsListe = await w.ladeJson('/api/vereine');
            } catch (e) {
                meldung.textContent = e.message;
                return schliessen();
            }
        }
        treffer = filtereVereine(vereinsListe, eingabe.value).slice(0, 20);
        liste.replaceChildren(...treffer.map((verein, i) => {
            const option = w.el('li', { id: `hfVerein-${verein.id}`, role: 'option', 'aria-selected': 'false', text: verein.name });
            // mousedown statt blur: die Liste bleibt offen, bis der Klick ankommt
            option.addEventListener('mousedown', (e) => e.preventDefault());
            option.addEventListener('click', () => waehle(treffer[i]));
            return option;
        }));
        if (treffer.length === 0) {
            meldung.textContent = 'Kein Verein gefunden.';
            return schliessen();
        }
        liste.hidden = false;
        eingabe.setAttribute('aria-expanded', 'true');
        aktiv = -1;
    };

    eingabe.addEventListener('input', () => { zeigeTreffer(); });
    eingabe.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (liste.hidden || treffer.length === 0) return;
            e.preventDefault();
            const schritt = e.key === 'ArrowDown' ? 1 : -1;
            markiere((aktiv + schritt + treffer.length) % treffer.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!liste.hidden && aktiv >= 0) waehle(treffer[aktiv]);
            else if (gewaehlt) senden.click();
        } else if (e.key === 'Escape') {
            schliessen();
        }
    });
    eingabe.addEventListener('blur', schliessen);

    senden.addEventListener('click', async () => {
        if (!gewaehlt || eingabe.value !== gewaehlt.name) return;
        senden.disabled = true;
        try {
            const { ok, daten } = await w.apiFetch('/api/helfer/profil/verein', { method: 'POST', body: { vereinId: gewaehlt.id } });
            if (ok) {
                ausstehendeMeldung = `Anfrage an „${gewaehlt.name}“ gesendet. Der Verein muss dich noch freischalten.`;
                return w.zeige();
            }
            meldung.textContent = (daten && daten.error) || 'Anfrage fehlgeschlagen.';
        } catch (e) {
            meldung.textContent = e.message;
        }
        senden.disabled = false;
    });

    return w.el('div', { class: 'hf-feld' },
        w.el('label', { for: 'hfVereinSuche', text: 'Weiteren Verein hinzufügen' }),
        w.el('div', { class: 'hf-suche' }, eingabe, liste),
        w.el('div', { class: 'hf-aktionen' }, senden),
        meldung);
}

function passwortFormular(w) {
    const aktuell = w.el('input', { id: 'hfPwAktuell', type: 'password', class: 'hf-eingabe', autocomplete: 'current-password', required: true });
    const neu = w.el('input', { id: 'hfPwNeu', type: 'password', class: 'hf-eingabe', autocomplete: 'new-password', minlength: MIN_PASSWORT, required: true });
    const meldung = w.el('p', { class: 'hf-meldung', role: 'status' });
    const knopf = w.el('button', { type: 'submit', class: 'hf-knopf', text: 'Passwort ändern' });
    const formular = w.el('form', { class: 'hf-formular', novalidate: true },
        w.el('div', { class: 'hf-feld' }, w.el('label', { for: 'hfPwAktuell', text: 'Aktuelles Passwort' }), aktuell),
        w.el('div', { class: 'hf-feld' }, w.el('label', { for: 'hfPwNeu', text: `Neues Passwort (mind. ${MIN_PASSWORT} Zeichen)` }), neu),
        w.el('div', { class: 'hf-aktionen' }, knopf),
        meldung);
    formular.addEventListener('submit', async (e) => {
        e.preventDefault();
        meldung.classList.remove('hf-meldung-ok');
        if (!aktuell.value) { meldung.textContent = 'Bitte das aktuelle Passwort eingeben.'; return; }
        if (neu.value.length < MIN_PASSWORT) { meldung.textContent = `Das neue Passwort muss mindestens ${MIN_PASSWORT} Zeichen lang sein.`; return; }
        knopf.disabled = true;
        try {
            const { ok, daten } = await w.apiFetch('/api/helfer/profil/passwort', {
                method: 'POST', body: { aktuellesPasswort: aktuell.value, neuesPasswort: neu.value }
            });
            if (ok) {
                formular.reset();
                meldung.textContent = 'Passwort geändert.';
                meldung.classList.add('hf-meldung-ok');
            } else {
                meldung.textContent = (daten && daten.error) || 'Ändern fehlgeschlagen.';
            }
        } catch (err) {
            meldung.textContent = err.message;
        }
        knopf.disabled = false;
    });
    return formular;
}

/** Baut die Profilansicht. @param {{apiFetch, ladeJson, el, abmelden, zeige}} w */
export async function ansichtProfil(w) {
    const profil = await w.ladeJson('/api/helfer/profil');
    const vereine = profil.vereine || [];
    const name = [profil.vorname, profil.nachname].filter(Boolean).join(' ');
    const inhalt = w.el('div', {}, w.el('h1', { class: 'hf-titel hf-titel-seite', text: 'Profil' }));

    if (ausstehendeMeldung) {
        inhalt.append(w.el('p', { class: 'hf-hinweis', role: 'status', text: ausstehendeMeldung }));
        ausstehendeMeldung = null;
    }
    inhalt.append(w.el('section', { class: 'hf-abschnitt' },
        w.el('p', { class: 'hf-profil-name', text: name || profil.email || '' }),
        profil.email ? w.el('p', { class: 'hf-meta hf-profil-email', text: profil.email }) : null));

    if (vereine.length > 0 && !vereine.some(v => v.freigegeben)) {
        inhalt.append(w.el('p', { class: 'hf-hinweis', text: 'Deine Registrierung muss noch freigeschaltet werden.' }));
    }
    inhalt.append(abschnitt(w, 'Meine Vereine',
        vereine.length
            ? w.el('ul', { class: 'hf-vereine' }, vereine.map(v => vereinZeile(w, v)))
            : w.el('p', { class: 'hf-meta', text: 'Noch kein Verein.' }),
        vereinSuche(w, vereine)));
    inhalt.append(abschnitt(w, 'Passwort ändern', passwortFormular(w)));

    const abmelden = w.el('button', { type: 'button', class: 'hf-knopf hf-knopf-zweit hf-knopf-breit', text: 'Abmelden' });
    abmelden.addEventListener('click', w.abmelden);
    inhalt.append(w.el('div', { class: 'hf-abmelden' }, abmelden));
    return inhalt;
}
