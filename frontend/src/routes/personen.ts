import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";
import { datumFormatieren, datumRelativ, kategorieBadge, seitenNavigation } from "../ui.js";
import { personNetzwerk1HopHtml, personNetzwerk1HopLaden } from "../lib/netzwerk.js";

export const personenRoutes = new Hono();

const SEITEN_GROESSE = 30;

personenRoutes.get("/", async (c) => {
    const seite = Math.max(1, Number(c.req.query("seite")) || 1);
    const suche = (c.req.query("suche") || "").trim();
    const gemeindeId = Number(c.req.query("gemeinde")) || 0;
    const sortierung = c.req.query("sortierung") || "aktivitaet";
    const offset = (seite - 1) * SEITEN_GROESSE;

    const bedingungen = [
        suche ? sql`(p.name ILIKE ${"%" + suche + "%"} OR p.aktuelle_funktion ILIKE ${"%" + suche + "%"} OR p.aktuelle_organisation ILIKE ${"%" + suche + "%"})` : null,
        gemeindeId ? sql`p.aktuelle_gemeinde_id = ${gemeindeId}` : null,
    ].filter((b): b is NonNullable<typeof b> => b !== null);

    const whereKlausel = bedingungen.length
        ? bedingungen.slice(1).reduce((acc, b) => sql`${acc} AND ${b}`, sql`WHERE ${bedingungen[0]}`)
        : sql``;

    const orderKlausel = sortierung === "name"
        ? sql`ORDER BY p.name ASC`
        : sortierung === "name_desc"
            ? sql`ORDER BY p.name DESC`
            : sortierung === "neueste"
                ? sql`ORDER BY p.zuletzt_gesehen_am DESC`
                : sql`ORDER BY p.artikel_anzahl DESC, p.zuletzt_gesehen_am DESC`;

    const personen = await sql`
        SELECT p.*, g.name as gemeinde_name
        FROM newsletterj_personen p
        LEFT JOIN newsletterj_gemeinden g ON g.id = p.aktuelle_gemeinde_id
        ${whereKlausel}
        ${orderKlausel}
        LIMIT ${SEITEN_GROESSE} OFFSET ${offset}
    `;

    const [{ count: anzahl }] = await sql`
        SELECT COUNT(*)::int as count FROM newsletterj_personen p ${whereKlausel}
    ` as unknown as [{ count: number }];

    const gesamtSeiten = Math.ceil(anzahl / SEITEN_GROESSE);

    const gemeinden = await sql`
        SELECT g.id, g.name FROM newsletterj_gemeinden g
        WHERE EXISTS (SELECT 1 FROM newsletterj_personen p WHERE p.aktuelle_gemeinde_id = g.id)
        ORDER BY g.name
    `;
    const gemeindeOptionen = gemeinden
        .map((g) => `<option value="${g.id}" ${gemeindeId === g.id ? "selected" : ""}>${esc(g.name)}</option>`)
        .join("");

    const zeilen = personen.map((p) => `
        <tr>
            <td><a href="#" hx-get="/api/personen/${p.id}" hx-target="#content">${esc(p.name)}</a></td>
            <td>${esc(p.aktuelle_funktion || "—")}</td>
            <td>${esc(p.gemeinde_name || "—")}</td>
            <td>${esc(p.aktuelle_organisation || "—")}</td>
            <td><strong>${p.artikel_anzahl}</strong></td>
            <td class="muted">${datumRelativ(p.zuletzt_gesehen_am)}</td>
        </tr>
    `).join("");

    const filterQuery = `suche=${encodeURIComponent(suche)}&gemeinde=${gemeindeId || ""}&sortierung=${sortierung}`;

    return c.html(`
        <div class="header-row">
            <h2>Personen</h2>
            <span class="muted">${anzahl} Personen</span>
        </div>
        <form class="filter-bar filter-bar-grid" hx-get="/api/personen" hx-target="#content" hx-trigger="change, submit, input delay:400ms from:input[name='suche']" hx-include="this">
            <input type="search" name="suche" placeholder="Suche nach Name, Funktion, Organisation…" value="${esc(suche)}" class="filter-suche">
            <select name="gemeinde"><option value="">Alle Gemeinden</option>${gemeindeOptionen}</select>
            <select name="sortierung">
                <option value="aktivitaet" ${sortierung === "aktivitaet" ? "selected" : ""}>Meiste Artikel</option>
                <option value="neueste" ${sortierung === "neueste" ? "selected" : ""}>Zuletzt gesehen</option>
                <option value="name" ${sortierung === "name" ? "selected" : ""}>Name A–Z</option>
                <option value="name_desc" ${sortierung === "name_desc" ? "selected" : ""}>Name Z–A</option>
            </select>
        </form>
        <table>
            <thead><tr><th>Name</th><th>Funktion</th><th>Gemeinde</th><th>Organisation</th><th>Artikel</th><th>Zuletzt</th></tr></thead>
            <tbody>${zeilen || '<tr><td colspan="6" class="empty">Keine Personen gefunden</td></tr>'}</tbody>
        </table>
        ${seitenNavigation(seite, gesamtSeiten, `/api/personen?${filterQuery}`)}
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
        SELECT e.funktion_bei_erwaehnung, a.id as artikel_id, a.titel, a.url, a.quellen_name, a.gesucht_am, a.kategorie, a.relevanz
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

    const netzwerkVerbindungen = await personNetzwerk1HopLaden(id);
    const netzwerkHtml = personNetzwerk1HopHtml(id, person.name, netzwerkVerbindungen);

    const erwaehnungenHtml = erwaehnungen.map((e) => `
        <li>
            <a href="#" hx-get="/api/artikel/${e.artikel_id}" hx-target="#content">${esc(e.titel || "Ohne Titel")}</a>
            <a href="${esc(e.url)}" target="_blank" class="extern-link" title="Original öffnen">↗</a>
            ${kategorieBadge(e.kategorie)}
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
            ${person.notizen ? `<p><strong>Notizen:</strong> ${esc(person.notizen)}</p>` : ""}
        </div>

        <div class="section-row">
            ${funktionen.length ? `<div class="section-half"><h3>Funktionshistorie</h3><ul class="simple-list">${funktionenHtml}</ul></div>` : ""}
        </div>

        <h3>Netzwerk</h3>
        ${netzwerkHtml}

        <h3>Erwähnungen (${erwaehnungen.length})</h3>
        <ul class="simple-list">${erwaehnungenHtml || '<li class="muted">Keine Erwähnungen</li>'}</ul>
    `);
});
