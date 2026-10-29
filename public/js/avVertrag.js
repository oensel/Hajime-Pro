// Vertrag zur Auftragsverarbeitung (nur Cloud, src/services/avVertrag.js): Dialog zum Lesen, Annehmen und Drucken für Admins des
// aktiven Vereins. menu.js lädt das Skript nur für sie. Es fragt GET /api/av-vertrag ab und öffnet den Dialog von selbst, wenn der
// Verein schon Turniere hat und die aktuelle Fassung noch nicht angenommen ist („Später“ gilt bis zum Schließen des Tabs).
// window.hajimeZeigeAvVertrag() öffnet ihn jederzeit (Profil, Fehler beim Anlegen eines Turniers); auf profil.html füllt es #avVertragKarte.
(function () {
    let stand = null;

    async function ladeStand() {
        const resp = await fetch('/api/av-vertrag');
        const daten = await resp.json().catch(() => ({}));
        stand = resp.ok && daten.aktiv && daten.verein ? daten : null;
        return stand;
    }

    const spaeterSchluessel = (s) => `hajime_avv_spaeter_${s.verein.id}`;
    const datum = (wert) => new Date(wert).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

    function el(tag, attribute = {}, kinder = []) {
        const knoten = document.createElement(tag);
        for (const [k, v] of Object.entries(attribute)) {
            if (k === 'text') knoten.textContent = v;
            else if (k === 'style') knoten.style.cssText = v;
            else knoten.setAttribute(k, v);
        }
        for (const kind of kinder) if (kind) knoten.appendChild(kind);
        return knoten;
    }

    const CSS = `
#avVertragDialog { width: min(860px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 0; border: 2px solid var(--border, #d9d4c7); border-radius: 8px; background: var(--bg-card, #fff); color: var(--text-main, #1e293b); }
#avVertragDialog::backdrop { background: rgba(17, 24, 39, 0.6); }
#avVertragDialog .avv-kopf { padding: 16px 20px 0; } #avVertragDialog .avv-kopf h2 { margin: 0 0 6px; font-size: 20px; }
#avVertragDialog .avv-kopf p { margin: 0 0 10px; font-size: 14px; color: var(--text-muted, #64748b); }
#avVertragDialog .avv-text { margin: 0 20px; padding: 4px 16px 12px; max-height: 45vh; overflow: auto; border: 1px solid var(--border, #d9d4c7); border-radius: 6px; font-size: 14px; line-height: 1.5; }
#avVertragDialog .avv-text h1 { font-size: 20px; margin: 12px 0 4px; } #avVertragDialog .avv-text h2 { font-size: 16px; margin: 18px 0 4px; }
#avVertragDialog .avv-text table { width: 100%; border-collapse: collapse; font-size: 13px; } #avVertragDialog .avv-text th, #avVertragDialog .avv-text td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border, #d9d4c7); vertical-align: top; }
#avVertragDialog .avv-text .fehlt { background: #fee2e2; color: #991b1b; font-weight: 700; padding: 0 4px; border-radius: 3px; }
#avVertragDialog .avv-fuss { padding: 14px 20px 18px; display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
#avVertragDialog .avv-felder { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } @media (max-width: 600px) { #avVertragDialog .avv-felder { grid-template-columns: 1fr; } }
#avVertragDialog input[type="text"] { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border, #d9d4c7); border-radius: 4px; background: transparent; color: inherit; font-size: 14px; }
#avVertragDialog .avv-knoepfe { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
#avVertragDialog .avv-hinweis { margin: 0; padding: 8px 12px; border-radius: 6px; background: #fef3c7; color: #78350f; }
#avVertragDialog .avv-fehler { color: #c62828; font-weight: 600; margin: 0; }
#avVertragDialog .avv-haken { display: flex; gap: 8px; align-items: flex-start; text-transform: none; letter-spacing: normal; font-weight: 400; font-size: 14px; color: inherit; }`;

    function drucke(s) {
        const doc = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Vertrag zur Auftragsverarbeitung – ${s.verein.name.replace(/[<&]/g, '')}</title>
<style>body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;max-width:800px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:22px}h2{font-size:16px;margin-top:20px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #ccc;vertical-align:top}.stand{color:#555}</style>
</head><body>${s.html}</body></html>`;
        const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
        const fenster = window.open(url, '_blank');
        if (fenster) fenster.addEventListener('load', () => fenster.print(), { once: true });
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    function baueDialog(s) {
        document.getElementById('avVertragDialog')?.remove();
        if (!document.getElementById('avVertragStil')) document.head.appendChild(el('style', { id: 'avVertragStil', text: CSS }));

        const dialog = el('dialog', { id: 'avVertragDialog', 'aria-labelledby': 'avVertragTitel' });
        const text = el('div', { class: 'avv-text', tabindex: '0' });
        text.innerHTML = s.html; // serverseitig erzeugt und maskiert (src/services/avVertrag.js)
        const schliessen = () => { dialog.close(); dialog.remove(); };

        const kopf = el('div', { class: 'avv-kopf' }, [
            el('h2', { id: 'avVertragTitel', text: 'Vertrag zur Auftragsverarbeitung' }),
            el('p', { text: `Wenn ${s.verein.name} Turniere in Hajime Pro ausrichtet, verarbeitet der Betreiber die Daten der Teilnehmenden im Auftrag des Vereins. Dafür verlangt Art. 28 DSGVO diesen Vertrag zwischen Verein und Betreiber.` })
        ]);

        const fuss = el('div', { class: 'avv-fuss' });
        const knoepfe = el('div', { class: 'avv-knoepfe' });
        const knopf = (beschriftung, klasse, aktion, typ = 'button') => {
            const b = el('button', { type: typ, class: `btn ${klasse}`, text: beschriftung });
            if (aktion) b.addEventListener('click', aktion);
            return b;
        };

        if (s.angenommen) {
            fuss.appendChild(el('p', { style: 'margin:0', text: `Angenommen am ${datum(s.angenommen.am)} durch ${s.angenommen.name} (${s.angenommen.funktion}).` }));
            knoepfe.append(knopf('Drucken', 'btn-outlined', () => drucke(s)), knopf('Schließen', 'btn-raised', schliessen));
            fuss.appendChild(knoepfe);
        } else if (!s.darfAnnehmen) {
            fuss.appendChild(el('p', { class: 'avv-hinweis', text: 'Den Vertrag nimmt ein Admin des Vereins an.' }));
            knoepfe.appendChild(knopf('Schließen', 'btn-raised', schliessen));
            fuss.appendChild(knoepfe);
        } else if (!s.vollstaendig) {
            fuss.appendChild(el('p', { class: 'avv-hinweis', text: 'Die Angaben des Betreibers sind noch unvollständig (rot markiert). Der Vertrag lässt sich erst annehmen, wenn sie ergänzt sind.' }));
            knoepfe.appendChild(knopf('Schließen', 'btn-raised', schliessen));
            fuss.appendChild(knoepfe);
        } else {
            if (s.fruehereFassung) fuss.appendChild(el('p', { class: 'avv-hinweis', text: `Der Verein hat am ${datum(s.fruehereFassung.am)} eine frühere Fassung angenommen. Der Vertrag wurde seitdem geändert und muss neu angenommen werden.` }));
            const form = el('form', { style: 'display:flex;flex-direction:column;gap:10px;margin:0' });
            const name = el('input', { type: 'text', id: 'avVertragName', required: '', minlength: '2', maxlength: '200', autocomplete: 'name', placeholder: 'Vor- und Nachname' });
            const funktion = el('input', { type: 'text', id: 'avVertragFunktion', required: '', minlength: '2', maxlength: '200', placeholder: 'Funktion im Verein, z. B. 1. Vorsitzende' });
            const haken = el('input', { type: 'checkbox', id: 'avVertragHaken', required: '' });
            const fehler = el('p', { class: 'avv-fehler', role: 'alert' });
            form.append(
                el('div', { class: 'avv-felder' }, [
                    el('label', { for: 'avVertragName', style: 'display:flex;flex-direction:column;gap:4px', text: 'Name' }, [name]),
                    el('label', { for: 'avVertragFunktion', style: 'display:flex;flex-direction:column;gap:4px', text: 'Funktion' }, [funktion])
                ]),
                el('label', { for: 'avVertragHaken', class: 'avv-haken' }, [haken, el('span', { text: `Ich bin berechtigt, ${s.verein.name} zu vertreten, und nehme den Vertrag zur Auftragsverarbeitung in dieser Fassung für den Verein an.` })]),
                fehler,
                el('div', { class: 'avv-knoepfe' }, [
                    knopf('Später', 'btn-outlined', () => { try { sessionStorage.setItem(spaeterSchluessel(s), '1'); } catch { /* ohne Speicher erscheint er wieder */ } schliessen(); }),
                    knopf('Vertrag annehmen', 'btn-raised', null, 'submit')
                ])
            );
            form.addEventListener('submit', async (ereignis) => {
                ereignis.preventDefault();
                fehler.textContent = '';
                try {
                    const resp = await fetch('/api/av-vertrag/annehmen', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: name.value, funktion: funktion.value, bestaetigt: haken.checked, fassung: s.fassung })
                    });
                    const daten = await resp.json().catch(() => ({}));
                    if (!resp.ok) throw new Error(daten.error || 'Der Vertrag konnte nicht angenommen werden.');
                    schliessen();
                    if (window.zeigeNotification) window.zeigeNotification('Vertrag zur Auftragsverarbeitung angenommen.', 'success');
                    // Beim Anlegen eines Turniers (turnier.html ohne ID) geht es nach der Annahme zurück zu „Alle Turniere“
                    const params = new URLSearchParams(window.location.search);
                    if (window.location.pathname === '/turnier.html' && !params.get('id') && !params.get('turnierId')) {
                        window.location.href = '/turniere.html';
                        return;
                    }
                    await ladeStand();
                    fuelleKarte();
                } catch (err) {
                    fehler.textContent = err.message;
                }
            });
            fuss.appendChild(form);
        }

        dialog.append(kopf, text, fuss);
        dialog.addEventListener('close', () => dialog.remove());
        document.body.appendChild(dialog);
        dialog.showModal();
    }

    // profil.html: Karte mit dem Stand für Admins des aktiven Vereins
    function fuelleKarte() {
        const karte = document.getElementById('avVertragKarte');
        if (!karte) return;
        if (!stand || !stand.darfAnnehmen) { karte.hidden = true; return; }
        const offen = !stand.angenommen;
        karte.replaceChildren(
            el('div', { class: 'form-title-area' }, [el('span', { class: 'material-icons', text: 'gavel' }), el('h1', { text: 'Auftragsverarbeitung' })]),
            el('p', { style: 'margin:0 0 12px;font-size:14px', text: offen
                ? `${stand.verein.name} hat den Vertrag zur Auftragsverarbeitung (Art. 28 DSGVO) noch nicht angenommen. Ohne ihn lassen sich keine neuen Turniere anlegen.`
                : `${stand.verein.name} hat den Vertrag zur Auftragsverarbeitung am ${datum(stand.angenommen.am)} angenommen (${stand.angenommen.name}).` }),
            (() => {
                const b = el('button', { type: 'button', id: 'avVertragKnopf', class: `btn ${offen ? 'btn-raised' : 'btn-outlined'}`, style: 'width:100%', text: offen ? 'Lesen und annehmen' : 'Vertrag ansehen' });
                b.addEventListener('click', () => zeige());
                return b;
            })()
        );
        karte.hidden = false;
    }

    async function zeige() {
        try {
            const s = await ladeStand();
            if (s) baueDialog(s);
        } catch (err) {
            console.error('Vertrag zur Auftragsverarbeitung nicht ladbar:', err);
        }
    }
    window.hajimeZeigeAvVertrag = zeige;

    (async () => {
        try {
            const s = await ladeStand();
            if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
            fuelleKarte();
            if (!s || s.angenommen || !s.darfAnnehmen || !s.vollstaendig || !s.hatTurnier) return;
            let spaeter = false;
            try { spaeter = sessionStorage.getItem(spaeterSchluessel(s)) === '1'; } catch { /* Speicher gesperrt */ }
            if (!spaeter) baueDialog(s);
        } catch (err) {
            console.error('Vertrag zur Auftragsverarbeitung nicht ladbar:', err);
        }
    })();
})();
