import sql from "../db.js";
import type { FieldConfig, ResourceConfig } from "../config/resources.js";
import { editableFields, resolveListOrderBy, resourceConfig, searchableFieldNames } from "../config/resources.js";
import { assertDeletable, friendlyDbError } from "./db-errors.js";

const TABLE_SQL: Record<string, ReturnType<typeof sql.unsafe>> = {
    newsletterj_gemeinden: sql.unsafe("newsletterj_gemeinden"),
    newsletterj_artikel: sql.unsafe("newsletterj_artikel"),
    newsletterj_personen: sql.unsafe("newsletterj_personen"),
    newsletterj_personen_funktionen: sql.unsafe("newsletterj_personen_funktionen"),
    newsletterj_erwaehnungen: sql.unsafe("newsletterj_erwaehnungen"),
    newsletterj_organisationen: sql.unsafe("newsletterj_organisationen"),
    newsletterj_org_erwaehnungen: sql.unsafe("newsletterj_org_erwaehnungen"),
    newsletterj_ereignisse: sql.unsafe("newsletterj_ereignisse"),
    newsletterj_laeufe: sql.unsafe("newsletterj_laeufe"),
};

const ORDER_SQL: Record<string, ReturnType<typeof sql.unsafe>> = {
    "name ASC": sql.unsafe("name ASC"),
    "gesucht_am DESC": sql.unsafe("gesucht_am DESC"),
    "id DESC": sql.unsafe("id DESC"),
    "erstellt_am DESC": sql.unsafe("erstellt_am DESC"),
    "gestartet_am DESC": sql.unsafe("gestartet_am DESC"),
    "veroeffentlicht_am DESC NULLS LAST": sql.unsafe("veroeffentlicht_am DESC NULLS LAST"),
    "veroeffentlicht_am ASC NULLS LAST": sql.unsafe("veroeffentlicht_am ASC NULLS LAST"),
};

function tableRef(table: string) {
    const ref = TABLE_SQL[table];
    if (!ref) throw new Error(`Tabelle nicht erlaubt: ${table}`);
    return ref;
}

function orderRef(orderBy: string) {
    const ref = ORDER_SQL[orderBy];
    if (!ref) throw new Error(`Sortierung nicht erlaubt: ${orderBy}`);
    return ref;
}

function fieldAllowed(config: ResourceConfig, name: string): FieldConfig | undefined {
    return config.fields.find((f) => f.name === name);
}

export function parseFieldInput(field: FieldConfig, raw: unknown): unknown {
    if (raw === undefined) return undefined;
    if (raw === null) return null;

    const text = typeof raw === "string" ? raw.trim() : String(raw);

    if (text === "" && !field.required) return null;

    switch (field.type) {
        case "number": {
            if (text === "") return null;
            const n = Number(text);
            if (Number.isNaN(n)) throw new Error(`${field.label}: ungültige Zahl`);
            return n;
        }
        case "array":
            if (text === "") return [];
            return text.split(",").map((s) => s.trim()).filter(Boolean);
        case "json":
            if (text === "") return null;
            try {
                return JSON.parse(text);
            } catch {
                throw new Error(`${field.label}: ungültiges JSON`);
            }
        case "datetime":
            if (text === "") return null;
            return text;
        default:
            return text;
    }
}

export function bodyToRecord(config: ResourceConfig, body: Record<string, unknown>, forUpdate = false): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const fields = forUpdate ? editableFields(config) : editableFields(config);

    for (const field of fields) {
        if (!(field.name in body)) {
            if (!forUpdate && field.required) throw new Error(`${field.label} ist erforderlich`);
            continue;
        }
        const value = parseFieldInput(field, body[field.name]);
        if (value !== undefined) data[field.name] = value;
    }

    if (!forUpdate) {
        for (const field of fields) {
            if (field.required && !(field.name in data)) {
                throw new Error(`${field.label} ist erforderlich`);
            }
        }
    }

    return data;
}

export function formatCellValue(value: unknown): string {
    if (value === null || value === undefined) return "—";
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    const text = String(value);
    return text.length > 80 ? text.slice(0, 77) + "…" : text;
}

export function recordToFormValue(field: FieldConfig, value: unknown): string {
    if (value === null || value === undefined) {
        if (field.name === "kanton") return "ZH";
        if (field.name === "relevanz") return "mittel";
        if (field.name === "status") return "gestartet";
        if (field.name === "artikel_anzahl") return "0";
        return "";
    }
    if (field.type === "array" && Array.isArray(value)) return value.join(", ");
    if (field.type === "json" && typeof value === "object") return JSON.stringify(value, null, 2);
    if (value instanceof Date) return value.toISOString().slice(0, 16);
    return String(value);
}

export interface ListQuery {
    seite?: number;
    limit?: number;
    suche?: string;
    filter?: Record<string, string>;
    sort?: string;
}

