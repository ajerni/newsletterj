import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";
import { kategorieLabel, datumRelativ, relevanzBadge, kategorieBadge } from "../ui.js";
import { artikelKarte } from "./artikel.js";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/", async (c) => {
    const [artikelStats] = await sql`
        SELECT COUNT(*)::int as gesamt,
            COUNT(*) FILTER (WHERE gesucht_am > NOW() - INTERVAL '7 days')::int as diese_woche,
            COUNT(*) FILTER (WHERE gesucht_am > NOW() - INTERVAL '30 days')::int as dieser_monat,
            COUNT(*) FILTER (WHERE relevanz = 'hoch' AND gesucht_am > NOW() - INTERVAL '30 days')::int as hoch_relevant
        FROM newsletterj_artikel
    `;
    const [personenStats] = await sql`SELECT COUNT(*)::int as gesamt FROM newsletterj_personen`;
    const [ereignisseStats] = await sql`SELECT COUNT(*)::int as gesamt FROM newsletterj_ereignisse`;
    const [faelleStats] = await sql`
        SELECT COUNT(*)::int as gesamt,
            COUNT(*) FILTER (WHERE status = 'aktiv')::int as aktiv
        FROM newsletterj_faelle
    `;
    const aktiveFaelle = await sql`
        SELECT f.id, f.titel, f.artikel_anzahl, g.name as gemeinde_name
        FROM newsletterj_faelle f
        LEFT JOIN newsletterj_gemeinden g ON g.id = f.gemeinde_id
        WHERE f.status = 'aktiv'
        ORDER BY f.aktualisiert_am DESC
        LIMIT 5
    `;
    const [letzterLauf] = await sql`
        SELECT gestartet_am, status FROM newsletterj_laeufe ORDER BY gestartet_am DESC LIMIT 1
    `;

    // Top-Stories: hoch relevante Artikel der letzten 14 Tage
    const topStories = await sql`
        SELECT a.*, g.name as gemeinde_name,
            (SELECT COUNT(*)::int FROM newsletterj_erwaehnungen e WHERE e.artikel_id = a.id) as personen_anzahl
        FROM newsletterj_artikel a
        LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
        WHERE a.relevanz = 'hoch' AND a.gesucht_am > NOW() - INTERVAL '14 days'
        ORDER BY a.gesucht_am DESC
        LIMIT 5
    `;

    const topKategorien = await sql`
        SELECT kategorie, COUNT(*)::int as anzahl
        FROM newsletterj_artikel
        WHERE kategorie IS NOT NULL AND gesucht_am > NOW() - INTERVAL '30 days'
        GROUP BY kategorie ORDER BY anzahl DESC LIMIT 10
    `;

    const topPersonen = await sql`
        SELECT p.id, p.name, p.aktuelle_funktion, p.artikel_anzahl
        FROM newsletterj_personen p
        ORDER BY p.artikel_anzahl DESC, p.zuletzt_gesehen_am DESC
        LIMIT 50
    `;

    const topGemeinden = await sql`
        SELECT g.id, g.name, COUNT(a.id)::int as anzahl
        FROM newsletterj_gemeinden g
        JOIN newsletterj_artikel a ON a.gemeinde_id = g.id
        WHERE a.gesucht_am > NOW() - INTERVAL '30 days'
        GROUP BY g.id, g.name ORDER BY anzahl DESC LIMIT 8
    `;

    const topQuellen = await sql`
        SELECT quellen_name, COUNT(*)::int as anzahl
        FROM newsletterj_artikel
        WHERE quellen_name IS NOT NULL AND gesucht_am > NOW() - INTERVAL '30 days'
        GROUP BY quellen_name ORDER BY anzahl DESC LIMIT 8
    `;

    const letzteEreignisse = await sql`
        SELECT e.typ, e.titel, e.relevanz, e.erstellt_am, e.artikel_id, g.name as gemeinde_name
        FROM newsletterj_ereignisse e
        LEFT JOIN newsletterj_gemeinden g ON g.id = e.gemeinde_id
        ORDER BY e.erstellt_am DESC LIMIT 6
    `;

    const maxKategorieAnzahl = topKategorien[0]?.anzahl || 1;
    const kategorienHtml = topKategorien.map((k) => `
        <div class="trend-row" hx-get="/api/artikel?kategorie=${esc(k.kategorie)}" hx-target="#content">
            <span class="trend-label">${esc(kategorieLabel(k.kategorie))}</span>
            <div class="trend-balken-wrap"><div class="trend-balken" style="width:${Math.round((k.anzahl / maxKategorieAnzahl) * 100)}%"></div></div>
            <strong>${k.anzahl}</strong>
        </div>
    `).join("");

    const personenHtml = topPersonen.map((p) => `
        <li class="person-row" hx-get="/api/personen/${p.id}" hx-target="#content">
            <span class="person-info">
                <a href="#" hx-get="/api/personen/${p.id}" hx-target="#content">${esc(p.name)}</a>
                ${p.aktuelle_funktion ? `<span class="muted">${esc(p.aktuelle_funktion)}</span>` : ""}
            </span>
            <span class="count-pill" title="${p.artikel_anzahl} Artikel">${p.artikel_anzahl}</span>
        </li>
    `).join("");

    const gemeindenHtml = topGemeinden.map((g) => `
        <li class="zeile-mit-pill">
            <a href="#" hx-get="/api/artikel?gemeinde=${g.id}" hx-target="#content">${esc(g.name)}</a>
            <span class="count-pill" title="${g.anzahl} Artikel">${g.anzahl}</span>
        </li>
    `).join("");

    const quellenHtml = topQuellen.map((q) => `
        <li class="zeile-mit-pill">
            <a href="#" hx-get="/api/artikel?quelle=${encodeURIComponent(q.quellen_name)}" hx-target="#content">${esc(q.quellen_name)}</a>
            <span class="count-pill" title="${q.anzahl} Artikel">${q.anzahl}</span>
        </li>
    `).join("");

    const ereignisseHtml = letzteEreignisse.map((e) => `
        <li>
            <span class="badge">${esc(kategorieLabel(e.typ))}</span>
            <a href="#" hx-get="/api/artikel/${e.artikel_id}" hx-target="#content">${esc(e.titel)}</a>
            ${relevanzBadge(e.relevanz)}
            <span class="muted">${e.gemeinde_name ? esc(e.gemeinde_name) + " — " : ""}${datumRelativ(e.erstellt_am)}</span>
        </li>
    `).join("");

    const topStoriesHtml = topStories.map((a) => artikelKarte(a)).join("");

    const faelleHtml = aktiveFaelle.map((f) => `
        <li>
            <a href="#" hx-get="/api/faelle/${f.id}" hx-target="#content">${esc(f.titel)}</a>
            <span class="count-pill">${f.artikel_anzahl}</span>
            ${f.gemeinde_name ? `<span class="muted">${esc(f.gemeinde_name)}</span>` : ""}
        </li>
    `).join("");

    return c.html(`
        <div class="header-row">
            <h2>Medienspiegel — Übersicht</h2>
            ${letzterLauf ? `<span class="muted">Letzter Lauf: ${datumRelativ(letzterLauf.gestartet_am)} (${esc(letzterLauf.status)})</span>` : ""}
        </div>
        <div class="stats-grid">
            <div class="stat-card" hx-get="/api/artikel" hx-target="#content"><div class="stat-value">${artikelStats.gesamt}</div><div class="stat-label">Artikel gesamt</div></div>
            <div class="stat-card" hx-get="/api/artikel?tage=7" hx-target="#content"><div class="stat-value">${artikelStats.diese_woche}</div><div class="stat-label">Diese Woche</div></div>
            <div class="stat-card" hx-get="/api/artikel?relevanz=hoch&tage=30" hx-target="#content"><div class="stat-value">${artikelStats.hoch_relevant}</div><div class="stat-label">Hoch relevant</div></div>
            <div class="stat-card" hx-get="/api/personen" hx-target="#content"><div class="stat-value">${personenStats.gesamt}</div><div class="stat-label">Personen</div></div>
            <div class="stat-card" hx-get="/api/ereignisse" hx-target="#content"><div class="stat-value">${ereignisseStats.gesamt}</div><div class="stat-label">Ereignisse</div></div>
            <div class="stat-card" hx-get="/api/faelle?status=aktiv" hx-target="#content"><div class="stat-value">${faelleStats.aktiv}</div><div class="stat-label">Aktive Fälle</div></div>
        </div>

        ${topStories.length ? `
        <h3>Top-Themen (hohe Relevanz, letzte 14 Tage)</h3>
        <div class="artikel-liste">${topStoriesHtml}</div>` : ""}

        ${aktiveFaelle.length ? `
        <h3>Aktive Fälle</h3>
        <ul class="simple-list">${faelleHtml}</ul>` : ""}

        <div class="section-row">
            <div class="section-half">
                <h3>Kategorien-Trend (30 Tage)</h3>
                <div class="trend-liste">${kategorienHtml || '<span class="muted">Noch keine Daten</span>'}</div>
            </div>
            <div class="section-half">
                <h3>Meist erwähnte Personen</h3>
                <div class="scroll-list personen-scroll">
                    <ul class="simple-list">${personenHtml || '<li class="muted">Noch keine Daten</li>'}</ul>
                </div>
            </div>
        </div>

        <div class="section-row">
            <div class="section-half">
                <h3>Aktive Gemeinden (30 Tage)</h3>
                <div class="ranking-panel">
                    <ul class="simple-list">${gemeindenHtml || '<li class="muted">Noch keine Daten</li>'}</ul>
                </div>
            </div>
            <div class="section-half">
                <h3>Quellen (30 Tage)</h3>
                <div class="ranking-panel">
                    <ul class="simple-list">${quellenHtml || '<li class="muted">Noch keine Daten</li>'}</ul>
                </div>
            </div>
        </div>

    `);
});
