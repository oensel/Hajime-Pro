// Anzeige der voraussichtlichen Uhrzeit ("ca. 11:20") in den Listen kommender Kämpfe.
// Klassisches Script (kampf.js ist kein Modul); die Zeit selbst liefert baueMattenAnsicht als
// `voraussichtlich_um` (ms seit Epoch), siehe src/shared/zeitPrognose.js.
window.ZeitAnzeige = {
    format(ms) {
        if (ms == null || !Number.isFinite(Number(ms))) return '';
        return 'ca. ' + new Date(Number(ms)).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
};
