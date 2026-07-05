import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";
import { zeitraumOptionen, datumFormatieren } from "../ui.js";
import { dossierErstellen } from "../lib/dossier.js";

export const dossierRoutes = new Hono();

const SEITEN_GROESSE = 20;

function statusKlasse(status: string): string {
    switch (status) {
        case "abgeschlossen": return "sent";
        case "fehlgeschlagen": return "failed";
        default: return "started";
    }
}

async function dossierListeAnsicht(
    seite = 1,
    hinweis?: { typ: "success" | "error"; text: string }
): Promise<string> {
    const offset = (seite - 1) * SEITEN_GROESSE;

    const dossiers = await sql`
        SELECT id, status, tage, zeitraum_label, statistik_json,
            gestartet_am, abgeschlossen_am, fehlermeldung
        FROM newsletterj_dossiers
        ORDER BY gestartet_am DESC
        LIMIT ${SEITEN_GROESSE} OFFSET ${offset}
    `;

    const [{ count: anzahl }] = await sql`
        SELECT COUNT(*)::int AS count FROM newsletterj_dossiers
    ` as unknown as [{ count: number }];

    const gesamtSeiten = Math.ceil(anzahl / SEITEN_GROESSE);

    const zeilen = dossiers.map((d) => {
        const stats = d.statistik_json as { artikel?: number } | null;
        return `
            <tr>
                <td><span class="badge badge-${statusKlasse(String(d.status))}">${esc(String(d.status))}</span></td>
                <td>${esc(d.zeitraum_label)}</td>
                <td>${stats?.artikel ?? "—"}</td>
                <td class="muted">${datumFormatieren(d.gestartet_am, true)}</td>
                <td class="muted">${d.abgeschlossen_am ? datumFormatieren(d.abgeschlossen_am, true) : "—"}</td>
                <td class="actions">
                    ${d.status === "abgeschlossen"
                        ? `<button class="btn btn-sm" hx-get="/api/dossier/${d.id}" hx-target="#content">Ansehen</button>`
                        : d.fehlermeldung
                            ? `<span class="error" title="${esc(String(d.fehlermeldung))}">Fehler</span>`
                            : ""}
                    <button class="btn btn-sm btn-danger"
                        hx-delete="/api/dossier/${d.id}?seite=${seite}"
                        hx-target="#content"
                        hx-confirm="Dossier #${d.id} (${esc(d.zeitraum_label)}) löschen?">
                        Löschen
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    const pagination = gesamtSeiten > 1 ? `
        <div class="pagination">
            ${seite > 1 ? `<button class="btn btn-sm" hx-get="/api/dossier?seite=${seite - 1}" hx-target="#content">← Zurück</button>` : ""}
            <span>Seite ${seite} von ${gesamtSeiten}</span>
            ${seite < gesamtSeiten ? `<button class="btn btn-sm" hx-get="/api/dossier?seite=${seite + 1}" hx-target="#content">Weiter →</button>` : ""}
        </div>
    ` : "";

    return `
        <div class="header-row">
            <div class="header-row-title">
                <h2>Dossier</h2>
            </div>
            <div class="header-row-actions">
                <span class="muted">${anzahl} Einträge</span>
            </div>
        </div>

        <div class="dossier-composer card">
            <h3>Recherche-Dossier erstellen</h3>
            <p class="muted">SQL-Auswertung aller erfassten Daten für den gewählten Zeitraum.</p>
            <form class="filter-bar dossier-form" hx-post="/api/dossier/run" hx-target="#content">
                <label>
                    Zeitraum
                    <select name="tage">
                        <option value="">Gesamter Zeitraum</option>
                        ${zeitraumOptionen("30")}
                    </select>
                </label>
                <button type="submit" class="btn btn-primary">Dossier generieren</button>
            </form>
        </div>

        ${hinweis ? `<div class="flash flash-${hinweis.typ}" role="status">${esc(hinweis.text)}</div>` : ""}

        <table>
            <thead>
                <tr>
                    <th>Status</th>
                    <th>Zeitraum</th>
                    <th>Artikel</th>
                    <th>Gestartet</th>
                    <th>Abgeschlossen</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>${zeilen || '<tr><td colspan="6" class="empty">Noch keine Dossiers</td></tr>'}</tbody>
        </table>
        ${pagination}
    `;
}

dossierRoutes.get("/", async (c) => {
    const seite = Math.max(1, Number(c.req.query("seite")) || 1);
    return c.html(await dossierListeAnsicht(seite));
});

dossierRoutes.post("/run", async (c) => {
    const body = await c.req.parseBody();
    const tageRaw = typeof body.tage === "string" ? body.tage : "";
    const tage = tageRaw ? Number(tageRaw) || 0 : 0;

    try {
        const id = await dossierErstellen(tage);

        const [dossier] = await sql`
            SELECT id, zeitraum_label, inhalt_html, status, gestartet_am
            FROM newsletterj_dossiers
            WHERE id = ${id}
        `;

        if (!dossier?.inhalt_html) {
            return c.html(
                await dossierListeAnsicht(1, {
                    typ: "success",
                    text: `Dossier #${id} wurde erstellt.`,
                })
            );
        }

        return c.html(`
            <div class="flash flash-success" role="status">Dossier #${id} wurde erstellt.</div>
            <div class="header-row">
                <div class="header-row-title">
                    <button class="btn btn-sm" hx-get="/api/dossier" hx-target="#content">← Zurück</button>
                    <h2>Dossier #${dossier.id}</h2>
                </div>
                <div class="header-row-actions">
                    <span class="muted">${esc(dossier.zeitraum_label)} · ${datumFormatieren(dossier.gestartet_am, true)}</span>
                </div>
            </div>
            ${dossier.inhalt_html}
        `);
    } catch (fehler) {
        const meldung = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
        return c.html(
            await dossierListeAnsicht(1, { typ: "error", text: `Dossier-Erstellung fehlgeschlagen: ${meldung}` }),
            500
        );
    }
});

