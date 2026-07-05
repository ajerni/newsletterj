import sql from "./db.js";
import type { ArtikelExtraktion } from "./typen.js";

export const EMBEDDING_DIMENSIONS = 1536;

const STANDARD_EMBEDDING_MODEL = "openai/text-embedding-3-small";

function embeddingModell(): string {
    return process.env.OPENROUTER_EMBEDDING_MODEL || STANDARD_EMBEDDING_MODEL;
}

/** Text used for embedding — title, summary, categories, location. */
export function einbettungsTextErstellen(
    extraktion: Pick<
        ArtikelExtraktion,
        "titel" | "zusammenfassung" | "kategorie" | "kategorien" | "schule" | "kontext_bezug"
    >,
    gemeindeName: string | null
): string {
    const teile = [
        extraktion.titel,
        extraktion.zusammenfassung,
        gemeindeName ? `Gemeinde: ${gemeindeName}` : null,
        extraktion.schule ? `Schule: ${extraktion.schule}` : null,
        extraktion.kategorie ? `Kategorie: ${extraktion.kategorie}` : null,
        extraktion.kategorien?.length ? `Themen: ${extraktion.kategorien.join(", ")}` : null,
        extraktion.kontext_bezug ? `Kontext: ${extraktion.kontext_bezug}` : null,
    ].filter((t): t is string => typeof t === "string" && t.trim().length > 0);

    return teile.join("\n").slice(0, 8000);
}

function vektorLiteral(embedding: number[]): string {
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Embedding hat ${embedding.length} Dimensionen, erwartet ${EMBEDDING_DIMENSIONS}`);
    }
    return `[${embedding.join(",")}]`;
}

export async function einbettungErzeugen(text: string): Promise<number[]> {
    const antwort = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: embeddingModell(),
            input: text,
        }),
    });

    if (!antwort.ok) {
        const fehlerText = await antwort.text().catch(() => "");
        throw new Error(`OpenRouter Embeddings fehlgeschlagen: ${antwort.status} ${fehlerText.slice(0, 200)}`);
    }

    const daten = (await antwort.json()) as {
        data?: Array<{ embedding?: number[] }>;
        error?: { message?: string };
    };

    if (daten.error) {
        throw new Error(`OpenRouter Embeddings Fehler: ${daten.error.message ?? "unbekannt"}`);
    }

    const embedding = daten.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error("OpenRouter lieferte kein Embedding");
    }

    return embedding;
}

export async function artikelEinbettungSpeichern(artikelId: number, embedding: number[]): Promise<void> {
    const literal = vektorLiteral(embedding);
    await sql`
        UPDATE newsletterj_artikel
        SET embedding = ${literal}::vector(1536)
        WHERE id = ${artikelId}
    `;
}

export interface AehnlicherArtikel {
    id: number;
    titel: string | null;
    gemeinde_id: number | null;
    kategorie: string | null;
    similarity: number;
}

export async function aehnlicheArtikelFinden(
    embedding: number[],
    ausserId: number,
    gemeindeId: number | null,
    limit = 8,
    minSimilarity = 0.65
): Promise<AehnlicherArtikel[]> {
    const literal = vektorLiteral(embedding);
    const rows = await sql`
        SELECT * FROM newsletterj_aehnliche_artikel(
            ${literal}::vector(1536),
            ${ausserId},
            ${gemeindeId},
            ${limit},
            ${minSimilarity}
        )
    ` as AehnlicherArtikel[];
    return rows;
}

export interface SemantischerTreffer {
    id: number;
    titel: string | null;
    gemeinde_id: number | null;
    kategorie: string | null;
    relevanz: string;
    gesucht_am: Date;
    similarity: number;
}

export async function semantischeSuche(
    embedding: number[],
    limit = 20,
    minSimilarity = 0.55
): Promise<SemantischerTreffer[]> {
    const literal = vektorLiteral(embedding);
    const rows = await sql`
        SELECT * FROM newsletterj_semantische_suche(
            ${literal}::vector(1536),
            ${limit},
            ${minSimilarity}
        )
    ` as SemantischerTreffer[];
    return rows;
}

export async function artikelEinbettungVerarbeiten(
    artikelId: number,
    extraktion: ArtikelExtraktion,
    gemeindeName: string | null
): Promise<number[]> {
    const text = einbettungsTextErstellen(extraktion, gemeindeName);
    const embedding = await einbettungErzeugen(text);
    await artikelEinbettungSpeichern(artikelId, embedding);
    return embedding;
}
