import sql from "../db.js";
import { esc } from "../html.js";
import { relationBadgeHtml, relationRichtungText } from "./relationen.js";

export type NetzwerkKantenFilter = "alle" | "explizit" | "komention";

export interface NetzwerkKnoten {
    id: string;
    typ: "person";
    person_id: number;
    label: string;
    funktion: string | null;
    grad: number;
}

export interface NetzwerkKante {
    von: string;
    zu: string;
    relation: string;
    artikel_anzahl: number;
}

export interface NetzwerkGraph {
    knoten: NetzwerkKnoten[];
    kanten: NetzwerkKante[];
}

function artikelZeitraumBedingung(tage: number) {
    if (tage > 0) {
        return sql`COALESCE(a.veroeffentlicht_am, a.gesucht_am) > NOW() - make_interval(days => ${tage})`;
    }
    return sql`TRUE`;
}

function kantenFilterBedingung(filter: NetzwerkKantenFilter) {
    if (filter === "explizit") return sql`b.relation <> 'erwaehnt_zusammen'`;
    if (filter === "komention") return sql`b.relation = 'erwaehnt_zusammen'`;
    return sql`TRUE`;
}

/** Idempotent: insert co-mention edges for all person pairs per article. */
export async function komentionBootstrap(): Promise<number> {
    const inserted = await sql`
        INSERT INTO newsletterj_beziehungen (von_typ, von_id, zu_typ, zu_id, relation, quell_artikel_id)
        SELECT
            'person',
            LEAST(e1.person_id, e2.person_id),
            'person',
            GREATEST(e1.person_id, e2.person_id),
            'erwaehnt_zusammen',
            e1.artikel_id
        FROM newsletterj_erwaehnungen e1
        JOIN newsletterj_erwaehnungen e2
            ON e2.artikel_id = e1.artikel_id
            AND e2.person_id > e1.person_id
        ON CONFLICT DO NOTHING
        RETURNING id
    `;
    return inserted.length;
}

/** Co-mention edges for a single article (call after new article ingestion). */
export async function komentionArtikelErzeugen(artikelId: number): Promise<number> {
    const inserted = await sql`
        INSERT INTO newsletterj_beziehungen (von_typ, von_id, zu_typ, zu_id, relation, quell_artikel_id)
        SELECT
            'person',
            LEAST(e1.person_id, e2.person_id),
            'person',
            GREATEST(e1.person_id, e2.person_id),
            'erwaehnt_zusammen',
            e1.artikel_id
        FROM newsletterj_erwaehnungen e1
        JOIN newsletterj_erwaehnungen e2
            ON e2.artikel_id = e1.artikel_id
            AND e2.person_id > e1.person_id
        WHERE e1.artikel_id = ${artikelId}
        ON CONFLICT DO NOTHING
        RETURNING id
    `;
    return inserted.length;
}

export async function netzwerkGraphLaden(
    tage = 0,
    kantenLimit = 80,
    filter: NetzwerkKantenFilter = "alle"
): Promise<NetzwerkGraph> {
    const zeitraum = artikelZeitraumBedingung(tage);
    const kantenFilter = kantenFilterBedingung(filter);

    const kanten = await sql`
        SELECT
            b.von_id,
            b.zu_id,
            b.relation,
            COUNT(DISTINCT b.quell_artikel_id)::int AS artikel_anzahl
        FROM newsletterj_beziehungen b
        JOIN newsletterj_artikel a ON a.id = b.quell_artikel_id
        WHERE b.von_typ = 'person'
          AND b.zu_typ = 'person'
          AND ${zeitraum}
          AND ${kantenFilter}
        GROUP BY b.von_id, b.zu_id, b.relation
        ORDER BY
            CASE WHEN b.relation = 'erwaehnt_zusammen' THEN 1 ELSE 0 END,
            artikel_anzahl DESC,
            b.von_id,
            b.zu_id
        LIMIT ${kantenLimit}
    `;

    if (kanten.length === 0) {
        return { knoten: [], kanten: [] };
    }

    const personIds = new Set<number>();
    for (const k of kanten) {
        personIds.add(k.von_id);
        personIds.add(k.zu_id);
    }

    const personen = await sql`
        SELECT p.id, p.name, p.aktuelle_funktion
        FROM newsletterj_personen p
        WHERE p.id = ANY(${[...personIds]})
    `;

    const personMap = new Map(personen.map((p) => [p.id, p]));

    const grad = new Map<number, number>();
    for (const k of kanten) {
        grad.set(k.von_id, (grad.get(k.von_id) ?? 0) + k.artikel_anzahl);
        grad.set(k.zu_id, (grad.get(k.zu_id) ?? 0) + k.artikel_anzahl);
    }

    const knoten: NetzwerkKnoten[] = [...personIds]
        .map((id) => {
            const p = personMap.get(id);
            return {
                id: `person-${id}`,
                typ: "person" as const,
                person_id: id,
                label: p?.name ?? `Person #${id}`,
                funktion: p?.aktuelle_funktion ?? null,
                grad: grad.get(id) ?? 0,
            };
        })
        .sort((a, b) => b.grad - a.grad);

    return {
        knoten,
        kanten: kanten.map((k) => ({
            von: `person-${k.von_id}`,
            zu: `person-${k.zu_id}`,
            relation: k.relation,
            artikel_anzahl: k.artikel_anzahl,
        })),
    };
}

