import { task } from "@trigger.dev/sdk/v3";
import { artikelOhneEinbettungLaden } from "../lib/db.js";
import { artikelEinbettungVerarbeiten } from "../lib/embeddings.js";
import type { ArtikelExtraktion } from "../lib/typen.js";
import type { Kategorie, Relevanz } from "../config/kategorien.js";

/**
 * Backfills embeddings for articles that were ingested before the embedding
 * pipeline existed. Does not run case threading (no full extraction context).
 */
export const einbettungenNachziehenTask = task({
    id: "einbettungen-nachziehen",
    maxDuration: 3600,
    retry: { maxAttempts: 1 },
    run: async (payload: { limit?: number } = {}) => {
        const limit = Math.min(payload.limit ?? 50, 200);
        const artikel = await artikelOhneEinbettungLaden(limit);

        let verarbeitet = 0;
        let fehlgeschlagen = 0;

        for (const a of artikel) {
            try {
                const extraktion: ArtikelExtraktion = {
                    titel: a.titel ?? "Ohne Titel",
                    zusammenfassung: a.zusammenfassung ?? "",
                    kategorie: (a.kategorie as Kategorie) ?? "medienmitteilungen",
                    kategorien: (a.kategorien as Kategorie[]) ?? [],
                    relevanz: "mittel" as Relevanz,
                    gemeinde: a.gemeinde_name,
                    schule: a.schule,
                    auswirkungen: null,
                    kontext_bezug: a.kontext_bezug,
                    personen: [],
                    organisationen: [],
                    ereignisse: [],
                    beziehungen: [],
                };
                await artikelEinbettungVerarbeiten(a.id, extraktion, a.gemeinde_name);
                verarbeitet++;
            } catch (fehler) {
                fehlgeschlagen++;
                const meldung = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
                console.error(`Embedding für Artikel ${a.id} fehlgeschlagen: ${meldung}`);
            }
        }

        return { verarbeitet, fehlgeschlagen, gesamt: artikel.length };
    },
});
