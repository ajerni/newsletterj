import {
    fallErstellen,
    fallAktualisieren,
    fallArtikelVerknuepfen,
    fallEreignisVerknuepfen,
    artikelBezugErstellen,
    faelleFuerGemeindeLaden,
    faelleFuerArtikelLaden,
    faelleFuerArtikelIdsLaden,
    gemeindeNameLaden,
} from "./db.js";
import { aehnlicheArtikelFinden } from "./embeddings.js";
import type { ArtikelExtraktion } from "./typen.js";
import type { Kategorie, Relevanz } from "../config/kategorien.js";
import { llmJsonParsen, llmInhaltExtrahieren } from "./json.js";
import type { OpenRouterChatAntwort } from "./json.js";

interface FallThreadingErgebnis {
    aktion: "neuer_fall" | "bestehender_fall" | "kein_fall";
    fall_id: number | null;
    neuer_fall: { titel: string; beschreibung: string } | null;
    bezug_artikel: Array<{
        artikel_id: number;
        typ: "kontext" | "folge" | "widerspruch";
    }>;
    begruendung: string;
}

export interface FallVerarbeitungErgebnis {
    fall_id: number | null;
    fall_neu: boolean;
    bezuege_erstellt: number;
}

async function kiFallThreadingAnfrage(prompt: string): Promise<FallThreadingErgebnis | null> {
    for (let versuch = 1; versuch <= 2; versuch++) {
        try {
            const antwort = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: process.env.OPENROUTER_MODEL,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 2000,
                    temperature: 0.1,
                    response_format: { type: "json_object" },
                }),
            });

            if (!antwort.ok) {
                throw new Error(`OpenRouter fehlgeschlagen: ${antwort.status}`);
            }

            const daten: OpenRouterChatAntwort = await antwort.json();
            const ergebnis = llmJsonParsen<FallThreadingErgebnis>(llmInhaltExtrahieren(daten));

            const aktion = ergebnis.aktion;
            if (aktion !== "neuer_fall" && aktion !== "bestehender_fall" && aktion !== "kein_fall") {
                return null;
            }

            return {
                aktion,
                fall_id: typeof ergebnis.fall_id === "number" ? ergebnis.fall_id : null,
                neuer_fall: ergebnis.neuer_fall ?? null,
                bezug_artikel: Array.isArray(ergebnis.bezug_artikel) ? ergebnis.bezug_artikel : [],
                begruendung: typeof ergebnis.begruendung === "string" ? ergebnis.begruendung : "",
            };
        } catch {
            if (versuch < 2) await new Promise((r) => setTimeout(r, 1000));
        }
    }
    return null;
}

function fallThreadingPrompt(
    extraktion: ArtikelExtraktion,
    artikelId: number,
    gemeindeName: string | null,
    kandidaten: Array<{ id: number; titel: string | null; similarity: number; faelle: Array<{ id: number; titel: string }> }>,
    aktiveFaelle: Array<{ id: number; titel: string; beschreibung: string | null; artikel_anzahl: number }>
): string {
    return `Du ordnest Medienberichte zu Bildungsthemen im Kanton Zürich laufenden Fällen (Story-Threads) zu.

Neuer Artikel (ID ${artikelId}):
- Titel: ${extraktion.titel}
- Zusammenfassung: ${extraktion.zusammenfassung}
- Kategorie: ${extraktion.kategorie}
- Gemeinde: ${gemeindeName ?? "unbekannt"}
- Schule: ${extraktion.schule ?? "—"}
- Kontextbezug: ${extraktion.kontext_bezug ?? "—"}

Semantisch ähnliche frühere Artikel:
${kandidaten.length === 0 ? "(keine)" : kandidaten.map((k) =>
    `- ID ${k.id}: "${k.titel}" (Ähnlichkeit ${(k.similarity * 100).toFixed(0)}%)${k.faelle.length ? ` → Fall: ${k.faelle.map((f) => `#${f.id} "${f.titel}"`).join(", ")}` : ""}`
).join("\n")}

Aktive Fälle in derselben Gemeinde:
${aktiveFaelle.length === 0 ? "(keine)" : aktiveFaelle.map((f) =>
    `- Fall #${f.id}: "${f.titel}" (${f.artikel_anzahl} Artikel)${f.beschreibung ? ` — ${f.beschreibung.slice(0, 150)}` : ""}`
).join("\n")}

