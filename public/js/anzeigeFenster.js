// Knopf „Anzeige auf TV“ in steuerung.html: öffnet anzeige.html als eigenes Fenster (gleiche Herkunft, der
// BroadcastChannel 'judo_scoreboard' versorgt es). Im Desktop-Client platziert der Hauptprozess das Fenster im Vollbild
// auf dem zweiten Bildschirm (desktop/anzeigeFenster.js); im Browser öffnet sich ein Fenster, das man auf den TV
// zieht und mit F11 bzw. Doppelklick in den Vollbildmodus bringt.
(function () {
    const FENSTER_NAME = 'hajimeAnzeige';
    const knopf = document.getElementById('btnAnzeigeFenster');
    if (!knopf) return;
    knopf.addEventListener('click', () => {
        const fenster = window.open('anzeige.html', FENSTER_NAME, 'popup,width=1280,height=720');
        if (fenster) fenster.focus();
        else alert('Das Anzeige-Fenster wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben.');
    });
})();
