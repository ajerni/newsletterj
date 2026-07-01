import type { ArtikelExtraktion } from "./typen.js";
import { KATEGORIEN } from "../config/kategorien.js";

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

interface ChatAntwort {
    choices: Array<{ message: { content: string } }>;
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
    const inhalt = daten.choices[0].message.content;

    const extraktion: ArtikelExtraktion = JSON.parse(inhalt);
    return extraktion;
}
