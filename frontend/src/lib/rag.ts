import sql from "../db.js";
import { hybrideArtikelSuche, hatEinbettungen } from "./semantik.js";

const RAG_KONTEXT_LIMIT = 8;

export interface RagQuelle {
    nr: number;
    id: number;
    titel: string;
    url: string;
    zusammenfassung: string;
    quellen_name: string | null;
}

interface OpenRouterChatAntwort {
    choices?: Array<{
        message?: { content?: string | null };
        finish_reason?: string;
    }>;
    error?: { message?: string };
}

const SYSTEM_PROMPT = `Du bist «Schulmonitor», ein Recherche-Assistent für Bildungspolitik und Volksschulen im Kanton Zürich.

Regeln:
- Beantworte die Frage ausschliesslich auf Basis der nummerierten Quellen [1], [2], …
- Jede inhaltliche Aussage muss mit mindestens einer Quellenangabe [n] belegt sein.
- Wenn die Quellen die Frage nicht beantworten, sage das klar — erfinde nichts.
- Antworte auf Deutsch, sachlich und präzise (2–8 Absätze je nach Frage).
- Verwende die Zitatform [1] oder [1][2] inline im Text, keine anderen Fussnotenformate.`;

export async function ragKontextLaden(frage: string): Promise<RagQuelle[]> {
    const einbettungenVorhanden = await hatEinbettungen();
    const treffer = await hybrideArtikelSuche(frage, RAG_KONTEXT_LIMIT, einbettungenVorhanden);

    if (treffer.length === 0) return [];

    const ids = treffer.map((t) => t.id);
    const artikel = await sql`
        SELECT a.id, a.titel, a.url, a.zusammenfassung, a.quellen_name
        FROM newsletterj_artikel a
        WHERE a.id = ANY(${ids})
    ` as Array<{
        id: number;
        titel: string | null;
        url: string;
        zusammenfassung: string | null;
        quellen_name: string | null;
    }>;

    const nachId = new Map(artikel.map((a) => [a.id, a]));

    return treffer
        .map((t, index) => {
            const a = nachId.get(t.id);
            if (!a?.zusammenfassung?.trim()) return null;
            return {
                nr: index + 1,
                id: a.id,
                titel: a.titel?.trim() || "Ohne Titel",
                url: a.url,
                zusammenfassung: a.zusammenfassung.trim(),
                quellen_name: a.quellen_name,
            };
        })
        .filter((q): q is RagQuelle => q !== null);
}

function quellenBlock(quellen: RagQuelle[]): string {
    return quellen
        .map((q) => {
            const quelle = q.quellen_name ? `Quelle: ${q.quellen_name}\n` : "";
            return `[${q.nr}] Titel: ${q.titel}\n${quelle}URL: ${q.url}\nZusammenfassung: ${q.zusammenfassung}`;
        })
        .join("\n\n");
}

function llmInhaltExtrahieren(daten: OpenRouterChatAntwort): string {
    if (daten?.error) {
        throw new Error(daten.error.message ?? "OpenRouter Fehler");
    }
    const content = daten?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
        throw new Error("OpenRouter lieferte keine Antwort");
    }
    return content.trim();
}

export async function ragAntwortGenerieren(frage: string, quellen: RagQuelle[]): Promise<string> {
    const modell = process.env.OPENROUTER_MODEL;
    if (!modell) {
        throw new Error("OPENROUTER_MODEL ist nicht konfiguriert");
    }

    const benutzerPrompt = quellen.length === 0
        ? `Frage: ${frage}\n\nEs wurden keine passenden Artikel im Corpus gefunden. Erkläre dem Nutzer kurz, dass keine Quellen vorliegen, und schlage vor, die Frage umzuformulieren oder den Monitor-Lauf zu prüfen.`
        : `Frage: ${frage}\n\nVerfügbare Quellen:\n\n${quellenBlock(quellen)}`;

    const antwort = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: modell,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: benutzerPrompt },
            ],
            max_tokens: 2000,
            temperature: 0.2,
        }),
    });

    if (!antwort.ok) {
        const text = await antwort.text().catch(() => "");
        throw new Error(`OpenRouter fehlgeschlagen: ${antwort.status} ${text.slice(0, 150)}`);
    }

    const daten: OpenRouterChatAntwort = await antwort.json();
    return llmInhaltExtrahieren(daten);
}
