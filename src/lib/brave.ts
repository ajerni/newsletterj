import type { SuchErgebnis } from "./typen.js";

interface BraveWebResult {
    title: string;
    url: string;
    description: string;
    age?: string;
    page_age?: string;
}

interface BraveResponse {
    web?: { results: BraveWebResult[] };
}

export async function braveSuche(
    anfrage: string,
    optionen: { anzahl?: number; aktualitaet?: "pd" | "pw" | "pm" } = {}
): Promise<SuchErgebnis[]> {
    const { anzahl = 10, aktualitaet = "pw" } = optionen;

    const params = new URLSearchParams({
        q: anfrage,
        count: String(anzahl),
        freshness: aktualitaet,
        country: "CH",
        search_lang: "de",
        text_decorations: "false",
    });

    const antwort = await fetch(
        `https://api.search.brave.com/res/v1/web/search?${params}`,
        {
            headers: {
                "X-Subscription-Token": process.env.BRAVE_API_KEY!,
                Accept: "application/json",
            },
        }
    );

    if (!antwort.ok) {
        throw new Error(`Brave-Suche fehlgeschlagen: ${antwort.status} ${antwort.statusText}`);
    }

    const daten: BraveResponse = await antwort.json();

    return (daten.web?.results ?? []).map((r) => ({
        titel: r.title,
        url: r.url,
        ausschnitt: r.description,
        veroeffentlicht_am: r.page_age || null,
        such_engine: "brave" as const,
        roh_json: r as unknown as Record<string, unknown>,
    }));
}
