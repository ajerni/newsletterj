import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";
import { kategorieLabel, datumRelativ, relevanzBadge } from "../ui.js";
import { artikelKarte } from "./artikel.js";

export const gemeindenRoutes = new Hono();

gemeindenRoutes.get("/", async (c) => {
    const suche = (c.req.query("suche") || "").trim();

    const gemeinden = suche
        ? await sql`
            SELECT g.*,
                (SELECT COUNT(*)::int FROM newsletterj_artikel a WHERE a.gemeinde_id = g.id) as artikel_anzahl,
                (SELECT COUNT(*)::int FROM newsletterj_personen p WHERE p.aktuelle_gemeinde_id = g.id) as personen_anzahl,
                (SELECT COUNT(*)::int FROM newsletterj_ereignisse e WHERE e.gemeinde_id = g.id) as ereignisse_anzahl
            FROM newsletterj_gemeinden g
            WHERE g.name ILIKE ${"%" + suche + "%"}
            ORDER BY (SELECT COUNT(*) FROM newsletterj_artikel a WHERE a.gemeinde_id = g.id) DESC
          `
        : await sql`
            SELECT g.*,
                (SELECT COUNT(*)::int FROM newsletterj_artikel a WHERE a.gemeinde_id = g.id) as artikel_anzahl,
                (SELECT COUNT(*)::int FROM newsletterj_personen p WHERE p.aktuelle_gemeinde_id = g.id) as personen_anzahl,
                (SELECT COUNT(*)::int FROM newsletterj_ereignisse e WHERE e.gemeinde_id = g.id) as ereignisse_anzahl
            FROM newsletterj_gemeinden g
            ORDER BY (SELECT COUNT(*) FROM newsletterj_artikel a WHERE a.gemeinde_id = g.id) DESC
          `;

    const zeilen = gemeinden.map((g) => `
        <tr>
            <td><a href="#" hx-get="/api/gemeinden/${g.id}" hx-target="#content"><strong>${esc(g.name)}</strong></a></td>
            <td class="muted">${(g.aliase as string[]).length > 0 ? esc((g.aliase as string[]).join(", ")) : "—"}</td>
            <td>${g.artikel_anzahl}</td>
            <td>${g.personen_anzahl}</td>
            <td>${g.ereignisse_anzahl}</td>
        </tr>
    `).join("");

    return c.html(`
        <div class="header-row">
            <h2>Gemeinden</h2>
            <span class="muted">${gemeinden.length} erfasst</span>
        </div>
        <form class="filter-bar" hx-get="/api/gemeinden" hx-target="#content" hx-trigger="submit, input delay:400ms from:input[name='suche']" hx-include="this">
            <input type="search" name="suche" placeholder="Gemeinde suchen…" value="${esc(suche)}" class="filter-suche">
        </form>
        <table>
            <thead><tr><th>Gemeinde</th><th>Aliase</th><th>Artikel</th><th>Personen</th><th>Ereignisse</th></tr></thead>
            <tbody>${zeilen || '<tr><td colspan="5" class="empty">Keine Gemeinden gefunden</td></tr>'}</tbody>
        </table>
    `);
});

gemeindenRoutes.get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [gemeinde] = await sql`SELECT * FROM newsletterj_gemeinden WHERE id = ${id}`;
    if (!gemeinde) return c.html('<p class="error">Gemeinde nicht gefunden</p>', 404);

    const artikel = await sql`
        SELECT a.*, g.name as gemeinde_name,
            (SELECT COUNT(*)::int FROM newsletterj_erwaehnungen e WHERE e.artikel_id = a.id) as personen_anzahl
        FROM newsletterj_artikel a
        LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
        WHERE a.gemeinde_id = ${id}
        ORDER BY a.gesucht_am DESC
        LIMIT 15
    `;

    const personen = await sql`
        SELECT p.id, p.name, p.aktuelle_funktion, p.artikel_anzahl
        FROM newsletterj_personen p
        WHERE p.aktuelle_gemeinde_id = ${id}
        ORDER BY p.artikel_anzahl DESC
        LIMIT 15
    `;

    const ereignisse = await sql`
        SELECT e.typ, e.titel, e.relevanz, e.erstellt_am, e.artikel_id
        FROM newsletterj_ereignisse e
        WHERE e.gemeinde_id = ${id}
        ORDER BY e.erstellt_am DESC
        LIMIT 10
    `;

    const kategorien = await sql`
        SELECT kategorie, COUNT(*)::int as anzahl
        FROM newsletterj_artikel
        WHERE gemeinde_id = ${id} AND kategorie IS NOT NULL
        GROUP BY kategorie ORDER BY anzahl DESC LIMIT 8
    `;

    const personenHtml = personen.map((p) => `
        <li><a href="#" hx-get="/api/personen/${p.id}" hx-target="#content">${esc(p.name)}</a>
        <span class="muted">${esc(p.aktuelle_funktion || "")}</span> <strong>${p.artikel_anzahl}</strong></li>
    `).join("");

    const ereignisseHtml = ereignisse.map((e) => `
        <li>
            <span class="badge">${esc(kategorieLabel(e.typ))}</span>
            <a href="#" hx-get="/api/artikel/${e.artikel_id}" hx-target="#content">${esc(e.titel)}</a>
            ${relevanzBadge(e.relevanz)}
            <span class="muted">${datumRelativ(e.erstellt_am)}</span>
        </li>
    `).join("");

    const kategorienHtml = kategorien.map((k) => `
        <div class="stat-badge" hx-get="/api/artikel?gemeinde=${id}&kategorie=${esc(k.kategorie)}" hx-target="#content">${esc(kategorieLabel(k.kategorie))} <strong>${k.anzahl}</strong></div>
    `).join("");

    const artikelHtml = artikel.map((a) => artikelKarte(a)).join("");

    return c.html(`
        <button class="btn btn-sm" hx-get="/api/gemeinden" hx-target="#content">← Zurück</button>
        <h2>${esc(gemeinde.name)}</h2>
        ${(gemeinde.aliase as string[]).length ? `<p class="muted">Aliase: ${esc((gemeinde.aliase as string[]).join(", "))}</p>` : ""}

        ${kategorien.length ? `<h3>Themen</h3><div class="badge-grid">${kategorienHtml}</div>` : ""}

        <div class="section-row">
            ${personen.length ? `<div class="section-half"><h3>Personen</h3><ul class="simple-list">${personenHtml}</ul></div>` : ""}
            ${ereignisse.length ? `<div class="section-half"><h3>Ereignisse</h3><ul class="simple-list ereignis-liste">${ereignisseHtml}</ul></div>` : ""}
        </div>

        <h3>Artikel (neueste 15)</h3>
        <div class="artikel-liste">${artikelHtml || '<p class="empty">Keine Artikel</p>'}</div>
        ${artikel.length === 15 ? `<button class="btn btn-sm" hx-get="/api/artikel?gemeinde=${id}" hx-target="#content">Alle Artikel dieser Gemeinde →</button>` : ""}
    `);
});
