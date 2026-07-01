import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/", async (c) => {
    const [artikelStats] = await sql`
        SELECT COUNT(*)::int as gesamt,
            COUNT(*) FILTER (WHERE gesucht_am > NOW() - INTERVAL '7 days')::int as diese_woche
        FROM newsletterj_artikel
    `;
    const [personenStats] = await sql`SELECT COUNT(*)::int as gesamt FROM newsletterj_personen`;
    const [ereignisseStats] = await sql`SELECT COUNT(*)::int as gesamt FROM newsletterj_ereignisse`;

    const topKategorien = await sql`
        SELECT kategorie, COUNT(*)::int as anzahl
        FROM newsletterj_artikel
        WHERE kategorie IS NOT NULL AND gesucht_am > NOW() - INTERVAL '30 days'
        GROUP BY kategorie ORDER BY anzahl DESC LIMIT 8
    `;

    const topPersonen = await sql`
        SELECT p.name, p.aktuelle_funktion, p.artikel_anzahl
        FROM newsletterj_personen p
        ORDER BY p.artikel_anzahl DESC, p.zuletzt_gesehen_am DESC
        LIMIT 8
    `;

    const letzteArtikel = await sql`
        SELECT a.id, a.titel, a.quellen_name, a.kategorie, a.relevanz, a.gesucht_am,
            g.name as gemeinde_name
        FROM newsletterj_artikel a
        LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
        ORDER BY a.gesucht_am DESC LIMIT 10
    `;

    const kategorienHtml = topKategorien.map((k) => `
        <div class="stat-badge">${esc(k.kategorie.replace(/_/g, " "))} <strong>${k.anzahl}</strong></div>
    `).join("");

    const personenHtml = topPersonen.map((p) => `
        <li>${esc(p.name)} <span class="muted">${esc(p.aktuelle_funktion || "")}</span> <strong>${p.artikel_anzahl}</strong></li>
    `).join("");

    const artikelHtml = letzteArtikel.map((a) => `
        <tr>
            <td>${esc(a.titel || "Ohne Titel")}</td>
            <td><span class="badge">${esc(a.kategorie || "")}</span></td>
            <td><span class="badge badge-${a.relevanz}">${a.relevanz}</span></td>
            <td class="muted">${esc(a.gemeinde_name || "")}</td>
            <td class="muted">${esc(a.quellen_name || "")}</td>
        </tr>
    `).join("");

    return c.html(`
        <h2>Übersicht</h2>
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${artikelStats.gesamt}</div><div class="stat-label">Artikel gesamt</div></div>
            <div class="stat-card"><div class="stat-value">${artikelStats.diese_woche}</div><div class="stat-label">Diese Woche</div></div>
            <div class="stat-card"><div class="stat-value">${personenStats.gesamt}</div><div class="stat-label">Personen</div></div>
            <div class="stat-card"><div class="stat-value">${ereignisseStats.gesamt}</div><div class="stat-label">Ereignisse</div></div>
        </div>

        <div class="section-row">
            <div class="section-half">
                <h3>Trending Kategorien (30 Tage)</h3>
                <div class="badge-grid">${kategorienHtml || '<span class="muted">Noch keine Daten</span>'}</div>
            </div>
            <div class="section-half">
                <h3>Meist erwähnte Personen</h3>
                <ul class="simple-list">${personenHtml || '<li class="muted">Noch keine Daten</li>'}</ul>
            </div>
        </div>

        <h3>Letzte Artikel</h3>
        <table>
            <thead><tr><th>Titel</th><th>Kategorie</th><th>Relevanz</th><th>Gemeinde</th><th>Quelle</th></tr></thead>
            <tbody>${artikelHtml || '<tr><td colspan="5" class="empty">Noch keine Artikel</td></tr>'}</tbody>
        </table>
    `);
});
