import postgres from "postgres";
import type { SuchErgebnis, ArtikelExtraktion } from "./typen.js";
import type { Kategorie, Relevanz, OrgTyp } from "../config/kategorien.js";

const sql = postgres(process.env.DATABASE_URL!);

export default sql;

// --- Gemeinden ---

/** Returns trimmed name or null if missing/blank. */
export function normalisiereGemeindeName(name: string | null | undefined): string | null {
    if (typeof name !== "string") return null;
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export async function gemeindeAufloesen(name: string): Promise<number | null> {
    const gueltigerName = normalisiereGemeindeName(name);
    if (!gueltigerName) return null;

    const [treffer] = await sql`
        SELECT id FROM newsletterj_gemeinden
        WHERE name = ${gueltigerName} OR ${gueltigerName} = ANY(COALESCE(aliase, '{}'))
        LIMIT 1
    `;
    return treffer?.id ?? null;
}

export async function gemeindeErstellen(name: string, aliase: string[] = []): Promise<number> {
    const gueltigerName = normalisiereGemeindeName(name);
    if (!gueltigerName) {
        throw new Error("Gemeinde-Name fehlt oder ist leer");
    }

    const sichereAliase = Array.isArray(aliase)
        ? aliase.filter((a) => typeof a === "string" && a.trim() !== "")
        : [];

    const [row] = await sql`
        INSERT INTO newsletterj_gemeinden (name, aliase)
        VALUES (${gueltigerName}, ${sichereAliase})
        RETURNING id
    `;
    return row.id;
}

export async function alleGemeindenLaden(): Promise<Array<{ id: number; name: string; aliase: string[] }>> {
    const rows = await sql`
        SELECT id, name, aliase FROM newsletterj_gemeinden ORDER BY name
    ` as Array<{ id: number; name: string | null; aliase: string[] | null }>;

    return rows.map((r) => ({
        id: r.id,
        name: r.name ?? "",
        aliase: r.aliase ?? [],
    }));
}

export async function gemeindeAliasHinzufuegen(id: number, alias: string): Promise<void> {
    const gueltigerAlias = normalisiereGemeindeName(alias);
    if (!gueltigerAlias) return;

    await sql`
        UPDATE newsletterj_gemeinden
        SET aliase = array_append(COALESCE(aliase, '{}'), ${gueltigerAlias})
        WHERE id = ${id} AND NOT (${gueltigerAlias} = ANY(COALESCE(aliase, '{}')))
    `;
}

// --- Artikel ---

export async function vorhandeneUrls(urls: string[]): Promise<Set<string>> {
    if (urls.length === 0) return new Set();
    const rows = await sql`SELECT url FROM newsletterj_artikel WHERE url = ANY(${urls})`;
    return new Set(rows.map((r) => r.url));
}

export async function artikelSpeichern(
    ergebnis: SuchErgebnis,
    extraktion: ArtikelExtraktion,
    gemeindeId: number | null,
    laufId: number
): Promise<number> {
    const rohJson = {
        ...(ergebnis.roh_json ?? {}),
        suchtitel: ergebnis.titel ?? null,
    };

    const [row] = await sql`
        INSERT INTO newsletterj_artikel (
            url, titel, ausschnitt, veroeffentlicht_am,
            quellen_name, quellen_domain, such_engine,
            kategorie, kategorien, relevanz,
            gemeinde_id, schule, zusammenfassung,
            auswirkungen, kontext_bezug, roh_json,
            extrahiert_am, lauf_id
        ) VALUES (
            ${ergebnis.url}, ${extraktion.titel ?? null}, ${ergebnis.ausschnitt ?? null},
            ${ergebnis.veroeffentlicht_am ?? null}, ${ergebnis.quellen_name ?? null},
            ${ergebnis.quellen_domain ?? null}, ${ergebnis.such_engine},
            ${extraktion.kategorie ?? null}, ${(extraktion.kategorien ?? []) as string[]},
            ${extraktion.relevanz ?? "mittel"}, ${gemeindeId ?? null},
            ${extraktion.schule ?? null}, ${extraktion.zusammenfassung ?? null},
            ${extraktion.auswirkungen ?? null}, ${extraktion.kontext_bezug ?? null},
            ${JSON.stringify(rohJson)},
            NOW(), ${laufId}
        )
        ON CONFLICT (url) DO NOTHING
        RETURNING id
    `;
    return row?.id;
}

// --- Personen ---

export async function personenKandidatenFinden(
    name: string,
    gemeindeId?: number | null
): Promise<Array<{ id: number; name: string; aktuelle_funktion: string | null; aktuelle_gemeinde_id: number | null; aktuelle_organisation: string | null }>> {
    if (gemeindeId) {
        return await sql`
            SELECT id, name, aktuelle_funktion, aktuelle_gemeinde_id, aktuelle_organisation
            FROM newsletterj_personen
            WHERE name ILIKE ${`%${name}%`} OR name ILIKE ${`${name.split(" ").pop()}%`}
            ORDER BY (aktuelle_gemeinde_id = ${gemeindeId}) DESC, zuletzt_gesehen_am DESC
            LIMIT 10
        ` as any;
    }
    return await sql`
        SELECT id, name, aktuelle_funktion, aktuelle_gemeinde_id, aktuelle_organisation
        FROM newsletterj_personen
        WHERE name ILIKE ${`%${name}%`} OR name ILIKE ${`${name.split(" ").pop()}%`}
        ORDER BY zuletzt_gesehen_am DESC
        LIMIT 10
    ` as any;
}

export async function personErstellen(daten: {
    name: string;
    aktuelle_funktion: string | null;
    aktuelle_gemeinde_id: number | null;
    aktuelle_organisation: string | null;
}): Promise<number> {
    const [row] = await sql`
        INSERT INTO newsletterj_personen (name, aktuelle_funktion, aktuelle_gemeinde_id, aktuelle_organisation, artikel_anzahl)
        VALUES (${daten.name}, ${daten.aktuelle_funktion}, ${daten.aktuelle_gemeinde_id}, ${daten.aktuelle_organisation}, 1)
        RETURNING id
    `;
    return row.id;
}

export async function personAktualisieren(id: number, daten: {
    aktuelle_funktion?: string | null;
    aktuelle_gemeinde_id?: number | null;
    aktuelle_organisation?: string | null;
}): Promise<void> {
    await sql`
        UPDATE newsletterj_personen SET
            aktuelle_funktion = COALESCE(${daten.aktuelle_funktion ?? null}, aktuelle_funktion),
            aktuelle_gemeinde_id = COALESCE(${daten.aktuelle_gemeinde_id ?? null}, aktuelle_gemeinde_id),
            aktuelle_organisation = COALESCE(${daten.aktuelle_organisation ?? null}, aktuelle_organisation),
            zuletzt_gesehen_am = NOW(),
            artikel_anzahl = artikel_anzahl + 1,
            aktualisiert_am = NOW()
        WHERE id = ${id}
    `;
}

// --- Erwähnungen ---

export async function erwaehnungErstellen(
    artikelId: number,
    personId: number,
    daten: { funktion_bei_erwaehnung: string | null; kontext: string | null }
): Promise<void> {
    await sql`
        INSERT INTO newsletterj_erwaehnungen (artikel_id, person_id, funktion_bei_erwaehnung, kontext)
        VALUES (${artikelId}, ${personId}, ${daten.funktion_bei_erwaehnung}, ${daten.kontext})
        ON CONFLICT (artikel_id, person_id) DO NOTHING
    `;
}

// --- Organisationen ---

export async function organisationFindenOderErstellen(
    name: string,
    typ: OrgTyp | null,
    gemeindeId: number | null
): Promise<number> {
    const [bestehend] = await sql`
        SELECT id FROM newsletterj_organisationen
        WHERE name = ${name} AND (gemeinde_id = ${gemeindeId} OR (gemeinde_id IS NULL AND ${gemeindeId}::int IS NULL))
        LIMIT 1
    `;
    if (bestehend) return bestehend.id;

    const [row] = await sql`
        INSERT INTO newsletterj_organisationen (name, typ, gemeinde_id)
        VALUES (${name}, ${typ}, ${gemeindeId})
        RETURNING id
    `;
    return row.id;
}

export async function orgErwaehnungErstellen(artikelId: number, organisationId: number): Promise<void> {
    await sql`
        INSERT INTO newsletterj_org_erwaehnungen (artikel_id, organisation_id)
        VALUES (${artikelId}, ${organisationId})
        ON CONFLICT (artikel_id, organisation_id) DO NOTHING
    `;
}

// --- Ereignisse ---

export async function ereignisErstellen(artikelId: number, daten: {
    typ: Kategorie;
    titel: string;
    beschreibung: string | null;
    gemeinde_id: number | null;
    schule: string | null;
    ereignis_datum: string | null;
    relevanz: Relevanz;
}): Promise<void> {
    await sql`
        INSERT INTO newsletterj_ereignisse (artikel_id, typ, titel, beschreibung, gemeinde_id, schule, ereignis_datum, relevanz)
        VALUES (${artikelId}, ${daten.typ}, ${daten.titel}, ${daten.beschreibung ?? null}, ${daten.gemeinde_id ?? null}, ${daten.schule ?? null}, ${daten.ereignis_datum ?? null}, ${daten.relevanz ?? "mittel"})
    `;
}

// --- Läufe ---

export async function laufErstellen(): Promise<number> {
    const [row] = await sql`
        INSERT INTO newsletterj_laeufe (status) VALUES ('gestartet') RETURNING id
    `;
    return row.id;
}

export async function laufAbschliessen(id: number, statistik: {
    status: "abgeschlossen" | "fehlgeschlagen";
    artikel_gefunden: number;
    artikel_neu: number;
    personen_erstellt: number;
    personen_aktualisiert: number;
    ereignisse_erstellt: number;
    email_id?: string;
    fehlermeldung?: string;
}): Promise<void> {
    await sql`
        UPDATE newsletterj_laeufe SET
            status = ${statistik.status},
            artikel_gefunden = ${statistik.artikel_gefunden},
            artikel_neu = ${statistik.artikel_neu},
            personen_erstellt = ${statistik.personen_erstellt},
            personen_aktualisiert = ${statistik.personen_aktualisiert},
            ereignisse_erstellt = ${statistik.ereignisse_erstellt},
            email_id = ${statistik.email_id ?? null},
            fehlermeldung = ${statistik.fehlermeldung ?? null},
            abgeschlossen_am = NOW()
        WHERE id = ${id}
    `;
}
