// CouchDB-Äquivalent zu turnierHatEchteKaempfe (src/controllers/poolController.js): true,
// sobald irgendein Pool dieses Turniers einen Kampf mit Status 'gestartet' oder 'beendet'
// hat. Solange Pools/Kämpfe für den Offline-Betrieb noch nicht nach CouchDB migriert sind
// (spätere Schritte dieses Cutovers), liefert das für JEDES heute existierende
// Offline-Turnier korrekt false -- die Turnier-Datenbank enthält dann schlicht noch keine
// Pool-/Kampf-Dokumente. Sobald die Migration diese Dokumente dort ablegt, wird diese
// Prüfung ohne Codeänderung automatisch wahr.
export async function pruefeHatEchteKaempfe(poolsRepository, kaempfeRepository) {
    const pools = await poolsRepository.findAll();
    for (const pool of pools) {
        const kaempfe = await kaempfeRepository.findByPool(pool._id);
        if (kaempfe.some((k) => k.status === 'gestartet' || k.status === 'beendet')) {
            return true;
        }
    }
    return false;
}
