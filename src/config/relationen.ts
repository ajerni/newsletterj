/** Curated Person↔Person relation types extracted from articles. */
export const RELATION_TYPEN = [
    "konflikt_mit",
    "vorgesetzt_von",
    "untergeben",
    "nachfolger_von",
    "vorgaenger_von",
    "kollege_von",
    "kritisiert",
    "unterstuetzt",
    "vertritt",
    "beschwerde_gegen",
    "verfahren_gegen",
] as const;

export type RelationTyp = (typeof RELATION_TYPEN)[number];

/** Relations without inherent direction — stored with normalized person-id order. */
export const SYMMETRISCHE_RELATIONEN = new Set<RelationTyp>(["konflikt_mit", "kollege_von"]);

export const RELATION_LABELS: Record<RelationTyp, string> = {
    konflikt_mit: "Konflikt mit",
    vorgesetzt_von: "Vorgesetzt von",
    untergeben: "Untergeben",
    nachfolger_von: "Nachfolger von",
    vorgaenger_von: "Vorgänger von",
    kollege_von: "Kollege/Kollegin von",
    kritisiert: "Kritisiert",
    unterstuetzt: "Unterstützt",
    vertritt: "Vertritt",
    beschwerde_gegen: "Beschwerde gegen",
    verfahren_gegen: "Verfahren gegen",
};
