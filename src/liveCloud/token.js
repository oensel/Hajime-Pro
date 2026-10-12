// Ingest-Token des Live-Prozesses (Spec 5.3: in der Cloud sperrbar, optional an ein Turnier gebunden).
// Gespeichert wird nur der SHA-256; das Token selbst wird einmalig beim Erzeugen angezeigt.
import crypto from 'node:crypto';

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function erzeugeToken(knex, { name, turnierKey = null }) {
    const token = `hjl_${crypto.randomBytes(32).toString('hex')}`;
    const [{ id }] = await knex('live_ingest_tokens')
        .insert({ name: String(name || ''), token_hash: hash(token), turnier_key: turnierKey })
        .returning('id');
    return { id, token };
}

export async function pruefeToken(knex, token, { jetzt = () => new Date() } = {}) {
    if (typeof token !== 'string' || token.length < 10 || token.length > 200) return null;
    const zeile = await knex('live_ingest_tokens').where({ token_hash: hash(token) }).whereNull('gesperrt_am').first();
    if (!zeile) return null;
    const jetztZeit = jetzt();
    const grenze = new Date(jetztZeit.getTime() - 60_000);
    await knex('live_ingest_tokens').where({ id: zeile.id })
        .where(function () { this.whereNull('zuletzt_genutzt').orWhere('zuletzt_genutzt', '<', grenze); })
        .update({ zuletzt_genutzt: jetztZeit });
    return { id: zeile.id, turnierKey: zeile.turnier_key };
}

export async function sperreToken(knex, id) {
    const geaendert = await knex('live_ingest_tokens').where({ id }).whereNull('gesperrt_am').update({ gesperrt_am: knex.fn.now() });
    return geaendert > 0;
}

export async function listeTokens(knex) {
    const zeilen = await knex('live_ingest_tokens').orderBy('id');
    return zeilen.map(z => ({
        id: z.id, name: z.name, turnierKey: z.turnier_key,
        erzeugtAm: z.erzeugt_am, gesperrtAm: z.gesperrt_am, zuletztGenutzt: z.zuletzt_genutzt
    }));
}

function option(argv, name) {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
}

export async function fuehreTokenBefehlAus(knex, argv) {
    const [befehl, ...rest] = argv;
    if (befehl === 'erzeugen') {
        const { id, token } = await erzeugeToken(knex, { name: option(rest, '--name'), turnierKey: option(rest, '--turnier') || null });
        return [`Token ${id} erzeugt (wird nur jetzt angezeigt):`, token];
    }
    if (befehl === 'liste') {
        const eintraege = await listeTokens(knex);
        if (!eintraege.length) return ['Keine Token vorhanden.'];
        return eintraege.map(e => `${e.id}\t${e.name}\t${e.turnierKey || 'alle Turniere'}\t${e.gesperrtAm ? 'gesperrt' : 'aktiv'}`);
    }
    if (befehl === 'sperren') {
        const id = Number(rest[0]);
        if (!Number.isInteger(id)) throw new Error('Befehl "sperren" braucht die Token-ID.');
        return [(await sperreToken(knex, id)) ? `Token ${id} gesperrt.` : `Token ${id} nicht gefunden oder schon gesperrt.`];
    }
    throw new Error('Unbekannter Befehl. Verwendung: erzeugen [--name X] [--turnier KEY] | liste | sperren ID');
}
