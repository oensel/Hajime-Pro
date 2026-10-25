// Zahlweg-Dialog (Startgeld-Zahlweg, Stufe 1, Plan docs/superpowers/plans/2026-10-24-startgeld-zahlweg-stufe1.md):
// Ein Verein, der bei einem fremden Turnier mit Startgeld anmeldet, wählt einmal je Turnier Überweisung oder Bar
// und gibt die Rechnungsangaben an. Fachlogik (wann Pflicht, wann änderbar) liegt in /api/zahlweg; der Dialog
// bleibt still (nichtNoetig), wenn die API nicht antwortet (Hallen-Server: 409, kein Mitglied: 403 usw.).
(function () {
    const NAMEN = { ueberweisung: 'Überweisung', bar: 'Bar an der Waage' };
    const BASIS_TEXT = {
        gemeldet: 'Abgerechnet wird nach den gemeldeten Kämpfern.',
        teilnahme_waage: 'Abgerechnet wird nach den Kämpfern, die an der Waage teilgenommen haben.'
    };

    const meldung = (text, typ) => {
        if (typeof window.zeigeNotification === 'function') window.zeigeNotification(text, typ);
    };

    async function ladeStatus(turnierId) {
        try {
            const resp = await fetch(`/api/zahlweg/${encodeURIComponent(turnierId)}`);
            if (!resp.ok) return null;
            const daten = await resp.json();
            return daten && typeof daten.erforderlich === 'boolean' ? daten : null;
        } catch {
            return null;
        }
    }

    function element(tag, eigenschaften = {}, kinder = []) {
        const el = document.createElement(tag);
        Object.assign(el, eigenschaften);
        for (const kind of kinder) el.append(kind);
        return el;
    }

    function feld(beschriftung, steuerelement) {
        const label = element('label', { textContent: beschriftung });
        label.style.cssText = 'display:block;margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;';
        const zeile = element('div', {}, [label, steuerelement]);
        zeile.style.cssText = 'margin:0 0 12px;';
        return zeile;
    }

    // Zeigt das Popup. pflicht = true: kein Schließen ohne Speichern (weder Escape noch Abbrechen-Knopf).
    function zeigeDialog(status, pflicht) {
        return new Promise((resolve) => {
            const vorhanden = status.zahlweg || {};
            const vor = status.vorbelegung || {};
            const angeboten = (status.angebotene || []).filter((z) => NAMEN[z]);
            const keineWege = angeboten.length === 0;
            const gewaehlt = angeboten.includes(vorhanden.zahlweg) ? vorhanden.zahlweg : (angeboten[0] || '');

            const wegeZeilen = angeboten.map((weg) => {
                const radio = element('input', { type: 'radio', name: 'zahlwegWahl', value: weg, checked: weg === gewaehlt });
                const zeile = element('label', {}, [radio, document.createTextNode(' ' + NAMEN[weg])]);
                zeile.style.cssText = 'display:block;margin:0 0 6px;font-weight:700;cursor:pointer;';
                return zeile;
            });

            const eingabeStil = 'width:100%;padding:8px 10px;font-size:14px;box-sizing:border-box;';
            const email = element('input', { type: 'email', id: 'zahlwegEmail', value: vorhanden.rechnung_email || vor.rechnung_email || '' });
            const person = element('input', { type: 'text', id: 'zahlwegAnsprechperson', value: vorhanden.rechnung_ansprechperson || vor.rechnung_ansprechperson || '' });
            const anschrift = element('textarea', { id: 'zahlwegAnschrift', rows: 3, value: vorhanden.rechnung_anschrift || vor.rechnung_anschrift || '' });
            for (const el of [email, person, anschrift]) el.style.cssText = eingabeStil;

            const startgeldText = Number(status.startgeld).toLocaleString('de-DE');
            const info = element('p', {
                textContent: `Startgeld ${startgeldText} € je Kämpfer. Der Höchstbetrag ist Anzahl Kämpfer × Startgeld. ${BASIS_TEXT[status.abrechnungsbasis] || ''}`.trim()
            });
            info.style.cssText = 'margin:0 0 16px;font-size:13px;color:var(--text-muted);';

            const fehlerAnzeige = element('p', { id: 'zahlwegFehler', role: 'alert' });
            fehlerAnzeige.style.cssText = 'margin:0 0 12px;font-size:13px;font-weight:700;color:#c62828;display:none;';
            if (keineWege) {
                fehlerAnzeige.textContent = 'Für dieses Turnier ist kein Zahlweg verfügbar. Bitte den Ausrichter kontaktieren.';
                fehlerAnzeige.style.display = 'block';
            }

            const btnSpeichern = element('button', { type: 'button', id: 'zahlwegSpeichernBtn', className: 'btn btn-raised', textContent: 'Speichern' });
            const btnAbbrechen = element('button', { type: 'button', id: 'zahlwegAbbrechenBtn', className: 'btn btn-outlined', textContent: 'Abbrechen' });
            const knoepfe = element('div', {}, pflicht && !keineWege ? [btnSpeichern] : [btnAbbrechen, btnSpeichern]);
            knoepfe.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;';
            for (const b of [btnAbbrechen, btnSpeichern]) b.style.padding = '2px 16px';

            if (keineWege) btnSpeichern.disabled = true;
            const titel = element('h2', { id: 'zahlwegTitel', textContent: 'Wie zahlt Ihr Verein das Startgeld?' });
            titel.style.cssText = 'margin:0 0 8px;font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-main);';

            if (wegeZeilen.length) wegeZeilen[wegeZeilen.length - 1].style.marginBottom = '16px';
            const karte = element('div', { role: 'dialog' }, [
                titel, info, ...wegeZeilen,
                feld('Rechnungs-E-Mail', email), feld('Ansprechperson', person), feld('Rechnungsanschrift', anschrift),
                fehlerAnzeige, knoepfe
            ]);
            karte.setAttribute('aria-modal', 'true');
            karte.setAttribute('aria-labelledby', 'zahlwegTitel');
            karte.style.cssText = 'background:var(--bg-card);color:var(--text-main);border:2px solid var(--border);border-radius:4px;padding:24px;max-width:520px;width:90%;max-height:90vh;overflow:auto;box-shadow:var(--shadow);';
            const overlay = element('div', { id: 'zahlwegDialog' }, [karte]);
            overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);backdrop-filter:blur(2px);';

            const beiTaste = (e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!pflicht || keineWege) beenden('abgebrochen');
                    return;
                }
                if (e.key === 'Tab') {
                    const fokussierbar = [...overlay.querySelectorAll('input, textarea, button')].filter((el) => !el.disabled && el.offsetParent !== null);
                    if (!fokussierbar.length) { e.preventDefault(); return; }
                    const erstes = fokussierbar[0];
                    const letztes = fokussierbar[fokussierbar.length - 1];
                    if (!overlay.contains(document.activeElement)) {
                        e.preventDefault();
                        erstes.focus();
                    } else if (e.shiftKey && document.activeElement === erstes) {
                        e.preventDefault();
                        letztes.focus();
                    } else if (!e.shiftKey && document.activeElement === letztes) {
                        e.preventDefault();
                        erstes.focus();
                    }
                }
            };
            const beenden = (ergebnis) => {
                document.removeEventListener('keydown', beiTaste, true);
                overlay.remove();
                resolve(ergebnis);
            };
            document.addEventListener('keydown', beiTaste, true);
            btnAbbrechen.addEventListener('click', () => beenden('abgebrochen'));

            btnSpeichern.addEventListener('click', async () => {
                const wahl = overlay.querySelector('input[name="zahlwegWahl"]:checked');
                btnSpeichern.disabled = true;
                fehlerAnzeige.style.display = 'none';
                try {
                    const resp = await fetch(`/api/zahlweg/${encodeURIComponent(status.turnierId)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            zahlweg: wahl ? wahl.value : '',
                            rechnung_email: email.value,
                            rechnung_ansprechperson: person.value,
                            rechnung_anschrift: anschrift.value
                        })
                    });
                    const daten = await resp.json().catch(() => ({}));
                    if (!resp.ok || daten.success === false) throw new Error(daten.error || 'Speichern fehlgeschlagen.');
                    meldung('Zahlweg gespeichert.', 'success');
                    beenden('gespeichert');
                } catch (error) {
                    fehlerAnzeige.textContent = error.message;
                    fehlerAnzeige.style.display = 'block';
                    btnSpeichern.disabled = false;
                    btnSpeichern.focus();
                }
            });

            document.body.append(overlay);
            (keineWege ? btnAbbrechen : btnSpeichern).focus();
        });
    }

    // Nach einer Anmeldung: Popup nur, wenn ein Zahlweg nötig ist und noch fehlt; nicht überspringbar.
    async function frageNach(turnierId) {
        if (!turnierId) return 'nichtNoetig';
        const status = await ladeStatus(turnierId);
        if (!status || !status.erforderlich || status.zahlweg || !status.aenderbar) return 'nichtNoetig';
        const ergebnis = await zeigeDialog({ ...status, turnierId }, true);
        if (ergebnis !== 'gespeichert') return 'abgebrochen';
        document.dispatchEvent(new CustomEvent('zahlweg:geaendert'));
        return 'gespeichert';
    }

    // Zeile "Zahlweg: … – ändern": derselbe Dialog, Abbrechen erlaubt (nur solange aenderbar).
    async function aendere(turnierId) {
        const status = await ladeStatus(turnierId);
        if (!status || !status.erforderlich || !status.aenderbar) return 'nichtNoetig';
        const ergebnis = await zeigeDialog({ ...status, turnierId }, !status.zahlweg);
        if (ergebnis === 'gespeichert') document.dispatchEvent(new CustomEvent('zahlweg:geaendert'));
        return ergebnis;
    }

    // Rechnungsdaten eines Vereins erfassen, der erst vor Ort auftaucht (Hallen-Server/Kasse, Zahlweg immer Bar).
    // "Später an der Kasse" bzw. Escape -> 'abgebrochen'. Optional { url }: anderes Ziel (Abrechnungsseite der Cloud).
    function erfasseVorOrt(turnierId, vereinName, { url } = {}) {
        return new Promise((resolve) => {
            const eingabeStil = 'width:100%;padding:8px 10px;font-size:14px;box-sizing:border-box;';
            const email = element('input', { type: 'email', id: 'vorOrtEmail' });
            const person = element('input', { type: 'text', id: 'vorOrtAnsprechperson' });
            const anschrift = element('textarea', { id: 'vorOrtAnschrift', rows: 3 });
            for (const el of [email, person, anschrift]) el.style.cssText = eingabeStil;
            const titel = element('h2', { id: 'vorOrtTitel', textContent: 'Neuer Verein: Rechnungsdaten jetzt erfassen?' });
            titel.style.cssText = 'margin:0 0 8px;font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-main);';
            const info = element('p', { textContent: `${vereinName} hat noch keine Rechnungsdaten und zahlt das Startgeld bar an der Kasse.` });
            info.style.cssText = 'margin:0 0 16px;font-size:13px;color:var(--text-muted);';
            const fehlerAnzeige = element('p', { id: 'vorOrtFehler', role: 'alert' });
            fehlerAnzeige.style.cssText = 'margin:0 0 12px;font-size:13px;font-weight:700;color:#c62828;display:none;';
            const btnSpeichern = element('button', { type: 'button', id: 'vorOrtSpeichernBtn', className: 'btn btn-raised', textContent: 'Speichern' });
            const btnSpaeter = element('button', { type: 'button', id: 'vorOrtSpaeterBtn', className: 'btn btn-outlined', textContent: 'Später an der Kasse' });
            const knoepfe = element('div', {}, [btnSpaeter, btnSpeichern]);
            knoepfe.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;';
            for (const b of [btnSpaeter, btnSpeichern]) b.style.padding = '2px 16px';
            const karte = element('div', { role: 'dialog' }, [
                titel, info, feld('Rechnungs-E-Mail', email), feld('Ansprechperson', person), feld('Rechnungsanschrift', anschrift),
                fehlerAnzeige, knoepfe
            ]);
            karte.setAttribute('aria-modal', 'true');
            karte.setAttribute('aria-labelledby', 'vorOrtTitel');
            karte.style.cssText = 'background:var(--bg-card);color:var(--text-main);border:2px solid var(--border);border-radius:4px;padding:24px;max-width:520px;width:90%;max-height:90vh;overflow:auto;box-shadow:var(--shadow);';
            const overlay = element('div', { id: 'vorOrtDialog' }, [karte]);
            overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);backdrop-filter:blur(2px);';

            const beiTaste = (e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    e.preventDefault();
                    beenden('abgebrochen');
                }
            };
            const beenden = (ergebnis) => {
                document.removeEventListener('keydown', beiTaste, true);
                overlay.remove();
                resolve(ergebnis);
            };
            document.addEventListener('keydown', beiTaste, true);
            btnSpaeter.addEventListener('click', () => beenden('abgebrochen'));
            btnSpeichern.addEventListener('click', async () => {
                btnSpeichern.disabled = true;
                fehlerAnzeige.style.display = 'none';
                try {
                    const resp = await fetch(url || `/api/zahlweg/${encodeURIComponent(turnierId)}/vor-ort`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            vereinName,
                            rechnung_email: email.value,
                            rechnung_ansprechperson: person.value,
                            rechnung_anschrift: anschrift.value
                        })
                    });
                    const daten = await resp.json().catch(() => ({}));
                    if (!resp.ok || daten.success === false) throw new Error(daten.error || 'Speichern fehlgeschlagen.');
                    meldung('Rechnungsdaten gespeichert.', 'success');
                    beenden('gespeichert');
                } catch (error) {
                    fehlerAnzeige.textContent = error.message;
                    fehlerAnzeige.style.display = 'block';
                    btnSpeichern.disabled = false;
                    btnSpeichern.focus();
                }
            });
            document.body.append(overlay);
            email.focus();
        });
    }

    // Nach dem Anlegen eines Kämpfers am Hallen-Server: steht sein Verein ohne Zahlweg auf der Kassenliste
    // (Startgeld > 0), wird gefragt, ob die Rechnungsdaten gleich erfasst werden sollen.
    async function frageNachVorOrt(turnierId, vereinName) {
        if (!turnierId || !vereinName) return 'nichtNoetig';
        try {
            // 409 = Hallen-Server (Einzelbenutzerbetrieb); in der Cloud wählt der Verein selbst den Zahlweg.
            const cloud = await fetch(`/api/zahlweg/${encodeURIComponent(turnierId)}`);
            if (cloud.status !== 409) return 'nichtNoetig';
            const turnierResp = await fetch(`/api/turniere/${encodeURIComponent(turnierId)}`);
            if (!turnierResp.ok || !(parseFloat((await turnierResp.json()).startgeld) > 0)) return 'nichtNoetig';
            const kasseResp = await fetch(`/api/zahlweg/${encodeURIComponent(turnierId)}/kasse`);
            if (!kasseResp.ok) return 'nichtNoetig';
            const eintraege = (await kasseResp.json()).eintraege || [];
            if (!eintraege.some((e) => e.vereinName === vereinName && e.zahlweg === 'ohneZahlweg')) return 'nichtNoetig';
        } catch {
            return 'nichtNoetig';
        }
        const ergebnis = await erfasseVorOrt(turnierId, vereinName);
        if (ergebnis === 'gespeichert') document.dispatchEvent(new CustomEvent('zahlweg:geaendert'));
        return ergebnis;
    }

    window.ZahlwegDialog = { frageNach, aendere, ladeStatus, NAMEN, erfasseVorOrt, frageNachVorOrt };
})();
