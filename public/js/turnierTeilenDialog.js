// Dialog "Turnier per E-Mail teilen" (turniere.html): window.TurnierTeilen.oeffne(turnier).
// Schickt an die eingetragenen Adressen einen Direktlink zum Turnier (POST /api/turniere/:id/teilen, nur Cloud).
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

    const STATUS_TEXT = { gesendet: 'Mail gesendet', fehler: 'Mail konnte nicht gesendet werden' };

    function oeffne(turnier) {
        const overlay = el('div', {
            id: 'turnierTeilenModal',
            style: 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); z-index: 10000; display: flex; align-items: center; justify-content: center;'
        });
        const karte = el('div', {
            className: 'mdc-card',
            style: 'max-width: 480px; width: 90%; padding: 24px; border-radius: 4px; border: 2px solid var(--border); box-shadow: var(--shadow); background-color: var(--bg-card);'
        });
        const titel = el('h2', { text: 'Turnier teilen', style: 'margin: 0 0 4px 0; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;' });
        const unterzeile = el('p', { text: `Direktlink zu „${turnier.bezeichnung}“ per E-Mail. Wer schon ein Konto hat, meldet sich an; alle anderen registrieren sich zuerst.`, style: 'margin: 0 0 16px 0; font-size: 13px; color: var(--text-muted);' });
        const label = el('label', { text: 'E-Mail-Adressen', htmlFor: 'teilenAdressen', style: 'display: block; font-size: 12px; font-weight: 700; margin-bottom: 4px;' });
        const adressen = el('textarea', {
            id: 'teilenAdressen',
            placeholder: 'Eine Adresse pro Zeile oder getrennt durch Komma oder Semikolon (höchstens 100)',
            style: 'width: 100%; box-sizing: border-box; min-height: 110px; padding: 8px 10px; font: inherit; font-size: 14px; border: 2px solid var(--border); border-radius: 4px; background: var(--bg-card); color: var(--text-main); resize: vertical;'
        });
        const vereinLabel = el('label', { text: 'Vereine (Admins bekommen die Mail)', htmlFor: 'teilenVerein', style: 'display: block; font-size: 12px; font-weight: 700; margin: 14px 0 4px 0;' });
        const vereinFeld = el('input', {
            id: 'teilenVerein', type: 'text', autocomplete: 'off', placeholder: 'Vereinsname eingeben und aus der Liste wählen …',
            style: 'width: 100%; box-sizing: border-box; padding: 8px 10px; font: inherit; font-size: 14px; border: 2px solid var(--border); border-radius: 4px; background: var(--bg-card); color: var(--text-main);'
        });
        vereinFeld.setAttribute('list', 'teilenVereineListe');
        const vereinListe = el('datalist', { id: 'teilenVereineListe' });
        const gewaehlt = el('div', { id: 'teilenVereine', style: 'display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;' });
        const ergebnis = el('ul', { id: 'teilenErgebnis', style: 'display: none; margin: 12px 0 0 0; padding-left: 18px; font-size: 13px;' });
        const fehler = el('p', { id: 'teilenFehler', style: 'display: none; margin: 12px 0 0 0; font-size: 13px; font-weight: 700; color: #c62828;' });
        const schliessenKnopf = el('button', { type: 'button', className: 'btn btn-outlined', text: 'Schließen', style: 'padding: 8px 20px; font-size: 12px;' });
        const senden = el('button', { type: 'button', className: 'btn btn-raised', text: 'Link senden', id: 'teilenSendenBtn', style: 'padding: 8px 20px; font-size: 12px;' });
        const knoepfe = el('div', { style: 'display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;' }, [schliessenKnopf, senden]);

        [titel, unterzeile, label, adressen, vereinLabel, vereinFeld, vereinListe, gewaehlt, ergebnis, fehler, knoepfe].forEach(k => karte.appendChild(k));
        overlay.appendChild(karte);
        document.body.appendChild(overlay);
        adressen.focus();

        // Vereine: Namen aus der öffentlichen Vereinsliste, gewählte erscheinen als Chips (Klick entfernt)
        let alleVereine = [];
        const ausgewaehlt = new Map();
        fetch('/api/vereine').then(r => (r.ok ? r.json() : [])).then((liste) => {
            alleVereine = Array.isArray(liste) ? liste : [];
            vereinListe.replaceChildren(...alleVereine.map(v => el('option', { value: v.name })));
        }).catch(() => { /* ohne Liste bleiben nur die Adressen */ });
        const zeichneChips = () => {
            gewaehlt.replaceChildren(...[...ausgewaehlt.values()].map((v) => {
                const chip = el('button', {
                    type: 'button', text: `${v.name} ✕`, title: 'Entfernen',
                    style: 'border: 1px solid var(--border); border-radius: 12px; padding: 2px 10px; font-size: 12px; background: var(--bg-card); color: var(--text-main); cursor: pointer;'
                });
                chip.addEventListener('click', () => { ausgewaehlt.delete(v.id); zeichneChips(); });
                return chip;
            }));
        };
        vereinFeld.addEventListener('input', () => {
            const treffer = alleVereine.find(v => v.name.toLowerCase() === vereinFeld.value.trim().toLowerCase());
            if (!treffer) return;
            ausgewaehlt.set(treffer.id, treffer);
            vereinFeld.value = '';
            zeichneChips();
        });

        const schliessen = () => overlay.remove();
        schliessenKnopf.addEventListener('click', schliessen);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) schliessen(); });

        senden.addEventListener('click', async () => {
            fehler.style.display = 'none';
            if (!adressen.value.trim() && ausgewaehlt.size === 0) {
                fehler.textContent = 'Bitte mindestens eine E-Mail-Adresse eintragen oder einen Verein wählen.';
                fehler.style.display = 'block';
                return;
            }
            senden.disabled = true;
            try {
                const antwort = await fetch(`/api/turniere/${encodeURIComponent(turnier.id)}/teilen`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emails: adressen.value, vereinIds: [...ausgewaehlt.keys()] })
                });
                const daten = await antwort.json().catch(() => ({}));
                if (!antwort.ok) throw new Error(daten.error || 'Das Teilen ist fehlgeschlagen.');
                const zeilen = [
                    ...daten.ergebnisse.map(r => `${r.email}: ${STATUS_TEXT[r.status] || r.status}`),
                    ...daten.ungueltig.map(u => `${u}: keine gültige E-Mail-Adresse`),
                    ...(daten.vereinsAdmins && (daten.vereinsAdmins.gesendet || daten.vereinsAdmins.fehler)
                        ? [`Vereins-Admins: ${daten.vereinsAdmins.gesendet} Mail(s) gesendet${daten.vereinsAdmins.fehler ? `, ${daten.vereinsAdmins.fehler} fehlgeschlagen` : ''}`] : []),
                    ...(daten.vereineOhneAdmin || []).map(n => `${n}: kein Admin mit bestätigter Adresse gefunden`)
                ];
                ergebnis.replaceChildren(...zeilen.map(text => el('li', { text })));
                ergebnis.style.display = 'block';
                const gesendet = daten.ergebnisse.filter(r => r.status === 'gesendet').length + ((daten.vereinsAdmins && daten.vereinsAdmins.gesendet) || 0);
                if (gesendet > 0) {
                    adressen.value = '';
                    ausgewaehlt.clear();
                    zeichneChips();
                    if (window.zeigeNotification) window.zeigeNotification(gesendet === 1 ? 'Link gesendet.' : `${gesendet} Links gesendet.`, 'success');
                }
            } catch (err) {
                fehler.textContent = err.message;
                fehler.style.display = 'block';
            } finally {
                senden.disabled = false;
            }
        });
    }

    window.TurnierTeilen = { oeffne };
})();
