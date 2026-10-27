// Reiter „Nachrichten“ der Helfer-App (Postfach: /api/nachrichten, src/routes/nachrichtenRoutes.js).
// Einspaltig für das Handy: Liste → Unterhaltung bzw. neue Nachricht, ohne die Web-Oberfläche zu verlassen.
// Alle Texte kommen über textContent in die Seite (Nachrichten sind fremde Eingaben).

const zeitText = (t) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

/**
 * @param {{ apiFetch: Function, el: Function, leer: Function, aktualisiereZaehler: Function }} h - Helfer aus helfer.js
 * @returns {Promise<HTMLElement>}
 */
export async function ansichtNachrichten({ apiFetch, el, leer, aktualisiereZaehler }) {
    const api = async (pfad, optionen) => {
        const { ok, daten } = await apiFetch(`/api/nachrichten${pfad}`, optionen);
        if (!ok || !daten || daten.success === false) throw new Error((daten && daten.error) || 'Die Anfrage ist fehlgeschlagen.');
        return daten;
    };
    const auswahl = await api('/empfaenger');
    const wurzel = el('div', {});

    const meldung = el('p', { class: 'hf-fehler', role: 'alert' });
    const zeigeFehler = (text) => { meldung.textContent = text || ''; };
    const option = (wert, text) => el('option', { value: wert, text });
    const feld = (beschriftung, steuerelement, id) => el('div', { class: 'hf-feld' },
        el('label', { for: id, text: beschriftung }), steuerelement);

    async function zeigeListe() {
        const { threads } = await api('');
        zeigeFehler('');
        const kopf = el('div', { class: 'hf-kopfzeile' },
            el('h1', { class: 'hf-titel', text: 'Nachrichten' }),
            el('button', { type: 'button', class: 'hf-knopf', text: 'Neue Nachricht', onclick: () => zeigeNeu() }));
        const liste = threads.length === 0
            ? leer('Noch keine Nachrichten', 'Schreibe die erste Nachricht an die Turnierleitung oder deinen Verein.')
            : el('ul', { class: 'hf-karten' }, threads.map((t) => el('li', {},
                el('button', {
                    type: 'button', class: 'hf-nachricht-zeile' + (t.ungelesen ? ' hf-ungelesen' : ''),
                    onclick: () => zeigeThread(t.id)
                },
                    el('span', { class: 'hf-nachricht-betreff', text: t.betreff }),
                    el('span', { class: 'hf-slot-info', text: `${t.letzteVon || t.absender} · ${zeitText(t.aktualisiertAm)}` }),
                    el('span', { class: 'hf-slot-info hf-nachricht-vorschau', text: t.vorschau })))));
        wurzel.replaceChildren(kopf, liste, meldung);
    }

    async function zeigeThread(id) {
        try {
            const { thread } = await api(`/${id}`);
            if (!thread) return;
            aktualisiereZaehler();
            const mit = thread.teilnehmer.map((t) => t.name).join(', ');
            const info = thread.anSuperAdmins
                ? `Von ${thread.absender}${thread.absenderEmail ? ` (${thread.absenderEmail})` : ''} an die Super-Admins`
                : `Teilnehmer: ${mit}`;
            const verlauf = el('div', { class: 'hf-verlauf' }, thread.nachrichten.map((n) =>
                el('div', { class: 'hf-blase' + (n.eigene ? ' hf-blase-eigene' : '') },
                    el('div', { class: 'hf-slot-info', text: `${n.von} · ${zeitText(n.erstelltAm)}` }),
                    el('div', { class: 'hf-blase-text', text: n.text }))));
            const text = el('textarea', { class: 'hf-eingabe hf-textfeld', id: 'hfAntwort', maxlength: 5000, required: true });
            const formular = el('form', {
                onsubmit: async (e) => {
                    e.preventDefault();
                    try {
                        await api(`/${id}/antworten`, { method: 'POST', body: { text: text.value } });
                        await zeigeThread(id);
                    } catch (err) { zeigeFehler(err.message); }
                }
            }, feld('Antwort', text, 'hfAntwort'), el('button', { type: 'submit', class: 'hf-knopf', text: 'Antworten' }));
            wurzel.replaceChildren(
                el('div', { class: 'hf-kopfzeile' },
                    el('button', { type: 'button', class: 'hf-icon-knopf', 'aria-label': 'Zurück zu den Nachrichten', text: '←', onclick: zeigeListe }),
                    el('div', { class: 'hf-kopfzeile-text' },
                        el('h1', { class: 'hf-titel', text: thread.betreff }),
                        el('p', { class: 'hf-meta', text: info }))),
                verlauf, formular, meldung);
            zeigeFehler('');
        } catch (e) { zeigeFehler(e.message); }
    }

    function zeigeNeu() {
        const ziel = el('select', { class: 'hf-eingabe', id: 'hfNeuZiel' }, option('super_admins', 'Super-Admins (Kontakt, Fragen)'));
        const eigeneIds = new Set(auswahl.eigeneVereine.map((v) => v.id));
        const verein = el('select', { class: 'hf-eingabe', id: 'hfNeuVerein' });
        const vereinFeld = feld('Verein', verein, 'hfNeuVerein');
        const eigene = el('select', { class: 'hf-eingabe', id: 'hfNeuEigene' }, option('', '– Person wählen –'));
        const fremderVerein = el('select', { class: 'hf-eingabe', id: 'hfNeuFremderVerein' }, option('', '– Verein wählen –'));
        const fremd = el('select', { class: 'hf-eingabe', id: 'hfNeuFremd' });
        const fremdFeld = feld('Person', fremd, 'hfNeuFremd');
        const chips = el('div', { class: 'hf-chips' });
        const personenBox = el('div', {},
            auswahl.eigeneVereine.length ? feld('Aus meinem Verein', eigene, 'hfNeuEigene') : null,
            feld('Admin eines anderen Vereins', fremderVerein, 'hfNeuFremderVerein'), fremdFeld, chips);
        const gewaehlt = new Map();

        const zeichneChips = () => chips.replaceChildren(...[...gewaehlt].map(([id, name]) => el('button', {
            type: 'button', class: 'hf-chip', text: `${name} ✕`, 'aria-label': `${name} entfernen`,
            onclick: () => { gewaehlt.delete(id); zeichneChips(); }
        })));
        const aktualisiereZiel = () => {
            const art = ziel.value;
            vereinFeld.hidden = !(art === 'eigener-verein' || art === 'fremder-verein');
            personenBox.hidden = art !== 'personen';
            verein.replaceChildren(...(art === 'eigener-verein' ? auswahl.eigeneVereine : auswahl.vereine.filter((v) => !eigeneIds.has(v.id)))
                .map((v) => option(v.id, v.name)));
        };
        if (auswahl.darfAnKonten) {
            if (auswahl.eigeneVereine.length) ziel.append(option('eigener-verein', 'Alle Mitglieder meines Vereins'));
            ziel.append(option('fremder-verein', 'Alle Admins eines anderen Vereins'), option('personen', 'Einzelne Personen'));
            for (const v of auswahl.eigeneVereine) for (const m of v.mitglieder) eigene.append(option(m.id, `${m.name} (${v.name})`));
            for (const v of auswahl.vereine.filter((x) => !eigeneIds.has(x.id))) fremderVerein.append(option(v.id, v.name));
        } else {
            ziel.disabled = true;
        }
        fremdFeld.hidden = true;
        ziel.addEventListener('change', aktualisiereZiel);
        eigene.addEventListener('change', () => {
            const o = eigene.selectedOptions[0];
            if (o && o.value) { gewaehlt.set(o.value, o.textContent.replace(/ \(.*\)$/, '')); zeichneChips(); }
            eigene.value = '';
        });
        fremderVerein.addEventListener('change', async () => {
            fremd.replaceChildren(option('', '– Person wählen –'));
            fremdFeld.hidden = !fremderVerein.value;
            if (!fremderVerein.value) return;
            try {
                const { admins } = await api(`/empfaenger/admins?vereinId=${encodeURIComponent(fremderVerein.value)}`);
                for (const a of admins) fremd.append(option(a.id, a.name));
                if (admins.length === 0) fremd.replaceChildren(option('', 'Dieser Verein hat keine Admins'));
            } catch (e) { zeigeFehler(e.message); }
        });
        fremd.addEventListener('change', () => {
            const o = fremd.selectedOptions[0];
            if (o && o.value) { gewaehlt.set(o.value, o.textContent); zeichneChips(); }
            fremd.value = '';
        });

        const betreff = el('input', { class: 'hf-eingabe', id: 'hfNeuBetreff', type: 'text', maxlength: 150, required: true });
        const text = el('textarea', { class: 'hf-eingabe hf-textfeld', id: 'hfNeuText', maxlength: 5000, required: true });
        const formular = el('form', {
            onsubmit: async (e) => {
                e.preventDefault();
                const art = ziel.value;
                let zielDaten;
                if (art === 'super_admins') zielDaten = { art: 'super_admins' };
                else if (art === 'personen') zielDaten = { art: 'personen', benutzerIds: [...gewaehlt.keys()] };
                else zielDaten = { art: 'verein', vereinId: Number(verein.value) };
                try {
                    const { id } = await api('', { method: 'POST', body: { betreff: betreff.value, text: text.value, ziel: zielDaten } });
                    await zeigeThread(id);
                } catch (err) { zeigeFehler(err.message); }
            }
        }, feld('An', ziel, 'hfNeuZiel'), vereinFeld, personenBox, feld('Betreff', betreff, 'hfNeuBetreff'),
        feld('Nachricht', text, 'hfNeuText'), el('button', { type: 'submit', class: 'hf-knopf', text: 'Senden' }));
        aktualisiereZiel();
        wurzel.replaceChildren(
            el('div', { class: 'hf-kopfzeile' },
                el('button', { type: 'button', class: 'hf-icon-knopf', 'aria-label': 'Zurück zu den Nachrichten', text: '←', onclick: zeigeListe }),
                el('div', { class: 'hf-kopfzeile-text' }, el('h1', { class: 'hf-titel', text: 'Neue Nachricht' }))),
            formular, meldung);
        zeigeFehler('');
    }

    await zeigeListe();
    return wurzel;
}
