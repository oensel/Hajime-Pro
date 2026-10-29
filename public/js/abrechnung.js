// Abrechnungsseite je Turnier (Startgeld-Rechnungen, Stufe 2). Nur Cloud, nur Admins des Ausrichters / Super-Admin im Modus.
// Alle Texte vom Server kommen ausschließlich über textContent/value in die Seite.
(function () {
    const $ = (id) => document.getElementById(id);
    const turnierId = new URLSearchParams(window.location.search).get('turnierId');
    const api = `/api/abrechnung/${encodeURIComponent(turnierId || '')}`;
    const ZAHLWEGE = { ueberweisung: 'Überweisung', bar: 'Bar', lastschrift: 'Lastschrift' };
    const STATUS = { offen: 'Offen', versandt: 'Versandt', bezahlt: 'Bezahlt', ueberfaellig: 'Überfällig', eingezogen: 'Eingezogen', zurueckgebucht: 'Zurückgebucht' };
    let daten = null;
    let sepaDateien = [];
    let sepaLaeuft = false; // Doppelklick-Schutz: höchstens eine Datei-Anfrage gleichzeitig

    const datumDe = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('.') : '');
    const zeitDe = (iso) => {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
    };
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
                if (r.zahlweg === 'lastschrift' && r.sepa_datei_id) {
                    const datei = sepaDateien.find((d) => d.id === r.sepa_datei_id);
                    status.append(el('span', {
                        className: 'abr-sepa-datei',
                        textContent: datei
                            ? `Datei erzeugt am ${zeitDe(datei.erzeugt_am)}, Einzug am ${datumDe(r.einzug_am)}`
                            : `In einer SEPA-Datei, Einzug am ${datumDe(r.einzug_am)}`
                    }));
                } else if (r.zahlweg === 'lastschrift' && r.einzug_am) {
                    status.append(el('span', { className: 'abr-sepa-datei', textContent: `Einzug angekündigt für ${datumDe(r.einzug_am)}` }));
                }
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
                // Rücklastschrift: nur für Lastschriften, die schon in einer SEPA-Datei stehen (wie der Server prüft).
                if (r.zahlweg === 'lastschrift' && r.art === 'rechnung' && r.sepa_datei_id && r.status !== 'zurueckgebucht') {
                    aktionen.append(baueRuecklastschrift(r, v.vereinName));
                }
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

    // ---- SEPA-Lastschrift ----
    const lastschriftRechnungen = () => (daten ? daten.vereine
        .map((v) => (v.rechnung ? { ...v.rechnung, vereinName: v.vereinName } : null))
        .filter((r) => r && r.zahlweg === 'lastschrift' && r.art === 'rechnung') : []);
    const summeVon = (liste) => liste.reduce((s, r) => s + (r.betrag_cent || 0), 0);
    // Wie der Server: nur versandte Lastschrift-Rechnungen (art 'rechnung'), ohne bzw. mit Datei.
    const sepaOffen = () => lastschriftRechnungen().filter((r) => r.status === 'versandt' && !r.sepa_datei_id);
    const sepaMitDatei = () => lastschriftRechnungen().filter((r) => r.status === 'versandt' && r.sepa_datei_id);

    // Eigene Fehler-/Hinweisflächen des SEPA-Bereichs: lade() leert sie nicht, sie bleiben bis zur nächsten SEPA-Aktion.
    function zeigeSepaFehler(text) {
        $('abrSepaFehler').textContent = text || '';
        $('abrSepaFehler').hidden = !text;
    }
    function zeigeSepaWarnung(text) {
        $('abrSepaWarnung').textContent = text || '';
        $('abrSepaWarnung').hidden = !text;
    }

    function zeigeSepa() {
        const alle = lastschriftRechnungen();
        $('abrSepa').hidden = alle.length === 0 && sepaDateien.length === 0;
        const offen = sepaOffen();
        const nichtVersandt = alle.filter((r) => r.status === 'offen' && !r.sepa_datei_id);
        let grund;
        if (offen.length === 0) {
            grund = nichtVersandt.length > 0
                ? 'Die Lastschrift-Rechnungen wurden noch nicht versandt (Vorabankündigung). Bitte zuerst erneut senden.'
                : 'Für alle Lastschriften gibt es schon eine Datei.';
        } else {
            grund = `${offen.length} Lastschrift(en) über ${euro(summeVon(offen))} noch ohne Datei.`;
            if (nichtVersandt.length > 0) grund += ` ${nichtVersandt.length} noch nicht versandte Rechnung(en) sind nicht enthalten.`;
        }
        $('abrSepaBtn').disabled = sepaLaeuft || offen.length === 0;
        $('abrSepaGrund').textContent = grund;
        $('abrSepaNeuBtn').hidden = sepaMitDatei().length === 0;
        $('abrSepaNeuBtn').disabled = sepaLaeuft;
        const tbody = $('abrSepaDateien');
        tbody.replaceChildren();
        $('abrSepaTabelle').hidden = sepaDateien.length === 0;
        for (const d of sepaDateien) {
            const tr = el('tr');
            tr.append(
                zelle('Erzeugt am', zeitDe(d.erzeugt_am)),
                zelle('Einzug am', datumDe(d.faelligkeit)),
                zelle('Lastschriften', String(d.anzahl), 'rechts'),
                zelle('Summe', euro(d.summe_cent), 'rechts'),
                zelle('Hinweise', d.warnung || '–', 'abr-sepa-hinweis')
            );
            tbody.append(tr);
        }
    }

    async function ladeSepaDateien() {
        sepaDateien = [];
        if (lastschriftRechnungen().length === 0) return;
        try {
            const antwort = await fetch(`${api}/sepa`);
            if (antwort.ok) sepaDateien = (await antwort.json()).dateien || [];
        } catch { /* Übersicht ist optional */ }
    }

    function zeigeNeuAuswahl() {
        zeigeSepaFehler('');
        const liste = $('abrSepaNeuListe');
        liste.replaceChildren();
        for (const r of sepaMitDatei()) {
            const haken = el('input', { type: 'checkbox', value: String(r.id), className: 'abr-sepa-haken' });
            const text = `${r.nummer} – ${r.vereinName} – ${euro(r.betrag_cent)} (Einzug ${datumDe(r.einzug_am)})`;
            liste.append(el('label', {}, [haken, document.createTextNode(text)]));
        }
        $('abrSepaNeu').hidden = false;
    }

    function ladeHerunter(blob, dateiname) {
        const adresse = URL.createObjectURL(blob);
        const link = el('a', { href: adresse, download: dateiname });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(adresse), 10000);
    }

    async function erzeugeSepa({ neu = false, rechnungIds = null } = {}) {
        if (sepaLaeuft) return;
        zeigeFehler('');
        zeigeSepaFehler('');
        zeigeSepaWarnung('');
        let text;
        if (neu) {
            if (!rechnungIds || rechnungIds.length === 0) return zeigeSepaFehler('Bitte mindestens eine Rechnung auswählen.');
            text = `Achtung: Die ${rechnungIds.length} ausgewählte(n) Lastschrift(en) stehen schon in einer Datei. Reichen Sie die neue Datei nur ein, `
                + 'wenn die bisherige NICHT eingereicht wurde, sonst wird doppelt eingezogen. Neu erzeugen?';
        } else {
            const offen = sepaOffen();
            text = `Es wird eine SEPA-Lastschriftdatei mit ${offen.length} Lastschrift(en) über ${euro(summeVon(offen))} erzeugt. `
                + 'Die Lastschriften gelten danach als „in einer Datei“. Fortfahren?';
        }
        // Sperre schon vor der Rückfrage: ein zweiter Klick öffnet keinen zweiten Dialog und keine zweite Anfrage.
        sepaLaeuft = true;
        for (const k of ['abrSepaBtn', 'abrSepaNeuBtn', 'abrSepaNeuStart']) $(k).disabled = true;
        let neuLaden = false;
        let dateiId = null;
        let kurzWarnung = null;
        try {
            if (!(await bestaetige(text, neu ? 'SEPA-Datei neu erzeugen' : 'SEPA-Datei erzeugen'))) return;
            const antwort = await rufe(`${api}/sepa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(neu ? { neu: true, rechnungIds } : {})
            });
            if (!antwort.ok) {
                const inhalt = await antwort.json().catch(() => ({}));
                zeigeSepaFehler(inhalt.error || 'Die SEPA-Datei konnte nicht erzeugt werden.');
                neuLaden = antwort.status === 409; // Stand hat sich geändert: neu laden (die Meldung bleibt stehen)
                return;
            }
            neuLaden = true;
            const roh = antwort.headers.get('X-Sepa-Warnung');
            if (roh) {
                kurzWarnung = roh;
                try { kurzWarnung = decodeURIComponent(roh); } catch { /* Rohtext anzeigen */ }
            }
            dateiId = Number(antwort.headers.get('X-Sepa-Datei-Id')) || null;
            const treffer = /filename="([A-Za-z0-9._-]+)"/.exec(antwort.headers.get('Content-Disposition') || '');
            ladeHerunter(await antwort.blob(), treffer ? treffer[1] : `sepa-lastschrift-${turnierId}.xml`);
            zeigeSepaWarnung(kurzWarnung);
            $('abrSepaNeu').hidden = true;
            meldung('Die SEPA-Datei wurde erzeugt. Bitte im Online-Banking einreichen.', 'success');
        } catch {
            zeigeSepaFehler('Die SEPA-Datei konnte nicht erzeugt werden.');
        } finally {
            sepaLaeuft = false;
            $('abrSepaNeuStart').disabled = false;
            if (neuLaden) {
                try { await lade(); } catch { zeigeFehler('Die Abrechnung konnte nicht neu geladen werden.'); }
                // Die vollständige Warnung steht an der Datei (der Header trägt nur eine gekürzte Fassung).
                const datei = dateiId ? sepaDateien.find((d) => d.id === dateiId) : null;
                if (datei && datei.warnung) zeigeSepaWarnung(datei.warnung);
            } else if (daten) {
                zeigeSepa();
            }
        }
    }

    function zeigeAlles() {
        $('abrInhalt').hidden = false;
        zeigeKennzahlen();
        zeigeNichtZugeordnet();
        zeigeVereine();
        zeigeLaufKnoepfe();
        zeigeSepa();
    }

    async function ladeStammdatenLink() {
        try {
            const resp = await fetch(`/api/abrechnung/stammdaten-pruefung/${encodeURIComponent(turnierId)}`);
            if (!resp.ok) return;
            const pruefung = await resp.json();
            if (pruefung.darfPflegen && pruefung.vereinId) {
                $('abrStammdatenLink').href = `/verein.html?vereinId=${encodeURIComponent(pruefung.vereinId)}`;
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
        await ladeSepaDateien();
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

    // ---- Rücklastschrift ----
    let ruecklastschriftLaeuft = false; // Doppelklick-Schutz: höchstens eine Erfassung gleichzeitig

    // Knopf mit Auswahl des neuen Zahlwegs (Überweisung/Bar); die Auswahl erscheint erst nach dem Klick.
    function baueRuecklastschrift(r, vereinName) {
        const box = el('div', { className: 'abr-ruecklastschrift' });
        const knopf = el('button', { type: 'button', className: 'btn btn-outlined abr-ruecklastschrift-btn', textContent: 'Rücklastschrift erfassen' });
        const auswahl = el('select', { className: 'abr-ruecklastschrift-zahlweg' });
        auswahl.setAttribute('aria-label', 'Neuer Zahlweg');
        auswahl.append(el('option', { value: 'ueberweisung', textContent: 'künftig per Überweisung' }), el('option', { value: 'bar', textContent: 'künftig bar' }));
        const erfassen = el('button', { type: 'button', className: 'btn btn-outlined abr-ruecklastschrift-start', textContent: 'Erfassen' });
        const abbrechen = el('button', { type: 'button', className: 'btn btn-outlined abr-ruecklastschrift-abbruch', textContent: 'Abbrechen' });
        const wahl = el('div', { className: 'abr-ruecklastschrift-wahl', hidden: true }, [auswahl, erfassen, abbrechen]);
        knopf.addEventListener('click', () => { wahl.hidden = false; knopf.hidden = true; });
        abbrechen.addEventListener('click', () => { wahl.hidden = true; knopf.hidden = false; });
        erfassen.addEventListener('click', () => erfasseRuecklastschrift(r, vereinName, auswahl.value, [erfassen, abbrechen, auswahl]));
        box.append(knopf, wahl);
        return box;
    }

    async function erfasseRuecklastschrift(r, vereinName, neuerZahlweg, bedienelemente) {
        if (ruecklastschriftLaeuft) return;
        zeigeFehler('');
        zeigeSepaFehler('');
        // Sperre schon vor der Rückfrage: ein zweiter Klick öffnet keinen zweiten Dialog und keine zweite Anfrage.
        ruecklastschriftLaeuft = true;
        for (const k of bedienelemente) k.disabled = true;
        let neuLaden = false;
        try {
            const text = `Rechnung ${r.nummer} (${vereinName}, ${euro(r.betrag_cent)}) wurde von der Bank zurückgebucht? `
                + `Die Rechnung gilt dann als „zurückgebucht“, das Lastschriftmandat wird widerrufen und der Verein zahlt künftig `
                + `${neuerZahlweg === 'bar' ? 'bar' : 'per Überweisung'}. Der nächste Rechnungslauf erstellt eine neue Rechnung mit neuer Nummer. `
                + 'Das lässt sich nicht rückgängig machen. Fortfahren?';
            if (!(await bestaetige(text, 'Rücklastschrift erfassen'))) return;
            const { ok, status, daten: antwort } = await post(`${api}/rechnungen/${encodeURIComponent(r.id)}/ruecklastschrift`, { neuerZahlweg });
            if (!ok) {
                zeigeSepaFehler(antwort.error || 'Die Rücklastschrift konnte nicht erfasst werden.');
                neuLaden = status === 409; // Stand hat sich geändert: neu laden (die Meldung bleibt stehen)
                return;
            }
            neuLaden = true;
            meldung(`Rücklastschrift zu ${r.nummer} erfasst. ${vereinName} zahlt künftig ${neuerZahlweg === 'bar' ? 'bar' : 'per Überweisung'}; `
                + 'bitte den Rechnungslauf erneut starten.', 'success');
        } catch {
            zeigeSepaFehler('Die Rücklastschrift konnte nicht erfasst werden.');
        } finally {
            ruecklastschriftLaeuft = false;
            for (const k of bedienelemente) k.disabled = false;
            if (neuLaden) {
                try { await lade(); } catch { zeigeFehler('Die Abrechnung konnte nicht neu geladen werden.'); }
            }
            if (!$('abrSepaFehler').hidden) $('abrSepaFehler').scrollIntoView({ block: 'nearest' });
        }
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
        $('abrSepaBtn').addEventListener('click', () => erzeugeSepa());
        $('abrSepaNeuBtn').addEventListener('click', zeigeNeuAuswahl);
        $('abrSepaNeuAbbruch').addEventListener('click', () => { $('abrSepaNeu').hidden = true; });
        $('abrSepaNeuStart').addEventListener('click', () => {
            const ids = [...document.querySelectorAll('.abr-sepa-haken:checked')].map((h) => Number(h.value)).filter(Number.isInteger);
            erzeugeSepa({ neu: true, rechnungIds: ids });
        });
        try {
            await lade();
        } catch {
            zeigeFehler('Die Abrechnung konnte nicht geladen werden.');
        }
    }

    start();
})();