dossierRoutes.get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!id) return c.html("<p class='error'>Ungültige ID</p>", 400);

    const [dossier] = await sql`
        SELECT id, zeitraum_label, inhalt_html, status, gestartet_am
        FROM newsletterj_dossiers
        WHERE id = ${id}
    `;

    if (!dossier) return c.html("<p class='error'>Dossier nicht gefunden</p>", 404);
    if (dossier.status !== "abgeschlossen" || !dossier.inhalt_html) {
        return c.html("<p class='error'>Dossier ist nicht verfügbar</p>", 404);
    }

    return c.html(`
        <div class="header-row">
            <div class="header-row-title">
                <button class="btn btn-sm" hx-get="/api/dossier" hx-target="#content">← Zurück</button>
                <h2>Dossier #${dossier.id}</h2>
            </div>
            <div class="header-row-actions">
                <span class="muted">${esc(dossier.zeitraum_label)} · ${datumFormatieren(dossier.gestartet_am, true)}</span>
            </div>
        </div>
        ${dossier.inhalt_html}
    `);
});

dossierRoutes.delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!id) return c.html("<p class='error'>Ungültige ID</p>", 400);

    const seite = Math.max(1, Number(c.req.query("seite")) || 1);

    const geloescht = await sql`
        DELETE FROM newsletterj_dossiers WHERE id = ${id} RETURNING id
    `;

    if (geloescht.length === 0) {
        return c.html(
            await dossierListeAnsicht(seite, { typ: "error", text: `Dossier #${id} nicht gefunden.` }),
            404
        );
    }

    const [{ count: anzahl }] = await sql`
        SELECT COUNT(*)::int AS count FROM newsletterj_dossiers
    ` as unknown as [{ count: number }];

    const gesamtSeiten = Math.max(1, Math.ceil(anzahl / SEITEN_GROESSE));
    const zielSeite = Math.min(seite, gesamtSeiten);

    return c.html(
        await dossierListeAnsicht(zielSeite, {
            typ: "success",
            text: `Dossier #${id} wurde gelöscht.`,
        })
    );
});
