import sql from "../db.js";
import {
    hybrideArtikelSuche,
    hatEinbettungen,
    semantischeArtikelSuche,
    stichwortArtikelSuche,
    type SemantischerTreffer,
} from "./semantik.js";
import { openRouterChat } from "./openrouter.js";

const RAG_KONTEXT_LIMIT = 8;
const RAG_SEMANTIK_SCHWELLWERT = 0.35;

const STOPWOERTER = new Set([
    "alle", "als", "also", "an", "auch", "auf", "aus", "bei", "bis", "das", "dass",
    "dem", "den", "der", "des", "die", "ein", "eine", "einem", "einen", "einer",
    "eines", "er", "es", "für", "gab", "gibt", "haben", "hat", "hier", "ich",
    "ihr", "ihre", "im", "in", "ist", "kann", "mehr", "mit", "nach", "nicht",
    "noch", "nur", "ob", "oder", "rund", "schon", "sich", "sie", "sind", "über",
    "um", "und", "uns", "vom", "von", "vor", "war", "was", "weg", "weil", "welche",
    "welcher", "welches", "wenn", "wer", "wie", "wird", "wo", "wohl", "zum", "zur",
    "zwar", "zwischen", "frage", "bitte", "gibt", "gab", "sein", "seine", "dieser",
    "diese", "dieses", "damit", "dann", "dort", "hier", "heute", "gestern",
]);

/** Significant terms from a natural-language question for keyword retrieval. */
function ragSuchbegriffe(frage: string): string[] {
    const woerter = frage
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_-]/gu, " ")
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 4 && !STOPWOERTER.has(w));

    return [...new Set(woerter)].sort((a, b) => b.length - a.length).slice(0, 5);
}

async function ragArtikelRetrieval(frage: string, tage = 0): Promise<SemantischerTreffer[]> {
    const einbettungenVorhanden = await hatEinbettungen();
    const ergebnis: SemantischerTreffer[] = [];
    const gesehen = new Set<number>();

    const hinzufuegen = (liste: SemantischerTreffer[]) => {
        for (const t of liste) {
            if (!gesehen.has(t.id)) {
                gesehen.add(t.id);
                ergebnis.push(t);
            }
        }
    };

    // 1. Semantic with lower threshold (RAG tolerates weaker matches)
    if (einbettungenVorhanden) {
        try {
            hinzufuegen(await semantischeArtikelSuche(frage, RAG_KONTEXT_LIMIT, RAG_SEMANTIK_SCHWELLWERT, tage));
        } catch {
            // fall through
        }
    }

    // 2. Standard hybrid search (semantic + keyword for short queries)
    if (ergebnis.length < RAG_KONTEXT_LIMIT) {
        hinzufuegen(await hybrideArtikelSuche(frage, RAG_KONTEXT_LIMIT, einbettungenVorhanden, tage));
    }

    // 3. Keyword on extracted terms — fixes long questions where full-string ILIKE matches nothing
    if (ergebnis.length < RAG_KONTEXT_LIMIT) {
        for (const begriff of ragSuchbegriffe(frage)) {
            if (ergebnis.length >= RAG_KONTEXT_LIMIT) break;
            hinzufuegen(await stichwortArtikelSuche(begriff, 10, tage));
        }
    }

    return ergebnis.slice(0, RAG_KONTEXT_LIMIT);
}

export interface RagQuelle {
    nr: number;
    id: number;
    titel: string;
    url: string;
    zusammenfassung: string;
    quellen_name: string | null;
}

const SYSTEM_PROMPT = `Du bist «Schulmonitor», ein Recherche-Assistent für Bildungspolitik und Volksschulen im Kanton Zürich.

Regeln:
- Beantworte die Frage ausschliesslich auf Basis der nummerierten Quellen [1], [2], …
- Jede inhaltliche Aussage muss mit mindestens einer Quellenangabe [n] belegt sein.
- Wenn die Quellen die Frage nicht beantworten, sage das klar — erfinde nichts.
- Antworte auf Deutsch, sachlich und präzise (2–8 Absätze je nach Frage).
- Verwende die Zitatform [1] oder [1][2] inline im Text, keine anderen Fussnotenformate.`;

export async function ragKontextLaden(frage: string, tage = 0): Promise<RagQuelle[]> {
    const treffer = await ragArtikelRetrieval(frage, tage);

    if (treffer.length === 0) return [];

    const ids = treffer.map((t) => t.id);
    const artikel = await sql`
        SELECT a.id, a.titel, a.url, a.zusammenfassung, a.ausschnitt, a.quellen_name
        FROM newsletterj_artikel a
        WHERE a.id = ANY(${ids})
    ` as Array<{
        id: number;
        titel: string | null;
        url: string;
        zusammenfassung: string | null;
        ausschnitt: string | null;
        quellen_name: string | null;
    }>;

    const nachId = new Map(artikel.map((a) => [a.id, a]));

    const quellen: RagQuelle[] = [];
    for (const t of treffer) {
        const a = nachId.get(t.id);
        if (!a) continue;
        const text = (a.zusammenfassung?.trim() || a.ausschnitt?.trim() || "").slice(0, 2000);
        if (!text) continue;
        quellen.push({
            nr: quellen.length + 1,
            id: a.id,
            titel: a.titel?.trim() || "Ohne Titel",
            url: a.url,
            zusammenfassung: text,
            quellen_name: a.quellen_name,
        });
    }
    return quellen;
}

function quellenBlock(quellen: RagQuelle[]): string {
    return quellen
        .map((q) => {
            const quelle = q.quellen_name ? `Quelle: ${q.quellen_name}\n` : "";
            return `[${q.nr}] Titel: ${q.titel}\n${quelle}URL: ${q.url}\nZusammenfassung: ${q.zusammenfassung}`;
        })
        .join("\n\n");
}

export async function ragAntwortGenerieren(frage: string, quellen: RagQuelle[]): Promise<string> {
    const benutzerPrompt = quellen.length === 0
        ? `Frage: ${frage}\n\nEs wurden keine passenden Artikel im Corpus gefunden. Erkläre dem Nutzer kurz, dass keine Quellen vorliegen, und schlage vor, die Frage umzuformulieren oder den Monitor-Lauf zu prüfen.`
        : `Frage: ${frage}\n\nVerfügbare Quellen:\n\n${quellenBlock(quellen)}`;

    return openRouterChat(SYSTEM_PROMPT, benutzerPrompt, 2000);
}
