import sql from "./db.js";

/** Co-mention edges for a single article (after person mentions are saved). */
export async function komentionArtikelErzeugen(artikelId: number): Promise<number> {
    const inserted = await sql`
        INSERT INTO newsletterj_beziehungen (von_typ, von_id, zu_typ, zu_id, relation, quell_artikel_id)
        SELECT
            'person',
            LEAST(e1.person_id, e2.person_id),
            'person',
            GREATEST(e1.person_id, e2.person_id),
            'erwaehnt_zusammen',
            e1.artikel_id
        FROM newsletterj_erwaehnungen e1
        JOIN newsletterj_erwaehnungen e2
            ON e2.artikel_id = e1.artikel_id
            AND e2.person_id > e1.person_id
        WHERE e1.artikel_id = ${artikelId}
        ON CONFLICT DO NOTHING
        RETURNING id
    `;
    return inserted.length;
}