export async function netzwerkZentralitaet(
    tage = 0,
    limit = 20,
    filter: NetzwerkKantenFilter = "alle"
) {
    const zeitraum = artikelZeitraumBedingung(tage);
    const kantenFilter = kantenFilterBedingung(filter);

    return sql`
        SELECT
            p.id,
            p.name,
            p.aktuelle_funktion,
            COUNT(DISTINCT b.quell_artikel_id)::int AS verbindungen,
            COUNT(DISTINCT CASE WHEN b.von_id = p.id OR b.zu_id = p.id THEN
                CASE WHEN b.von_id = p.id THEN b.zu_id ELSE b.von_id END
            END)::int AS nachbarn
        FROM newsletterj_beziehungen b
        JOIN newsletterj_artikel a ON a.id = b.quell_artikel_id
        JOIN newsletterj_personen p ON p.id IN (b.von_id, b.zu_id)
        WHERE b.von_typ = 'person'
          AND b.zu_typ = 'person'
          AND ${zeitraum}
          AND ${kantenFilter}
        GROUP BY p.id, p.name, p.aktuelle_funktion
        ORDER BY verbindungen DESC, nachbarn DESC, p.name
        LIMIT ${limit}
    `;
}

export async function netzwerkStaerksteVerbindungen(
    tage = 0,
    limit = 25,
    filter: NetzwerkKantenFilter = "alle"
) {
    const zeitraum = artikelZeitraumBedingung(tage);
    const kantenFilter = kantenFilterBedingung(filter);

    return sql`
        SELECT
            b.von_id,
            b.zu_id,
            b.relation,
            COUNT(DISTINCT b.quell_artikel_id)::int AS artikel_anzahl,
            p1.name AS person_a_name,
            p1.aktuelle_funktion AS person_a_funktion,
            p2.name AS person_b_name,
            p2.aktuelle_funktion AS person_b_funktion
        FROM newsletterj_beziehungen b
        JOIN newsletterj_artikel a ON a.id = b.quell_artikel_id
        JOIN newsletterj_personen p1 ON p1.id = b.von_id
        JOIN newsletterj_personen p2 ON p2.id = b.zu_id
        WHERE b.von_typ = 'person'
          AND b.zu_typ = 'person'
          AND ${zeitraum}
          AND ${kantenFilter}
        GROUP BY b.von_id, b.zu_id, b.relation, p1.name, p1.aktuelle_funktion, p2.name, p2.aktuelle_funktion
        ORDER BY
            CASE WHEN b.relation = 'erwaehnt_zusammen' THEN 1 ELSE 0 END,
            artikel_anzahl DESC,
            p1.name,
            p2.name
        LIMIT ${limit}
    `;
}

