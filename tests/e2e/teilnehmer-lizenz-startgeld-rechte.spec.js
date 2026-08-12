// Integrationstest (kein Browser, kein HTTP): prüft, dass createTeilnehmer/updateTeilnehmer
// (teilnehmerController.js) das Setzen von "Lizenz gültig bis" und "Startgeld bezahlt" auf
// Mitglieder des ausrichtenden Vereins bzw. den Super-Admin beschränken — jeder andere Verein
// darf zwar (weiterhin) ohne Judopass-Nr./Lizenz/Gewicht anmelden, kann diese beiden Felder aber
// weder beim Anlegen setzen noch nachträglich verändern (siehe waage-modal.js/teilnehmer.html:
// das Lizenzfeld ist dort für Nicht-Ausrichter deaktiviert, die Startgeld-Checkbox ausgeblendet —
// serverseitig durchgesetzt wird das hier).
//
// Bewusst KEIN normaler Playwright-Browser-/API-Test gegen den gemeinsamen Testserver: dessen
// gesamte Umgebung läuft mit IS_OFFLINE=true fest verdrahtet (siehe test-env.js), und
// istGastgeberVerein in teilnehmerController.js ist
// `process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(...)` — der erste Teil ist auf
// diesem Server also IMMER wahr, jede Anfrage zählt dort unabhängig vom tatsächlichen Verein als
// privilegiert. Die hier zu prüfende Vereinstrennung lässt sich deshalb nicht über HTTP gegen den
// gemeinsamen Server erreichen. Stattdessen läuft dieser Test im Playwright-TESTPROZESS (nicht im
// per webServer gestarteten Kindprozess) direkt gegen dieselbe migrierte Test-SQLite-Datei (siehe
// mitTestDb-Muster in registrierung.spec.js) und ruft die Controller-Funktionen unmittelbar auf,
// mit lokal auf 'false' gesetztem process.env.IS_OFFLINE — das betrifft ausschließlich diesen
// Testprozess, der separat laufende Server-Kindprozess (fixe eigene Umgebung beim Start) bleibt
// davon komplett unberührt.
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import path from 'path';
import { fileURLToPath } from 'url';
import { TEST_SQLITE_PATH } from './test-env.js';
import { createTeilnehmer, updateTeilnehmer } from '../../src/controllers/teilnehmerController.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = Date.now();

// Minimaler Express-res-Doppelgänger: status().json() wie im echten Controller verwendet.
function mockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

function mockReq(benutzerId, body = {}, params = {}) {
    return { user: { id: benutzerId }, body, params };
}

