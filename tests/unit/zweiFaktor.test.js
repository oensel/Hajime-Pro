import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SUPER_ADMIN_2FA;
process.env.JWT_SECRET = 'test-geheimnis-fuer-2fa';

const { starteTestPostgres } = await import('../helpers/testPostgres.js');
const { totpCode, pruefeTotpCode, base32Kodiere, base32Dekodiere, schrittFuer, otpauthUrl } = await import('../../src/utils/totp.js');
const zf = await import('../../src/services/zweiFaktor.js');
const { anmeldungAbschliessen, zweiFaktorPruefen, zweiFaktorEinrichtungStart, zweiFaktorEinrichtungBestaetigen } = await import('../../src/controllers/authController.js');
const { hashPassword } = await import('../../src/utils/password.js');
const jwtDecode = (await import('jsonwebtoken')).default.decode;

// RFC 6238, Anhang B (SHA-1, Geheimnis "12345678901234567890"): die letzten sechs Stellen der Achtstelligen Werte
const RFC_GEHEIMNIS = base32Kodiere(Buffer.from('12345678901234567890'));

test('TOTP: RFC-6238-Testvektoren und Base32', () => {
    assert.deepEqual(base32Dekodiere(RFC_GEHEIMNIS), Buffer.from('12345678901234567890'));
    assert.equal(totpCode(RFC_GEHEIMNIS, Math.floor(59 / 30)), '287082');
    assert.equal(totpCode(RFC_GEHEIMNIS, Math.floor(1111111109 / 30)), '081804');
    assert.equal(totpCode(RFC_GEHEIMNIS, Math.floor(1234567890 / 30)), '005924');
    assert.equal(totpCode(RFC_GEHEIMNIS, Math.floor(20000000000 / 30)), '353130');
    assert.match(otpauthUrl({ geheimnis: 'ABC', konto: 'a@b.de' }), /^otpauth:\/\/totp\/Hajime%20Pro%3Aa%40b\.de\?secret=ABC&issuer=Hajime%20Pro/);
});

test('TOTP: Zeitfenster, Wiederholung und Format', () => {
    const jetzt = 1_700_000_000_000;
    const schritt = schrittFuer(jetzt);
    const code = totpCode(RFC_GEHEIMNIS, schritt);
    assert.deepEqual(pruefeTotpCode(RFC_GEHEIMNIS, code, { zeitMs: jetzt }), { ok: true, schritt });
    assert.deepEqual(pruefeTotpCode(RFC_GEHEIMNIS, ` ${code.slice(0, 3)} ${code.slice(3)} `, { zeitMs: jetzt }), { ok: true, schritt });
    assert.equal(pruefeTotpCode(RFC_GEHEIMNIS, totpCode(RFC_GEHEIMNIS, schritt - 1), { zeitMs: jetzt }).ok, true, 'ein Schritt Uhrabweichung');
    assert.equal(pruefeTotpCode(RFC_GEHEIMNIS, totpCode(RFC_GEHEIMNIS, schritt - 3), { zeitMs: jetzt }).ok, false);
    assert.equal(pruefeTotpCode(RFC_GEHEIMNIS, code, { zeitMs: jetzt, letzterSchritt: schritt }).ok, false, 'kein zweites Mal');
    assert.equal(pruefeTotpCode(RFC_GEHEIMNIS, '12345', { zeitMs: jetzt }).ok, false);
    assert.equal(pruefeTotpCode(RFC_GEHEIMNIS, 'abcdef', { zeitMs: jetzt }).ok, false);
});

test('Geheimnis verschlüsseln und Zwischen-Token', () => {
    const chiffre = zf.verschluessele('GEHEIMNIS');
    assert.notEqual(chiffre, 'GEHEIMNIS');
    assert.equal(zf.entschluessele(chiffre), 'GEHEIMNIS');
    const token = zf.erzeugeZwischenToken('u1', 'pruefen');
    assert.equal(zf.leseZwischenToken(token, 'pruefen'), 'u1');
    assert.equal(zf.leseZwischenToken(token, 'einrichtung'), null, 'falscher Zweck');
    assert.equal(zf.leseZwischenToken('murks', 'pruefen'), null);
});

function antwortAttrappe() {
    return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
}