export async function netzwerkKantenStatistik(tage = 0) {
    const zeitraum = artikelZeitraumBedingung(tage);

    const [row] = await sql`
        SELECT
            COUNT(*) FILTER (WHERE b.relation <> 'erwaehnt_zusammen')::int AS explizit,
            COUNT(*) FILTER (WHERE b.relation = 'erwaehnt_zusammen')::int AS komention
        FROM newsletterj_beziehungen b
        JOIN newsletterj_artikel a ON a.id = b.quell_artikel_id
        WHERE b.von_typ = 'person'
          AND b.zu_typ = 'person'
          AND ${zeitraum}
    `;

    return {
        explizit: row?.explizit ?? 0,
        komention: row?.komention ?? 0,
    };
}

export async function netzwerkHtml(tage: number): Promise<string> {
    const [zentral, verbindungen, stats] = await Promise.all([
        netzwerkZentralitaet(tage, 15),
        netzwerkStaerksteVerbindungen(tage, 20),
        netzwerkKantenStatistik(tage),
    ]);

    const explizit = verbindungen.filter((v) => v.relation !== "erwaehnt_zusammen");
    const komention = verbindungen.filter((v) => v.relation === "erwaehnt_zusammen");

    if (zentral.length === 0 && verbindungen.length === 0) {
        return `<p class="muted">Keine Personen-Verbindungen im gewählten Zeitraum.</p>`;
    }

    const verbindungsZeile = (v: (typeof verbindungen)[number]) => `
        <tr>
            <td>${esc(v.person_a_name)}${v.person_a_funktion ? `<br><span class="muted">${esc(v.person_a_funktion)}</span>` : ""}</td>
            <td>${esc(v.person_b_name)}${v.person_b_funktion ? `<br><span class="muted">${esc(v.person_b_funktion)}</span>` : ""}</td>
            <td>${relationBadgeHtml(String(v.relation))}</td>
            <td>${v.artikel_anzahl}</td>
        </tr>
    `;

    const zentralHtml = zentral.length === 0 ? "" : `
        <h4>Meistvernetzte Personen</h4>
        <table class="dossier-table">
            <thead><tr><th>Person</th><th>Funktion</th><th>Verbindungen</th><th>Nachbarn</th></tr></thead>
            <tbody>${zentral.map((p) => `
                <tr>
                    <td>${esc(p.name)}</td>
                    <td>${p.aktuelle_funktion ? esc(p.aktuelle_funktion) : "—"}</td>
                    <td>${p.verbindungen}</td>
                    <td>${p.nachbarn}</td>
                </tr>
            `).join("")}</tbody>
        </table>
    `;

    const explizitHtml = explizit.length === 0 ? "" : `
        <h4>Explizite Beziehungen</h4>
        <table class="dossier-table">
            <thead><tr><th>Person A</th><th>Person B</th><th>Beziehung</th><th>Quellen</th></tr></thead>
            <tbody>${explizit.map(verbindungsZeile).join("")}</tbody>
        </table>
    `;

    const komentionHtml = komention.length === 0 ? "" : `
        <h4>Co-Mentions (gemeinsame Artikel)</h4>
        <table class="dossier-table">
            <thead><tr><th>Person A</th><th>Person B</th><th>Beziehung</th><th>Artikel</th></tr></thead>
            <tbody>${komention.map(verbindungsZeile).join("")}</tbody>
        </table>
    `;

    return `
        <p class="muted">${stats.explizit} explizite Kanten, ${stats.komention} Co-Mention-Kanten im Zeitraum.</p>
        ${zentralHtml}
        ${explizitHtml}
        ${komentionHtml}
    `;
}

export interface PersonNetzwerkVerbindung {
    nachbar_id: number;
    nachbar_name: string;
    nachbar_funktion: string | null;
    relation: string;
    von_id: number;
    zu_id: number;
    quellen: Array<{ artikel_id: number; titel: string | null }>;
}

