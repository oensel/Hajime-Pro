// Dialog „In die Cloud zurückspielen“ (turniere.html, nur Hallen-Server): window.RueckspielDialog.oeffne(lokalesTurnier).
// Anmeldung an der Cloud (Super-Admins zusätzlich mit dem Code der Authenticator-App), Bestätigung mit den Zählern,
// dann POST /api/cloud/turniere/:cloudId/zurueckspielen. Das Cloud-Token bleibt nur im Arbeitsspeicher dieses Dialogs.
(function () {
    const FELD_STIL = 'width: 100%; box-sizing: border-box; padding: 8px 10px; font: inherit; font-size: 14px; border: 2px solid var(--border); border-radius: 4px; background: var(--bg-card); color: var(--text-main);';
    const LABEL_STIL = 'display: block; font-size: 12px; font-weight: 700; margin: 12px 0 4px 0;';

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

    function feld(id, text, typ, platzhalter = '') {
        const label = el('label', { text, htmlFor: id, style: LABEL_STIL });
        const eingabe = el('input', { id, type: typ, autocomplete: 'off', placeholder: platzhalter, style: FELD_STIL });
        return { label, eingabe, block: el('div', {}, [label, eingabe]) };
    }

    async function sende(url, body) {
        const antwort = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const daten = await antwort.json().catch(() => ({}));
        return { ok: antwort.ok, daten };
    }

    function oeffne(turnier) {
        if (!turnier || turnier.urspruengliche_id == null) return;
        const cloudId = turnier.urspruengliche_id;
        let cloudToken = null;

        const overlay = el('div', {
            id: 'rueckspielModal',
            style: 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); z-index: 10000; display: flex; align-items: center; justify-content: center;'
        });
        const karte = el('div', {
            className: 'mdc-card',
            style: 'max-width: 480px; width: 90%; max-height: 90vh; overflow-y: auto; padding: 24px; border-radius: 4px; border: 2px solid var(--border); box-shadow: var(--shadow); background-color: var(--bg-card);'
        });
        const titel = el('h2', { text: 'In die Cloud zurückspielen', style: 'margin: 0 0 4px 0; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;' });
        const unterzeile = el('p', {
            text: `Teilnehmer, Pools, Matten, Kämpfe, Barzahlungen und vor Ort erfasste Vereine von „${turnier.bezeichnung}“ ersetzen den Stand in der Cloud. Zahlungsdaten und Rechnungen in der Cloud bleiben unverändert. Anmelden kann sich ein Admin des ausrichtenden Vereins.`,
            style: 'margin: 0 0 8px 0; font-size: 13px; color: var(--text-muted);'
        });

        // Schritt 1: Anmeldung
        const email = feld('rueckspielEmail', 'Cloud-Benutzer (E-Mail)', 'text', 'name@verein.de');
        const passwort = feld('rueckspielPasswort', 'Passwort', 'password');
        const anmeldenKnopf = el('button', { type: 'button', className: 'btn btn-raised', id: 'rueckspielAnmeldenBtn', text: 'Anmelden', style: 'padding: 8px 20px; font-size: 12px; margin-top: 16px;' });
        const anmeldung = el('div', { id: 'rueckspielAnmeldung' }, [email.block, passwort.block]);

        // Code der Authenticator-App: erscheint erst, wenn die Cloud ihn verlangt (Super-Admins)
        const code = feld('rueckspielCode', 'Code (nur Super-Admins)', 'text', '6-stelliger Code oder Backup-Code');
        code.eingabe.inputMode = 'numeric';
        code.block.id = 'rueckspielCodeBlock';
        code.block.style.display = 'none';
        code.eingabe.style.cssText = FELD_STIL;

        // Schritt 2: Bestätigung mit den Zählern
        const zaehler = el('p', { id: 'rueckspielZaehler', style: 'margin: 0; font-size: 14px;' });
        const sendenKnopf = el('button', { type: 'button', className: 'btn btn-raised', id: 'rueckspielSendenBtn', text: 'Jetzt zurückspielen', style: 'padding: 8px 20px; font-size: 12px; margin-top: 16px;' });
        const bestaetigung = el('div', { id: 'rueckspielBestaetigung', style: 'display: none; margin-top: 12px;' }, [zaehler]);

        const ergebnis = el('p', { id: 'rueckspielErgebnis', style: 'display: none; margin: 12px 0 0 0; font-size: 14px; font-weight: 700; color: #2e7d32;' });
        const fehler = el('p', { id: 'rueckspielFehler', style: 'display: none; margin: 12px 0 0 0; font-size: 13px; font-weight: 700; color: #c62828;' });
        const reserve = el('p', {
            text: 'Ohne Verbindung: Turnier exportieren und in der Cloud unter ‚Ergebnisse hochladen‘ einspielen',
            style: 'margin: 16px 0 0 0; font-size: 12px; color: var(--text-muted);'
        });
        const schliessenKnopf = el('button', { type: 'button', className: 'btn btn-outlined', text: 'Schließen', style: 'padding: 8px 20px; font-size: 12px;' });
        const knoepfe = el('div', { style: 'display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;' }, [schliessenKnopf, anmeldenKnopf, sendenKnopf]);
        sendenKnopf.style.display = 'none';

        [titel, unterzeile, anmeldung, code.block, bestaetigung, ergebnis, fehler, reserve, knoepfe].forEach(k => karte.appendChild(k));
        overlay.appendChild(karte);
        document.body.appendChild(overlay);
        email.eingabe.focus();

        const schliessen = () => { cloudToken = null; overlay.remove(); };
        schliessenKnopf.addEventListener('click', schliessen);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) schliessen(); });

        function zeigeFehler(text) {
            fehler.textContent = text || '';
            fehler.style.display = text ? 'block' : 'none';
        }
        function verlangeCode(text) {
            code.block.style.display = 'block';
            code.eingabe.value = '';
            code.eingabe.focus();
            zeigeFehler(text);
        }

        async function anmelden() {
            zeigeFehler('');
            const daten = { email: email.eingabe.value.trim(), password: passwort.eingabe.value };
            if (!daten.email || !daten.password) {
                zeigeFehler('Bitte E-Mail und Passwort eingeben.');
                return;
            }
            if (code.block.style.display !== 'none' && code.eingabe.value.trim()) daten.code = code.eingabe.value.trim();
            anmeldenKnopf.disabled = true;
            try {
                const { ok, daten: antwort } = await sende('/api/cloud/turniere', daten);
                if (!ok) {
                    if (antwort.zweiFaktor) return verlangeCode(antwort.error || 'Bitte den Code der Authenticator-App eingeben.');
                    throw new Error(antwort.error || 'Anmeldung an der Cloud fehlgeschlagen.');
                }
                cloudToken = antwort.token;
                // Passwort und Code sofort verwerfen, sie werden nicht mehr gebraucht
                passwort.eingabe.value = '';
                code.eingabe.value = '';
                code.block.style.display = 'none';
                anmeldung.style.display = 'none';
                anmeldenKnopf.style.display = 'none';
                const teilnehmer = Number(turnier.teilnehmer_anzahl || 0);
                const matten = Number(turnier.anzahl_kampfflaechen || 0);
                zaehler.textContent = `Gesendet werden ${teilnehmer} Teilnehmer und ${matten} Matten samt Pools, Kämpfen und Barzahlungen an das Cloud-Turnier.`;
                bestaetigung.style.display = 'block';
                sendenKnopf.style.display = '';
                sendenKnopf.focus();
            } catch (err) {
                zeigeFehler(err.message);
            } finally {
                anmeldenKnopf.disabled = false;
            }
        }

        async function zurueckspielen() {
            zeigeFehler('');
            const body = { token: cloudToken };
            if (code.block.style.display !== 'none' && code.eingabe.value.trim()) body.code = code.eingabe.value.trim();
            sendenKnopf.disabled = true;
            try {
                const { ok, daten } = await sende(`/api/cloud/turniere/${encodeURIComponent(cloudId)}/zurueckspielen`, body);
                if (!ok) {
                    if (daten.zweiFaktor) return verlangeCode(daten.error || 'Bitte den Code der Authenticator-App eingeben.');
                    throw new Error(daten.error || 'Das Zurückspielen ist fehlgeschlagen.');
                }
                const i = daten.imported || {};
                const teile = [
                    `${i.teilnehmer ?? 0} Teilnehmer`, `${i.pools ?? 0} Pools`, `${i.kampfflaechen ?? 0} Matten`, `${i.kaempfe ?? 0} Kämpfe`,
                    `${daten.barzahlungen ?? 0} Barzahlungen`, `${daten.neueVereine ?? 0} neue Vereine`
                ];
                ergebnis.textContent = `Turnier in die Cloud zurückgespielt: ${teile.join(', ')}.`;
                ergebnis.style.display = 'block';
                bestaetigung.style.display = 'none';
                code.block.style.display = 'none';
                sendenKnopf.style.display = 'none';
                cloudToken = null;
                if (window.zeigeNotification) window.zeigeNotification('Turnier in die Cloud zurückgespielt.', 'success');
            } catch (err) {
                zeigeFehler(err.message);
            } finally {
                sendenKnopf.disabled = false;
            }
        }

        anmeldenKnopf.addEventListener('click', anmelden);
        sendenKnopf.addEventListener('click', zurueckspielen);
        [email.eingabe, passwort.eingabe, code.eingabe].forEach(f => f.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (cloudToken) zurueckspielen(); else anmelden();
        }));
    }

    window.RueckspielDialog = { oeffne };
})();
