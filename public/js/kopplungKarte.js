// Karte "Neues Gerät koppeln" auf matten.html (nur Hallen-Server): zeigt den Kopplungscode, den
// ein neu installierter Desktop-Client beim ersten Start abfragt. Erneuern macht den alten Code
// ungültig; bereits gekoppelte Geräte bleiben gekoppelt.
document.addEventListener('DOMContentLoaded', async () => {
    const karte = document.getElementById('kopplungKarte');
    const anzeige = document.getElementById('kopplungCode');
    if (!karte || !anzeige) return;
    const zeige = (code) => { anzeige.textContent = `${code.slice(0, 3)} ${code.slice(3)}`; };

    const resp = await fetch('/api/client/kopplungscode').catch(() => null);
    if (!resp || !resp.ok) return; // kein Hallen-Server oder kein Passwort
    zeige((await resp.json()).code);
    karte.style.display = '';

    document.getElementById('kopplungErneuernBtn').addEventListener('click', async () => {
        const r = await fetch('/api/client/kopplungscode/erneuern', { method: 'POST' });
        if (r.ok) zeige((await r.json()).code);
        else if (window.zeigeNotification) window.zeigeNotification('Code konnte nicht erneuert werden.', 'error');
    });
});
