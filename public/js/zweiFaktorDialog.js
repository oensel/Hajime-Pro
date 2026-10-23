// Zwei-Faktor-Schritt der Anmeldung (Super-Admins, nur Cloud), von login.html aufgerufen, wenn /api/auth/login statt der
// Sitzung { zweiFaktor: 'pruefen' | 'einrichtung', zwischenToken } liefert:
//   const antwort = await window.ZweiFaktorDialog.starte(loginAntwort);   // Antwort mit token und user
// 'pruefen': Code der Authenticator-App oder ein Backup-Code. 'einrichtung': QR-Code scannen, Code bestätigen, danach
// werden die Backup-Codes einmalig angezeigt. Der Dialog baut sein eigenes <dialog> auf (Abbrechen = Promise-Fehler).
(function () {
    const CSS = `
        dialog.zf-dialog { border: 2px solid #374151; border-radius: 8px; padding: 28px; width: min(420px, 92vw); background: #1f2937; color: #f3f4f6; font-family: inherit; }
        dialog.zf-dialog::backdrop { background: rgba(0, 0, 0, 0.6); }
        .zf-dialog h2 { margin: 0 0 10px; font-size: 18px; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.5px; }
        .zf-dialog p { font-size: 13px; line-height: 1.5; color: #d1d5db; margin: 8px 0; }
        .zf-dialog input[type=text] { width: 100%; box-sizing: border-box; padding: 12px; font-size: 18px; letter-spacing: 2px; text-align: center; border-radius: 4px; border: 1px solid #4b5563; background: #111827; color: #f3f4f6; margin: 8px 0; }
        .zf-dialog button { width: 100%; padding: 12px; font-size: 14px; font-weight: 700; border: none; border-radius: 4px; cursor: pointer; text-transform: uppercase; background: #3b82f6; color: #fff; margin-top: 8px; }
        .zf-dialog button.zf-leise { background: transparent; color: #93c5fd; text-transform: none; font-weight: 400; }
        .zf-dialog button:disabled { background: #4b5563; cursor: default; }
        .zf-dialog .zf-fehler { color: #ef4444; font-weight: 700; font-size: 13px; min-height: 18px; }
        .zf-dialog .zf-qr { background: #fff; padding: 10px; border-radius: 4px; width: fit-content; margin: 10px auto; }
        .zf-dialog .zf-qr img, .zf-dialog .zf-qr svg { display: block; }
        .zf-dialog code.zf-geheimnis { display: block; word-break: break-all; text-align: center; font-size: 13px; background: #111827; padding: 8px; border-radius: 4px; user-select: all; }
        .zf-dialog .zf-codes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 10px 0; font-family: monospace; font-size: 15px; text-align: center; }
        .zf-dialog .zf-codes span { background: #111827; padding: 6px; border-radius: 4px; user-select: all; }
        .zf-dialog label.zf-haken { display: flex; gap: 8px; align-items: center; font-size: 13px; margin-top: 8px; }
    `;

    function el(tag, eigenschaften = {}, ...kinder) {
        const e = document.createElement(tag);
        Object.assign(e, eigenschaften);
        e.append(...kinder);
        return e;
    }

    async function post(pfad, daten) {
        const response = await fetch(pfad, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(daten)
        });
        const antwort = await response.json().catch(() => ({}));
        if (!response.ok) {
            const fehler = new Error(antwort.error || 'Die Anfrage ist fehlgeschlagen.');
            fehler.status = response.status;
            throw fehler;
        }
        return antwort;
    }

    function starte(login) {
        return new Promise((resolve, reject) => {
            if (!document.getElementById('zf-stil')) {
                const stil = el('style', { id: 'zf-stil', textContent: CSS });
                document.head.appendChild(stil);
            }
            const dialog = el('dialog', { className: 'zf-dialog' });
            document.body.appendChild(dialog);
            const schliesse = () => { dialog.close(); dialog.remove(); };
            const abbrechen = () => { schliesse(); reject(new Error('Anmeldung abgebrochen.')); };
            dialog.addEventListener('cancel', (e) => { e.preventDefault(); abbrechen(); });

            const fehlerFeld = el('div', { className: 'zf-fehler', role: 'alert' });
            const zeigeFehler = (text) => { fehlerFeld.textContent = text || ''; };
            const abgelaufen = (fehler) => {
                if (fehler.status === 401 && /abgelaufen/i.test(fehler.message)) { schliesse(); reject(fehler); return true; }
                return false;
            };

            function zeigePruefen() {
                const eingabe = el('input', {
                    type: 'text', autocomplete: 'one-time-code', maxLength: 20, placeholder: '123 456', spellcheck: false, ariaLabel: 'Code'
                });
                const knopf = el('button', { type: 'submit', textContent: 'Anmelden' });
                const form = el('form', {}, eingabe, fehlerFeld, knopf);
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    knopf.disabled = true;
                    zeigeFehler('');
                    try {
                        const antwort = await post('/api/auth/2fa/pruefen', { zwischenToken: login.zwischenToken, code: eingabe.value });
                        schliesse();
                        resolve(antwort);
                    } catch (fehler) {
                        if (abgelaufen(fehler)) return;
                        knopf.disabled = false;
                        zeigeFehler(fehler.message);
                        eingabe.select();
                    }
                });
                const zurueck = el('button', { type: 'button', className: 'zf-leise', textContent: 'Abbrechen' });
                zurueck.addEventListener('click', abbrechen);
                dialog.replaceChildren(
                    el('h2', { textContent: 'Zwei-Faktor-Anmeldung' }),
                    el('p', { textContent: 'Geben Sie den sechsstelligen Code Ihrer Authenticator-App ein. Haben Sie das Telefon nicht zur Hand, geht auch einer Ihrer Backup-Codes (jeder gilt nur einmal).' }),
                    form, zurueck
                );
                eingabe.focus();
            }

            async function zeigeEinrichtung() {
                dialog.replaceChildren(el('h2', { textContent: 'Zwei-Faktor-Anmeldung einrichten' }), el('p', { textContent: 'Wird vorbereitet …' }));
                let start;
                try {
                    start = await post('/api/auth/2fa/einrichtung/start', { zwischenToken: login.zwischenToken });
                } catch (fehler) {
                    schliesse();
                    reject(fehler);
                    return;
                }
                const qrBox = el('div', { className: 'zf-qr' });
                try {
                    const qr = window.qrcode(0, 'M');
                    qr.addData(start.otpauthUrl);
                    qr.make();
                    qrBox.append(el('img', { src: qr.createDataURL(5, 0), alt: 'QR-Code für die Authenticator-App', width: 170, height: 170 }));
                } catch (_) {
                    qrBox.textContent = 'QR-Code nicht verfügbar – bitte den Schlüssel unten eintippen.';
                }
                const eingabe = el('input', { type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 7, placeholder: '123 456', ariaLabel: 'Code aus der App' });
                const knopf = el('button', { type: 'submit', textContent: 'Bestätigen' });
                const form = el('form', {}, eingabe, fehlerFeld, knopf);
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    knopf.disabled = true;
                    zeigeFehler('');
                    try {
                        const antwort = await post('/api/auth/2fa/einrichtung/bestaetigen', { zwischenToken: login.zwischenToken, code: eingabe.value });
                        zeigeBackupCodes(antwort);
                    } catch (fehler) {
                        if (abgelaufen(fehler)) return;
                        knopf.disabled = false;
                        zeigeFehler(fehler.message);
                        eingabe.select();
                    }
                });
                const zurueck = el('button', { type: 'button', className: 'zf-leise', textContent: 'Abbrechen' });
                zurueck.addEventListener('click', abbrechen);
                dialog.replaceChildren(
                    el('h2', { textContent: 'Zwei-Faktor-Anmeldung einrichten' }),
                    el('p', { textContent: 'Für Super-Admins ist ein zweiter Faktor Pflicht. Scannen Sie den QR-Code mit einer Authenticator-App (z. B. Google Authenticator, Authy oder Bitwarden) und geben Sie den angezeigten Code ein.' }),
                    qrBox,
                    el('p', { textContent: 'Oder den Schlüssel von Hand eintippen:' }),
                    el('code', { className: 'zf-geheimnis', textContent: start.geheimnis }),
                    form, zurueck
                );
                eingabe.focus();
            }

            function zeigeBackupCodes(antwort) {
                const codes = antwort.backupCodes || [];
                const haken = el('input', { type: 'checkbox', id: 'zfGespeichert' });
                const weiter = el('button', { type: 'button', textContent: 'Weiter zur Anmeldung', disabled: true });
                haken.addEventListener('change', () => { weiter.disabled = !haken.checked; });
                const datei = el('button', { type: 'button', className: 'zf-leise', textContent: 'Als Textdatei speichern' });
                datei.addEventListener('click', () => {
                    const text = `Hajime Pro – Backup-Codes (jeder Code gilt nur einmal)\n\n${codes.join('\n')}\n`;
                    const link = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'hajime-pro-backup-codes.txt' });
                    link.click();
                    URL.revokeObjectURL(link.href);
                });
                weiter.addEventListener('click', () => { schliesse(); resolve(antwort); });
                dialog.replaceChildren(
                    el('h2', { textContent: 'Backup-Codes' }),
                    el('p', { textContent: 'Die Zwei-Faktor-Anmeldung ist aktiv. Speichern Sie diese Codes sicher (ausdrucken oder im Passwort-Manager): damit kommen Sie ohne Telefon hinein. Sie werden nur jetzt angezeigt.' }),
                    el('div', { className: 'zf-codes' }, ...codes.map((c) => el('span', { textContent: c }))),
                    datei,
                    el('label', { className: 'zf-haken', htmlFor: 'zfGespeichert' }, haken, 'Ich habe die Codes gespeichert.'),
                    weiter
                );
            }

            dialog.showModal();
            if (login.zweiFaktor === 'einrichtung') zeigeEinrichtung(); else zeigePruefen();
        });
    }

    window.ZweiFaktorDialog = { starte };
})();
