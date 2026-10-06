// Update-Entscheidung der Android-App (reine Funktionen, läuft im Browser der App und in Node-Tests): aus der
// version.json des Hallen-Servers (/api/client/version) wird bestimmt, ob es eine NEUERE APK gibt und wo sie liegt.
// Die App folgt dem Server nur nach oben: Android erlaubt kein Downgrade, und eine ältere Server-Version
// (z.B. nach einem Zurückrollen) darf die App nicht in eine Installationsschleife schicken.

// "1.10.2" > "1.9.9": nur reine x.y.z-Versionen, alles andere (Vorabversionen) gilt als nicht vergleichbar.
export function istNeuer(kandidat, aktuell) {
    const teile = (v) => {
        const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
        return m ? m.slice(1).map(Number) : null;
    };
    const a = teile(kandidat);
    const b = teile(aktuell);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

/**
 * @returns {{version: string, datei: string, sha256: string, pfad: string} | null}
 *   pfad: relativ zum Server (/downloads/<version>/<datei>)
 */
export function waehleAndroidUpdate({ versionJson, appVersion }) {
    if (!versionJson || !istNeuer(versionJson.version, appVersion)) return null;
    const eintrag = versionJson.dateien && versionJson.dateien.android && versionJson.dateien.android.installieren;
    if (!eintrag || !eintrag.datei || !/^[0-9a-f]{64}$/i.test(eintrag.sha256 || '')) return null;
    return {
        version: versionJson.version,
        datei: eintrag.datei,
        sha256: eintrag.sha256,
        pfad: `/downloads/${encodeURIComponent(versionJson.version)}/${encodeURIComponent(eintrag.datei)}`
    };
}
