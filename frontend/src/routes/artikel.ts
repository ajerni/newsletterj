import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";

export const artikelRoutes = new Hono();

const SEITEN_GROESSE = 25;

artikelRoutes.get("/", async (c) => {
    const seite = Math.max(1, Number(c.req.query("seite")) || 1);
    const kategorie = c.req.query("kategorie") || null;
    const relevanz = c.req.query("relevanz") || null;
    const offset = (seite - 1) * SEITEN_GROESSE;

    let artikel;
    let anzahl: number;

    if (kategorie && relevanz) {
        artikel = await sql`
            SELECT a.*, g.name as gemeinde_name FROM newsletterj_artikel a
            LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
            WHERE a.kategorie = ${kategorie} AND a.relevanz = ${relevanz}
            ORDER BY a.gesucht_am DESC LIMIT ${SEITEN_GROESSE} OFFSET ${offset}
        `;
        [{ count: anzahl }] = await sql`SELECT COUNT(*)::int as count FROM newsletterj_artikel WHERE kategorie = ${kategorie} AND relevanz = ${relevanz}` as any;
    } else if (kategorie) {
        artikel = await sql`
            SELECT a.*, g.name as gemeinde_name FROM newsletterj_artikel a
            LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
            WHERE a.kategorie = ${kategorie}
            ORDER BY a.gesucht_am DESC LIMIT ${SEITEN_GROESSE} OFFSET ${offset}
        `;
        [{ count: anzahl }] = await sql`SELECT COUNT(*)::int as count FROM newsletterj_artikel WHERE kategorie = ${kategorie}` as any;
    } else if (relevanz) {
        artikel = await sql`
            SELECT a.*, g.name as gemeinde_name FROM newsletterj_artikel a
            LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
            WHERE a.relevanz = ${relevanz}
            ORDER BY a.gesucht_am DESC LIMIT ${SEITEN_GROESSE} OFFSET ${offset}
        `;
        [{ count: anzahl }] = await sql`SELECT COUNT(*)::int as count FROM newsletterj_artikel WHERE relevanz = ${relevanz}` as any;
    } else {
        artikel = await sql`
            SELECT a.*, g.name as gemeinde_name FROM newsletterj_artikel a
            LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
            ORDER BY a.gesucht_am DESC LIMIT ${SEITEN_GROESSE} OFFSET ${offset}
        `;
        [{ count: anzahl }] = await sql`SELECT COUNT(*)::int as count FROM newsletterj_artikel` as any;
    }

    const gesamtSeiten = Math.ceil(anzahl / SEITEN_GROESSE);

    const zeilen = artikel.map((a: any) => `
        <tr>
            <td><a href="${esc(a.url)}" target="_blank">${esc(a.titel || a.url)}</a></td>
            <td><span class="badge">${esc(a.kategorie || "")}</span></td>
            <td><span class="badge badge-${a.relevanz}">${a.relevanz}</span></td>
            <td class="muted">${esc(a.gemeinde_name || "")}</td>
            <td class="muted">${esc(a.quellen_name || "")}</td>
            <td class="muted">${datumFormatieren(a.gesucht_am)}</td>
        </tr>
    `).join("");

    const filterParams = `kategorie=${kategorie || ""}&relevanz=${relevanz || ""}`;

    return c.html(`
        <div class="header-row">
            <h2>Artikel</h2>
            <span class="muted">${anzahl} Treffer</span>
        </div>
        <form class="filter-bar" hx-get="/api/artikel" hx-target="#content" hx-trigger="change" hx-include="this">
            <select name="kategorie"><option value="">Alle Kategorien</option>${kategorieOptionen(kategorie)}</select>
            <select name="relevanz">
                <option value="">Alle Relevanzen</option>
                <option value="hoch" ${relevanz === "hoch" ? "selected" : ""}>hoch</option>
                <option value="mittel" ${relevanz === "mittel" ? "selected" : ""}>mittel</option>
                <option value="tief" ${relevanz === "tief" ? "selected" : ""}>tief</option>
            </select>
        </form>
        <table>
            <thead><tr><th>Titel</th><th>Kategorie</th><th>Relevanz</th><th>Gemeinde</th><th>Quelle</th><th>Datum</th></tr></thead>
            <tbody>${zeilen || '<tr><td colspan="6" class="empty">Keine Artikel gefunden</td></tr>'}</tbody>
        </table>
        ${seitenNavigation(seite, gesamtSeiten, `/api/artikel?${filterParams}`)}
    `);
});

function kategorieOptionen(ausgewaehlt: string | null): string {
    const kategorien = [
        "fuehrungswechsel", "wahlen", "ruecktritte", "kuendigungen", "konflikte",
        "krisen", "finanzen", "personal", "lehrpersonen", "digitalisierung",
        "bauprojekte", "schulqualitaet", "gewalt", "mobbing", "sonderpaedagogik",
    ];
    return kategorien.map((k) =>
        `<option value="${k}" ${ausgewaehlt === k ? "selected" : ""}>${k.replace(/_/g, " ")}</option>`
    ).join("");
}

function seitenNavigation(seite: number, gesamt: number, basisUrl: string): string {
    if (gesamt <= 1) return "";
    const zurueck = seite > 1 ? `<button class="btn btn-sm" hx-get="${basisUrl}&seite=${seite - 1}" hx-target="#content">← Zurück</button>` : "";
    const weiter = seite < gesamt ? `<button class="btn btn-sm" hx-get="${basisUrl}&seite=${seite + 1}" hx-target="#content">Weiter →</button>` : "";
    return `<div class="pagination">${zurueck}<span>Seite ${seite} von ${gesamt}</span>${weiter}</div>`;
}

function datumFormatieren(d: Date | string): string {
    return new Date(d).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}
