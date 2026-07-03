import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";
import {
    kategorieOptionen,
    relevanzOptionen,
    zeitraumOptionen,
    kategorieBadge,
    relevanzBadge,
    datumFormatieren,
    datumRelativ,
    seitenNavigation,
} from "../ui.js";

export const artikelRoutes = new Hono();

const SEITEN_GROESSE = 20;

artikelRoutes.get("/", async (c) => {
    const seite = Math.max(1, Number(c.req.query("seite")) || 1);
    const suche = (c.req.query("suche") || "").trim();
    const kategorie = c.req.query("kategorie") || "";
    const relevanz = c.req.query("relevanz") || "";
    const gemeindeId = Number(c.req.query("gemeinde")) || 0;
    const quelle = c.req.query("quelle") || "";
    const tage = Number(c.req.query("tage")) || 0;
    const sortierung = c.req.query("sortierung") === "aelteste" ? "aelteste" : "neueste";
    const offset = (seite - 1) * SEITEN_GROESSE;

    // Compose WHERE conditions dynamically (postgres.js fragments)
    const bedingungen = [
        suche ? sql`(a.titel ILIKE ${"%" + suche + "%"} OR a.zusammenfassung ILIKE ${"%" + suche + "%"} OR a.ausschnitt ILIKE ${"%" + suche + "%"} OR a.schule ILIKE ${"%" + suche + "%"})` : null,
        kategorie ? sql`(a.kategorie = ${kategorie} OR ${kategorie} = ANY(a.kategorien))` : null,
        relevanz ? sql`a.relevanz = ${relevanz}` : null,
        gemeindeId ? sql`a.gemeinde_id = ${gemeindeId}` : null,
        quelle ? sql`a.quellen_name = ${quelle}` : null,
        tage ? sql`a.gesucht_am > NOW() - make_interval(days => ${tage})` : null,
    ].filter((b): b is NonNullable<typeof b> => b !== null);

    const whereKlausel = bedingungen.length
        ? bedingungen.slice(1).reduce((acc, b) => sql`${acc} AND ${b}`, sql`WHERE ${bedingungen[0]}`)
        : sql``;

    const artikel = await sql`
        SELECT a.*, g.name as gemeinde_name,
            (SELECT COUNT(*)::int FROM newsletterj_erwaehnungen e WHERE e.artikel_id = a.id) as personen_anzahl
        FROM newsletterj_artikel a
        LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
        ${whereKlausel}
        ${sortierung === "aelteste"
            ? sql`ORDER BY COALESCE(a.veroeffentlicht_am, a.gesucht_am) ASC`
            : sql`ORDER BY COALESCE(a.veroeffentlicht_am, a.gesucht_am) DESC`}
        LIMIT ${SEITEN_GROESSE} OFFSET ${offset}
    `;

    const [{ count: anzahl }] = await sql`
        SELECT COUNT(*)::int as count
        FROM newsletterj_artikel a
        ${whereKlausel}
    ` as unknown as [{ count: number }];

    const gesamtSeiten = Math.ceil(anzahl / SEITEN_GROESSE);

    // Filter dropdown values from DB
    const gemeinden = await sql`
        SELECT g.id, g.name FROM newsletterj_gemeinden g
        WHERE EXISTS (SELECT 1 FROM newsletterj_artikel a WHERE a.gemeinde_id = g.id)
        ORDER BY g.name
    `;
    const quellen = await sql`
        SELECT DISTINCT quellen_name FROM newsletterj_artikel
        WHERE quellen_name IS NOT NULL ORDER BY quellen_name
    `;

    const gemeindeOptionen = gemeinden
        .map((g) => `<option value="${g.id}" ${gemeindeId === g.id ? "selected" : ""}>${esc(g.name)}</option>`)
        .join("");
    const quellenOptionen = quellen
        .map((q) => `<option value="${esc(q.quellen_name)}" ${quelle === q.quellen_name ? "selected" : ""}>${esc(q.quellen_name)}</option>`)
        .join("");

    const karten = artikel.map((a) => artikelKarte(a)).join("");

    const filterQuery = `suche=${encodeURIComponent(suche)}&kategorie=${encodeURIComponent(kategorie)}&relevanz=${encodeURIComponent(relevanz)}&gemeinde=${gemeindeId || ""}&quelle=${encodeURIComponent(quelle)}&tage=${tage || ""}&sortierung=${sortierung}`;
    const filterAktiv = suche || kategorie || relevanz || gemeindeId || quelle || tage;

    return c.html(`
        <div class="header-row">
            <h2>Medienspiegel</h2>
            <span class="muted">${anzahl} Artikel${filterAktiv ? " (gefiltert)" : ""}</span>
        </div>
        <form class="filter-bar filter-bar-grid" hx-get="/api/artikel" hx-target="#content" hx-trigger="change, submit, input delay:400ms from:input[name='suche']" hx-include="this">
            <input type="search" name="suche" placeholder="Suche in Titel, Zusammenfassung, Schule…" value="${esc(suche)}" class="filter-suche">
            <select name="kategorie"><option value="">Alle Kategorien</option>${kategorieOptionen(kategorie || null)}</select>
            <select name="relevanz"><option value="">Alle Relevanzen</option>${relevanzOptionen(relevanz || null)}</select>
            <select name="gemeinde"><option value="">Alle Gemeinden</option>${gemeindeOptionen}</select>
            <select name="quelle"><option value="">Alle Quellen</option>${quellenOptionen}</select>
            <select name="tage"><option value="">Gesamter Zeitraum</option>${zeitraumOptionen(tage ? String(tage) : null)}</select>
            <select name="sortierung">
                <option value="neueste" ${sortierung === "neueste" ? "selected" : ""}>Neueste zuerst</option>
                <option value="aelteste" ${sortierung === "aelteste" ? "selected" : ""}>Älteste zuerst</option>
            </select>
            ${filterAktiv ? `<button type="button" class="btn btn-sm" hx-get="/api/artikel" hx-target="#content">Filter zurücksetzen</button>` : ""}
        </form>
        <div class="artikel-liste">
            ${karten || '<p class="empty">Keine Artikel gefunden</p>'}
        </div>
        ${seitenNavigation(seite, gesamtSeiten, `/api/artikel?${filterQuery}`)}
    `);
});