export async function listRecords(key: string, query: ListQuery = {}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const config = resourceConfig(key);
    const seite = query.seite ?? 1;
    const limit = query.limit ?? 30;
    const offset = (seite - 1) * limit;
    const table = tableRef(config.table);
    const order = orderRef(resolveListOrderBy(config, query.sort));

    const bedingungen: ReturnType<typeof sql>[] = [];

    const suche = (query.suche || "").trim();
    if (suche) {
        const pattern = `%${suche}%`;
        const textCols = searchableFieldNames(config);
        const teile = textCols.map((col) => sql`${sql.unsafe(col)} ILIKE ${pattern}`);
        if (/^\d+$/.test(suche)) {
            teile.push(sql`id = ${Number(suche)}`);
        }
        if (teile.length === 1) {
            bedingungen.push(sql`(${teile[0]})`);
        } else if (teile.length > 1) {
            const orKlausel = teile.slice(1).reduce((acc, teil) => sql`${acc} OR ${teil}`, teile[0]);
            bedingungen.push(sql`(${orKlausel})`);
        }
    }

    for (const [fieldName, rawValue] of Object.entries(query.filter || {})) {
        if (!rawValue) continue;
        const field = fieldAllowed(config, fieldName);
        if (!field || field.type !== "select") continue;
        const wert = field.type === "select" && field.fk ? Number(rawValue) : rawValue;
        bedingungen.push(sql`${sql.unsafe(fieldName)} = ${wert}`);
    }

    const whereKlausel = bedingungen.length
        ? bedingungen.slice(1).reduce((acc, b) => sql`${acc} AND ${b}`, sql`WHERE ${bedingungen[0]}`)
        : sql``;

    const rows = await sql`
        SELECT * FROM ${table}
        ${whereKlausel}
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${offset}
    ` as Record<string, unknown>[];

    const [{ count }] = await sql`
        SELECT COUNT(*)::int as count FROM ${table} ${whereKlausel}
    ` as [{ count: number }];

    return { rows, total: count };
}

export async function getRecord(key: string, id: number): Promise<Record<string, unknown> | null> {
    const config = resourceConfig(key);
    const table = tableRef(config.table);
    const [row] = await sql`
        SELECT * FROM ${table} WHERE id = ${id}
    ` as Record<string, unknown>[];
    return row ?? null;
}

export async function createRecord(key: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const config = resourceConfig(key);
    const data = bodyToRecord(config, body, false);
    if (Object.keys(data).length === 0) throw new Error("Keine Felder zum Erstellen");

    const table = tableRef(config.table);
    const rows = await sql`
        INSERT INTO ${table} ${sql(data)}
        RETURNING *
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("Insert fehlgeschlagen");
    return row;
}

export async function updateRecord(key: string, id: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const config = resourceConfig(key);
    const data = bodyToRecord(config, body, true);
    if (Object.keys(data).length === 0) throw new Error("Keine Felder zum Aktualisieren");

    for (const name of Object.keys(data)) {
        if (!fieldAllowed(config, name)) throw new Error(`Feld nicht erlaubt: ${name}`);
    }

    const table = tableRef(config.table);
    const rows = await sql`
        UPDATE ${table} SET ${sql(data)} WHERE id = ${id} RETURNING *
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("Datensatz nicht gefunden");
    return row;
}

export async function deleteRecord(key: string, id: number): Promise<void> {
    const config = resourceConfig(key);
    const table = tableRef(config.table);
    await assertDeletable(key, id);
    try {
        const result = await sql`DELETE FROM ${table} WHERE id = ${id}`;
        if (result.count === 0) throw new Error("Datensatz nicht gefunden");
    } catch (err) {
        if (err instanceof Error && err.message.startsWith("Löschen nicht möglich")) throw err;
        throw new Error(friendlyDbError(err));
    }
}

/** FK dropdown options: id + label from related table */
export async function fkOptions(fkResource: string): Promise<Array<{ value: number; label: string }>> {
    switch (fkResource) {
        case "gemeinden":
            return sql`SELECT id::int as value, name as label FROM newsletterj_gemeinden ORDER BY name LIMIT 500` as unknown as Array<{ value: number; label: string }>;
        case "artikel":
            return sql`SELECT id::int as value, COALESCE(NULLIF(titel, ''), LEFT(url, 60)) as label FROM newsletterj_artikel ORDER BY gesucht_am DESC LIMIT 500` as unknown as Array<{ value: number; label: string }>;
        case "personen":
            return sql`SELECT id::int as value, name as label FROM newsletterj_personen ORDER BY name LIMIT 500` as unknown as Array<{ value: number; label: string }>;
        case "organisationen":
            return sql`SELECT id::int as value, name as label FROM newsletterj_organisationen ORDER BY name LIMIT 500` as unknown as Array<{ value: number; label: string }>;
        case "laeufe":
            return sql`SELECT id::int as value, ('Lauf #' || id || ' — ' || status)::text as label FROM newsletterj_laeufe ORDER BY gestartet_am DESC LIMIT 500` as unknown as Array<{ value: number; label: string }>;
        default:
            return sql`SELECT id::int as value, id::text as label FROM ${tableRef(resourceConfig(fkResource).table)} ORDER BY id DESC LIMIT 500` as unknown as Array<{ value: number; label: string }>;
    }
}

function guessLabelField(config: ResourceConfig): string {
    if (config.fields.some((f) => f.name === "name")) return "name";
    if (config.fields.some((f) => f.name === "titel")) return "titel";
    if (config.fields.some((f) => f.name === "url")) return "url";
    return "id";
}

export async function resolveFkLabel(fkResource: string, id: unknown): Promise<string> {
    if (id === null || id === undefined || id === "") return "—";
    const row = await getRecord(fkResource, Number(id));
    if (!row) return `#${id}`;
    const config = resourceConfig(fkResource);
    const labelField = guessLabelField(config);
    const val = row[labelField];
    return val ? String(val) : `#${id}`;
}
