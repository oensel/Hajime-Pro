// Linux (AppImage): legt beim ersten Start einen Startmenü-Eintrag und eine Verknüpfung auf dem
// Schreibtisch an. Der AppImage-Pfad bleibt bei Updates gleich (Datei wird ersetzt), das Symbol
// bleibt also gültig. Fehler sind nie fatal.
import { copyFileSync, chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';

export function richteLinuxIntegrationEin({ appImage, iconQuelle }) {
    try {
        const home = os.homedir();
        const iconZiel = path.join(home, '.local/share/icons/hajime-pro.png');
        mkdirSync(path.dirname(iconZiel), { recursive: true });
        copyFileSync(iconQuelle, iconZiel);
        const inhalt = ['[Desktop Entry]', 'Type=Application', 'Name=Hajime Pro', 'Comment=Judo-Turnier (Waage/Matte)',
            `Exec="${appImage}" --no-sandbox`, `Icon=${iconZiel}`, 'Terminal=false', 'Categories=Utility;', ''].join('\n');
        const menue = path.join(home, '.local/share/applications/hajime-pro.desktop');
        mkdirSync(path.dirname(menue), { recursive: true });
        writeFileSync(menue, inhalt);
        let schreibtisch = path.join(home, 'Desktop');
        try { schreibtisch = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).trim() || schreibtisch; } catch { /* Standard */ }
        if (existsSync(schreibtisch)) {
            const verknuepfung = path.join(schreibtisch, 'hajime-pro.desktop');
            writeFileSync(verknuepfung, inhalt);
            chmodSync(verknuepfung, 0o755);
            try { execFileSync('gio', ['set', verknuepfung, 'metadata::trusted', 'true']); } catch { /* nicht GNOME */ }
        }
    } catch (err) {
        console.warn('[Linux] Desktop-Integration fehlgeschlagen:', err.message);
    }
}
