/** Display labels for relation slugs stored in newsletterj_beziehungen.relation */
export const RELATION_LABELS: Record<string, string> = {
    erwaehnt_zusammen: "Co-Mention",
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

export function relationLabel(slug: string): string {
    return RELATION_LABELS[slug] ?? slug.replace(/_/g, " ");
}

export function istExpliziteRelation(relation: string): boolean {
    return relation !== "erwaehnt_zusammen";
}

export function relationBadgeHtml(relation: string): string {
    const label = relationLabel(relation);
    const klasse = istExpliziteRelation(relation) ? "relation-badge relation-explicit" : "relation-badge relation-komention";
    return `<span class="${klasse}">${label}</span>`;
}
