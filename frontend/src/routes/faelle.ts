import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";
import {
    kategorieOptionen,
    kategorieLabel,
    relevanzOptionen,
    relevanzBadge,
    kategorieBadge,
    datumFormatieren,
    datumRelativ,
    seitenNavigation,
} from "../ui.js";

export const faelleRoutes = new Hono();

const SEITEN_GROESSE = 20;

const STATUS_OPTIONEN = [
    { value: "aktiv", label: "Aktiv" },
    { value: "abgeschlossen", label: "Abgeschlossen" },
    { value: "ruhend", label: "Ruhend" },
];

faelleRoutes.get("/", async (c) => {
    const seite = Math.max(1, Number(c.req.query("seite")) || 1);
    const suche = (c.req.query("suche") || "").trim();
    const status = c.req.query("status") || "";
    const relevanz = c.req.query("relevanz") || "";
    const gemeindeId = Number(c.req.query("gemeinde")) || 0;
    const offset = (seite - 1) * SEITEN_GROESSE;

    const bedingungen = [
        suche ? sql`(f.titel ILIKE ${"%" + suche + "%"} OR f.beschreibung ILIKE ${"%" + suche + "%"})` : null,
        status ? sql`f.status = ${status}` : null,
        relevanz ? sql`f.relevanz = ${relevanz}` : null,
        gemeindeId ? sql`f.gemeinde_id = ${gemeindeId}` : null,
    ].filter((b): b is NonNullable<typeof b> => b !== null);

    const whereKlausel = bedingungen.length
        ? bedingungen.slice(1).reduce((acc, b) => sql`${acc} AND ${b}`, sql`WHERE ${bedingungen[0]}`)
        : sql``;

    const faelle = await sql`
        SELECT f.*, g.name as gemeinde_name
        FROM newsletterj_faelle f
        LEFT JOIN newsletterj_gemeinden g ON g.id = f.gemeinde_id
        ${whereKlausel}
        ORDER BY COALESCE(f.letzter_artikel_am, f.aktualisiert_am) DESC
        LIMIT ${SEITEN_GROESSE} OFFSET ${offset}
    `;

    const [{ count: anzahl }] = await sql`
        SELECT COUNT(*)::int as count FROM newsletterj_faelle f ${whereKlausel}
    ` as unknown as [{ count: number }];

    const gesamtSeiten = Math.ceil(anzahl / SEITEN_GROESSE);

    const gemeinden = await sql`
        SELECT g.id, g.name FROM newsletterj_gemeinden g
        WHERE EXISTS (SELECT 1 FROM newsletterj_faelle f WHERE f.gemeinde_id = g.id)
        ORDER BY g.name
    `;

    const gemeindeOptionen = gemeinden
        .map((g) => `<option value="${g.id}" ${gemeindeId === g.id ? "selected" : ""}>${esc(g.name)}</option>`)
        .join("");

    const statusOptionen = STATUS_OPTIONEN
        .map((s) => `<option value="${s.value}" ${status === s.value ? "selected" : ""}>${esc(s.label)}</option>`)
        .join("");

    const karten = faelle.map((f) => `
        <article class="fall-karte">
            <div class="artikel-karte-meta">
                <span class="badge badge-status-${esc(f.status)}">${esc(f.status)}</span>
                ${relevanzBadge(f.relevanz)}
                ${f.hauptkategorie ? kategorieBadge(f.hauptkategorie) : ""}
                ${f.gemeinde_name ? `<span class="badge badge-gemeinde">${esc(f.gemeinde_name)}</span>` : ""}
                <span class="muted">${f.artikel_anzahl} Artikel</span>
            </div>
            <h3 class="artikel-karte-titel">
                <a href="#" hx-get="/api/faelle/${f.id}" hx-target="#content">${esc(f.titel)}</a>
            </h3>
            ${f.beschreibung ? `<p class="artikel-karte-text">${esc(f.beschreibung.slice(0, 200))}${f.beschreibung.length > 200 ? "…" : ""}</p>` : ""}
            <span class="muted">Zuletzt: ${datumRelativ(f.letzter_artikel_am || f.aktualisiert_am)}</span>
        </article>
    `).join("");

    const filterQuery = `suche=${encodeURIComponent(suche)}&status=${encodeURIComponent(status)}&relevanz=${encodeURIComponent(relevanz)}&gemeinde=${gemeindeId || ""}`;

    return c.html(`
        <div class="header-row">
            <h2>Fälle</h2>
            <span class="muted">${anzahl} Story-Threads</span>
        </div>
        <p class="muted section-intro">Zusammenhängende Berichte zu einer Situation — automatisch durch Embeddings und KI verknüpft.</p>
        <form class="filter-bar filter-bar-grid" hx-get="/api/faelle" hx-target="#content" hx-trigger="change, submit, input delay:400ms from:input[name='suche']" hx-include="this">
            <input type="search" name="suche" placeholder="Suche in Titel und Beschreibung…" value="${esc(suche)}" class="filter-suche">
            <select name="status"><option value="">Alle Status</option>${statusOptionen}</select>
            <select name="relevanz"><option value="">Alle Relevanzen</option>${relevanzOptionen(relevanz || null)}</select>
            <select name="gemeinde"><option value="">Alle Gemeinden</option>${gemeindeOptionen}</select>
        </form>
        <div class="artikel-liste">${karten || '<p class="empty">Noch keine Fälle — werden beim nächsten Monitor-Lauf automatisch erstellt.</p>'}</div>
        ${seitenNavigation(seite, gesamtSeiten, `/api/faelle?${filterQuery}`)}
    `);
});

