import { Hono } from "hono";
import { esc } from "../html.js";
import {
    editableFields,
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

export const adminRoutes = new Hono();

adminRoutes.get("/", (c) => {
    const first = resourceKeys()[0];
    return c.redirect(`/admin/${first}`);
});

for (const key of resourceKeys()) {
    const config = resourceConfig(key);

    adminRoutes.get(`/${key}`, async (c) => {
        const seite = Math.max(1, Number(c.req.query("seite")) || 1);
        const { rows, total } = await listRecords(key, seite, 30);
        const gesamtSeiten = Math.max(1, Math.ceil(total / 30));
        const cols = listFields(config);

        const kopf = cols.map((f) => `<th>${esc(f.label)}</th>`).join("") + "<th>Aktionen</th>";

        const zeilen = await Promise.all(rows.map(async (row) => {
            const zellen = await Promise.all(cols.map(async (f) => {
                let val = row[f.name];
                if (f.fk && val != null) {
                    val = await resolveFkLabel(f.fk.resource, val);
                }
                return `<td>${esc(formatCellValue(val))}</td>`;
            }));
            return `<tr>
                ${zellen.join("")}
                <td class="actions">
                    <button class="btn btn-sm" hx-get="/admin/${key}/${row.id}/edit" hx-target="#crud-panel-wrap" hx-swap="innerHTML">Bearbeiten</button>
                    <button class="btn btn-sm btn-danger"
                        hx-delete="/api/${key}/${row.id}"
                        hx-swap="none"
                        hx-confirm="Datensatz #${row.id} wirklich löschen?"
                        hx-on::after-request="if(event.detail.successful) htmx.ajax('GET', '/admin/${key}', '#crud-main')">
                        Löschen
                    </button>
                </td>
            </tr>`;
        }));

        const pagination = gesamtSeiten > 1 ? `
            <div class="pagination">
                ${seite > 1 ? `<button class="btn btn-sm" hx-get="/admin/${key}?seite=${seite - 1}" hx-target="#crud-main">← Zurück</button>` : ""}
                <span>Seite ${seite} von ${gesamtSeiten} (${total} total)</span>
                ${seite < gesamtSeiten ? `<button class="btn btn-sm" hx-get="/admin/${key}?seite=${seite + 1}" hx-target="#crud-main">Weiter →</button>` : ""}
            </div>` : `<p class="muted">${total} Datensätze</p>`;

        return c.html(`
            <div id="crud-main">
                <div class="header-row">
                    <h2>${esc(config.label)}</h2>
                    <button class="btn btn-primary btn-sm" hx-get="/admin/${key}/new" hx-target="#crud-panel-wrap" hx-swap="innerHTML">+ Neu</button>
                </div>
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

    adminRoutes.get(`/${key}/:id/edit`, async (c) => {
        const id = Number(c.req.param("id"));
        const row = await getRecord(key, id);
        if (!row) return c.html('<p class="error">Nicht gefunden</p>', 404);
        return c.html(await formularHtml(key, row));
    });
}

/** HTMX: after successful API create/update, refresh list */
adminRoutes.post("/_refresh/:key", (c) => {
    const key = c.req.param("key");
    return c.redirect(`/admin/${key}`);
});

async function formularHtml(key: string, row: Record<string, unknown> | null): Promise<string> {
    const config = resourceConfig(key);
    const isEdit = row !== null;
    const felder = editableFields(config);
    const inputs = await Promise.all(felder.map((f) => feldInputHtml(f, row?.[f.name])));

    return `
        <div id="crud-panel" class="form-card">
            <h3>${isEdit ? `Bearbeiten #${row!.id}` : "Neu erstellen"} — ${esc(config.label)}</h3>
            <form ${isEdit
                ? `hx-put="/api/${key}/${row!.id}"`
                : `hx-post="/api/${key}"`}
                hx-swap="none"
                hx-on::after-request="if(event.detail.successful) { htmx.ajax('GET', '/admin/${key}', '#crud-main'); document.getElementById('crud-panel-wrap').innerHTML = ''; }">
                ${inputs.join("")}
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${isEdit ? "Speichern" : "Erstellen"}</button>
                    <button type="button" class="btn" onclick="document.getElementById('crud-panel-wrap').innerHTML = ''">Abbrechen</button>
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
