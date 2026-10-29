// Formular "Angaben auf den Rechnungen" (Absender, Anschrift, E-Mail, Steuernummer, Präfix, Umsatzsteuer-Hinweis).
// Wird von rechnungen.html (aufklappbarer Bereich) und, als Popup im Turnierformular, von zahlungsdaten.html eingebunden
// (Stylesheet: /css/rechnungsAngaben.css). Das Modul baut nur die Felder; Laden und Speichern (PUT /api/abrechnung/stammdaten/:vereinId)
// übernimmt die Seite, weil sie ggf. weitere Felder im selben Request mitschickt.
(function () {
    // Vorschlag für den Umsatzsteuer-Hinweis: gemeinnützige Sportvereine (§ 4 Nr. 22 Buchst. b UStG); nur bei leerem gespeichertem Feld
    const UST_VORSCHLAG = 'Steuerfrei nach § 4 Nr. 22 Buchst. b UStG.';
    // Name des Eintrags in der Prüfliste, der nicht zu diesen Feldern gehört (Konto und IBAN stehen unter "Zahlungsdaten")
    const KONTO = 'Kontoinhaber und IBAN';

    const VORLAGE = `
        <p class="ra-hilfe">Diese Angaben erscheinen auf jeder Startgeld-Rechnung. Konto und Lastschrift stehen unter „Zahlungsdaten“.</p>
        <div class="ra-feld"><label for="raAbsender">Absendername</label>
            <input type="text" id="raAbsender" maxlength="200" placeholder="z.B. Judo-Club Köln e.V."></div>
        <div class="ra-feld"><label for="raAnschrift">Anschrift</label>
            <textarea id="raAnschrift" rows="3" maxlength="500" placeholder="Straße, PLZ Ort"></textarea></div>
        <div class="ra-feld"><label for="raEmail">Rechnungs-E-Mail</label>
            <input type="email" id="raEmail" maxlength="200" placeholder="rechnung@verein.de">
            <p class="ra-hilfe">An diese Adresse gehen Rückfragen zu den Rechnungen.</p></div>
        <div class="ra-paar">
            <div class="ra-feld"><label for="raSteuernummer">Steuernummer des Vereins</label>
                <input type="text" id="raSteuernummer" maxlength="50" placeholder="z.B. 337/5710/1234"></div>
            <div class="ra-feld"><label for="raPraefix">Rechnungsnummern-Präfix</label>
                <input type="text" id="raPraefix" maxlength="12" placeholder="z.B. JCK-"></div>
        </div>
        <p class="ra-hilfe" style="margin: -8px 0 14px;">Steuernummer: die Nummer vom Finanzamt, zum Beispiel vom Freistellungsbescheid. Eine USt-IdNr. ist nicht nötig. Präfix: Buchstaben, Ziffern und Bindestrich, höchstens 12 Zeichen. Nächste Rechnungsnummer: <strong id="raNaechste">-</strong></p>
        <div class="ra-feld"><label for="raUstHinweis">Hinweis zur Umsatzsteuer <span class="ra-marke" id="raUstVorschlag" hidden>Vorschlag</span></label>
            <textarea id="raUstHinweis" rows="2" maxlength="1000" placeholder="z.B. Steuerfrei nach § 4 Nr. 22 Buchst. b UStG."></textarea>
            <p class="ra-hilfe">Steht unten auf jeder Rechnung. Gilt für gemeinnützige Sportvereine, deren Startgelder steuerfrei sind. In anderen Fällen, zum Beispiel bei Kleinunternehmern (§ 19 UStG), den Text anpassen. Bitte mit dem Steuerberater abstimmen.</p></div>`;

    window.RechnungsAngaben = {
        /** Einträge der Prüfliste (fehlt), die zu diesen Feldern gehören (alles außer Konto und IBAN). */
        fehlendeAngaben(fehlt) {
            return (fehlt || []).filter((eintrag) => eintrag !== KONTO);
        },

        /** Baut die Felder in den Container und liefert fuelle(stammdaten) und werte() für den Request. */
        baue(container) {
            container.innerHTML = VORLAGE;
            const $ = (id) => container.querySelector(`#${id}`);
            let naechsteNummer = 1;

            function zeigeNaechsteNummer() {
                const praefix = $('raPraefix').value.trim();
                $('raNaechste').textContent = praefix ? `${praefix}${String(naechsteNummer).padStart(5, '0')}` : '-';
            }
            $('raPraefix').addEventListener('input', zeigeNaechsteNummer);

            return {
                fuelle(stammdaten) {
                    const s = stammdaten || {};
                    $('raAbsender').value = s.absender_name || '';
                    $('raAnschrift').value = s.anschrift || '';
                    $('raEmail').value = s.rechnung_email || '';
                    $('raSteuernummer').value = s.steuernummer || '';
                    $('raPraefix').value = s.rechnungs_praefix || '';
                    $('raUstHinweis').value = s.ust_hinweis || UST_VORSCHLAG;
                    $('raUstVorschlag').hidden = !!s.ust_hinweis;
                    naechsteNummer = s.naechste_rechnungsnummer || 1;
                    zeigeNaechsteNummer();
                },
                werte() {
                    return {
                        absender_name: $('raAbsender').value,
                        anschrift: $('raAnschrift').value,
                        rechnung_email: $('raEmail').value,
                        steuernummer: $('raSteuernummer').value,
                        rechnungs_praefix: $('raPraefix').value,
                        ust_hinweis: $('raUstHinweis').value
                    };
                },
                /** Eingabe-Ereignis eines Feldes (z. B. für die Vorschau des Mandatstexts, die den Absendernamen braucht). */
                beiAbsender(rueckruf) {
                    $('raAbsender').addEventListener('input', rueckruf);
                }
            };
        }
    };
})();