test('Zwei-Faktor: Einrichtung, Anmeldung, Backup-Codes, Zurücksetzen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        await knex('benutzer').insert([
            { id: 'sa', email: 'sa@test.de', vorname: 'Sa', nachname: 'Admin', password_hash: hashPassword('Passwort-123'), ist_super_admin: true, email_bestaetigt_am: knex.fn.now() },
            { id: 'normal', email: 'normal@test.de', vorname: 'No', nachname: 'Rmal', password_hash: hashPassword('Passwort-123'), email_bestaetigt_am: knex.fn.now() }
        ]);

        // normale Konten sind nicht betroffen, Super-Admins brauchen den zweiten Faktor
        const normal = await anmeldungAbschliessen(knex, await knex('benutzer').where({ id: 'normal' }).first());
        assert.ok(normal.token && !normal.zweiFaktor);
        const ersterLogin = await anmeldungAbschliessen(knex, await knex('benutzer').where({ id: 'sa' }).first());
        assert.equal(ersterLogin.zweiFaktor, 'einrichtung');
        assert.equal(ersterLogin.token, undefined, 'keine Sitzung vor dem zweiten Faktor');

        // Einrichtung über die Endpunkte
        const einrichtungsToken = ersterLogin.zwischenToken;
        let res = antwortAttrappe();
        await zweiFaktorEinrichtungStart(knex, { body: { zwischenToken: 'falsch' } }, res);
        assert.equal(res.statusCode, 401);
        res = antwortAttrappe();
        await zweiFaktorEinrichtungStart(knex, { body: { zwischenToken: einrichtungsToken } }, res);
        assert.equal(res.statusCode, 200);
        const geheimnis = res.body.geheimnis;
        assert.match(res.body.otpauthUrl, /sa%40test\.de/);
        assert.notEqual((await knex('benutzer').where({ id: 'sa' }).first()).totp_secret, geheimnis, 'verschlüsselt gespeichert');

        res = antwortAttrappe();
        await zweiFaktorEinrichtungBestaetigen(knex, { body: { zwischenToken: einrichtungsToken, code: '000000' } }, res);
        assert.equal(res.statusCode, 400);
        const schritt = schrittFuer();
        res = antwortAttrappe();
        await zweiFaktorEinrichtungBestaetigen(knex, { body: { zwischenToken: einrichtungsToken, code: totpCode(geheimnis, schritt) } }, res);
        assert.equal(res.statusCode, 200);
        assert.ok(res.body.token, 'Sitzung nach der Einrichtung');
        // Claim zf: Zeitpunkt der bestandenen 2FA-Prüfung (Unix-Sekunden), für sensible Aktionen kurz danach
        const zfEinrichtung = jwtDecode(res.body.token).zf;
        assert.ok(Number.isInteger(zfEinrichtung) && Math.abs(zfEinrichtung - Date.now() / 1000) < 60);
        assert.equal(jwtDecode(normal.token).zf, undefined, 'ohne 2FA kein zf');
        assert.equal(res.body.backupCodes.length, zf.ANZAHL_BACKUP_CODES);
        assert.match(res.body.backupCodes[0], /^[a-z0-9]{5}-[a-z0-9]{5}$/);
        const backupCodes = res.body.backupCodes;
        const gespeichert = await knex('totp_backup_codes').where({ benutzer_id: 'sa' });
        assert.equal(gespeichert.length, 10);
        assert.ok(gespeichert.every((z) => !backupCodes.some((c) => z.code_hash.includes(c.replace('-', '')))), 'nur Hashes');

        // zweite Einrichtung ist nicht möglich
        res = antwortAttrappe();
        await zweiFaktorEinrichtungStart(knex, { body: { zwischenToken: einrichtungsToken } }, res);
        assert.equal(res.statusCode, 409);

        // Anmeldung mit Code: derselbe Schritt gilt nicht noch einmal
        const zweiterLogin = await anmeldungAbschliessen(knex, await knex('benutzer').where({ id: 'sa' }).first());
        assert.equal(zweiterLogin.zweiFaktor, 'pruefen');
        res = antwortAttrappe();
        await zweiFaktorPruefen(knex, { body: { zwischenToken: zweiterLogin.zwischenToken, code: totpCode(geheimnis, schritt) } }, res);
        assert.equal(res.statusCode, 401, 'Code der Einrichtung ist verbraucht');
        // einen späteren Schritt akzeptieren (Uhr +1 Schritt liegt im Fenster)
        res = antwortAttrappe();
        await zweiFaktorPruefen(knex, { body: { zwischenToken: zweiterLogin.zwischenToken, code: totpCode(geheimnis, schritt + 1) } }, res);
        assert.equal(res.statusCode, 200);
        assert.ok(res.body.token);
        assert.ok(Math.abs(jwtDecode(res.body.token).zf - Date.now() / 1000) < 60);
        assert.equal(res.body.zweiFaktorArt, 'totp');
        assert.equal(res.body.verbleibendeBackupCodes, 10);

        // Zwischen-Token mit falschem Zweck funktioniert nicht
        res = antwortAttrappe();
        await zweiFaktorPruefen(knex, { body: { zwischenToken: einrichtungsToken, code: '123456' } }, res);
        assert.equal(res.statusCode, 401);

        // Backup-Code: einmalig, auch mit anderer Schreibweise
        res = antwortAttrappe();
        await zweiFaktorPruefen(knex, { body: { zwischenToken: zweiterLogin.zwischenToken, code: ` ${backupCodes[0].toUpperCase()} ` } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.zweiFaktorArt, 'backup');
        assert.equal(res.body.verbleibendeBackupCodes, 9);
        res = antwortAttrappe();
        await zweiFaktorPruefen(knex, { body: { zwischenToken: zweiterLogin.zwischenToken, code: backupCodes[0] } }, res);
        assert.equal(res.statusCode, 401, 'Backup-Code nur einmal');

        // Sperre nach fünf Fehlversuchen (auch ein richtiger Code hilft dann nicht mehr)
        for (let i = 0; i < 5; i += 1) await zf.pruefeZweitenFaktor(knex, 'sa', '111111');
        const gesperrt = await zf.pruefeZweitenFaktor(knex, 'sa', backupCodes[1]);
        assert.equal(gesperrt.status, 429);
        zf.vergesseFehlversuche('sa');

        // Aktions-Code: ohne Code abgelehnt, mit Backup-Code erlaubt
        assert.equal((await zf.pruefeCodeFuerAktion(knex, 'sa', '')).status, 403, 'nicht 401: menu.js würde zur Anmeldung leiten');
        assert.equal((await zf.pruefeCodeFuerAktion(knex, 'sa', '000000')).status, 403);
        assert.equal((await zf.pruefeCodeFuerAktion(knex, 'normal', '123456')).status, 403, 'ohne eingerichtete 2FA');
        assert.equal((await zf.pruefeCodeFuerAktion(knex, 'sa', backupCodes[2])).ok, true);

        // Status und neue Backup-Codes (Profil): die alten verfallen, die neuen gelten
        const status = await zf.zweiFaktorStatus(knex, 'sa');
        assert.deepEqual([status.pflicht, status.istSuperAdmin, status.aktiv, status.backupCodesUebrig], [true, true, true, 8]);
        assert.ok(Date.parse(status.aktivSeit) > 0);
        assert.deepEqual(await zf.zweiFaktorStatus(knex, 'normal'), { pflicht: true, istSuperAdmin: false, aktiv: false, aktivSeit: null, backupCodesUebrig: 0 });
        assert.equal(await zf.zweiFaktorStatus(knex, 'gibtsnicht'), null);
        const neueCodes = await zf.erzeugeNeueBackupCodes(knex, 'sa');
        assert.equal(neueCodes.length, 10);
        assert.equal((await zf.zweiFaktorStatus(knex, 'sa')).backupCodesUebrig, 10);
        assert.equal((await zf.pruefeZweitenFaktor(knex, 'sa', backupCodes[3])).ok, false, 'alter Backup-Code ist ungültig');
        assert.equal((await zf.pruefeZweitenFaktor(knex, 'sa', neueCodes[0])).ok, true);
        zf.vergesseFehlversuche('sa');

        // Zurücksetzen: danach wieder Einrichtung
        await zf.setzeZweiFaktorZurueck(knex, 'sa');
        const konto = await knex('benutzer').where({ id: 'sa' }).first();
        assert.deepEqual([konto.totp_secret, konto.totp_aktiv_am, konto.totp_letzter_schritt], [null, null, null]);
        assert.equal((await knex('totp_backup_codes').where({ benutzer_id: 'sa' })).length, 0);
        assert.equal((await anmeldungAbschliessen(knex, konto)).zweiFaktor, 'einrichtung');

        // abgeschaltet (SUPER_ADMIN_2FA=false) gibt es sofort die Sitzung
        process.env.SUPER_ADMIN_2FA = 'false';
        try {
            assert.ok((await anmeldungAbschliessen(knex, konto)).token);
            assert.equal((await zf.pruefeCodeFuerAktion(knex, 'sa', '')).ok, true);
        } finally {
            delete process.env.SUPER_ADMIN_2FA;
        }
    } finally {
        await db.stoppe();
    }
});
