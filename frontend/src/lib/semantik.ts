import sql from "../db.js";

const EMBEDDING_DIMENSIONS = 1536;
const STANDARD_EMBEDDING_MODEL = "openai/text-embedding-3-small";

function vektorLiteral(embedding: number[]): string {
    return `[${embedding.join(",")}]`;
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
    similarity: number;
}

export async function semantischeArtikelSuche(
    query: string,
    limit = 20,
    minSimilarity = 0.55
): Promise<SemantischerTreffer[]> {
    const embedding = await einbettungErzeugen(query);
    const literal = vektorLiteral(embedding);

    const treffer = await sql`
        SELECT s.*, g.name as gemeinde_name
        FROM newsletterj_semantische_suche(
            ${literal}::vector(1536),
            ${limit},
            ${minSimilarity}
        ) s
        LEFT JOIN newsletterj_gemeinden g ON g.id = s.gemeinde_id
    ` as SemantischerTreffer[];

    return treffer;
}

export async function hatEinbettungen(): Promise<boolean> {
    const [row] = await sql`
        SELECT EXISTS(SELECT 1 FROM newsletterj_artikel WHERE embedding IS NOT NULL) as vorhanden
    ` as unknown as [{ vorhanden: boolean }];
    return Boolean(row?.vorhanden);
}
