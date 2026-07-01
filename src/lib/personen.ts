import {
    personenKandidatenFinden,
    personErstellen,
    personAktualisieren,
    erwaehnungErstellen,
    gemeindeAufloesen,
    gemeindeErstellen,
    alleGemeindenLaden,
    gemeindeAliasHinzufuegen,
} from "./db.js";
import type { ArtikelExtraktion } from "./typen.js";

interface ChatAntwort {
    choices: Array<{ message: { content: string } }>;
}

interface PersonenAufloesungErgebnis {
    personen_erstellt: number;
    personen_aktualisiert: number;
}

export async function personenAufloesen(
    personen: ArtikelExtraktion["personen"],
    artikelId: number
): Promise<PersonenAufloesungErgebnis> {
    let erstellt = 0;
    let aktualisiert = 0;

    for (const person of personen) {
        const gemeindeId = person.gemeinde
            ? await gemeindeIdAufloesen(person.gemeinde)
            : null;

        const kandidaten = await personenKandidatenFinden(person.name, gemeindeId);

        if (kandidaten.length > 0) {
            const uebereinstimmung = await kiPersonAbgleich(person, kandidaten);

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
        erstellt++;
    }

    return { personen_erstellt: erstellt, personen_aktualisiert: aktualisiert };
}

export async function gemeindeIdAufloesen(name: string): Promise<number | null> {
    // Direct match first
    const direktId = await gemeindeAufloesen(name);
    if (direktId) return direktId;

    // AI match against known municipalities
    const alleGemeinden = await alleGemeindenLaden();
    if (alleGemeinden.length === 0) {
        return await gemeindeErstellen(name);
    }

    const uebereinstimmungId = await kiGemeindeAbgleich(name, alleGemeinden);
    if (uebereinstimmungId) {
        await gemeindeAliasHinzufuegen(uebereinstimmungId, name);
        return uebereinstimmungId;
    }

    return await gemeindeErstellen(name);
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

    const antwort = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: process.env.OPENROUTER_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 100,
            temperature: 0.1,
            response_format: { type: "json_object" },
        }),
    });

    if (!antwort.ok) return null;

    const daten: ChatAntwort = await antwort.json();
    const ergebnis = JSON.parse(daten.choices[0].message.content);
    return ergebnis.uebereinstimmung_id ?? null;
}

async function kiGemeindeAbgleich(
    name: string,
    bekannteGemeinden: Array<{ id: number; name: string; aliase: string[] }>
): Promise<number | null> {
    const prompt = `Bestimme ob der folgende Ortsname einer bekannten Gemeinde im Kanton Zürich entspricht.

Neuer Name: "${name}"

Bekannte Gemeinden:
${bekannteGemeinden.map((g) => `- ID ${g.id}: ${g.name} (Aliase: ${g.aliase.join(", ") || "keine"})`).join("\n")}

Antworte mit JSON: {"uebereinstimmung_id": <id oder null>}
Nur eine Übereinstimmung melden wenn es sich eindeutig um dieselbe Gemeinde handelt (z.B. "Stadt Zürich" = "Zürich", "Gemeinde Uster" = "Uster").`;

    const antwort = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: process.env.OPENROUTER_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 100,
            temperature: 0.1,
            response_format: { type: "json_object" },
        }),
    });

    if (!antwort.ok) return null;

    const daten: ChatAntwort = await antwort.json();
    const ergebnis = JSON.parse(daten.choices[0].message.content);
    return ergebnis.uebereinstimmung_id ?? null;
}
