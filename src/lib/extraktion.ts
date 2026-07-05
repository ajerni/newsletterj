import type { ArtikelExtraktion } from "./typen.js";
import { KATEGORIEN, RELEVANZ_STUFEN, ORG_TYPEN } from "../config/kategorien.js";
import type { Kategorie, Relevanz, OrgTyp } from "../config/kategorien.js";
import { RELATION_TYPEN } from "../config/relationen.js";
import type { RelationTyp } from "../config/relationen.js";
import { llmJsonParsen, llmInhaltExtrahieren } from "./json.js";
import type { OpenRouterChatAntwort } from "./json.js";

const SYSTEM_PROMPT = `Du bist ein professioneller Investigativ-Rechercheur und Medienanalyst mit Schwerpunkt Bildungspolitik, Volksschulen und öffentliche Verwaltung im Kanton Zürich, Schweiz.

Analysiere den folgenden Medienbeitrag und extrahiere strukturierte Informationen. Antworte ausschliesslich mit einem JSON-Objekt im folgenden Format:

{
  "titel": "Prägnanter Titel passend zum analysierten Inhalt (nicht blind den Suchtitel übernehmen)",
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
  "ereignisse": [{"typ": "...", "titel": "...", "beschreibung": "...", "ereignis_datum": "ISO oder null", "relevanz": "hoch|mittel|tief"}],
  "beziehungen": [{"von": "Personenname", "zu": "Personenname", "relation": "relationstyp"}]
}

Verfügbare Kategorien: ${KATEGORIEN.join(", ")}

Verfügbare Organisationstypen: volksschulamt, bildungsdirektion, bildungsrat, fachstelle_schulbeurteilung, schulpflege, schulpraesidium, schulleitung, schulverwaltung, kreisschulbehoerde, zweckverband, primarschule, sekundarschule, sonderschule, tagesschule, berufsschule, kantonsschule, gemeinde

Wichtig: Erfasse unter "personen" ausschliesslich Personen, die im Beitrag mit ihrem echten Namen (Vor- und/oder Nachname) genannt werden. Anonyme oder unbenannte Personen (z.B. "nicht namentlich genannt", "unbekannt", "ein Lehrer", "die Schulleiterin") NICHT aufführen — lasse das Array in diesem Fall leer.

Explizite Beziehungen zwischen Personen (Feld "beziehungen"):
- Nur erfassen, wenn die Beziehung im Text ausdrücklich genannt oder klar erkennbar ist — nicht aus blosser Co-Erwähnung im selben Artikel ableiten.
- "von" und "zu" müssen exakt Namen aus "personen" sein.
- Verfügbare relation-Werte: ${RELATION_TYPEN.join(", ")}
- Bedeutungen: konflikt_mit (offener Konflikt/Streit), vorgesetzt_von (von ist unterstellt zu), untergeben (von führt/hat zu unterstellt), nachfolger_von (von trat die Rolle von zu an), vorgaenger_von (von hatte die Rolle vor zu), kollege_von (gleiche Ebene/Gremium), kritisiert (von kritisiert zu), unterstuetzt (von unterstützt/backt zu), vertritt (von vertritt/handelt für zu), beschwerde_gegen (von reichte Beschwerde gegen zu ein), verfahren_gegen (Verfahren/Anklage gegen zu, initiiert durch/bezogen auf von).
- Wenn keine explizite Beziehung erkennbar ist: leeres Array [].

Der Feld "titel" soll den konkret analysierten Beitrag beschreiben. Bei Sammelseiten oder wenn der Suchtitel nicht zum Inhalt passt, formuliere einen eigenen, passenden Titel aus dem Inhalt — übernimm den Suchtitel nicht wörtlich, wenn er falsch oder irreführend ist.

Berücksichtige ausschliesslich Schulen und Bildungsthemen im Kanton Zürich.`;

