// Beitrittsanfragen des eigenen Vereins auf admin-nutzer.html (nur für Vereins-Admins; adminNutzer.js meldet per
// Ereignis 'nutzer:vereinsadmin', dass die Seite in der Vereins-Admin-Ansicht läuft). Freigeben legt die Rolle fest,
// danach lädt die Mitgliederliste neu ('nutzer:neuladen'). Alle Namen/Adressen stammen von anderen Konten: nur per
// textContent/createElement einsetzen.
document.addEventListener('nutzer:vereinsadmin', async () => {
    const { ROLLEN_TEXT, vorbelegteFreigabeRolle } = await import('/js/shared/menueRechte.js');

    const meldeFehler = (text) => window.zeigeNotification ? window.zeigeNotification(text, 'error') : alert(text);
    const meldeErfolg = (text) => { if (window.zeigeNotification) window.zeigeNotification(text); };

    function el(tag, eigenschaften = {}, ...kinder) {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(eigenschaften)) {
            if (k === 'text') e.textContent = v;
            else if (k === 'class') e.className = v;
            else if (k === 'style') e.style.cssText = v;
            else e.setAttribute(k, v);
        }
        e.append(...kinder);
        return e;
    }

    const kleinerKnopf = (text, klasse, zusatzStil = '') =>
        el('button', { type: 'button', class: `btn ${klasse}`, text, style: `padding: 6px 12px; font-size: 11px;${zusatzStil}` });

    /** Auswahl Admin/Benutzer/Helfer für Freigaben und Rollenwechsel. */
    function rollenAuswahl(vorbelegt, beschriftung) {
        const auswahl = el('select', { class: 'rollen-auswahl', 'aria-label': beschriftung });
        for (const rolle of ['helfer', 'benutzer', 'admin']) {
            const option = el('option', { value: rolle, text: ROLLEN_TEXT[rolle] });
            if (rolle === vorbelegt) option.selected = true;
            auswahl.append(option);
        }
        return auswahl;
    }

    async function sendePost(url, daten) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(daten)
        });
        const antwort = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(antwort.error || 'Aktion fehlgeschlagen');
        return antwort;
    }

    /**
     * Zeile einer offenen Anfrage mit Rollenauswahl, „Freigeben“ und „Ablehnen“.
     * @param {object} p Anfrage aus /api/vereine/pending bzw. /super/pending
     * @param {{ pfad: string, vorbelegt: string, nachher: Function, freigabeText: string }} o
     */
    function anfrageZeile(p, { pfad, vorbelegt, nachher, freigabeText }) {
        const name = `${p.vorname || ''} ${p.nachname || ''}`.trim();
        const auswahl = rollenAuswahl(vorbelegt, `Rolle für ${name}`);
        const freigeben = kleinerKnopf('Freigeben', 'btn-raised');
        freigeben.dataset.action = 'approve';
        const ablehnen = kleinerKnopf('Ablehnen', 'btn-outlined');
        ablehnen.dataset.action = 'reject';

        const entscheide = async (aktion) => {
            freigeben.disabled = ablehnen.disabled = true;
            try {
                const daten = { userId: p.id, vereinId: p.verein_id };
                if (aktion === 'approve') daten.rolle = auswahl.value;
                await sendePost(`/api/vereine/${pfad}${aktion}`, daten);
                meldeErfolg(aktion === 'approve' ? freigabeText : 'Anfrage abgelehnt.');
                nachher();
                if (window.hajimeAktualisiereGenehmigungsHinweis) window.hajimeAktualisiereGenehmigungsHinweis();
            } catch (err) {
                freigeben.disabled = ablehnen.disabled = false;
                meldeFehler(err.message);
            }
        };
        freigeben.addEventListener('click', () => entscheide('approve'));
        ablehnen.addEventListener('click', () => entscheide('reject'));

        return el('div', { class: 'erstregistrierung-row', 'data-user-id': String(p.id) },
            el('div', {},
                el('div', { class: 'erstregistrierung-name', text: name }),
                el('div', { class: 'erstregistrierung-meta', text: `${p.email} · ${p.verein_name}` })),
            el('div', { class: 'erstregistrierung-actions' }, auswahl, freigeben, ablehnen));
    }

    // --- BEITRITTSANFRAGEN: Admins sehen die offenen Anfragen ihrer Vereine ---
    // /api/vereine/pending liefert 403, wenn das Konto in keinem Verein Admin ist; dann bleibt die Karte
    // ausgeblendet. Die Rolle ist vorbelegt (Helfer-App → Helfer, sonst Benutzer), der Admin entscheidet.
    async function ladeUndRendereBeitrittsanfragen() {
        const liste = document.getElementById('beitrittsanfragenListe');
        try {
            const resp = await fetch('/api/vereine/pending');
            const pending = resp.ok ? await resp.json() : [];
            if (!Array.isArray(pending) || pending.length === 0) {
                liste.replaceChildren(el('p', { style: 'font-size: 13px; color: var(--text-muted); text-align: center;', text: 'Keine offenen Beitrittsanfragen.' }));
                return;
            }
            liste.replaceChildren(...pending.map(p => anfrageZeile(p, {
                pfad: '',
                vorbelegt: vorbelegteFreigabeRolle(p.angefragt_ueber),
                freigabeText: 'Mitglied freigegeben.',
                nachher: () => { ladeUndRendereBeitrittsanfragen(); document.dispatchEvent(new CustomEvent('nutzer:neuladen')); }
            })));
        } catch (err) {
            console.error('Fehler beim Laden der Beitrittsanfragen:', err);
            liste.replaceChildren(el('p', { style: 'font-size: 13px; color: var(--text-muted); text-align: center;', text: 'Beitrittsanfragen konnten nicht geladen werden.' }));
        }
    }

    document.getElementById('beitrittsanfragenCard').hidden = false;
    ladeUndRendereBeitrittsanfragen();
});
