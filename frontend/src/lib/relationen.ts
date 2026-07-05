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

const SYMMETRISCHE = new Set(["erwaehnt_zusammen", "konflikt_mit", "kollege_von"]);

/** Short directional phrase from the center person's perspective (plain text, not HTML). */
export function relationRichtungText(
    relation: string,
    centerPersonId: number,
    vonId: number,
    nachbarName: string
): string {
    if (SYMMETRISCHE.has(relation)) {
        return relation === "erwaehnt_zusammen" ? `Co-Mention mit ${nachbarName}` : `${relationLabel(relation)} ${nachbarName}`;
    }

    const centerIstVon = vonId === centerPersonId;
    const richtungen: Record<string, [string, string]> = {
        vorgesetzt_von: [`Vorgesetzt von ${nachbarName}`, `${nachbarName} ist unterstellt`],
        untergeben: [`Führt ${nachbarName}`, `Geführt von ${nachbarName}`],
        nachfolger_von: [`Nachfolger von ${nachbarName}`, `${nachbarName} ist Nachfolger`],
        vorgaenger_von: [`Vorgänger von ${nachbarName}`, `${nachbarName} war Vorgänger`],
        kritisiert: [`Kritisiert ${nachbarName}`, `Kritisiert von ${nachbarName}`],
        unterstuetzt: [`Unterstützt ${nachbarName}`, `Unterstützt von ${nachbarName}`],
        vertritt: [`Vertritt ${nachbarName}`, `Vertreten durch ${nachbarName}`],
        beschwerde_gegen: [`Beschwerde gegen ${nachbarName}`, `Beschwerde von ${nachbarName}`],
        verfahren_gegen: [`Verfahren gegen ${nachbarName}`, `Verfahren durch ${nachbarName}`],
    };

    const paar = richtungen[relation];
    if (!paar) return `${relationLabel(relation)} ${nachbarName}`;
    return centerIstVon ? paar[0] : paar[1];
}