Regeln:
- Ein Fall = eine zusammenhängende Situation (Konflikt, Bauprojekt, Führungswechsel-Kette, Gerichtsverfahren …) über mehrere Berichte.
- Ordne zu einem bestehenden Fall zu, wenn der neue Artikel dieselbe Situation fortsetzt.
- Erstelle einen neuen Fall nur bei klarer zusammenhängender Story mit mindestens einem Bezugsartikel ODER starkem Kontextbezug.
- "kein_fall" wenn der Artikel isoliert / allgemein / ohne Story-Bezug ist.
- bezug_artikel: explizite inhaltliche Verknüpfungen zu früheren Artikel-IDs (nur aus der Kandidatenliste).

Antworte mit JSON:
{
  "aktion": "neuer_fall" | "bestehender_fall" | "kein_fall",
  "fall_id": number | null,
  "neuer_fall": { "titel": "...", "beschreibung": "..." } | null,
  "bezug_artikel": [{ "artikel_id": number, "typ": "kontext" | "folge" | "widerspruch" }],
  "begruendung": "kurze Begründung"
}`;
}

export async function fallThreadingVerarbeiten(
    artikelId: number,
    extraktion: ArtikelExtraktion,
    gemeindeId: number | null,
    embedding: number[],
    ereignisIds: number[] = []
): Promise<FallVerarbeitungErgebnis> {
    const gemeindeName = gemeindeId ? await gemeindeNameLaden(gemeindeId) : null;
    const kandidaten = await aehnlicheArtikelFinden(embedding, artikelId, gemeindeId, 8, 0.65);

    const fallZuordnungen = await faelleFuerArtikelIdsLaden(kandidaten.map((k) => k.id));
    const kandidatenMitFaellen = kandidaten.map((k) => ({
        ...k,
        faelle: fallZuordnungen.get(k.id) ?? [],
    }));

    const aktiveFaelle = gemeindeId
        ? await faelleFuerGemeindeLaden(gemeindeId, "aktiv", 15)
        : [];

    // Skip LLM if no candidates and no kontext_bezug — isolated article
    const hatKontext = Boolean(extraktion.kontext_bezug?.trim()) || kandidaten.length > 0;
    if (!hatKontext) {
        return { fall_id: null, fall_neu: false, bezuege_erstellt: 0 };
    }

    const prompt = fallThreadingPrompt(extraktion, artikelId, gemeindeName, kandidatenMitFaellen, aktiveFaelle);
    const ergebnis = await kiFallThreadingAnfrage(prompt);

    if (!ergebnis) {
        return { fall_id: null, fall_neu: false, bezuege_erstellt: 0 };
    }

    let fallId: number | null = null;
    let fallNeu = false;

    if (ergebnis.aktion === "bestehender_fall" && ergebnis.fall_id) {
        fallId = ergebnis.fall_id;
        await fallAktualisieren(fallId, {
            relevanz: extraktion.relevanz,
            hauptkategorie: extraktion.kategorie,
        });
    } else if (ergebnis.aktion === "neuer_fall" && ergebnis.neuer_fall?.titel) {
        fallId = await fallErstellen({
            titel: ergebnis.neuer_fall.titel,
            beschreibung: ergebnis.neuer_fall.beschreibung ?? null,
            gemeinde_id: gemeindeId,
            schule: extraktion.schule,
            hauptkategorie: extraktion.kategorie as Kategorie,
            relevanz: extraktion.relevanz as Relevanz,
        });
        fallNeu = true;
    }

    if (fallId) {
        const topSimilarity = kandidaten.find((k) =>
            ergebnis.bezug_artikel.some((b) => b.artikel_id === k.id)
        )?.similarity ?? kandidaten[0]?.similarity ?? null;

        await fallArtikelVerknuepfen(fallId, artikelId, topSimilarity, ergebnis.begruendung || null);

        for (const ereignisId of ereignisIds) {
            await fallEreignisVerknuepfen(fallId, ereignisId);
        }
    }

    let bezuegeErstellt = 0;
    const similarityMap = new Map(kandidaten.map((k) => [k.id, k.similarity]));

    for (const bezug of ergebnis.bezug_artikel) {
        if (bezug.artikel_id === artikelId) continue;
        const typ = bezug.typ === "folge" || bezug.typ === "widerspruch" ? bezug.typ : "kontext";
        await artikelBezugErstellen(
            artikelId,
            bezug.artikel_id,
            similarityMap.get(bezug.artikel_id) ?? null,
            typ
        );
        bezuegeErstellt++;
    }

    // Auto-link top similar candidate when LLM assigned a case but no explicit bezuege
    if (fallId && bezuegeErstellt === 0 && kandidaten.length > 0 && kandidaten[0].similarity >= 0.72) {
        await artikelBezugErstellen(artikelId, kandidaten[0].id, kandidaten[0].similarity, "kontext");
        bezuegeErstellt++;
    }

    return { fall_id: fallId, fall_neu: fallNeu, bezuege_erstellt: bezuegeErstellt };
}

export { faelleFuerArtikelLaden };