/** All 1-hop edges for one person from newsletterj_beziehungen, grouped by neighbor + relation. */
export async function personNetzwerk1HopLaden(
    personId: number,
    limit = 30
): Promise<PersonNetzwerkVerbindung[]> {
    const kanten = await sql`
        SELECT
            b.von_id,
            b.zu_id,
            b.relation,
            b.quell_artikel_id,
            CASE WHEN b.von_id = ${personId} THEN b.zu_id ELSE b.von_id END AS nachbar_id,
            p.name AS nachbar_name,
            p.aktuelle_funktion AS nachbar_funktion,
            a.titel AS artikel_titel
        FROM newsletterj_beziehungen b
        JOIN newsletterj_personen p ON p.id = CASE WHEN b.von_id = ${personId} THEN b.zu_id ELSE b.von_id END
        JOIN newsletterj_artikel a ON a.id = b.quell_artikel_id
        WHERE b.von_typ = 'person'
          AND b.zu_typ = 'person'
          AND (b.von_id = ${personId} OR b.zu_id = ${personId})
        ORDER BY
            CASE WHEN b.relation = 'erwaehnt_zusammen' THEN 1 ELSE 0 END,
            a.gesucht_am DESC
    `;

    const gruppen = new Map<string, PersonNetzwerkVerbindung>();

    for (const k of kanten) {
        const schluessel = `${k.nachbar_id}:${k.relation}:${k.von_id}:${k.zu_id}`;
        let eintrag = gruppen.get(schluessel);
        if (!eintrag) {
            eintrag = {
                nachbar_id: k.nachbar_id,
                nachbar_name: k.nachbar_name,
                nachbar_funktion: k.nachbar_funktion,
                relation: k.relation,
                von_id: k.von_id,
                zu_id: k.zu_id,
                quellen: [],
            };
            gruppen.set(schluessel, eintrag);
        }
        if (!eintrag.quellen.some((q) => q.artikel_id === k.quell_artikel_id)) {
            eintrag.quellen.push({
                artikel_id: k.quell_artikel_id,
                titel: k.artikel_titel,
            });
        }
    }

    return [...gruppen.values()]
        .sort((a, b) => {
            const aExplizit = a.relation !== "erwaehnt_zusammen" ? 0 : 1;
            const bExplizit = b.relation !== "erwaehnt_zusammen" ? 0 : 1;
            if (aExplizit !== bExplizit) return aExplizit - bExplizit;
            return b.quellen.length - a.quellen.length;
        })
        .slice(0, limit);
}

export function personNetzwerk1HopHtml(
    personId: number,
    personName: string,
    verbindungen: PersonNetzwerkVerbindung[]
): string {
    if (verbindungen.length === 0) {
        return `<p class="muted">Keine direkten Beziehungen zu anderen Personen.</p>`;
    }

    const explizit = verbindungen.filter((v) => v.relation !== "erwaehnt_zusammen");
    const komention = verbindungen.filter((v) => v.relation === "erwaehnt_zusammen");

    const zeile = (v: PersonNetzwerkVerbindung) => {
        const quellenLinks = v.quellen
            .map((q) => `<a href="#" hx-get="/api/artikel/${q.artikel_id}" hx-target="#content">${esc(q.titel || `Artikel #${q.artikel_id}`)}</a>`)
            .join(", ");

        return `
            <tr>
                <td>
                    <a href="#" hx-get="/api/personen/${v.nachbar_id}" hx-target="#content">${esc(v.nachbar_name)}</a>
                    ${v.nachbar_funktion ? `<br><span class="muted">${esc(v.nachbar_funktion)}</span>` : ""}
                </td>
                <td>
                    ${relationBadgeHtml(v.relation)}
                    <span class="relation-direction">${esc(relationRichtungText(v.relation, personId, v.von_id, v.nachbar_name))}</span>
                </td>
                <td>${quellenLinks}${v.quellen.length > 1 ? ` <span class="muted">(${v.quellen.length})</span>` : ""}</td>
            </tr>
        `;
    };

    const tabelle = (titel: string, zeilen: PersonNetzwerkVerbindung[]) => zeilen.length === 0 ? "" : `
        <h4>${esc(titel)}</h4>
        <table class="person-netzwerk-table">
            <thead><tr><th>Person</th><th>Beziehung</th><th>Quelle</th></tr></thead>
            <tbody>${zeilen.map(zeile).join("")}</tbody>
        </table>
    `;

    return `
        <p class="muted">Direkte Verbindungen (1 Hop) von ${esc(personName)} — ${explizit.length} explizit, ${komention.length} Co-Mention.</p>
        ${tabelle("Explizite Beziehungen", explizit)}
        ${tabelle("Co-Mentions", komention)}
    `;
}