artikelRoutes.get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [a] = await sql`
        SELECT a.*, g.name as gemeinde_name
        FROM newsletterj_artikel a
        LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
        WHERE a.id = ${id}
    `;
    if (!a) return c.html('<p class="error">Artikel nicht gefunden</p>', 404);

    const personen = await sql`
        SELECT p.id, p.name, e.funktion_bei_erwaehnung
        FROM newsletterj_erwaehnungen e
        JOIN newsletterj_personen p ON p.id = e.person_id
        WHERE e.artikel_id = ${id}
        ORDER BY p.name
    `;
    const ereignisse = await sql`
        SELECT typ, titel, beschreibung, ereignis_datum, relevanz
        FROM newsletterj_ereignisse WHERE artikel_id = ${id}
        ORDER BY erstellt_am
    `;
    const organisationen = await sql`
        SELECT o.name, o.typ
        FROM newsletterj_org_erwaehnungen oe
        JOIN newsletterj_organisationen o ON o.id = oe.organisation_id
        WHERE oe.artikel_id = ${id}
        ORDER BY o.name
    `;

    const personenHtml = personen.map((p) => `
        <li><a href="#" hx-get="/api/personen/${p.id}" hx-target="#content">${esc(p.name)}</a>
        ${p.funktion_bei_erwaehnung ? `<span class="muted">${esc(p.funktion_bei_erwaehnung)}</span>` : ""}</li>
    `).join("");

    const ereignisseHtml = ereignisse.map((e) => `
        <li>
            <span class="badge">${esc(e.typ)}</span> <strong>${esc(e.titel)}</strong> ${relevanzBadge(e.relevanz)}
            ${e.beschreibung ? `<p class="muted">${esc(e.beschreibung)}</p>` : ""}
            ${e.ereignis_datum ? `<span class="muted">${datumFormatieren(e.ereignis_datum)}</span>` : ""}
        </li>
    `).join("");

    const orgHtml = organisationen.map((o) => `
        <li>${esc(o.name)} ${o.typ ? `<span class="muted">(${esc(o.typ.replace(/_/g, " "))})</span>` : ""}</li>
    `).join("");

    return c.html(`
        <button class="btn btn-sm" hx-get="/api/artikel" hx-target="#content">← Zurück zum Medienspiegel</button>
        <div class="detail-card artikel-detail">
            <div class="artikel-karte-meta">
                ${a.quellen_name ? `<span class="quelle-tag">${esc(a.quellen_name)}</span>` : ""}
                <span class="muted">${datumFormatieren(a.veroeffentlicht_am || a.gesucht_am, true)}</span>
                ${relevanzBadge(a.relevanz)}
                ${kategorieBadge(a.kategorie)}
                ${a.gemeinde_name && a.gemeinde_id ? `<span class="badge badge-gemeinde" hx-get="/api/artikel?gemeinde=${a.gemeinde_id}" hx-target="#content">${esc(a.gemeinde_name)}</span>` : ""}
            </div>
            <h2><a href="${esc(a.url)}" target="_blank">${esc(a.titel || "Ohne Titel")} ↗</a></h2>
            ${a.schule ? `<p class="muted">${esc(a.schule)}</p>` : ""}
            ${a.zusammenfassung ? `<h3>Zusammenfassung</h3><p>${esc(a.zusammenfassung)}</p>` : ""}
            ${a.auswirkungen ? `<h3>Mögliche Auswirkungen</h3><p>${esc(a.auswirkungen)}</p>` : ""}
            ${a.kontext_bezug ? `<h3>Kontext</h3><p>${esc(a.kontext_bezug)}</p>` : ""}
            ${(a.kategorien as string[])?.length > 1 ? `<h3>Alle Kategorien</h3><div class="badge-grid">${(a.kategorien as string[]).map((k) => kategorieBadge(k)).join("")}</div>` : ""}
        </div>
        <div class="section-row">
            ${personen.length ? `<div class="section-half"><h3>Personen (${personen.length})</h3><ul class="simple-list">${personenHtml}</ul></div>` : ""}
            ${organisationen.length ? `<div class="section-half"><h3>Organisationen (${organisationen.length})</h3><ul class="simple-list">${orgHtml}</ul></div>` : ""}
        </div>
        ${ereignisse.length ? `<h3>Ereignisse (${ereignisse.length})</h3><ul class="simple-list ereignis-liste">${ereignisseHtml}</ul>` : ""}
    `);
});

