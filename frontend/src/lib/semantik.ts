import sql from "../db.js";

const EMBEDDING_DIMENSIONS = 1536;
const STANDARD_EMBEDDING_MODEL = "openai/text-embedding-3-small";

const SEMANTISCH_SCHWELLWERT_LANG = 0.35;
const SEMANTISCH_SCHWELLWERT_KURZ = 0.2;

function vektorLiteral(embedding: number[]): string {
    return `[${embedding.join(",")}]`;
}

function queryWoerterAnzahl(query: string): number {
    return query.trim().split(/\s+/).filter(Boolean).length;
}

function semantikSchwellwert(query: string): number {
    return queryWoerterAnzahl(query) <= 2 ? SEMANTISCH_SCHWELLWERT_KURZ : SEMANTISCH_SCHWELLWERT_LANG;
}

async function einbettungErzeugen(text: string): Promise<number[]> {
    const modell = process.env.OPENROUTER_EMBEDDING_MODEL || STANDARD_EMBEDDING_MODEL;
    const antwort = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: modell, input: text }),
    });

    if (!antwort.ok) {
        throw new Error(`Embeddings fehlgeschlagen: ${antwort.status}`);
    }

    const daten = (await antwort.json()) as { data?: Array<{ embedding?: number[] }> };
    const embedding = daten.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error("Ungültiges Embedding");
    }
    return embedding;
}

export interface SemantischerTreffer {
    id: number;
    titel: string | null;
    gemeinde_id: number | null;
    gemeinde_name?: string | null;
    kategorie: string | null;
    relevanz: string;
    gesucht_am: Date;
    similarity: number | null;
    match_typ: "semantisch" | "stichwort";
}

export async function semantischeArtikelSuche(
    query: string,
    limit = 20,
    minSimilarity = SEMANTISCH_SCHWELLWERT_LANG,
    tage = 0
): Promise<SemantischerTreffer[]> {
    const embedding = await einbettungErzeugen(query);
    const literal = vektorLiteral(embedding);

    const treffer = await sql`
        SELECT a.id, a.titel, a.gemeinde_id, g.name as gemeinde_name,
            a.kategorie, a.relevanz, a.gesucht_am,
            (1 - (a.embedding <=> ${literal}::vector(1536)))::real AS similarity
        FROM newsletterj_artikel a
        LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
        WHERE a.embedding IS NOT NULL
          AND (${tage}::int = 0 OR COALESCE(a.veroeffentlicht_am, a.gesucht_am) > NOW() - make_interval(days => ${tage}))
          AND (1 - (a.embedding <=> ${literal}::vector(1536))) >= ${minSimilarity}
        ORDER BY a.embedding <=> ${literal}::vector(1536)
        LIMIT ${limit}
    ` as Array<Omit<SemantischerTreffer, "match_typ">>;

    return treffer.map((t) => ({ ...t, match_typ: "semantisch" as const }));
}

/** Keyword search — matches Artikel filter fields + Kategorie slug. */
export async function stichwortArtikelSuche(query: string, limit = 20, tage = 0): Promise<SemantischerTreffer[]> {
    const muster = `%${query}%`;
    const kategorieSlug = query.trim().toLowerCase().replace(/\s+/g, "_");

    const treffer = await sql`
        SELECT a.id, a.titel, a.gemeinde_id, g.name as gemeinde_name,
            a.kategorie, a.relevanz, a.gesucht_am
        FROM newsletterj_artikel a
        LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
        WHERE (${tage}::int = 0 OR COALESCE(a.veroeffentlicht_am, a.gesucht_am) > NOW() - make_interval(days => ${tage}))
          AND (a.titel ILIKE ${muster}
           OR a.zusammenfassung ILIKE ${muster}
           OR a.ausschnitt ILIKE ${muster}
           OR a.schule ILIKE ${muster}
           OR a.kategorie = ${kategorieSlug}
           OR ${kategorieSlug} = ANY(a.kategorien))
        ORDER BY COALESCE(a.veroeffentlicht_am, a.gesucht_am) DESC
        LIMIT ${limit}
    ` as Array<{
        id: number;
        titel: string | null;
        gemeinde_id: number | null;
        gemeinde_name: string | null;
        kategorie: string | null;
        relevanz: string;
        gesucht_am: Date;
    }>;

    return treffer.map((t) => ({
        ...t,
        similarity: null,
        match_typ: "stichwort" as const,
    }));
}

/**
 * Semantic search with adaptive threshold; supplements with keyword matches
 * when the query is short, semantic results are sparse, or vector search returns nothing.
 */
export async function hybrideArtikelSuche(
    query: string,
    limit = 20,
    einbettungenVorhanden: boolean,
    tage = 0
): Promise<SemantischerTreffer[]> {
    const istKurz = queryWoerterAnzahl(query) <= 2;
    const ergebnis: SemantischerTreffer[] = [];
    const gesehen = new Set<number>();

    if (einbettungenVorhanden) {
        try {
            const schwellwert = semantikSchwellwert(query);
            const semantisch = await semantischeArtikelSuche(query, limit, schwellwert, tage);
            for (const t of semantisch) {
                if (!gesehen.has(t.id)) {
                    gesehen.add(t.id);
                    ergebnis.push(t);
                }
            }
        } catch {
            // Embedding API failed — fall through to keyword search
        }
    }

    const brauchtStichwort =
        !einbettungenVorhanden ||
        ergebnis.length === 0 ||
        istKurz ||
        ergebnis.length < limit;

    if (brauchtStichwort && ergebnis.length < limit) {
        const rest = limit - ergebnis.length;
        const stichwort = await stichwortArtikelSuche(query, rest + 10, tage);
        for (const t of stichwort) {
            if (!gesehen.has(t.id) && ergebnis.length < limit) {
                gesehen.add(t.id);
                ergebnis.push(t);
            }
        }
    }

    return ergebnis;
}

export async function hatEinbettungen(): Promise<boolean> {
    const [row] = await sql`
        SELECT EXISTS(SELECT 1 FROM newsletterj_artikel WHERE embedding IS NOT NULL) as vorhanden
    ` as unknown as [{ vorhanden: boolean }];
    return Boolean(row?.vorhanden);
}
