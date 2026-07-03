import sql from "../db.js";

const TABLE_LABELS: Record<string, string> = {
    newsletterj_artikel: "Artikeln",
    newsletterj_personen: "Personen",
    newsletterj_personen_funktionen: "Personen-Funktionen",
    newsletterj_erwaehnungen: "Erwähnungen",
    newsletterj_organisationen: "Organisationen",
    newsletterj_org_erwaehnungen: "Org-Erwähnungen",
    newsletterj_ereignisse: "Ereignissen",
    newsletterj_laeufe: "Läufen",
    newsletterj_gemeinden: "Gemeinden",
};

interface PostgresError {
    code?: string;
    detail?: string;
    message?: string;
}

export function friendlyDbError(err: unknown): string {
    if (!(err instanceof Error)) return "Unbekannter Fehler";

    const pg = err as PostgresError;
    if (pg.code === "23503") {
        const match = pg.detail?.match(/table "([^"]+)"/);
        const table = match?.[1];
        const label = table ? (TABLE_LABELS[table] ?? table) : "anderen Datensätzen";
        return `Löschen nicht möglich: Der Datensatz wird noch von ${label} referenziert. Bitte zuerst die verknüpften Einträge entfernen oder die Referenz aufheben.`;
    }
    if (pg.code === "23505") {
        return "Eintrag existiert bereits (eindeutiger Wert doppelt).";
    }

    return err.message;
}

async function gemeindeDeleteBlockers(id: number): Promise<string | null> {
    const [counts] = await sql`
        SELECT
            (SELECT COUNT(*)::int FROM newsletterj_artikel WHERE gemeinde_id = ${id}) as artikel,
            (SELECT COUNT(*)::int FROM newsletterj_personen WHERE aktuelle_gemeinde_id = ${id}) as personen,
            (SELECT COUNT(*)::int FROM newsletterj_personen_funktionen WHERE gemeinde_id = ${id}) as personen_funktionen,
            (SELECT COUNT(*)::int FROM newsletterj_organisationen WHERE gemeinde_id = ${id}) as organisationen,
            (SELECT COUNT(*)::int FROM newsletterj_ereignisse WHERE gemeinde_id = ${id}) as ereignisse
    ` as [{ artikel: number; personen: number; personen_funktionen: number; organisationen: number; ereignisse: number }];

    const teile: string[] = [];
    if (counts.artikel > 0) teile.push(`${counts.artikel} Artikel`);
    if (counts.personen > 0) teile.push(`${counts.personen} Personen`);
    if (counts.personen_funktionen > 0) teile.push(`${counts.personen_funktionen} Personen-Funktionen`);
    if (counts.organisationen > 0) teile.push(`${counts.organisationen} Organisationen`);
    if (counts.ereignisse > 0) teile.push(`${counts.ereignisse} Ereignisse`);

    if (teile.length === 0) return null;
    return `Löschen nicht möglich: Diese Gemeinde ist noch verknüpft mit ${teile.join(", ")}. Bitte zuerst die Referenzen entfernen.`;
}

export async function assertDeletable(key: string, id: number): Promise<void> {
    if (key === "gemeinden") {
        const msg = await gemeindeDeleteBlockers(id);
        if (msg) throw new Error(msg);
    }
}
