import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    menueFuerRolle, verwaltbareVereine, vorbelegteFreigabeRolle, istHelferFreieSeite, ROLLEN_TEXT
} from '../../src/shared/menueRechte.js';

// Menü-Rechte (Helferverwaltung, Spec 3.3): reine Helfer sehen kein Verwaltungsmenü, „Nutzer“ nur für
// Super-Admins, „Helfer-App“ für jedes angemeldete Konto in der Cloud. Im Einzelbenutzerbetrieb
// (Hallen-Server) bleibt alles wie bisher.

test('menueFuerRolle: Matrix über alle Rollen', () => {
    const faelle = [
        [{ rolle: null, istSuperAdmin: true }, { verwaltung: true, helferPlan: true, nutzer: true, helferApp: false, protokoll: true }],
        [{ rolle: 'helfer', istSuperAdmin: true }, { verwaltung: true, helferPlan: true, nutzer: true, helferApp: false, protokoll: true }],
        [{ rolle: 'admin' }, { verwaltung: true, helferPlan: true, nutzer: false, helferApp: true, protokoll: true }],
        [{ rolle: 'benutzer' }, { verwaltung: true, helferPlan: false, nutzer: false, helferApp: true, protokoll: false }],
        [{ rolle: 'helfer' }, { verwaltung: false, helferPlan: false, nutzer: false, helferApp: true, protokoll: false }],
        [{ rolle: null }, { verwaltung: false, helferPlan: false, nutzer: false, helferApp: true, protokoll: false }],
        [{}, { verwaltung: false, helferPlan: false, nutzer: false, helferApp: true, protokoll: false }],
        [{ rolle: 'unbekannt' }, { verwaltung: false, helferPlan: false, nutzer: false, helferApp: true, protokoll: false }]
    ];
    for (const [eingabe, erwartet] of faelle) {
        assert.deepEqual(menueFuerRolle(eingabe), erwartet, JSON.stringify(eingabe));
    }
});

test('menueFuerRolle: Einzelbenutzerbetrieb zeigt die Verwaltung wie bisher, ohne Helfer-App und Nutzer', () => {
    for (const rolle of [null, 'helfer', 'benutzer', 'admin']) {
        assert.deepEqual(menueFuerRolle({ rolle, istSuperAdmin: false, einzelbenutzer: true }),
            { verwaltung: true, helferPlan: true, nutzer: false, helferApp: false, protokoll: false }, String(rolle));
    }
    assert.deepEqual(menueFuerRolle({ rolle: null, istSuperAdmin: true, einzelbenutzer: true }),
        { verwaltung: true, helferPlan: true, nutzer: false, helferApp: false, protokoll: false });
});

test('verwaltbareVereine: nur freigegebene Mitgliedschaften als Benutzer oder Admin', () => {
    const vereine = [
        { verein_id: 1, name: 'A', freigegeben: true, rolle: 'admin' },
        { verein_id: 2, name: 'B', freigegeben: true, rolle: 'helfer' },
        { verein_id: 3, name: 'C', freigegeben: false, rolle: null },
        { verein_id: 4, name: 'D', freigegeben: true, rolle: 'benutzer' },
        // Rolle ohne Freigabe zählt nicht
        { verein_id: 5, name: 'E', freigegeben: false, rolle: 'admin' }
    ];
    assert.deepEqual(verwaltbareVereine(vereine).map(v => v.verein_id), [1, 4]);
    assert.deepEqual(verwaltbareVereine(null), []);
});

test('vorbelegteFreigabeRolle: Helfer-App → helfer, sonst benutzer', () => {
    assert.equal(vorbelegteFreigabeRolle('helfer-app'), 'helfer');
    assert.equal(vorbelegteFreigabeRolle('verwaltung'), 'benutzer');
    assert.equal(vorbelegteFreigabeRolle(null), 'benutzer');
    assert.equal(vorbelegteFreigabeRolle(undefined), 'benutzer');
});

test('istHelferFreieSeite: Seiten ohne Weiterleitung zur Helfer-App', () => {
    for (const pfad of ['/login.html', '/verein_auswahl.html', '/profil.html', '/bestaetigen.html', '/freigabe.html', '/helfer.html']) {
        assert.equal(istHelferFreieSeite(pfad), true, pfad);
    }
    for (const pfad of ['/turniere.html', '/turnier.html', '/teilnehmer.html', '/helfer-plan.html', '/admin-nutzer.html', '/']) {
        assert.equal(istHelferFreieSeite(pfad), false, pfad);
    }
});

test('ROLLEN_TEXT benennt alle drei Rollen', () => {
    assert.deepEqual(ROLLEN_TEXT, { admin: 'Admin', benutzer: 'Benutzer', helfer: 'Helfer' });
});
