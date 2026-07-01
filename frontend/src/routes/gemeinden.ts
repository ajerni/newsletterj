import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";

export const gemeindenRoutes = new Hono();

gemeindenRoutes.get("/", async (c) => {
    const gemeinden = await sql`
        SELECT g.*,
            (SELECT COUNT(*)::int FROM newsletterj_artikel a WHERE a.gemeinde_id = g.id) as artikel_anzahl,
            (SELECT COUNT(*)::int FROM newsletterj_personen p WHERE p.aktuelle_gemeinde_id = g.id) as personen_anzahl,
            (SELECT COUNT(*)::int FROM newsletterj_ereignisse e WHERE e.gemeinde_id = g.id) as ereignisse_anzahl
        FROM newsletterj_gemeinden g
        ORDER BY (SELECT COUNT(*) FROM newsletterj_artikel a WHERE a.gemeinde_id = g.id) DESC
    `;

    const zeilen = gemeinden.map((g) => `
        <tr>
            <td><strong>${esc(g.name)}</strong></td>
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
        <table>
            <thead><tr><th>Gemeinde</th><th>Aliase</th><th>Artikel</th><th>Personen</th><th>Ereignisse</th></tr></thead>
            <tbody>${zeilen || '<tr><td colspan="5" class="empty">Noch keine Gemeinden erfasst</td></tr>'}</tbody>
        </table>
    `);
});
