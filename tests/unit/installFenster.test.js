import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { psText, baueInstallFensterBefehl, baueInstallFensterSkript } from '../../desktop/server/installFenster.js';

const dekodiere = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');

test('psText maskiert einfache Anführungszeichen', () => {
    assert.equal(psText("C:\\Users\\O'Brien\\Hajime Pro\\app.exe"), "'C:\\Users\\O''Brien\\Hajime Pro\\app.exe'");
});

test('Befehl: PowerShell mit -EncodedCommand, Skript enthält Version, Pfad und die zu erwartende PID', () => {
    const { programm, args } = baueInstallFensterBefehl({ version: '1.0.16', exePfad: 'C:\\Programme\\Hajime Pro Server\\Hajime Pro Server.exe', wartePid: 4242 });
    assert.equal(programm, 'powershell.exe');
    assert.ok(args.includes('-NoProfile') && args.includes('-NonInteractive') && args.includes('Bypass'));
    const skript = dekodiere(args);
    assert.match(skript, /Version 1\.0\.16 wird installiert/);
    assert.match(skript, /Get-Process -Id 4242/);
    assert.match(skript, /ExtractAssociatedIcon\('C:\\Programme\\Hajime Pro Server\\Hajime Pro Server\.exe'\)/);
    assert.match(skript, /Style = 'Marquee'/);
    assert.match(skript, /Läuft seit/);
});

test('Skript: ohne gültige PID kein Fenster (sonst bliebe es endlos stehen)', () => {
    assert.throws(() => baueInstallFensterSkript({ version: '1', exePfad: 'x.exe', wartePid: undefined }), /wartePid/);
    assert.throws(() => baueInstallFensterSkript({ version: '1', exePfad: 'x.exe', wartePid: 0 }), /wartePid/);
});

test('Skript: Anführungszeichen in Version und Pfad brechen den PowerShell-Text nicht auf', () => {
    const skript = baueInstallFensterSkript({ version: "1.0.16'; Remove-Item -Recurse C:\\ #", exePfad: "C:\\a'b.exe", wartePid: 7 });
    assert.ok(skript.includes("''; Remove-Item"), 'Anführungszeichen der Version müssen verdoppelt sein');
    assert.ok(skript.includes("C:\\a''b.exe"));
});

// Echter Lauf (nur Windows mit Desktop-Sitzung): das Fenster bleibt offen, solange der wartende Prozess läuft,
// und beendet sich kurz nach dessen Ende.
test('Windows: Fenster-Prozess läuft, bis der wartende Prozess beendet ist', { skip: process.platform !== 'win32' }, async () => {
    const warte = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 6000)'], { stdio: 'ignore' });
    const { programm, args } = baueInstallFensterBefehl({ version: '0.0.0-test', exePfad: process.execPath, wartePid: warte.pid });
    const fenster = spawn(programm, args, { stdio: 'ignore', windowsHide: true });
    let beendet = false;
    fenster.on('exit', () => { beendet = true; });

    await new Promise(r => setTimeout(r, 3500));
    assert.equal(beendet, false, 'das Fenster darf vor dem Ende des wartenden Prozesses nicht schließen');

    await new Promise(resolve => warte.on('exit', resolve));
    for (let i = 0; i < 30 && !beendet; i++) await new Promise(r => setTimeout(r, 500));
    if (!beendet) fenster.kill();
    assert.equal(beendet, true, 'das Fenster muss sich nach dem Ende des wartenden Prozesses schließen');
});
