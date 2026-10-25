// Wahl zwischen Hallen-Server und Cloud beim Start eines Client-Geräts (Desktop-Client, Android-App), Spec
// docs/superpowers/specs/2026-10-24-cloud-live-betrieb-design.md: Ein Hallen-Server im WLAN ist der bevorzugte Weg und wird ohne
// Rückfrage genommen. Gibt es keinen, aber das Gerät ist mit einem Cloud-Turnier gekoppelt, fragt es den Benutzer, ob es sich mit der
// Cloud verbinden soll — nie ohne Rückfrage, denn ein Turnier läuft entweder am Hallen-Server oder in der Cloud. Rein, ohne Electron/DOM.

/**
 * @param {{ hallenServerErreichbar: boolean, cloud: ({ serverUrl: string, secret: string } | null), frageCloud: () => Promise<boolean> }} eingabe
 * @returns {Promise<'hallenserver' | 'cloud' | 'keiner'>} 'keiner': das Gerät arbeitet mit seinem lokalen Stand weiter und sucht neu
 */
export async function waehleServer({ hallenServerErreichbar, cloud, frageCloud }) {
    if (hallenServerErreichbar) return 'hallenserver';
    if (!cloud || !cloud.serverUrl || !cloud.secret) return 'keiner';
    return (await frageCloud()) ? 'cloud' : 'keiner';
}
