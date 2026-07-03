import type { ArtikelExtraktion } from "./typen.js";
import { KATEGORIEN, RELEVANZ_STUFEN, ORG_TYPEN } from "../config/kategorien.js";
import type { Kategorie, Relevanz, OrgTyp } from "../config/kategorien.js";
import { llmJsonParsen } from "./json.js";

const SYSTEM_PROMPT = `Du bist ein professioneller Investigativ-Rechercheur und Medienanalyst mit Schwerpunkt Bildungspolitik, Volksschulen und öffentliche Verwaltung im Kanton Zürich, Schweiz.

Analysiere den folgenden Medienbeitrag und extrahiere strukturierte Informationen. Antworte ausschliesslich mit einem JSON-Objekt im folgenden Format:

{
  "zusammenfassung": "3-10 Sätze Zusammenfassung",
  "kategorie": "hauptkategorie",
  "kategorien": ["alle", "zutreffenden", "kategorien"],
  "relevanz": "hoch|mittel|tief",
  "gemeinde": "Name der Gemeinde oder null",
  "schule": "Name der Schule oder null",
  "auswirkungen": "Mögliche Auswirkungen oder null",
  "kontext_bezug": "Bezug zu früheren Ereignissen oder null",
  "personen": [{"name": "...", "funktion": "...", "organisation": "...", "gemeinde": "..."}],
  "organisationen": [{"name": "...", "typ": "...", "gemeinde": "..."}],
  "ereignisse": [{"typ": "...", "titel": "...", "beschreibung": "...", "ereignis_datum": "ISO oder null", "relevanz": "hoch|mittel|tief"}]
}

Verfügbare Kategorien: ${KATEGORIEN.join(", ")}

Verfügbare Organisationstypen: volksschulamt, bildungsdirektion, bildungsrat, fachstelle_schulbeurteilung, schulpflege, schulpraesidium, schulleitung, schulverwaltung, kreisschulbehoerde, zweckverband, primarschule, sekundarschule, sonderschule, tagesschule, berufsschule, kantonsschule, gemeinde

Berücksichtige ausschliesslich Schulen und Bildungsthemen im Kanton Zürich.`;

type InhaltTeil = { type?: string; text?: string };

interface ChatAntwort {
    choices?: Array<{ message?: { content?: string | InhaltTeil[] | null } }>;
    error?: { message?: string };
}

/**
 * Extracts textual content from an OpenRouter chat response, tolerating
 * error payloads, null content, and content-part arrays (multimodal/reasoning
 * models). Throws with a clear message when no usable text is present.
 */
function inhaltAusAntwort(daten: ChatAntwort): string {
    if (daten?.error) {
        throw new Error(`OpenRouter Fehler: ${daten.error.message ?? "unbekannt"}`);
    }
    const content = daten?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map((teil) => (typeof teil?.text === "string" ? teil.text : "")).join("").trim();
    }
    throw new Error("OpenRouter lieferte keinen Textinhalt");
}

export async function artikelExtrahieren(
    titel: string,
    ausschnitt: string,
    quellenName: string | null
): Promise<ArtikelExtraktion> {
    const benutzerPrompt = `Medienbeitrag:
Quelle: ${quellenName || "Unbekannt"}
Titel: ${titel}
Inhalt: ${ausschnitt}`;

    let letzterFehler: unknown;
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
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: benutzerPrompt },
                    ],
                    max_tokens: 2000,
                    temperature: 0.2,
                    response_format: { type: "json_object" },
                }),
            });

            if (!antwort.ok) {
                throw new Error(`OpenRouter fehlgeschlagen: ${antwort.status} ${antwort.statusText}`);
            }

            const daten: ChatAntwort = await antwort.json();
            const inhalt = inhaltAusAntwort(daten);
            if (!inhalt.trim()) {
                throw new Error("OpenRouter lieferte leeren Inhalt");
            }

            return normalisiereExtraktion(llmJsonParsen(inhalt));
        } catch (fehler) {
            letzterFehler = fehler;
        }
    }

    const meldung = letzterFehler instanceof Error ? letzterFehler.message : "Unbekannter Fehler";
    throw new Error(`Extraktion fehlgeschlagen: ${meldung}`);
}

const KATEGORIEN_SET = new Set<string>(KATEGORIEN);
const RELEVANZ_SET = new Set<string>(RELEVANZ_STUFEN);
const ORG_TYPEN_SET = new Set<string>(ORG_TYPEN);

function textOderNull(wert: unknown): string | null {
    return typeof wert === "string" && wert.trim() !== "" ? wert : null;
}

function alsRelevanz(wert: unknown): Relevanz {
    return typeof wert === "string" && RELEVANZ_SET.has(wert) ? (wert as Relevanz) : "mittel";
}

function alsKategorie(wert: unknown): Kategorie | null {
    return typeof wert === "string" && KATEGORIEN_SET.has(wert) ? (wert as Kategorie) : null;
}

/**
 * Coerces raw (possibly partial/invalid) LLM output into a fully-populated
 * ArtikelExtraktion so that no `undefined` or invalid enum value can reach the
 * database layer.
 */
function normalisiereExtraktion(roh: any): ArtikelExtraktion {
    const kategorien: Kategorie[] = Array.isArray(roh?.kategorien)
        ? (roh.kategorien.map(alsKategorie).filter((k: Kategorie | null): k is Kategorie => k !== null))
        : [];

    const kategorie: Kategorie = alsKategorie(roh?.kategorie) ?? kategorien[0] ?? "medienmitteilungen";
    if (!kategorien.includes(kategorie)) kategorien.unshift(kategorie);

    const personen = Array.isArray(roh?.personen)
        ? roh.personen
              .filter((p: any) => p && typeof p.name === "string" && p.name.trim() !== "")
              .map((p: any) => ({
                  name: p.name.trim(),
                  funktion: textOderNull(p.funktion) ?? "",
                  organisation: textOderNull(p.organisation),
                  gemeinde: textOderNull(p.gemeinde),
              }))
        : [];

    const organisationen = Array.isArray(roh?.organisationen)
        ? roh.organisationen
              .filter((o: any) => o && typeof o.name === "string" && o.name.trim() !== "")
              .map((o: any) => ({
                  name: o.name.trim(),
                  typ: (typeof o.typ === "string" && ORG_TYPEN_SET.has(o.typ) ? o.typ : "gemeinde") as OrgTyp,
                  gemeinde: textOderNull(o.gemeinde),
              }))
        : [];

    const ereignisse = Array.isArray(roh?.ereignisse)
        ? roh.ereignisse
              .filter((e: any) => e && typeof e.titel === "string" && e.titel.trim() !== "")
              .map((e: any) => ({
                  typ: alsKategorie(e.typ) ?? kategorie,
                  titel: e.titel.trim(),
                  beschreibung: textOderNull(e.beschreibung) ?? "",
                  ereignis_datum: textOderNull(e.ereignis_datum),
                  relevanz: alsRelevanz(e.relevanz),
              }))
        : [];

    return {
        zusammenfassung: textOderNull(roh?.zusammenfassung) ?? "",
        kategorie,
        kategorien,
        relevanz: alsRelevanz(roh?.relevanz),
        gemeinde: textOderNull(roh?.gemeinde),
        schule: textOderNull(roh?.schule),
        auswirkungen: textOderNull(roh?.auswirkungen),
        kontext_bezug: textOderNull(roh?.kontext_bezug),
        personen,
        organisationen,
        ereignisse,
    };
}
