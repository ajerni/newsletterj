import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";

export const personenRoutes = new Hono();

personenRoutes.get("/", async (c) => {
    const personen = await sql`
        SELECT p.*, g.name as gemeinde_name
        FROM newsletterj_personen p
        LEFT JOIN newsletterj_gemeinden g ON g.id = p.aktuelle_gemeinde_id
        ORDER BY p.zuletzt_gesehen_am DESC
        LIMIT 50
    `;

    const zeilen = personen.map((p) => `
        <tr>
            <td><a href="#" hx-get="/api/personen/${p.id}" hx-target="#content">${esc(p.name)}</a></td>
            <td>${esc(p.aktuelle_funktion || "—")}</td>
            <td>${esc(p.gemeinde_name || "—")}</td>
            <td>${esc(p.aktuelle_organisation || "—")}</td>
            <td><strong>${p.artikel_anzahl}</strong></td>
            <td class="muted">${datumFormatieren(p.zuletzt_gesehen_am)}</td>
        </tr>
    `).join("");

    return c.html(`
        <div class="header-row">
            <h2>Personen</h2>
            <span class="muted">${personen.length} Personen</span>
        </div>
        <table>
            <thead><tr><th>Name</th><th>Funktion</th><th>Gemeinde</th><th>Organisation</th><th>Artikel</th><th>Zuletzt</th></tr></thead>
            <tbody>${zeilen || '<tr><td colspan="6" class="empty">Noch keine Personen erfasst</td></tr>'}</tbody>
        </table>
    `);
});

personenRoutes.get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [person] = await sql`
        SELECT p.*, g.name as gemeinde_name
        FROM newsletterj_personen p
        LEFT JOIN newsletterj_gemeinden g ON g.id = p.aktuelle_gemeinde_id
        WHERE p.id = ${id}
    `;
    if (!person) return c.html('<p class="error">Person nicht gefunden</p>', 404);

    const erwaehnungen = await sql`
        SELECT e.funktion_bei_erwaehnung, a.titel, a.url, a.quellen_name, a.gesucht_am, a.kategorie
        FROM newsletterj_erwaehnungen e
        JOIN newsletterj_artikel a ON a.id = e.artikel_id
        WHERE e.person_id = ${id}
        ORDER BY a.gesucht_am DESC
    `;

    const funktionen = await sql`
        SELECT pf.funktion, pf.organisation, g.name as gemeinde_name, pf.beginn, pf.ende
        FROM newsletterj_personen_funktionen pf
        LEFT JOIN newsletterj_gemeinden g ON g.id = pf.gemeinde_id
        WHERE pf.person_id = ${id}
        ORDER BY pf.beginn DESC NULLS FIRST
    `;

    const erwaehnungenHtml = erwaehnungen.map((e) => `
        <li>
            <a href="${esc(e.url)}" target="_blank">${esc(e.titel || "Ohne Titel")}</a>
            <span class="muted">${esc(e.quellen_name || "")} — ${datumFormatieren(e.gesucht_am)}</span>
            ${e.funktion_bei_erwaehnung ? `<span class="badge">${esc(e.funktion_bei_erwaehnung)}</span>` : ""}
        </li>
    `).join("");

    const funktionenHtml = funktionen.map((f) => `
        <li>${esc(f.funktion)} ${f.organisation ? `bei ${esc(f.organisation)}` : ""} ${f.gemeinde_name ? `(${esc(f.gemeinde_name)})` : ""}</li>
    `).join("");

    return c.html(`
        <button class="btn btn-sm" hx-get="/api/personen" hx-target="#content">← Zurück</button>
        <h2>${esc(person.name)}</h2>
        <div class="detail-card">
            <p><strong>Aktuelle Funktion:</strong> ${esc(person.aktuelle_funktion || "—")}</p>
            <p><strong>Gemeinde:</strong> ${esc(person.gemeinde_name || "—")}</p>
            <p><strong>Organisation:</strong> ${esc(person.aktuelle_organisation || "—")}</p>
            <p><strong>Artikel:</strong> ${person.artikel_anzahl}</p>
            <p><strong>Erstmals gesehen:</strong> ${datumFormatieren(person.erstmals_gesehen_am)}</p>
        </div>

        ${funktionen.length > 0 ? `<h3>Funktionshistorie</h3><ul class="simple-list">${funktionenHtml}</ul>` : ""}

        <h3>Erwähnungen (${erwaehnungen.length})</h3>
        <ul class="simple-list">${erwaehnungenHtml || '<li class="muted">Keine Erwähnungen</li>'}</ul>
    `);
});

function datumFormatieren(d: Date | string): string {
    return new Date(d).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}