test.describe.serial('Lizenz-/Startgeld-Rechte: nur ausrichtender Verein oder Super-Admin (teilnehmerController.js)', () => {
    let knex;
    let vorherigesIsOffline;
    let ausrichterVereinId, gastVereinId, gastVereinName, turnierId;
    let gastTeilnehmerId;

    const ausrichterUserId = `e2e-lizenz-ausrichter-${ts}`;
    const gastUserId = `e2e-lizenz-gast-${ts}`;
    const gastSuperAdminUserId = `e2e-lizenz-gast-superadmin-${ts}`;

    test.beforeAll(async () => {
        // Nur der lokale Testprozess ist betroffen (siehe Datei-Kommentar) — der laufende
        // Testserver-Kindprozess hat seine eigene, unveränderliche Umgebung.
        vorherigesIsOffline = process.env.IS_OFFLINE;
        process.env.IS_OFFLINE = 'false';

        knex = knexLib({
            client: 'sqlite3',
            connection: { filename: path.resolve(projectRoot, TEST_SQLITE_PATH) },
            useNullAsDefault: true,
            pool: { afterCreate: (conn, cb) => conn.run('PRAGMA busy_timeout = 5000;', cb) }
        });

        const [ausrichterVerein] = await knex('vereine').insert({ name: `E2E Lizenz Ausrichter ${ts}` }).returning('id');
        ausrichterVereinId = typeof ausrichterVerein === 'object' ? ausrichterVerein.id : ausrichterVerein;
        gastVereinName = `E2E Lizenz Gastverein ${ts}`;
        const [gastVerein] = await knex('vereine').insert({ name: gastVereinName }).returning('id');
        gastVereinId = typeof gastVerein === 'object' ? gastVerein.id : gastVerein;

        await knex('benutzer').insert([
            { id: ausrichterUserId, email: `${ausrichterUserId}@example.test`, vorname: 'Aus', nachname: 'Richter', aktiver_verein_id: ausrichterVereinId, ist_super_admin: false },
            { id: gastUserId, email: `${gastUserId}@example.test`, vorname: 'Gast', nachname: 'Verein', aktiver_verein_id: gastVereinId, ist_super_admin: false },
            { id: gastSuperAdminUserId, email: `${gastSuperAdminUserId}@example.test`, vorname: 'Gast', nachname: 'Superadmin', aktiver_verein_id: gastVereinId, ist_super_admin: true }
        ]);
        await knex('benutzer_vereine').insert([
            { benutzer_id: ausrichterUserId, verein_id: ausrichterVereinId, freigegeben: 1 },
            { benutzer_id: gastUserId, verein_id: gastVereinId, freigegeben: 1 },
            { benutzer_id: gastSuperAdminUserId, verein_id: gastVereinId, freigegeben: 1 }
        ]);

        const [turnier] = await knex('turniere').insert({
            bezeichnung: `E2E Lizenz-Berechtigungen ${ts}`,
            ort: 'Teststadt',
            datum: '2027-05-01',
            ausrichter: `E2E Lizenz Ausrichter ${ts}`,
            anzahl_kampfflaechen: 1,
            verein_id: ausrichterVereinId,
            // 'veroeffentlicht' nötig, sonst lehnt updateTeilnehmer/createTeilnehmer Nicht-
            // Ausrichter-Anfragen bereits vorher wegen "Anmeldung nicht offen" ab.
            status: 'veroeffentlicht'
        }).returning('id');
        turnierId = typeof turnier === 'object' ? turnier.id : turnier;
    });

    test.afterAll(async () => {
        await knex.destroy();
        process.env.IS_OFFLINE = vorherigesIsOffline;
    });

    test('Ausrichter-Verein: Lizenz und Startgeld werden beim Anlegen wie angegeben gespeichert', async () => {
        const res = mockRes();
        await createTeilnehmer(knex, mockReq(ausrichterUserId, {
            turnier_id: turnierId, vorname: 'Aus', nachname: 'Testerin', geburtsjahr: 2012,
            geschlecht: 'weiblich', verein: 'Frei wählbarer Vereinsname SC',
            altersklasse: 'U15', gewichtsklasse: '-44', judopass_id: 'JP-1',
            lizenz_ablauf: '2099-01-01', startgeld_bezahlt: true, gewicht: 44
        }), res);

        expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
        const row = await knex('turnier_teilnehmer').where({ id: res.body.teilnehmerId }).first();
        expect(row.lizenz_ablauf).toBe('2099-01-01');
        expect(row.startgeld_bezahlt).toBe(1);
    });

    test('Gast-Verein darf beim Anlegen keinen fremden Vereinsnamen eintragen', async () => {
        const res = mockRes();
        await createTeilnehmer(knex, mockReq(gastUserId, {
            turnier_id: turnierId, vorname: 'Fremd', nachname: 'Verein-Versuch', geburtsjahr: 2012,
            geschlecht: 'weiblich', verein: 'Ein ganz anderer Verein',
            altersklasse: 'U15', gewichtsklasse: '-44'
        }), res);

        expect(res.statusCode).toBe(403);
        expect(res.body.error).toContain(gastVereinName);
    });

    test('Gast-Verein (nicht Super-Admin): Lizenz und Startgeld werden beim Anlegen ignoriert, Judopass/Lizenz/Gewicht sind nicht Pflicht', async () => {
        const res = mockRes();
        await createTeilnehmer(knex, mockReq(gastUserId, {
            turnier_id: turnierId, vorname: 'Gast', nachname: 'Testerin', geburtsjahr: 2012,
            geschlecht: 'weiblich', verein: gastVereinName,
            altersklasse: 'U15', gewichtsklasse: '-44',
            // bewusst ohne judopass_id/gewicht -- für Gastvereine keine Pflichtfelder mehr
            lizenz_ablauf: '2099-01-01', startgeld_bezahlt: true
        }), res);

        expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
        gastTeilnehmerId = res.body.teilnehmerId;

        const row = await knex('turnier_teilnehmer').where({ id: gastTeilnehmerId }).first();
        // '1970-01-01' ist der Sentinel-Wert für "keine gültige Lizenz hinterlegt" (siehe
        // createTeilnehmer) -- der vom Gast-Verein gesendete Wert wurde verworfen.
        expect(row.lizenz_ablauf).toBe('1970-01-01');
        expect(row.startgeld_bezahlt).toBe(0);
        expect(row.judopass_id).toBe('');
        expect(row.gewicht).toBe(0);
    });

    test('Gast-Verein-Nutzer mit Super-Admin-Recht: Lizenz und Startgeld werden beim Anlegen übernommen', async () => {
        const res = mockRes();
        await createTeilnehmer(knex, mockReq(gastSuperAdminUserId, {
            turnier_id: turnierId, vorname: 'Super', nachname: 'Admin-Testerin', geburtsjahr: 2012,
            geschlecht: 'weiblich', verein: gastVereinName,
            altersklasse: 'U15', gewichtsklasse: '-44',
            lizenz_ablauf: '2099-01-01', startgeld_bezahlt: true
        }), res);

        expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
        const row = await knex('turnier_teilnehmer').where({ id: res.body.teilnehmerId }).first();
        expect(row.lizenz_ablauf).toBe('2099-01-01');
        expect(row.startgeld_bezahlt).toBe(1);
    });

    test('Ausrichter-Verein kann Lizenz und Startgeld eines Gast-Athleten nachträglich bestätigen', async () => {
        const res = mockRes();
        await updateTeilnehmer(knex, mockReq(ausrichterUserId, {
            lizenz_ablauf: '2099-06-01', startgeld_bezahlt: true
        }, { id: gastTeilnehmerId }), res);

        expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
        const row = await knex('turnier_teilnehmer').where({ id: gastTeilnehmerId }).first();
        expect(row.lizenz_ablauf).toBe('2099-06-01');
        expect(row.startgeld_bezahlt).toBe(1);
    });

    test('Gast-Verein-Nutzer kann die vom Ausrichter bestätigte Lizenz/Startgeld beim Bearbeiten nicht verändern', async () => {
        const res = mockRes();
        await updateTeilnehmer(knex, mockReq(gastUserId, {
            vorname: 'Gast-Geänderter-Vorname',
            lizenz_ablauf: '1900-01-01', startgeld_bezahlt: false
        }, { id: gastTeilnehmerId }), res);

        expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
        const row = await knex('turnier_teilnehmer').where({ id: gastTeilnehmerId }).first();
        // Der eigentlich erlaubte Feldwechsel (vorname) griff, Lizenz/Startgeld blieben trotz
        // gegenteiliger Angabe unverändert auf dem vom Ausrichter bestätigten Stand.
        expect(row.vorname).toBe('Gast-Geänderter-Vorname');
        expect(row.lizenz_ablauf).toBe('2099-06-01');
        expect(row.startgeld_bezahlt).toBe(1);
    });
});
