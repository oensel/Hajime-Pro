// Karte „Zwei-Faktor-Anmeldung“ auf profil.html (nur Super-Admins in der Cloud): Stand anzeigen und neue Backup-Codes erzeugen.
// API: GET /api/auth/2fa/status, POST /api/auth/2fa/backup-codes (Header X-2FA-Code). Neu einrichten läuft über den Login
// (die 2FA eines Kontos setzt ein anderer Super-Admin auf admin-nutzer.html zurück).
(function () {
    document.addEventListener('DOMContentLoaded', async () => {
        const karte = document.getElementById('zweiFaktorKarte');
        if (!karte) return;
        let status;
        try {
            const response = await fetch('/api/auth/2fa/status');
            if (!response.ok) return;
            status = await response.json();
        } catch (_) {
            return;
        }
        if (!status.istSuperAdmin || !status.pflicht) return;

        const el = (tag, eigenschaften = {}, ...kinder) => {
            const e = document.createElement(tag);
            Object.assign(e, eigenschaften);
            e.append(...kinder);
            return e;
        };
        const titel = el('div', { className: 'form-title-area' },
            el('span', { className: 'material-icons', textContent: 'phonelink_lock' }), el('h1', { textContent: 'Zwei-Faktor-Anmeldung' }));
        const stand = el('p', { style: 'font-size: 13px; margin: 0 0 12px;' });
        const meldung = el('div', { role: 'alert', style: 'font-size: 13px; font-weight: 700; min-height: 18px; margin-top: 8px;' });
        const codeFeld = el('input', {
            type: 'text', autocomplete: 'one-time-code', maxLength: 20, placeholder: 'Aktueller Code der App', spellcheck: false,
            style: 'width: 100%; box-sizing: border-box; padding: 8px 10px; margin-bottom: 8px;'
        });
        const knopf = el('button', { type: 'button', className: 'btn btn-outlined', textContent: 'Neue Backup-Codes erzeugen', style: 'width: 100%;' });
        const codesBox = el('div', { hidden: true });

        function zeigeStand(s) {
            if (!s.aktiv) {
                stand.textContent = 'Noch nicht eingerichtet. Sie richten sie beim nächsten Login ein.';
                codeFeld.hidden = true;
                knopf.hidden = true;
                return;
            }
            const seit = new Date(s.aktivSeit).toLocaleDateString('de-DE');
            stand.textContent = `Aktiv seit ${seit}. Verbleibende Backup-Codes: ${s.backupCodesUebrig}${s.backupCodesUebrig <= 2 ? ' (bald aufgebraucht, bitte neue erzeugen)' : ''}.`;
            stand.style.color = s.backupCodesUebrig <= 2 ? '#c62828' : '';
        }
        zeigeStand(status);

        knopf.addEventListener('click', async () => {
            meldung.textContent = '';
            meldung.style.color = '';
            knopf.disabled = true;
            try {
                const response = await fetch('/api/auth/2fa/backup-codes', { method: 'POST', headers: { 'X-2FA-Code': codeFeld.value.trim() } });
                const daten = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(daten.error || 'Die Codes konnten nicht erzeugt werden.');
                codesBox.replaceChildren(
                    el('p', { textContent: 'Neue Backup-Codes (die alten sind ungültig). Sie werden nur jetzt angezeigt, bitte sicher speichern:', style: 'font-size: 13px;' }),
                    el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-family: monospace; font-size: 15px; text-align: center;' },
                        ...daten.backupCodes.map((c) => el('span', { textContent: c, style: 'padding: 6px; border: 1px solid var(--border); border-radius: 4px; user-select: all;' })))
                );
                codesBox.hidden = false;
                codeFeld.value = '';
                const neu = await (await fetch('/api/auth/2fa/status')).json();
                zeigeStand(neu);
            } catch (err) {
                meldung.textContent = err.message;
                meldung.style.color = '#ef4444';
            } finally {
                knopf.disabled = false;
            }
        });

        karte.replaceChildren(titel, stand, codeFeld, knopf, meldung, codesBox);
        karte.hidden = false;
    });
})();
