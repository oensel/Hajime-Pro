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
        if (pool.moeglich === false) {
            return `${pool.bezeichnung} → nicht möglich (Pool läuft bereits)`;
        }
        const teile = [`${pool.bezeichnung} → ${pool.teilnehmerNachher} Teilnehmer, ${pool.systemNachher}`];
        if (pool.laeuft) teile.push('Pool läuft bereits, Einfügen ohne Systemwechsel');
        if (pool.gewichtsspanneUeberschritten) teile.push('Gewichtsspanne überschritten');
        return (istVorschlag ? 'Vorschlag: ' : '') + teile.join(' – ');
    }

    // Zeigt die Auswahl; löst mit { poolId } (Pool), { verspaetet: true } oder null ("Später") auf.
    function zeigeAuswahl(nachzuegler) {
        return new Promise((resolve) => {
            const pools = nachzuegler.offenePools || [];
            const vorschlagId = nachzuegler.vorschlag ? nachzuegler.vorschlag.poolId : null;
            const select = element('select', { id: 'nachzueglerPoolSelect' });
            select.style.cssText = 'width:100%;height:auto;padding:10px 12px;margin:0 0 12px;font-size:14px;cursor:pointer;';
            for (const pool of pools) {
                select.append(element('option', {
                    value: String(pool.poolId), textContent: optionsText(pool, pool.poolId === vorschlagId),
                    disabled: pool.moeglich === false
                }));
            }
            select.append(element('option', { value: 'verspaetet', textContent: 'Verspätet (Sammelpool)' }));
            select.value = vorschlagId != null ? String(vorschlagId) : 'verspaetet';

            // Begründung zur gewählten Zeile: warum ein laufender Pool nicht (mehr) in Frage kommt
            const begruendung = element('p', { id: 'nachzueglerBegruendung' });
            begruendung.style.cssText = 'margin:0 0 16px;font-size:13px;color:var(--text-muted);';
            const gesperrt = pools.filter(p => p.moeglich === false);
            const zeigeBegruendung = () => {
                const pool = pools.find(p => String(p.poolId) === select.value);
                begruendung.textContent = pool && pool.laeuft && pool.moeglich !== false
                    ? (pool.hinweis || 'Der Pool läuft bereits. Das Wettkampfsystem bleibt unverändert.')
                    : '';
            };
            select.addEventListener('change', zeigeBegruendung);
            zeigeBegruendung();

            const sperrHinweis = gesperrt.length === 0 ? null : element('ul', { id: 'nachzueglerSperrgruende' },
                gesperrt.map(p => element('li', { textContent: `${p.bezeichnung}: ${p.grund}` })));
            if (sperrHinweis) sperrHinweis.style.cssText = 'margin:0 0 16px;padding-left:18px;font-size:13px;color:var(--text-muted);';
            const nurSammelpool = !pools.some(p => p.moeglich !== false);
            const warnung = nurSammelpool
                ? element('p', { id: 'nachzueglerKeinPool', textContent: 'Kein Pool kann diesen Teilnehmer noch aufnehmen. Ein Wechsel des Wettkampfsystems ist nach Beginn eines Pools nicht möglich; er kommt in den Sammelpool "Verspätet".' })
                : null;
            if (warnung) warnung.style.cssText = 'margin:0 0 12px;padding:10px 12px;border:2px solid var(--border);font-size:13px;font-weight:700;';

            // Hinweise, die nicht überlesen werden dürfen (laufender Pool, gesperrte Pools, kein Platz): erst nach
            // ausdrücklicher Bestätigung lässt sich der Dialog schließen oder eine Auswahl treffen.
            const braucheBestaetigung = gesperrt.length > 0 || pools.some(p => p.laeuft) || vorschlagId == null;
            const bestaetigung = braucheBestaetigung
                ? element('input', { type: 'checkbox', id: 'nachzueglerBestaetigung' })
                : null;
            const bestaetigungZeile = bestaetigung
                ? element('label', {}, [bestaetigung, document.createTextNode(' Ich habe den Hinweis gelesen und verstanden.')])
                : null;
            if (bestaetigungZeile) bestaetigungZeile.style.cssText = 'display:block;margin:0 0 16px;font-size:14px;font-weight:700;cursor:pointer;';

            const btnEinsortieren = element('button', { type: 'button', id: 'nachzueglerEinsortierenBtn', className: 'btn btn-raised', textContent: 'Einsortieren' });
            const btnSpaeter = element('button', { type: 'button', id: 'nachzueglerSpaeterBtn', className: 'btn btn-outlined', textContent: 'Später' });
            const knoepfe = element('div', {}, [btnSpaeter, btnEinsortieren]);
            knoepfe.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;';
            for (const b of [btnSpaeter, btnEinsortieren]) b.style.padding = '2px 16px';
            if (bestaetigung) {
                btnSpaeter.disabled = true;
                btnEinsortieren.disabled = true;
                bestaetigung.addEventListener('change', () => {
                    btnSpaeter.disabled = !bestaetigung.checked;
                    btnEinsortieren.disabled = !bestaetigung.checked;
                });
            }

            const titel = element('h2', { textContent: `In welchen Pool soll ${nachzuegler.name} ?` });
            titel.style.cssText = 'margin:0 0 8px;font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-main);';
            const hinweis = element('p', { textContent: `Die Altersklasse ${nachzuegler.altersklasse} ist bereits ausgelost.` });
            hinweis.style.cssText = 'margin:0 0 16px;font-size:13px;color:var(--text-muted);';

            const karte = element('div', { role: 'dialog' }, [titel, hinweis, ...(warnung ? [warnung] : []), select, begruendung, ...(sperrHinweis ? [sperrHinweis] : []), ...(bestaetigungZeile ? [bestaetigungZeile] : []), knoepfe]);
            karte.style.cssText = 'background:var(--bg-card);color:var(--text-main);border:2px solid var(--border);border-radius:4px;padding:24px;max-width:560px;width:90%;box-shadow:var(--shadow);';

            const overlay = element('div', { id: 'nachzueglerDialog' }, [karte]);
            overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);backdrop-filter:blur(2px);';

            // Mit Pflicht-Hinweis schließt Escape nicht: erst die Bestätigung, dann "Später" oder "Einsortieren".
            const beiTaste = (e) => { if (e.key === 'Escape' && !(bestaetigung && !bestaetigung.checked)) beenden(null); };
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
            (bestaetigung || btnEinsortieren).focus();
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