faelleRoutes.get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [f] = await sql`
        SELECT f.*, g.name as gemeinde_name
        FROM newsletterj_faelle f
        LEFT JOIN newsletterj_gemeinden g ON g.id = f.gemeinde_id
        WHERE f.id = ${id}
    `;
    if (!f) return c.html('<p class="error">Fall nicht gefunden</p>', 404);

    const artikel = await sql`
        SELECT a.id, a.titel, a.url, a.veroeffentlicht_am, a.gesucht_am, a.relevanz, a.kategorie,
            fa.aehnlichkeit, fa.verknuepfungs_grund, fa.erstellt_am as verknuepft_am
        FROM newsletterj_fall_artikel fa
        JOIN newsletterj_artikel a ON a.id = fa.artikel_id
        WHERE fa.fall_id = ${id}
        ORDER BY COALESCE(a.veroeffentlicht_am, a.gesucht_am) ASC
    `;

    const ereignisse = await sql`
        SELECT e.typ, e.titel, e.beschreibung, e.ereignis_datum, e.relevanz, a.id as artikel_id, a.titel as artikel_titel
        FROM newsletterj_fall_ereignisse fe
        JOIN newsletterj_ereignisse e ON e.id = fe.ereignis_id
        JOIN newsletterj_artikel a ON a.id = e.artikel_id
        WHERE fe.fall_id = ${id}
        ORDER BY COALESCE(e.ereignis_datum, e.erstellt_am) ASC
    `;

    const artikelTimeline = artikel.map((a) => `
        <li class="fall-timeline-item">
            <div class="fall-timeline-date">${datumFormatieren(a.veroeffentlicht_am || a.gesucht_am, true)}</div>
            <div class="fall-timeline-body">
                <a href="#" hx-get="/api/artikel/${a.id}" hx-target="#content" class="fall-timeline-titel">${esc(a.titel || "Ohne Titel")}</a>
                ${relevanzBadge(a.relevanz)} ${a.kategorie ? kategorieBadge(a.kategorie) : ""}
                ${a.aehnlichkeit ? `<span class="muted" title="Semantische Ähnlichkeit">↔ ${Math.round(a.aehnlichkeit * 100)}%</span>` : ""}
                ${a.verknuepfungs_grund ? `<p class="muted">${esc(a.verknuepfungs_grund)}</p>` : ""}
            </div>
        </li>
    `).join("");

    const ereignisseHtml = ereignisse.map((e) => `
        <li>
            <span class="badge">${esc(kategorieLabel(e.typ))}</span>
            <strong>${esc(e.titel)}</strong> ${relevanzBadge(e.relevanz)}
            <a href="#" hx-get="/api/artikel/${e.artikel_id}" hx-target="#content" class="muted">(${esc((e.artikel_titel || "").slice(0, 40))})</a>
            ${e.ereignis_datum ? `<span class="muted">${datumFormatieren(e.ereignis_datum)}</span>` : ""}
        </li>
    `).join("");

    return c.html(`
        <button class="btn btn-sm" hx-get="/api/faelle" hx-target="#content">← Zurück zu Fällen</button>
        <div class="detail-card">
            <div class="artikel-karte-meta">
                <span class="badge badge-status-${esc(f.status)}">${esc(f.status)}</span>
                ${relevanzBadge(f.relevanz)}
                ${f.hauptkategorie ? kategorieBadge(f.hauptkategorie) : ""}
                ${f.gemeinde_name ? `<span class="badge badge-gemeinde">${esc(f.gemeinde_name)}</span>` : ""}
            </div>
            <h2>${esc(f.titel)}</h2>
            ${f.schule ? `<p class="muted">${esc(f.schule)}</p>` : ""}
            ${f.beschreibung ? `<p>${esc(f.beschreibung)}</p>` : ""}
            <p class="muted">${f.artikel_anzahl} Artikel · Erstellt ${datumFormatieren(f.erstellt_am, true)} · Aktualisiert ${datumRelativ(f.aktualisiert_am)}</p>
        </div>
        <h3>Chronologie (${artikel.length} Artikel)</h3>
        <ol class="fall-timeline">${artikelTimeline || '<li class="muted">Keine Artikel verknüpft</li>'}</ol>
        ${ereignisse.length ? `<h3>Ereignisse (${ereignisse.length})</h3><ul class="simple-list">${ereignisseHtml}</ul>` : ""}
    `);
});
