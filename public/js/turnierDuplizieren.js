// Dialog "Turnier duplizieren" (Hallen-Server, Spec docs/specs/2026-10-17-mehrere-turniere-design.md),
// gemeinsam für turniere.html und turnier.html: window.TurnierDuplizieren.oeffne(turnier, nachErfolg)
(function () {
    function el(tag, eigenschaften = {}, kinder = []) {
        const knoten = document.createElement(tag);
        Object.entries(eigenschaften).forEach(([k, v]) => {
            if (k === 'style') knoten.style.cssText = v;
            else if (k === 'text') knoten.textContent = v;
            else knoten[k] = v;
        });
        kinder.forEach(k => knoten.appendChild(k));
        return knoten;
    }

    function zeigeMeldung(text, typ) {
        if (window.zeigeNotification) window.zeigeNotification(text, typ);
        else alert(text);
    }

    function oeffne(turnier, nachErfolg) {
        const overlay = el('div', {
            id: 'turnierDuplizierenModal',
            style: 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); z-index: 10000; display: flex; align-items: center; justify-content: center;'
        });
        const karte = el('div', {
            className: 'mdc-card',
            style: 'max-width: 440px; width: 90%; padding: 24px; border-radius: 4px; border: 2px solid var(--border); box-shadow: var(--shadow); background-color: var(--bg-card);'
        });

        const titel = el('h2', { text: 'Turnier duplizieren', style: 'margin: 0 0 4px 0; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;' });
        const unterzeile = el('p', { text: `Kopie von „${turnier.bezeichnung}“ als Entwurf`, style: 'margin: 0 0 16px 0; font-size: 13px; color: var(--text-muted);' });

        const datumLabel = el('label', { text: 'Wettkampftag der Kopie', htmlFor: 'duplizierenDatum', style: 'display: block; font-size: 12px; font-weight: 700; margin-bottom: 4px;' });
        const datumFeld = el('input', { type: 'date', id: 'duplizierenDatum', style: 'width: 100%; box-sizing: border-box;' });
        const datumHinweis = el('p', { text: 'Muss frei sein. Mehrtägige Turniere: ein Turnier pro Tag.', style: 'margin: 4px 0 16px 0; font-size: 12px; color: var(--text-muted);' });

        const immer = el('label', { style: 'display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; font-size: 14px;' }, [
            el('input', { type: 'checkbox', checked: true, disabled: true }),
            el('span', {}, [
                document.createTextNode('Stammdaten, Matten und Klassen'),
                el('small', { text: 'Immer enthalten. Pools und Mattenzuordnungen werden nicht übernommen.', style: 'display: block; font-size: 12px; color: var(--text-muted);' })
            ])
        ]);
        const teilnehmerBox = el('input', { type: 'checkbox', id: 'duplizierenTeilnehmer', checked: true });
        const teilnehmer = el('label', { style: 'display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; font-size: 14px;' }, [
            teilnehmerBox,
            el('span', {}, [
                document.createTextNode('Teilnehmer übernehmen'),
                el('small', { text: 'Gewichte bleiben erhalten. „Gewogen“ und Startgeld werden zurückgesetzt.', style: 'display: block; font-size: 12px; color: var(--text-muted);' })
            ])
        ]);

        const fehler = el('p', { style: 'display: none; margin: 12px 0 0 0; font-size: 13px; font-weight: 700; color: #c62828;' });
        const abbrechen = el('button', { type: 'button', className: 'btn btn-outlined', text: 'Abbrechen', style: 'padding: 8px 20px; font-size: 12px;' });
        const ok = el('button', { type: 'button', className: 'btn btn-raised', text: 'Duplizieren', id: 'duplizierenOkBtn', style: 'padding: 8px 20px; font-size: 12px;' });
        const knoepfe = el('div', { style: 'display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;' }, [abbrechen, ok]);

        [titel, unterzeile, datumLabel, datumFeld, datumHinweis, immer, teilnehmer, fehler, knoepfe].forEach(k => karte.appendChild(k));
        overlay.appendChild(karte);
        document.body.appendChild(overlay);

        const schliessen = () => overlay.remove();
        abbrechen.addEventListener('click', schliessen);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) schliessen(); });

        ok.addEventListener('click', async () => {
            fehler.style.display = 'none';
            if (!datumFeld.value) {
                fehler.textContent = 'Bitte einen Wettkampftag wählen.';
                fehler.style.display = 'block';
                return;
            }
            ok.disabled = true;
            try {
                const antwort = await fetch(`/api/turniere/${turnier.id}/duplizieren`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ datum: datumFeld.value, teilnehmerUebernehmen: teilnehmerBox.checked })
                });
                const daten = await antwort.json().catch(() => ({}));
                if (!antwort.ok) throw new Error(daten.error || 'Das Duplizieren ist fehlgeschlagen.');
                schliessen();
                zeigeMeldung('Turnier dupliziert.', 'success');
                if (nachErfolg) nachErfolg(daten.turnierId);
            } catch (err) {
                fehler.textContent = err.message;
                fehler.style.display = 'block';
                ok.disabled = false;
            }
        });
    }

    window.TurnierDuplizieren = { oeffne };
})();