export function artikelKarte(a: any): string {
    const zusammenfassung = a.zusammenfassung || a.ausschnitt || "";
    return `
        <article class="artikel-karte">
            <div class="artikel-karte-meta">
                ${a.quellen_name ? `<span class="quelle-tag">${esc(a.quellen_name)}</span>` : ""}
                <span class="muted" title="${datumFormatieren(a.veroeffentlicht_am || a.gesucht_am, true)}">${datumRelativ(a.veroeffentlicht_am || a.gesucht_am)}</span>
                ${relevanzBadge(a.relevanz)}
                ${kategorieBadge(a.kategorie)}
                ${a.gemeinde_name ? (a.gemeinde_id
                    ? `<span class="badge badge-gemeinde" hx-get="/api/artikel?gemeinde=${a.gemeinde_id}" hx-target="#content">${esc(a.gemeinde_name)}</span>`
                    : `<span class="badge badge-gemeinde">${esc(a.gemeinde_name)}</span>`) : ""}
            </div>
            <h3 class="artikel-karte-titel">
                <a href="#" hx-get="/api/artikel/${a.id}" hx-target="#content">${esc(a.titel || "Ohne Titel")}</a>
                <a href="${esc(a.url)}" target="_blank" class="extern-link" title="Original öffnen">↗</a>
            </h3>
            ${zusammenfassung ? `<p class="artikel-karte-text">${esc(zusammenfassung.slice(0, 280))}${zusammenfassung.length > 280 ? "…" : ""}</p>` : ""}
            ${a.personen_anzahl > 0 ? `<span class="muted">${a.personen_anzahl} Person${a.personen_anzahl > 1 ? "en" : ""} erwähnt</span>` : ""}
        </article>
    `;
}
