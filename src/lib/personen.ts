import {
    personenKandidatenFinden,
    personErstellen,
    personAktualisieren,
    erwaehnungErstellen,
    gemeindeAufloesen,
    gemeindeErstellen,
    alleGemeindenLaden,
    gemeindeAliasHinzufuegen,
    normalisiereGemeindeName,
} from "./db.js";
import type { ArtikelExtraktion } from "./typen.js";
import { llmJsonParsen, llmInhaltExtrahieren } from "./json.js";
import type { OpenRouterChatAntwort } from "./json.js";

/**
 * Sends a matching prompt to OpenRouter and returns the parsed
 * {"uebereinstimmung_id": ...} result, or null when the call/parsing fails
 * after retries (callers treat null as "no match", which is safe).
 */
async function kiAbgleichAnfrage(prompt: string): Promise<number | null> {
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
                    // Reasoning models spend "thinking" tokens from this budget
                    // before the JSON answer; 100 was too tight and caused
                    // empty/truncated responses
                    max_tokens: 2000,
                    temperature: 0.1,
                    response_format: { type: "json_object" },
                }),
            });

            if (!antwort.ok) {
                throw new Error(`OpenRouter fehlgeschlagen: ${antwort.status} ${antwort.statusText}`);
            }

            const daten: OpenRouterChatAntwort = await antwort.json();
            const ergebnis = llmJsonParsen<{ uebereinstimmung_id?: number | null }>(llmInhaltExtrahieren(daten));
            const id = ergebnis.uebereinstimmung_id;
            return typeof id === "number" ? id : null;
        } catch {
            if (versuch < 2) await new Promise((r) => setTimeout(r, 1000));
        }
    }
    return null;
}

interface PersonenAufloesungErgebnis {
    personen_erstellt: number;
    personen_aktualisiert: number;
    /** Normalized person name → resolved DB id for this article. */
    person_ids: Map<string, number>;
}

export function nameNormalisieren(name: string): string {
    return name.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function personenAufloesen(
    personen: ArtikelExtraktion["personen"],
    artikelId: number
): Promise<PersonenAufloesungErgebnis> {
    let erstellt = 0;
    let aktualisiert = 0;
    const personIds = new Map<string, number>();

    for (const person of personen) {
        const gemeindeId = person.gemeinde
            ? await gemeindeIdAufloesen(person.gemeinde)
            : null;

        const kandidaten = await personenKandidatenFinden(person.name, gemeindeId);

        if (kandidaten.length > 0) {
            // Exact name match first (case/whitespace-insensitive) — skips the
            // LLM call for the common case of an unambiguous identical name
            const exakte = kandidaten.filter(
                (k) => nameNormalisieren(k.name) === nameNormalisieren(person.name)
            );
            const uebereinstimmung =
                exakte.length === 1 ? exakte[0].id : await kiPersonAbgleich(person, kandidaten);

            if (uebereinstimmung) {
                await personAktualisieren(uebereinstimmung, {
                    aktuelle_funktion: person.funktion,
                    aktuelle_gemeinde_id: gemeindeId,
                    aktuelle_organisation: person.organisation,
                });
                await erwaehnungErstellen(artikelId, uebereinstimmung, {
                    funktion_bei_erwaehnung: person.funktion,
                    kontext: null,
                });
                personIds.set(nameNormalisieren(person.name), uebereinstimmung);
                aktualisiert++;
                continue;
            }
        }

        const neuePersonId = await personErstellen({
            name: person.name,
            aktuelle_funktion: person.funktion,
            aktuelle_gemeinde_id: gemeindeId,
            aktuelle_organisation: person.organisation,
        });
        await erwaehnungErstellen(artikelId, neuePersonId, {
            funktion_bei_erwaehnung: person.funktion,
            kontext: null,
        });
        personIds.set(nameNormalisieren(person.name), neuePersonId);
        erstellt++;
    }

    return { personen_erstellt: erstellt, personen_aktualisiert: aktualisiert, person_ids: personIds };
}

export async function gemeindeIdAufloesen(name: string): Promise<number | null> {
    const gueltigerName = normalisiereGemeindeName(name);
    if (!gueltigerName) return null;

    const direktId = await gemeindeAufloesen(gueltigerName);
    if (direktId) return direktId;

    const alleGemeinden = (await alleGemeindenLaden()).filter((g) => g.name.trim() !== "");
    if (alleGemeinden.length === 0) {
        return await gemeindeErstellen(gueltigerName);
    }

    const uebereinstimmungId = await kiGemeindeAbgleich(gueltigerName, alleGemeinden);
    if (uebereinstimmungId) {
        await gemeindeAliasHinzufuegen(uebereinstimmungId, gueltigerName);
        return uebereinstimmungId;
    }

    return await gemeindeErstellen(gueltigerName);
}

async function kiPersonAbgleich(
    neuePerson: { name: string; funktion: string; organisation: string | null; gemeinde: string | null },
    kandidaten: Array<{ id: number; name: string; aktuelle_funktion: string | null; aktuelle_gemeinde_id: number | null; aktuelle_organisation: string | null }>
): Promise<number | null> {
    const prompt = `Bestimme ob die folgende Person mit einem der Kandidaten identisch ist.

Neue Erwähnung:
- Name: ${neuePerson.name}
- Funktion: ${neuePerson.funktion}
- Organisation: ${neuePerson.organisation || "unbekannt"}
- Gemeinde: ${neuePerson.gemeinde || "unbekannt"}

Bekannte Personen:
${kandidaten.map((k) => `- ID ${k.id}: ${k.name}, ${k.aktuelle_funktion || "keine Funktion"}, ${k.aktuelle_organisation || "keine Org"}`).join("\n")}

Antworte mit JSON: {"uebereinstimmung_id": <id oder null>}
Nur eine Übereinstimmung melden wenn du dir sicher bist, dass es dieselbe Person ist.`;

    return kiAbgleichAnfrage(prompt);
}

async function kiGemeindeAbgleich(
    name: string,
    bekannteGemeinden: Array<{ id: number; name: string; aliase: string[] }>
): Promise<number | null> {
    const gueltigeGemeinden = bekannteGemeinden.filter((g) => g.name.trim() !== "");
    if (gueltigeGemeinden.length === 0) return null;

    const prompt = `Bestimme ob der folgende Ortsname einer bekannten Gemeinde im Kanton Zürich entspricht.

Neuer Name: "${name}"

Bekannte Gemeinden:
${gueltigeGemeinden.map((g) => `- ID ${g.id}: ${g.name} (Aliase: ${(g.aliase ?? []).join(", ") || "keine"})`).join("\n")}

Antworte mit JSON: {"uebereinstimmung_id": <id oder null>}
Nur eine Übereinstimmung melden wenn es sich eindeutig um dieselbe Gemeinde handelt (z.B. "Stadt Zürich" = "Zürich", "Gemeinde Uster" = "Uster").`;

    const id = await kiAbgleichAnfrage(prompt);
    if (id === null) return null;
    return gueltigeGemeinden.some((g) => g.id === id) ? id : null;
}
