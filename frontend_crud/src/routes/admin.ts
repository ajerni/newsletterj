import { Hono } from "hono";
import { esc } from "../html.js";
import {
    editableFields,
    filterFields,
    listFields,
    resourceConfig,
    resourceKeys,
    type FieldConfig,
} from "../config/resources.js";
import {
    listRecords,
    getRecord,
    createRecord,
    updateRecord,
    deleteRecord,
    formatCellValue,
    recordToFormValue,
    fkOptions,
    resolveFkLabel,
} from "../lib/crud.js";
import { parseBody } from "../lib/parse-body.js";

export const adminRoutes = new Hono();

const SEITEN_GROESSE = 30;

adminRoutes.get("/", (c) => c.redirect("/admin/gemeinden"));

function refreshUrlFromRequest(c: { req: { header: (k: string) => string | undefined } }, key: string): string {
    const current = c.req.header("HX-Current-URL");
    if (current) {
        try {
            const u = new URL(current);
            if (u.pathname === `/admin/${key}`) return u.pathname + u.search;
        } catch { /* ignore */ }
    }
    return `/admin/${key}`;
}

function queryParams(c: { req: { query: (k: string) => string | undefined } }, key: string) {
    const seite = Math.max(1, Number(c.req.query("seite")) || 1);
    const suche = (c.req.query("suche") || "").trim();
    const config = resourceConfig(key);
    const filter: Record<string, string> = {};
    for (const f of filterFields(config)) {
        const v = c.req.query(f.name);
        if (v) filter[f.name] = v;
    }
    const sort = config.listSort
        ? (c.req.query(config.listSort.param) || config.listSort.default)
        : undefined;
    return { seite, suche, filter, sort };
}

