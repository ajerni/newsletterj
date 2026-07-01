import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";

export const ereignisseRoutes = new Hono();

ereignisseRoutes.get("/", async (c) => {
    const typ = c.req.query("typ") || null;

    const ereignisse = typ
        ? await sql`
            SELECT e.*, g.name as gemeinde_name, a.titel as artikel_titel, a.url as artikel_url
            FROM newsletterj_ereignisse e
            LEFT JOIN newsletterj_gemeinden g ON g.id = e.gemeinde_id
            JOIN newsletterj_artikel a ON a.id = e.artikel_id
            WHERE e.typ = ${typ}
            ORDER BY e.erstellt_am DESC LIMIT 50
          `
        : await sql`
            SELECT e.*, g.name as gemeinde_name, a.titel as artikel_titel, a.url as artikel_url
            FROM newsletterj_ereignisse e
            LEFT JOIN newsletterj_gemeinden g ON g.id = e.gemeinde_id
            JOIN newsletterj_artikel a ON a.id = e.artikel_id
            ORDER BY e.erstellt_am DESC LIMIT 50
          `;

    const zeilen = ereignisse.map((e) => `
        <tr>
            <td><span class="badge">${esc(e.typ)}</span></td>
            <td>${esc(e.titel)}</td>
            <td class="muted">${esc(e.gemeinde_name || "—")}</td>
            <td><span class="badge badge-${e.relevanz}">${e.relevanz}</span></td>
            <td><a href="${esc(e.artikel_url)}" target="_blank" class="muted">${esc((e.artikel_titel || "").slice(0, 40))}</a></td>
            <td class="muted">${e.ereignis_datum ? datumFormatieren(e.ereignis_datum) : "—"}</td>
        </tr>
    `).join("");

    return c.html(`
        <div class="header-row">
            <h2>Ereignisse</h2>
            <span class="muted">${ereignisse.length} Einträge</span>
        </div>
        <form class="filter-bar" hx-get="/api/ereignisse" hx-target="#content" hx-trigger="change" hx-include="this">
            <select name="typ">
                <option value="">Alle Typen</option>
                <option value="konflikte" ${typ === "konflikte" ? "selected" : ""}>Konflikte</option>
                <option value="ruecktritte" ${typ === "ruecktritte" ? "selected" : ""}>Rücktritte</option>
                <option value="wahlen" ${typ === "wahlen" ? "selected" : ""}>Wahlen</option>
                <option value="fuehrungswechsel" ${typ === "fuehrungswechsel" ? "selected" : ""}>Führungswechsel</option>
                <option value="kuendigungen" ${typ === "kuendigungen" ? "selected" : ""}>Kündigungen</option>
                <option value="finanzen" ${typ === "finanzen" ? "selected" : ""}>Finanzen</option>
                <option value="bauprojekte" ${typ === "bauprojekte" ? "selected" : ""}>Bauprojekte</option>
                <option value="gewalt" ${typ === "gewalt" ? "selected" : ""}>Gewalt</option>
            </select>
        </form>
        <table>
            <thead><tr><th>Typ</th><th>Titel</th><th>Gemeinde</th><th>Relevanz</th><th>Artikel</th><th>Datum</th></tr></thead>
            <tbody>${zeilen || '<tr><td colspan="6" class="empty">Noch keine Ereignisse</td></tr>'}</tbody>
        </table>
    `);
});

function datumFormatieren(d: Date | string): string {
    return new Date(d).toLocaleString("de-CH", { dateStyle: "short" });
}
