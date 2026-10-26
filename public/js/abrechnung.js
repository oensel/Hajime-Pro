// Abrechnungsseite je Turnier (Startgeld-Rechnungen, Stufe 2). Nur Cloud, nur Admins des Ausrichters / Super-Admin im Modus.
// Alle Texte vom Server kommen ausschließlich über textContent/value in die Seite.
(function () {
    const $ = (id) => document.getElementById(id);
    const turnierId = new URLSearchParams(window.location.search).get('turnierId');
    const api = `/api/abrechnung/${encodeURIComponent(turnierId || '')}`;
    const ZAHLWEGE = { ueberweisung: 'Überweisung', bar: 'Bar', lastschrift: 'Lastschrift' };
    const STATUS = { offen: 'Offen', versandt: 'Versandt', bezahlt: 'Bezahlt', ueberfaellig: 'Überfällig', eingezogen: 'Eingezogen', zurueckgebucht: 'Zurückgebucht' };
    let daten = null;

    const euro = (cent) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format((cent || 0) / 100);
    const meldung = (text, typ) => { if (window.zeigeNotification) window.zeigeNotification(text, typ); };

    function el(tag, eigenschaften = {}, kinder = []) {
        const knoten = document.createElement(tag);
        for (const [k, v] of Object.entries(eigenschaften)) knoten[k] = v;
        for (const kind of kinder) knoten.append(kind);
        return knoten;
    }
    function zelle(beschriftung, inhalt, klasse) {
        const td = el('td', klasse ? { className: klasse } : {});
        td.dataset.label = beschriftung;
        if (typeof inhalt === 'string') td.textContent = inhalt;
        else if (inhalt) td.append(inhalt);
        return td;
    }
    function zeigeFehler(text) {
        $('abrFehler').textContent = text || '';
        $('abrFehler').hidden = !text;
    }

    // Eine Anfrage; verlangt der Server den Zwei-Faktor-Code (403 zwei_faktor), wird er einmal erfragt (wie turnier.js).
    async function rufe(url, optionen = {}) {
        const sende = (code) => fetch(url, {
            ...optionen,
            headers: { ...(optionen.headers || {}), ...(code ? { 'X-2FA-Code': code } : {}) }
        });
        let antwort = await sende(null);
        if (antwort.status === 403) {
            const kopie = await antwort.clone().json().catch(() => ({}));
            if (kopie.code === 'zwei_faktor') {
                const code = window.prompt(`${kopie.error || 'Zwei-Faktor-Bestätigung erforderlich.'}\n\nCode der Authenticator-App oder Backup-Code:`);
                if (code && code.trim()) antwort = await sende(code.trim());
            }
        }
        return antwort;
    }
    async function json(url, optionen) {
        const antwort = await rufe(url, optionen);
        const inhalt = await antwort.json().catch(() => ({}));
        return { ok: antwort.ok, status: antwort.status, daten: inhalt };
    }
    const post = (url, body) => json(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    });

    async function bestaetige(text, titel) {
        if (window.zeigeZentraleBestaetigung) return window.zeigeZentraleBestaetigung(text, titel, 'warning');
        return window.confirm(text);
    }

    // ---- Anzeige ----
    function zeigeKennzahlen() {
        const rechnungen = daten.vereine.map((v) => v.rechnung).filter(Boolean);
        $('kzSumme').textContent = euro(daten.summeCent);
        $('kzVersandt').textContent = String(rechnungen.filter((r) => r.versandt_am).length);
        $('kzBezahlt').textContent = String(rechnungen.filter((r) => r.status === 'bezahlt').length);
        $('kzUeberfaellig').textContent = String(rechnungen.filter((r) => r.anzeigeStatus === 'ueberfaellig').length);
    }

    function zeigeNichtZugeordnet() {
        const tbody = $('abrNzTabelle');
        tbody.replaceChildren();
        $('abrNichtZugeordnet').hidden = daten.nichtZugeordnet.length === 0;
        for (const eintrag of daten.nichtZugeordnet) {
            const aktion = el('div', { className: 'abr-zuordnen' });
            if (daten.vereine.length > 0) {
                const auswahl = el('select', { className: 'abr-nz-auswahl' });
                auswahl.setAttribute('aria-label', 'Zielverein');
                for (const v of daten.vereine) auswahl.append(el('option', { value: v.vereinName, textContent: v.vereinName }));
                const knopf = el('button', { type: 'button', className: 'btn btn-outlined abr-nz-zuordnen', textContent: 'Zuordnen' });
                knopf.addEventListener('click', () => ordneZu(eintrag.vereinName, auswahl.value, knopf));
                aktion.append(auswahl, knopf);
            }
            if (eintrag.vereinName) {
                const erfassen = el('button', { type: 'button', className: 'btn btn-outlined abr-nz-erfassen', textContent: 'Rechnungsdaten erfassen' });
                erfassen.addEventListener('click', () => erfasse(eintrag.vereinName));
                aktion.append(erfassen);
            }
            const tr = el('tr');
            tr.append(
                zelle('Verein', eintrag.vereinName || '(ohne Verein)'),
                zelle('Kämpfer', String(eintrag.anzahl), 'rechts'),
                zelle('Aktion', aktion)
            );
            tbody.append(tr);
        }
    }

    function zeigeVereine() {
        const tbody = $('abrTabelle');
        tbody.replaceChildren();
        $('abrLeer').hidden = daten.vereine.length > 0;
        for (const v of daten.vereine) {
            const r = v.rechnung;
            const status = el('div');
            if (r) {
                status.append(el('span', { className: `abr-chip ${r.anzeigeStatus}`, textContent: STATUS[r.anzeigeStatus] || r.anzeigeStatus }));
                if (v.rechnungWeichtAb) {
                    const marke = el('span', { className: 'abr-abweichung', textContent: 'Rechnung weicht ab' });
                    marke.title = `Die Rechnung ${r.nummer} nennt ${r.anzahl} Kämpfer (${euro(r.betrag_cent)}), aktuell sind es ${v.anzahl} (${euro(v.betragCent)}).`;
                    status.append(marke);
                }
                if (r.versand_fehler) status.append(el('span', { className: 'abr-versandfehler', textContent: r.versand_fehler }));
            } else {
                status.textContent = v.anzahl > 0 ? 'Noch keine Rechnung' : 'Keine Kämpfer';
            }
            if (v.hinweis) {
                // z. B. Lastschrift ohne gültiges Mandat: Hinweis mit dem echten Grund
                const marke = el('span', { className: 'abr-abweichung', textContent: v.hinweis });
                marke.title = v.hinweisGrund || v.hinweis;
                status.append(marke);
                if (v.hinweisGrund) status.append(el('span', { className: 'abr-versandfehler', textContent: v.hinweisGrund }));
            }
            const aktionen = el('div', { className: 'abr-aktionen' });
            if (r) {
                const pdf = el('button', { type: 'button', className: 'btn btn-outlined abr-pdf', textContent: 'PDF' });
                pdf.title = `${r.nummer} herunterladen`;
                pdf.addEventListener('click', () => ladePdf(r));
                const senden = el('button', { type: 'button', className: 'btn btn-outlined abr-senden', textContent: 'Erneut senden' });
                senden.addEventListener('click', () => sendeErneut(r, v.vereinName, senden));
                const haken = el('input', { type: 'checkbox', className: 'abr-bezahlt-haken', checked: r.status === 'bezahlt', disabled: r.art === 'quittung' });
                haken.addEventListener('change', () => setzeBezahlt(r, haken));
                const bezahlt = el('label', { className: 'abr-bezahlt' }, [haken, document.createTextNode('Bezahlt')]);
                aktionen.append(pdf, senden, bezahlt);
            }
            const tr = el('tr');
            tr.dataset.verein = v.vereinName;
            tr.append(
                zelle('Verein', v.vereinName),
                zelle('Zahlweg', ZAHLWEGE[v.zahlweg] || v.zahlweg),
                zelle('Kämpfer', String(v.anzahl), 'rechts'),
                zelle('Betrag', euro(v.betragCent), 'rechts'),
                zelle('Status', status),
                zelle('Aktionen', aktionen)
            );
            tbody.append(tr);
        }
    }

    // Warum der Rechnungslauf gesperrt ist (null = möglich).
    function laufSperrgrund() {
        if (!daten.bereit) return daten.grund || 'Die Abrechnung ist noch nicht möglich.';
        if (!daten.stammdaten.vollstaendig) return 'Die Abrechnungsdaten des Ausrichters sind unvollständig.';
        if (daten.nichtZugeordnet.length > 0) return 'Es gibt Kämpfer unter „Nicht zugeordnet“. Bitte zuerst zuordnen oder Rechnungsdaten erfassen.';
        const ohneMandat = offeneVereine().filter((v) => v.zahlweg === 'lastschrift' && v.hinweis);
        if (ohneMandat.length > 0) {
            return ohneMandat.map((v) => (v.hinweisCode === 'glaeubiger_id'
                ? `Die Gläubiger-ID des Ausrichters hat sich seit dem Mandat von Verein ${v.vereinName} geändert.`
                : `Verein ${v.vereinName} hat kein gültiges Mandat.`)).join(' ');
        }
        if (offeneVereine().length === 0) return 'Es gibt keine Vereine, für die noch eine Rechnung zu erstellen ist.';
        return null;
    }
    const offeneVereine = () => daten.vereine.filter((v) => v.anzahl > 0 && !v.rechnung);

    function zeigeLaufKnoepfe() {
        const grund = laufSperrgrund();
        $('abrLaufBtn').disabled = !!grund;
        $('abrLaufGrund').textContent = grund || '';
        $('abrFreigabeBtn').hidden = !daten.vereine.some((v) => v.rechnung && v.rechnung.versandt_am);
    }

    function zeigeAlles() {
        $('abrInhalt').hidden = false;
        zeigeKennzahlen();
        zeigeNichtZugeordnet();
        zeigeVereine();
        zeigeLaufKnoepfe();
    }

    async function ladeStammdatenLink() {
        try {
            const resp = await fetch(`/api/abrechnung/stammdaten-pruefung/${encodeURIComponent(turnierId)}`);
            if (!resp.ok) return;
            const pruefung = await resp.json();
            if (pruefung.darfPflegen && pruefung.vereinId) {
                $('abrStammdatenLink').href = `/verein-abrechnung.html?vereinId=${encodeURIComponent(pruefung.vereinId)}`;
                $('abrStammdatenLink').hidden = false;
            } else {
                $('abrStammdatenBitte').hidden = false;
            }
        } catch { /* Link ist optional */ }
    }

    async function lade() {
        zeigeFehler('');
        const antwort = await rufe(api);
        const inhalt = await antwort.json().catch(() => ({}));
        if (!antwort.ok) {
            $('abrInhalt').hidden = true;
            zeigeFehler(inhalt.error || 'Die Abrechnung konnte nicht geladen werden.');
            return;
        }
        daten = inhalt;
        $('abrBereitschaft').hidden = daten.bereit;
        if (!daten.bereit) $('abrBereitschaft').textContent = daten.grund || 'Die Abrechnung ist noch nicht möglich.';
        const stammdatenOffen = !daten.stammdaten.vollstaendig;
        $('abrStammdaten').hidden = !stammdatenOffen;
        if (stammdatenOffen) {
            $('abrStammdatenFehlt').textContent = (daten.stammdaten.fehlt || []).join(', ');
            await ladeStammdatenLink();
        }
        // Auch ohne Bereitschaft anzeigen: der gesperrte Knopf nennt den Grund.
        zeigeAlles();
    }

    // ---- Aktionen ----
    async function ordneZu(von, zu, knopf) {
        knopf.disabled = true;
        const { ok, daten: antwort } = await post(`${api}/zuordnen`, { vonVereinName: von, zuVereinName: zu });
        knopf.disabled = false;
        if (!ok) return zeigeFehler(antwort.error || 'Das Zuordnen ist fehlgeschlagen.');
        meldung(`${antwort.anzahl ?? 0} Kämpfer zugeordnet.`, 'success');
        await lade();
    }

    async function erfasse(vereinName) {
        if (!window.ZahlwegDialog) return;
        const ergebnis = await window.ZahlwegDialog.erfasseVorOrt(turnierId, vereinName, { url: `${api}/rechnungsdaten` });
        if (ergebnis === 'gespeichert') await lade();
    }

    async function ladePdf(r) {
        zeigeFehler('');
        const antwort = await rufe(`${api}/rechnungen/${encodeURIComponent(r.id)}/pdf`);
        if (!antwort.ok) {
            const inhalt = await antwort.json().catch(() => ({}));
            return zeigeFehler(inhalt.error || 'Das PDF konnte nicht geladen werden.');
        }
        const blob = await antwort.blob();
        const adresse = URL.createObjectURL(blob);
        const link = el('a', { href: adresse, download: `${String(r.nummer).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf` });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(adresse), 10000);
    }

    async function sendeErneut(r, vereinName, knopf) {
        zeigeFehler('');
        knopf.disabled = true;
        const { ok, daten: antwort } = await post(`${api}/rechnungen/${encodeURIComponent(r.id)}/senden`);
        knopf.disabled = false;
        if (!ok) return zeigeFehler(antwort.error || 'Der Versand ist fehlgeschlagen.');
        if (antwort.versendet) meldung(`Rechnung ${r.nummer} an ${vereinName} gesendet.`, 'success');
        else zeigeFehler(`Rechnung ${r.nummer} wurde nicht gesendet: ${antwort.grund || 'unbekannter Grund'}`);
        await lade();
    }

    async function setzeBezahlt(r, haken) {
        zeigeFehler('');
        haken.disabled = true;
        const { ok, daten: antwort } = await post(`${api}/rechnungen/${encodeURIComponent(r.id)}/bezahlt`, { bezahlt: haken.checked });
        if (!ok) {
            haken.checked = !haken.checked;
            haken.disabled = false;
            return zeigeFehler(antwort.error || 'Der Zahlstatus konnte nicht gespeichert werden.');
        }
        await lade();
    }

    function zeigeErgebnis(ergebnis, abbruchText) {
        const box = $('abrErgebnis');
        box.replaceChildren();
        box.className = 'abr-hinweis' + ((ergebnis.fehler || []).length || abbruchText ? ' warnung' : ' erfolg');
        box.append(el('div', {
            textContent: `${ergebnis.erstellt} Rechnung(en) erstellt, ${ergebnis.versendet} versendet.`
        }));
        if (abbruchText) box.append(el('div', { textContent: `Der Lauf wurde abgebrochen: ${abbruchText}`, style: 'font-weight:700;' }));
        for (const [titel, liste] of [['Fehler', ergebnis.fehler], ['Hinweise', ergebnis.hinweise]]) {
            if (!liste || liste.length === 0) continue;
            box.append(el('div', { textContent: `${titel}:`, style: 'margin-top:6px;font-weight:700;' }));
            const ul = el('ul');
            for (const eintrag of liste) ul.append(el('li', { textContent: `${eintrag.vereinName}: ${eintrag.grund}` }));
            box.append(ul);
        }
        box.hidden = false;
    }

    async function rechnungslauf() {
        zeigeFehler('');
        const offen = offeneVereine();
        const summe = offen.reduce((s, v) => s + v.betragCent, 0);
        const ok = await bestaetige(
            `Es werden ${offen.length} Rechnung(en) über insgesamt ${euro(summe)} erstellt und, soweit möglich, per E-Mail versendet. Rechnungen können danach nicht mehr geändert werden. Fortfahren?`,
            'Rechnungen erstellen'
        );
        if (!ok) return;
        $('abrLaufBtn').disabled = true;
        const { ok: erfolg, daten: antwort } = await post(`${api}/rechnungen`);
        if (erfolg) zeigeErgebnis(antwort);
        else if (antwort.ergebnis) zeigeErgebnis(antwort.ergebnis, antwort.error);
        else zeigeFehler(antwort.error || 'Der Rechnungslauf ist fehlgeschlagen.');
        await lade();
    }

    async function gibRueckspielenFrei() {
        zeigeFehler('');
        const ok = await bestaetige(
            'Nach versandten Rechnungen ist ein weiteres Zurückspielen vom Hallen-Server gesperrt. Mit der Freigabe darf es einmal erneut erfolgen. Freigeben?',
            'Erneutes Zurückspielen freigeben'
        );
        if (!ok) return;
        const { ok: erfolg, daten: antwort } = await post(`${api}/rueckspielen-freigeben`);
        if (!erfolg) return zeigeFehler(antwort.error || 'Die Freigabe ist fehlgeschlagen.');
        meldung('Das nächste Zurückspielen ist freigegeben.', 'success');
    }

    async function start() {
        if (!/^\d+$/.test(String(turnierId || ''))) {
            zeigeFehler('Es wurde kein Turnier angegeben.');
            return;
        }
        $('abrZurueck').href = `/turnier.html?id=${encodeURIComponent(turnierId)}`;
        try {
            const resp = await fetch(`/api/turniere/${encodeURIComponent(turnierId)}`);
            if (resp.ok) $('abrTurnier').textContent = (await resp.json()).bezeichnung || '';
        } catch { /* Name ist optional */ }
        $('abrLaufBtn').addEventListener('click', rechnungslauf);
        $('abrFreigabeBtn').addEventListener('click', gibRueckspielenFrei);
        try {
            await lade();
        } catch {
            zeigeFehler('Die Abrechnung konnte nicht geladen werden.');
        }
    }

    start();
})();