function filterQueryString(key: string, seite: number, suche: string, filter: Record<string, string>, sort?: string) {
    const config = resourceConfig(key);
    const teile = [`suche=${encodeURIComponent(suche)}`];
    for (const [k, v] of Object.entries(filter)) {
        teile.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    if (config.listSort && sort && sort !== config.listSort.default) {
        teile.push(`${encodeURIComponent(config.listSort.param)}=${encodeURIComponent(sort)}`);
    }
    if (seite > 1) teile.push(`seite=${seite}`);
    return `/admin/${key}?${teile.join("&")}`;
}

function hasActiveFilters(config: ReturnType<typeof resourceConfig>, suche: string, filter: Record<string, string>, sort?: string): boolean {
    if (suche) return true;
    if (Object.keys(filter).length > 0) return true;
    if (config.listSort && sort && sort !== config.listSort.default) return true;
    return false;
}

for (const key of resourceKeys()) {
    const config = resourceConfig(key);

    adminRoutes.get(`/${key}`, async (c) => {
        const { seite, suche, filter, sort } = queryParams(c, key);
        const { rows, total } = await listRecords(key, { seite, limit: SEITEN_GROESSE, suche, filter, sort });
        const gesamtSeiten = Math.max(1, Math.ceil(total / SEITEN_GROESSE));
        const cols = listFields(config);
        const basisQuery = filterQueryString(key, 1, suche, filter, sort).replace(/&seite=\d+/, "");

        const kopf = cols.map((f) => `<th>${esc(f.label)}</th>`).join("") + "<th>Aktionen</th>";

        const zeilen = await Promise.all(rows.map(async (row) => {
            const zellen = await Promise.all(cols.map(async (f) => {
                let val = row[f.name];
                if (f.fk && val != null) val = await resolveFkLabel(f.fk.resource, val);
                return `<td>${esc(formatCellValue(val))}</td>`;
            }));
            return `<tr>
                ${zellen.join("")}
                <td class="actions">
                    <button type="button" class="btn btn-sm"
                        hx-get="/admin/${key}/${row.id}/edit"
                        hx-target="#crud-panel-wrap"
                        hx-swap="innerHTML">Bearbeiten</button>
                    <button type="button" class="btn btn-sm btn-danger"
                        hx-delete="/admin/${key}/${row.id}"
                        hx-swap="none"
                        hx-confirm="Datensatz #${row.id} wirklich löschen?">
                        Löschen
                    </button>
                </td>
            </tr>`;
        }));

        const filterInputs = await Promise.all(filterFields(config).map((f) => filterSelectHtml(f, filter[f.name] || "")));
        const sortInput = sortSelectHtml(config, sort || config.listSort?.default || "");

        const pagination = gesamtSeiten > 1 ? `
            <div class="pagination">
                ${seite > 1 ? `<button type="button" class="btn btn-sm" hx-get="${filterQueryString(key, seite - 1, suche, filter, sort)}" hx-target="#crud-main">← Zurück</button>` : ""}
                <span>Seite ${seite} von ${gesamtSeiten} (${total} total)</span>
                ${seite < gesamtSeiten ? `<button type="button" class="btn btn-sm" hx-get="${filterQueryString(key, seite + 1, suche, filter, sort)}" hx-target="#crud-main">Weiter →</button>` : ""}
            </div>` : `<p class="muted">${total} Datensätze</p>`;

        return c.html(`
            <div id="crud-main">
                <div class="header-row">
                    <h2>${esc(config.label)}</h2>
                    <button type="button" class="btn btn-primary btn-sm"
                        hx-get="/admin/${key}/new"
                        hx-target="#crud-panel-wrap"
                        hx-swap="innerHTML">+ Neu</button>
                </div>
                <form class="filter-bar filter-bar-grid"
                    hx-get="/admin/${key}"
                    hx-target="#crud-main"
                    hx-trigger="change, submit, input delay:400ms from:input[name='suche']"
                    hx-include="this">
                    <input type="search" name="suche" class="filter-suche"
                        placeholder="Suchen in ${esc(config.label)}…"
                        value="${esc(suche)}">
                    ${sortInput}
                    ${filterInputs.join("")}
                    ${hasActiveFilters(config, suche, filter, sort) ? `<button type="button" class="btn btn-sm" hx-get="/admin/${key}" hx-target="#crud-main">Filter zurücksetzen</button>` : ""}
                </form>
                <table>
                    <thead><tr>${kopf}</tr></thead>
                    <tbody>${zeilen.join("") || `<tr><td colspan="${cols.length + 1}" class="empty">Keine Datensätze</td></tr>`}</tbody>
                </table>
                ${pagination}
            </div>
        `);
    });

    adminRoutes.get(`/${key}/new`, async (c) => {
        return c.html(await formularHtml(key, null));
    });

    adminRoutes.post(`/${key}`, async (c) => {
        try {
            const body = await parseBody(c);
            await createRecord(key, body);
            return c.html("", 200, {
                "HX-Reswap": "none",
                "HX-Trigger": JSON.stringify({ crudToast: { message: "Erstellt", refreshUrl: refreshUrlFromRequest(c, key) } }),
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Fehler";
            return c.html(await formularHtml(key, null, msg), 422);
        }
    });

    adminRoutes.get(`/${key}/:id/edit`, async (c) => {
        const id = Number(c.req.param("id"));
        if (Number.isNaN(id)) return c.html('<p class="error">Ungültige ID</p>', 400);
        const row = await getRecord(key, id);
        if (!row) return c.html('<p class="error">Nicht gefunden</p>', 404);
        return c.html(await formularHtml(key, row));
    });

    adminRoutes.put(`/${key}/:id`, async (c) => {
        const id = Number(c.req.param("id"));
        if (Number.isNaN(id)) return c.html('<p class="error">Ungültige ID</p>', 400);
        try {
            const body = await parseBody(c);
            await updateRecord(key, id, body);
            return c.html("", 200, {
                "HX-Reswap": "none",
                "HX-Trigger": JSON.stringify({ crudToast: { message: "Gespeichert", refreshUrl: refreshUrlFromRequest(c, key) } }),
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Fehler";
            const row = await getRecord(key, id);
            return c.html(await formularHtml(key, row, msg), 422);
        }
    });

    adminRoutes.delete(`/${key}/:id`, async (c) => {
        const id = Number(c.req.param("id"));
        if (Number.isNaN(id)) return c.json({ error: "Ungültige ID" }, 400);
        try {
            await deleteRecord(key, id);
            return c.body(null, 204, {
                "HX-Trigger": JSON.stringify({ crudToast: { message: "Gelöscht", refreshUrl: refreshUrlFromRequest(c, key) } }),
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Fehler";
            return c.body(null, 200, {
                "HX-Trigger": JSON.stringify({ crudToast: { message: msg, isError: true } }),
            });
        }
    });
}

function sortSelectHtml(config: ReturnType<typeof resourceConfig>, selected: string): string {
    if (!config.listSort) return "";
    const opts = config.listSort.options.map((o) =>
        `<option value="${esc(o.value)}" ${selected === o.value ? "selected" : ""}>${esc(o.label)}</option>`
    ).join("");
    return `<select name="${esc(config.listSort.param)}" title="Sortierung nach Veröffentlichungsdatum">${opts}</select>`;
}

async function filterSelectHtml(field: FieldConfig, selected: string): Promise<string> {
    const leer = `<option value="">Alle ${esc(field.label)}</option>`;
    if (field.options) {
        const opts = field.options.map((o) =>
            `<option value="${esc(o.value)}" ${selected === o.value ? "selected" : ""}>${esc(o.label)}</option>`
        ).join("");
        return `<select name="${esc(field.name)}">${leer}${opts}</select>`;
    }
    if (field.fk) {
        const options = await fkOptions(field.fk.resource);
        const opts = options.map((o) =>
            `<option value="${o.value}" ${selected === String(o.value) ? "selected" : ""}>${esc(o.label)}</option>`
        ).join("");
        return `<select name="${esc(field.name)}">${leer}${opts}</select>`;
    }
    return "";
}

async function formularHtml(key: string, row: Record<string, unknown> | null, fehler?: string): Promise<string> {
    const config = resourceConfig(key);
    const isEdit = row !== null;
    const felder = editableFields(config);
    const inputs = await Promise.all(felder.map((f) => feldInputHtml(f, row?.[f.name])));

    return `
        <div id="crud-panel" class="form-card">
            <h3>${isEdit ? `Bearbeiten #${row!.id}` : "Neu erstellen"} — ${esc(config.label)}</h3>
            ${fehler ? `<p class="error">${esc(fehler)}</p>` : ""}
            <form method="post"
                action="${isEdit ? `/admin/${key}/${row!.id}` : `/admin/${key}`}"
                ${isEdit ? `hx-put="/admin/${key}/${row!.id}"` : `hx-post="/admin/${key}"`}
                hx-target="#crud-panel-wrap"
                hx-swap="innerHTML">
                ${inputs.join("")}
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${isEdit ? "Speichern" : "Erstellen"}</button>
                    <button type="button" class="btn" onclick="document.getElementById('crud-panel-wrap').innerHTML=''">Abbrechen</button>
                </div>
            </form>
        </div>
    `;
}

async function feldInputHtml(field: FieldConfig, value: unknown): Promise<string> {
    const val = recordToFormValue(field, value);
    const req = field.required ? " required" : "";

    if (field.type === "select" && field.options) {
        const opts = field.options.map((o) =>
            `<option value="${esc(o.value)}" ${val === o.value ? "selected" : ""}>${esc(o.label)}</option>`
        ).join("");
        return `<label>${esc(field.label)}<select name="${esc(field.name)}"${req}><option value="">—</option>${opts}</select></label>`;
    }

    if (field.type === "select" && field.fk) {
        const options = await fkOptions(field.fk.resource);
        const opts = options.map((o) =>
            `<option value="${o.value}" ${String(val) === String(o.value) ? "selected" : ""}>${esc(o.label)}</option>`
        ).join("");
        return `<label>${esc(field.label)}<select name="${esc(field.name)}"${req}><option value="">—</option>${opts}</select></label>`;
    }

    if (field.type === "textarea" || field.type === "json") {
        const rows = field.type === "json" ? 6 : 3;
        return `<label>${esc(field.label)}<textarea name="${esc(field.name)}" rows="${rows}"${req}>${esc(val)}</textarea></label>`;
    }

    const inputType = field.type === "number" ? "number" : field.type === "datetime" ? "datetime-local" : "text";
    return `<label>${esc(field.label)}<input type="${inputType}" name="${esc(field.name)}" value="${esc(val)}"${req}></label>`;
}
