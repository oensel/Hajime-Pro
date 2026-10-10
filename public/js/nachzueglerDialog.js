// Nachzügler-Dialog (Spec docs/specs/2026-10-10-nachzuegler-pool-design.md): nach dem Speichern eines
// kampfbereiten Teilnehmers, dessen Altersklasse schon ausgelost ist, fragt er, in welchen Pool er soll.
// Schlägt jede Abfrage fehl (Client-Gerät ohne diese API, Netzwerk, kein Nachzügler), bleibt er still.
(function () {
    const meldung = (text, typ) => {
        if (typeof window.zeigeNotification === 'function') window.zeigeNotification(text, typ);
    };

    async function holeNachzuegler(turnierId, teilnehmerId) {
        try {
            if (window.Datenzugriff && typeof window.Datenzugriff.rolle === 'function' && window.Datenzugriff.rolle() === 'client') return null;
            const resp = await fetch(`/api/pools/nachzuegler?turnierId=${encodeURIComponent(turnierId)}`);
            if (!resp.ok) return null;
            const daten = await resp.json();
            if (!daten || daten.success !== true || !Array.isArray(daten.nachzuegler)) return null;
            return daten.nachzuegler.find(n => Number(n.teilnehmerId) === Number(teilnehmerId)) || null;
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

    function optionsText(pool, istVorschlag) {
        const teile = [`${pool.bezeichnung} → ${pool.teilnehmerNachher} Teilnehmer, ${pool.systemNachher}`];
        if (pool.gewichtsspanneUeberschritten) teile.push('Gewichtsspanne überschritten');
        return (istVorschlag ? 'Vorschlag: ' : '') + teile.join(' – ');
    }

    // Zeigt die Auswahl; löst mit { poolId } (Pool), { verspaetet: true } oder null ("Später") auf.
    function zeigeAuswahl(nachzuegler) {
        return new Promise((resolve) => {
            const vorschlagId = nachzuegler.vorschlag ? nachzuegler.vorschlag.poolId : null;
            const select = element('select', { id: 'nachzueglerPoolSelect' });
            select.style.cssText = 'width:100%;padding:8px;margin:12px 0;font:inherit;';
            for (const pool of nachzuegler.offenePools || []) {
                select.append(element('option', { value: String(pool.poolId), textContent: optionsText(pool, pool.poolId === vorschlagId) }));
            }
            select.append(element('option', { value: 'verspaetet', textContent: 'Verspätet (Sammelpool)' }));
            select.value = vorschlagId != null ? String(vorschlagId) : 'verspaetet';

            const btnEinsortieren = element('button', { type: 'button', id: 'nachzueglerEinsortierenBtn', className: 'mdc-button mdc-button--raised', textContent: 'Einsortieren' });
            const btnSpaeter = element('button', { type: 'button', id: 'nachzueglerSpaeterBtn', className: 'mdc-button', textContent: 'Später' });
            const knoepfe = element('div', {}, [btnSpaeter, btnEinsortieren]);
            knoepfe.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

            const titel = element('h2', { textContent: `In welchen Pool soll ${nachzuegler.name} ?` });
            titel.style.cssText = 'margin:0 0 8px;font-size:1.15rem;';
            const hinweis = element('p', { textContent: `Die Altersklasse ${nachzuegler.altersklasse} ist bereits ausgelost.` });
            hinweis.style.cssText = 'margin:0;color:var(--text-muted,#666);';

            const karte = element('div', { role: 'dialog' }, [titel, hinweis, select, knoepfe]);
            karte.style.cssText = 'background:var(--bg-card,#fff);color:var(--text,#222);border-radius:8px;padding:20px;max-width:520px;width:calc(100% - 32px);box-shadow:0 8px 32px rgba(0,0,0,.35);';

            const overlay = element('div', { id: 'nachzueglerDialog' }, [karte]);
            overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);';

            const beiTaste = (e) => { if (e.key === 'Escape') beenden(null); };
            const beenden = (ergebnis) => {
                document.removeEventListener('keydown', beiTaste, true);
                overlay.remove();
                resolve(ergebnis);
            };
            document.addEventListener('keydown', beiTaste, true);
            btnSpaeter.addEventListener('click', () => beenden(null));
            btnEinsortieren.addEventListener('click', () => {
                beenden(select.value === 'verspaetet' ? { verspaetet: true } : { poolId: Number(select.value) });
            });
            document.body.append(overlay);
            btnEinsortieren.focus();
        });
    }

    async function sende(turnierId, teilnehmerId, auswahl) {
        const url = auswahl.verspaetet
            ? `/api/pools/nachzuegler/${teilnehmerId}/verspaetet`
            : `/api/pools/nachzuegler/${teilnehmerId}/einsortieren`;
        const body = auswahl.verspaetet ? { turnierId: Number(turnierId) } : { turnierId: Number(turnierId), poolId: auswahl.poolId };
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const daten = await resp.json().catch(() => ({}));
        if (!resp.ok || daten.success === false) throw new Error(daten.error || 'Zuordnung fehlgeschlagen.');
        return daten;
    }

    async function frageNachSpeichern({ turnierId, teilnehmerId }) {
        if (!turnierId || !teilnehmerId) return { aktion: 'keine' };
        const nachzuegler = await holeNachzuegler(turnierId, teilnehmerId);
        if (!nachzuegler) return { aktion: 'keine' };

        const auswahl = await zeigeAuswahl(nachzuegler);
        if (!auswahl) return { aktion: 'spaeter' };
        try {
            await sende(turnierId, teilnehmerId, auswahl);
            meldung(auswahl.verspaetet
                ? `${nachzuegler.name} wurde in den Sammelpool "Verspätet" gelegt.`
                : `${nachzuegler.name} wurde in den Pool einsortiert.`, 'success');
            if (typeof window.ladeTeilnehmerListe === 'function') window.ladeTeilnehmerListe();
            return { aktion: auswahl.verspaetet ? 'verspaetet' : 'einsortiert' };
        } catch (error) {
            meldung(error.message, 'error');
            return { aktion: 'fehler' };
        }
    }

    window.NachzueglerDialog = { frageNachSpeichern };
})();
