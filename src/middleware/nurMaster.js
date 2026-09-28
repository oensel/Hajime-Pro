// Server-Cluster: auf dem Secondary (und auf dem Master während einer geplanten Übergabe) sind
// nur Lesezugriffe erlaubt — die relationale DB ist dort ein Hot Standby. Ausgenommen sind die
// Cluster-Steuerung selbst, der Login und die Test-Endpunkte.
const AUSNAHMEN = ['/cluster', '/auth', '/sync/test'];

export function nurMaster(holeCluster) {
    return (req, res, next) => {
        const cluster = holeCluster();
        if (!cluster || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        if (AUSNAHMEN.some(p => req.path.startsWith(p))) return next();
        if (cluster.darfSchreiben()) return next();
        return res.status(409).json({ success: false, error: 'Secondary – nur lesend. Schreibzugriffe sind nur am Master möglich.' });
    };
}
