// CouchDB reserviert alle mit _ beginnenden Feldnamen für sich selbst (_id, _rev, _deleted,
// _attachments, _conflicts, _revisions, _local_seq, ...) -- ungefiltert übernommene Nutzerdaten
// könnten sonst z.B. per _deleted: true das Dokument beim nächsten Insert löschen
// (Mass-Assignment). Eine Blacklist auf das _-Präfix statt einzelner Feldnamen, da CouchDB
// jederzeit neue reservierte Felder einführen kann.
export function stripReservedFields(data) {
    return Object.fromEntries(
        Object.entries(data).filter(([key]) => !key.startsWith('_'))
    );
}