export async function artikelExtrahieren(
    titel: string,
    ausschnitt: string,
    quellenName: string | null
): Promise<ArtikelExtraktion> {
    const benutzerPrompt = `Medienbeitrag:
Quelle: ${quellenName || "Unbekannt"}
Suchtitel (von der Suche, kann ungenau sein): ${titel}
Inhalt: ${ausschnitt}`;

    let letzterFehler: unknown;
    for (let versuch = 1; versuch <= 3; versuch++) {
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
                    // Generous limit: reasoning models spend "thinking" tokens
                    // from the same budget before emitting the JSON answer
                    max_tokens: 8000,
                    temperature: 0.2,
                    response_format: { type: "json_object" },
                }),
            });

            if (!antwort.ok) {
                throw new Error(`OpenRouter fehlgeschlagen: ${antwort.status} ${antwort.statusText}`);
            }

            const daten: OpenRouterChatAntwort = await antwort.json();
            const inhalt = llmInhaltExtrahieren(daten);

            return normalisiereExtraktion(llmJsonParsen(inhalt), titel);
        } catch (fehler) {
            letzterFehler = fehler;
            // Brief pause before retrying, in case of transient model hiccups
            if (versuch < 3) await new Promise((r) => setTimeout(r, 1000 * versuch));
        }
    }

    const meldung = letzterFehler instanceof Error ? letzterFehler.message : "Unbekannter Fehler";
    throw new Error(`Extraktion fehlgeschlagen: ${meldung}`);
}

const KATEGORIEN_SET = new Set<string>(KATEGORIEN);
const RELEVANZ_SET = new Set<string>(RELEVANZ_STUFEN);
const ORG_TYPEN_SET = new Set<string>(ORG_TYPEN);
const RELATION_TYPEN_SET = new Set<string>(RELATION_TYPEN);

function textOderNull(wert: unknown): string | null {
    return typeof wert === "string" && wert.trim() !== "" ? wert : null;
}

// Placeholder "names" the LLM sometimes emits for anonymous persons
const PLATZHALTER_NAMEN = /^(nicht\s+(namentlich\s+)?genannt|unbekannt|anonym|keine?\s+angabe|n\.?\s*a\.?|unbenannt|niemand)/i;

function istEchterPersonenname(name: string): boolean {
    const bereinigt = name.trim();
    if (bereinigt.length < 3) return false;
    if (PLATZHALTER_NAMEN.test(bereinigt)) return false;
    // Generic role descriptions instead of names (e.g. "ein Lehrer", "die Schulleiterin")
    if (/^(ein|eine|der|die|das|mehrere|einige)\s/i.test(bereinigt)) return false;
    return true;
}

function alsRelation(wert: unknown): RelationTyp | null {
    return typeof wert === "string" && RELATION_TYPEN_SET.has(wert) ? (wert as RelationTyp) : null;
}

function nameNormalisieren(name: string): string {
    return name.toLowerCase().replace(/\s+/g, " ").trim();
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
function normalisiereExtraktion(roh: any, suchtitel = ""): ArtikelExtraktion {
    const kategorien: Kategorie[] = Array.isArray(roh?.kategorien)
        ? (roh.kategorien.map(alsKategorie).filter((k: Kategorie | null): k is Kategorie => k !== null))
        : [];

    const kategorie: Kategorie = alsKategorie(roh?.kategorie) ?? kategorien[0] ?? "medienmitteilungen";
    if (!kategorien.includes(kategorie)) kategorien.unshift(kategorie);

    const personen = Array.isArray(roh?.personen)
        ? roh.personen
              .filter((p: any) => p && typeof p.name === "string" && istEchterPersonenname(p.name))
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

    const personenNamen = new Set(personen.map((p: { name: string }) => nameNormalisieren(p.name)));

    const beziehungen = Array.isArray(roh?.beziehungen)
        ? roh.beziehungen
              .filter((b: any) => {
                  if (!b || typeof b.von !== "string" || typeof b.zu !== "string") return false;
                  const relation = alsRelation(b.relation);
                  if (!relation) return false;
                  const von = nameNormalisieren(b.von);
                  const zu = nameNormalisieren(b.zu);
                  if (von === zu) return false;
                  return personenNamen.has(von) && personenNamen.has(zu);
              })
              .map((b: any) => ({
                  von: b.von.trim(),
                  zu: b.zu.trim(),
                  relation: alsRelation(b.relation)!,
              }))
        : [];

    return {
        titel: textOderNull(roh?.titel) ?? textOderNull(suchtitel) ?? "",
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
        beziehungen,
    };
}
