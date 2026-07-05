import sql from "./db.js";
import { SYMMETRISCHE_RELATIONEN } from "../config/relationen.js";
import type { RelationTyp } from "../config/relationen.js";
import { nameNormalisieren } from "./personen.js";

export interface ExpliziteBeziehung {
    von: string;
    zu: string;
    relation: RelationTyp;
}

/** Persist LLM-extracted Person↔Person relations for one article. */
export async function expliziteRelationenErzeugen(
    artikelId: number,
    beziehungen: ExpliziteBeziehung[],
    personIds: Map<string, number>
): Promise<number> {
    if (beziehungen.length === 0) return 0;

    let inserted = 0;

    for (const b of beziehungen) {
        const vonId = personIds.get(nameNormalisieren(b.von));
        const zuId = personIds.get(nameNormalisieren(b.zu));
        if (!vonId || !zuId || vonId === zuId) continue;

        let vonTyp = "person";
        let von = vonId;
        let zuTyp = "person";
        let zu = zuId;

        if (SYMMETRISCHE_RELATIONEN.has(b.relation)) {
            von = Math.min(vonId, zuId);
            zu = Math.max(vonId, zuId);
        }

        const rows = await sql`
            INSERT INTO newsletterj_beziehungen (von_typ, von_id, zu_typ, zu_id, relation, quell_artikel_id)
            VALUES (${vonTyp}, ${von}, ${zuTyp}, ${zu}, ${b.relation}, ${artikelId})
            ON CONFLICT DO NOTHING
            RETURNING id
        `;
        inserted += rows.length;
    }

    return inserted;
}

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
