// Mannschaften: Team-Ansicht (Stern/Glocke nur am Team) und Mannschafts-Pool mit seinen Teams.
import { api } from './api.js';
import { verbindung, teamZeilen, matteText, poolName } from './anzeige.js';
import { sortiereTeams } from './uebersicht.js';
import { h, icon, inhalt, setzeStatus, setzeStopp, speicherFuer, teamKachel, zeigeTabs } from './ui.js';

const hinweisKeinTurnier = (f) => {
    inhalt().replaceChildren(h('p', { class: 'hinweis' }, f && f.status === 404 ? 'Das Turnier ist nicht mehr verfügbar.' : 'Keine Verbindung.'));
    setzeStatus(f && f.status === 404 ? '' : 'Keine Verbindung', !(f && f.status === 404));
};

function ergebnisText(b) {
    if (b.status === 'beendet') {
        if (b.gewonnen === null) return `Unentschieden ${b.eigene}:${b.fremde}`;
        return `${b.gewonnen ? 'gewonnen' : 'verloren'} ${b.eigene}:${b.fremde}`;
    }
    if (b.status === 'gestartet') return 'läuft';
    if (Number.isInteger(b.abstand)) return b.abstand === 0 ? 'als Nächstes' : (b.abstand === 1 ? 'in 1 Begegnung' : `in ${b.abstand} Begegnungen`);
    return 'anstehend';
}

export async function zeigeMannschaft({ key, teile }) {
    zeigeTabs(key, 'pools');
    const teamKey = teile[1];
    const speicher = speicherFuer(key);
    let timer = null;
    let beendet = false;
    const stoppe = () => { beendet = true; if (timer) { clearInterval(timer); timer = null; } };
    setzeStopp(stoppe);
    let letzte = null;

    async function lade() {
        let antwort;
        try { antwort = await api.mannschaft(key, teamKey); letzte = antwort; } catch (f) {
            if (f.status === 404) { stoppe(); hinweisKeinTurnier(f); return; }
            antwort = letzte;
        }
        if (beendet) return;
        if (!antwort) { hinweisKeinTurnier(null); return; }
        const t = antwort.mannschaft;
        const gesternt = speicher.istGesternt(t.key);
        const glocke = speicher.hatGlocke(t.key);
        const knopf = (an, symbolAn, symbolAus, titel, aktion, testId) => h('button', {
            class: 'icon-knopf klein', type: 'button', 'data-testid': testId, 'aria-pressed': String(an), 'aria-label': titel, title: titel,
            onclick: () => { aktion(!an); lade(); }
        }, icon(an ? symbolAn : symbolAus));
        const z = teamZeilen(t);
        const matte = t.zustand === 'abgeschlossen' ? '' : (t.matteBezeichnung || '');

        inhalt().replaceChildren(
            h('a', { class: 'zurueck', href: `#/t/${encodeURIComponent(key)}/pools/mannschaften` }, icon('chevron_left'), `${t.altersklasse} ${t.geschlecht} · Team`),
            h('h1', { class: 'mit-aktionen' }, h('span', {}, t.bezeichnung),
                h('span', {},
                    knopf(gesternt, 'star', 'star_border', gesternt ? 'Nicht mehr verfolgen' : 'Verfolgen', (an) => speicher.stern(t.key, an), 'team-stern'),
                    t.zustand === 'abgeschlossen' ? null
                        : knopf(glocke, 'notifications', 'notifications_off', glocke ? 'Benachrichtigung aus' : 'Benachrichtigung an', (an) => speicher.glocke(t.key, an), 'team-glocke'))),
            h('p', { class: 'hinweis-klein', style: 'margin:0 0 8px;color:var(--muted);font-weight:600' }, [t.verein, poolName(t.poolBezeichnung)].filter(Boolean).join(' · ')),
            h('div', { class: `kachel ${z.art === 'laeuft' ? 'laeuft' : z.art === 'bald' ? 'bald' : ''} ${matte ? 'mit-matte' : ''}`, 'data-testid': 'team-status' },
                matte ? h('div', { class: 'matte-block' }, h('small', {}, 'Matte'), h('span', { class: matteText(matte).length > 3 ? 'lang' : '' }, matte.replace(/^matte\s+/i, ''))) : null,
                h('div', { class: 'kachel-inhalt' },
                    h('div', { class: 'name' }, z.zeile2 || 'Status'),
                    z.zeile1 && h('div', { class: 'zeile' }, z.zeile1))),
            h('div', { class: 'abschnitt' }, `Stand · ${t.siege} ${t.siege === 1 ? 'Sieg' : 'Siege'} · ${t.niederlagen} ${t.niederlagen === 1 ? 'Niederlage' : 'Niederlagen'}`),
            antwort.begegnungen.length
                ? h('div', { class: 'treffer', 'data-testid': 'team-begegnungen' }, antwort.begegnungen.map(b => h('div', { class: 't', 'data-testid': `begegnung-${b.id}` },
                    `${t.bezeichnung} – ${b.gegner || 'offen'}`,
                    h('small', {}, [b.matteBezeichnung ? matteText(b.matteBezeichnung) : null, b.runde ? `Runde ${b.runde}` : null, ergebnisText(b)].filter(Boolean).join(' · ')))))
                : h('p', { class: 'hinweis' }, 'Noch keine Begegnungen.'),
            h('div', { class: 'abschnitt' }, 'Aufstellung'),
            antwort.mitglieder.length
                ? h('div', { class: 'treffer', 'data-testid': 'team-aufstellung' }, antwort.mitglieder.map(m => h('div', { class: 't' },
                    `${m.gewichtsklasse ? `${String(m.gewichtsklasse).replace(/^-/, '−')} kg` : '–'} · ${m.nachname}, ${m.vorname}`)))
                : h('p', { class: 'hinweis' }, 'Noch keine Kämpfer gemeldet.'));
        const v = verbindung(antwort);
        void v;
        setzeStatus('');
    }
    await lade();
    if (!beendet) timer = setInterval(() => { if (document.visibilityState === 'visible') lade(); }, 15000);
}

export async function zeigeMannschaftsPool({ key, teile }) {
    zeigeTabs(key, 'pools');
    const poolId = Number(teile[1]);
    const speicher = speicherFuer(key);
    let antwort;
    try { antwort = await api.mannschaften(key); } catch (f) { hinweisKeinTurnier(f); return; }
    setzeStatus('');
    const pool = antwort.pools.find(p => p.poolId === poolId);
    if (!pool) {
        inhalt().replaceChildren(h('a', { class: 'zurueck', href: `#/t/${encodeURIComponent(key)}/pools/mannschaften` }, icon('chevron_left'), 'Pools'),
            h('p', { class: 'hinweis' }, 'Pool nicht gefunden.'));
        return;
    }
    function zeichne() {
        inhalt().replaceChildren(
            h('a', { class: 'zurueck', href: `#/t/${encodeURIComponent(key)}/pools/mannschaften` }, icon('chevron_left'), 'Pools'),
            h('h1', {}, poolName(pool.bezeichnung), h('small', {}, `${pool.teams} Teams`)),
            h('div', { 'data-testid': 'mannschaftspool-teams' }, sortiereTeams(pool.mannschaften || []).map(t => teamKachel(t, speicher, zeichne, {
                href: `#/t/${encodeURIComponent(key)}/mannschaft/${encodeURIComponent(t.key)}`
            }))));
    }
    zeichne();
}
