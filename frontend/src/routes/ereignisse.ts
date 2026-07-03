import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";
import {
    kategorieOptionen,
    kategorieLabel,
    relevanzOptionen,
    zeitraumOptionen,
    relevanzBadge,
    datumFormatieren,
    seitenNavigation,
} from "../ui.js";

export const ereignisseRoutes = new Hono();

const SEITEN_GROESSE = 30;

ereignisseRoutes.get("/", async (c) => {
    const seite = Math.max(1, Number(c.req.query("seite")) || 1);
    const suche = (c.req.query("suche") || "").trim();
    const typ = c.req.query("typ") || "";
    const relevanz = c.req.query("relevanz") || "";
    const gemeindeId = Number(c.req.query("gemeinde")) || 0;
    const tage = Number(c.req.query("tage")) || 0;
    const offset = (seite - 1) * SEITEN_GROESSE;

    const bedingungen = [
        suche ? sql`(e.titel ILIKE ${"%" + suche + "%"} OR e.beschreibung ILIKE ${"%" + suche + "%"})` : null,
        typ ? sql`e.typ = ${typ}` : null,
        relevanz ? sql`e.relevanz = ${relevanz}` : null,
        gemeindeId ? sql`e.gemeinde_id = ${gemeindeId}` : null,
        tage ? sql`e.erstellt_am > NOW() - make_interval(days => ${tage})` : null,
    ].filter((b): b is NonNullable<typeof b> => b !== null);

    const whereKlausel = bedingungen.length
        ? bedingungen.slice(1).reduce((acc, b) => sql`${acc} AND ${b}`, sql`WHERE ${bedingungen[0]}`)
        : sql``;

    const ereignisse = await sql`
        SELECT e.*, g.name as gemeinde_name, a.titel as artikel_titel, a.url as artikel_url
        FROM newsletterj_ereignisse e
        LEFT JOIN newsletterj_gemeinden g ON g.id = e.gemeinde_id
        JOIN newsletterj_artikel a ON a.id = e.artikel_id
        ${whereKlausel}
        ORDER BY e.erstellt_am DESC
        LIMIT ${SEITEN_GROESSE} OFFSET ${offset}
    `;

    const [{ count: anzahl }] = await sql`
        SELECT COUNT(*)::int as count
        FROM newsletterj_ereignisse e
        ${whereKlausel}
    ` as unknown as [{ count: number }];

    const gesamtSeiten = Math.ceil(anzahl / SEITEN_GROESSE);

    const gemeinden = await sql`
        SELECT g.id, g.name FROM newsletterj_gemeinden g
        WHERE EXISTS (SELECT 1 FROM newsletterj_ereignisse e WHERE e.gemeinde_id = g.id)
        ORDER BY g.name
    `;
    const gemeindeOptionen = gemeinden
        .map((g) => `<option value="${g.id}" ${gemeindeId === g.id ? "selected" : ""}>${esc(g.name)}</option>`)
        .join("");

    const zeilen = ereignisse.map((e) => `
        <tr>
            <td><span class="badge">${esc(kategorieLabel(e.typ))}</span></td>
            <td>${esc(e.titel)}${e.beschreibung ? `<br><span class="muted">${esc(e.beschreibung.slice(0, 120))}${e.beschreibung.length > 120 ? "…" : ""}</span>` : ""}</td>
            <td class="muted">${esc(e.gemeinde_name || "—")}</td>
            <td>${relevanzBadge(e.relevanz)}</td>
            <td><a href="#" hx-get="/api/artikel/${e.artikel_id}" hx-target="#content" class="muted">${esc((e.artikel_titel || "").slice(0, 40))}</a></td>
            <td class="muted">${e.ereignis_datum ? datumFormatieren(e.ereignis_datum) : datumFormatieren(e.erstellt_am)}</td>
        </tr>
    `).join("");

    const filterQuery = `suche=${encodeURIComponent(suche)}&typ=${encodeURIComponent(typ)}&relevanz=${encodeURIComponent(relevanz)}&gemeinde=${gemeindeId || ""}&tage=${tage || ""}`;

    return c.html(`
        <div class="header-row">
            <h2>Ereignisse</h2>
            <span class="muted">${anzahl} Einträge</span>
        </div>
        <form class="filter-bar filter-bar-grid" hx-get="/api/ereignisse" hx-target="#content" hx-trigger="change, submit, input delay:400ms from:input[name='suche']" hx-include="this">
            <input type="search" name="suche" placeholder="Suche in Titel und Beschreibung…" value="${esc(suche)}" class="filter-suche">
            <select name="typ"><option value="">Alle Typen</option>${kategorieOptionen(typ || null)}</select>
            <select name="relevanz"><option value="">Alle Relevanzen</option>${relevanzOptionen(relevanz || null)}</select>
            <select name="gemeinde"><option value="">Alle Gemeinden</option>${gemeindeOptionen}</select>
            <select name="tage"><option value="">Gesamter Zeitraum</option>${zeitraumOptionen(tage ? String(tage) : null)}</select>
        </form>
        <table>
            <thead><tr><th>Typ</th><th>Titel</th><th>Gemeinde</th><th>Relevanz</th><th>Artikel</th><th>Datum</th></tr></thead>
            <tbody>${zeilen || '<tr><td colspan="6" class="empty">Keine Ereignisse gefunden</td></tr>'}</tbody>
        </table>
        ${seitenNavigation(seite, gesamtSeiten, `/api/ereignisse?${filterQuery}`)}
    `);
});
