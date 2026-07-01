import type { SuchErgebnis } from "./typen.js";

interface ExaResult {
    title: string;
    url: string;
    publishedDate: string | null;
    summary?: string;
    highlights?: string[];
    text?: string;
}

interface ExaResponse {
    requestId: string;
    results: ExaResult[];
}

export async function exaSuche(
    anfrage: string,
    optionen: { inklusiveDomains?: string[]; anzahl?: number; tageZurueck?: number } = {}
): Promise<SuchErgebnis[]> {
    const { inklusiveDomains, anzahl = 10, tageZurueck = 7 } = optionen;

    const startDatum = new Date();
    startDatum.setDate(startDatum.getDate() - tageZurueck);

    const body: Record<string, unknown> = {
        query: anfrage,
        type: "auto",
        numResults: anzahl,
        startPublishedDate: startDatum.toISOString(),
        contents: { highlights: true, summary: true },
    };

    if (inklusiveDomains && inklusiveDomains.length > 0) {
        body.includeDomains = inklusiveDomains;
    }

    const antwort = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
            "x-api-key": process.env.EXA_API_KEY!,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!antwort.ok) {
        throw new Error(`Exa-Suche fehlgeschlagen: ${antwort.status} ${antwort.statusText}`);
    }

    const daten: ExaResponse = await antwort.json();

    return daten.results.map((r) => ({
        titel: r.title,
        url: r.url,
        ausschnitt: r.summary || r.highlights?.join(" ") || "",
        veroeffentlicht_am: r.publishedDate,
        such_engine: "exa" as const,
        roh_json: r as unknown as Record<string, unknown>,
    }));
}
