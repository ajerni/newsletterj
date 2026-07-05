import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";
import { zeitraumOptionen } from "../ui.js";
import { zeitraumLabel } from "../lib/dossier.js";
import {
    komentionBootstrap,
    netzwerkGraphLaden,
    netzwerkKantenStatistik,
    netzwerkStaerksteVerbindungen,
    netzwerkZentralitaet,
    type NetzwerkKantenFilter,
} from "../lib/netzwerk.js";
import { relationBadgeHtml } from "../lib/relationen.js";

export const netzwerkRoutes = new Hono();

function kantenFilterAusQuery(wert: string | undefined): NetzwerkKantenFilter {
    if (wert === "explizit" || wert === "komention") return wert;
    return "alle";
}

async function netzwerkAnsicht(
    tage = 0,
    filter: NetzwerkKantenFilter = "alle",
    hinweis?: { typ: "success" | "error"; text: string }
): Promise<string> {
    const [{ count: kantenGesamt }] = await sql`
        SELECT COUNT(*)::int AS count FROM newsletterj_beziehungen
    ` as unknown as [{ count: number }];

    const [zentral, verbindungen, stats] = await Promise.all([
        netzwerkZentralitaet(tage, 20, filter),
        netzwerkStaerksteVerbindungen(tage, 30, filter),
        netzwerkKantenStatistik(tage),
    ]);

    const zeitraumText = zeitraumLabel(tage);

    const zentralZeilen = zentral.map((p) => `
        <tr>
            <td><a href="#" hx-get="/api/personen/${p.id}" hx-target="#content">${esc(p.name)}</a></td>
            <td>${p.aktuelle_funktion ? esc(p.aktuelle_funktion) : "—"}</td>
            <td>${p.verbindungen}</td>
            <td>${p.nachbarn}</td>
        </tr>
    `).join("");

    const verbindungsZeilen = verbindungen.map((v) => `
        <tr>
            <td><a href="#" hx-get="/api/personen/${v.von_id}" hx-target="#content">${esc(v.person_a_name)}</a></td>
            <td><a href="#" hx-get="/api/personen/${v.zu_id}" hx-target="#content">${esc(v.person_b_name)}</a></td>
            <td>${relationBadgeHtml(String(v.relation))}</td>
            <td>${v.artikel_anzahl}</td>
        </tr>
    `).join("");

    const filterQuery = filter !== "alle" ? `&filter=${filter}` : "";

    return `
        <div class="header-row">
            <div class="header-row-title">
                <h2>Netzwerk</h2>
            </div>
            <div class="header-row-actions">
                <span class="muted">${kantenGesamt} Kanten gespeichert</span>
                <button type="button" class="btn btn-sm"
                    hx-post="/api/netzwerk/aktualisieren?tage=${tage || ""}${filterQuery}"
                    hx-target="#content">
                    Co-Mentions aktualisieren
                </button>
            </div>
        </div>

        <p class="section-intro muted">
            Explizite Beziehungen (KI-extrahiert aus Artikeln) und Co-Mentions (Personen im selben Artikel).
            Im Zeitraum: <strong>${stats.explizit}</strong> explizit, <strong>${stats.komention}</strong> Co-Mention.
        </p>

        <form class="filter-bar filter-bar-grid" hx-get="/api/netzwerk" hx-target="#content" hx-trigger="change, submit">
            <label>
                Zeitraum
                <select name="tage">
                    <option value="">Gesamter Zeitraum</option>
                    ${zeitraumOptionen(tage ? String(tage) : null)}
                </select>
            </label>
            <label>
                Kantentyp
                <select name="filter">
                    <option value="alle" ${filter === "alle" ? "selected" : ""}>Alle</option>
                    <option value="explizit" ${filter === "explizit" ? "selected" : ""}>Explizit</option>
                    <option value="komention" ${filter === "komention" ? "selected" : ""}>Co-Mention</option>
                </select>
            </label>
        </form>

        ${hinweis ? `<div class="flash flash-${hinweis.typ}" role="status">${esc(hinweis.text)}</div>` : ""}

        <h3>Meistvernetzte Personen — ${esc(zeitraumText)}</h3>
        <table>
            <thead><tr><th>Person</th><th>Funktion</th><th>Verbindungen</th><th>Nachbarn</th></tr></thead>
            <tbody>${zentralZeilen || '<tr><td colspan="4" class="empty">Keine Verbindungen im Zeitraum</td></tr>'}</tbody>
        </table>

        <h3 style="margin-top:28px">Stärkste Verbindungen</h3>
        <table>
            <thead><tr><th>Person A</th><th>Person B</th><th>Beziehung</th><th>Quellen</th></tr></thead>
            <tbody>${verbindungsZeilen || '<tr><td colspan="4" class="empty">Keine Verbindungen im Zeitraum</td></tr>'}</tbody>
        </table>
    `;
}

netzwerkRoutes.get("/", async (c) => {
    const tage = Number(c.req.query("tage")) || 0;
    const filter = kantenFilterAusQuery(c.req.query("filter"));

    const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM newsletterj_beziehungen
    ` as unknown as [{ count: number }];

    if (count === 0) {
        await komentionBootstrap();
    }

    return c.html(await netzwerkAnsicht(tage, filter));
});

netzwerkRoutes.get("/daten", async (c) => {
    const tage = Number(c.req.query("tage")) || 0;
    const limit = Math.min(Number(c.req.query("limit")) || 80, 200);
    const filter = kantenFilterAusQuery(c.req.query("filter"));

    const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM newsletterj_beziehungen
    ` as unknown as [{ count: number }];

    if (count === 0) {
        await komentionBootstrap();
    }

    const graph = await netzwerkGraphLaden(tage, limit, filter);
    return c.json(graph);
});

netzwerkRoutes.post("/aktualisieren", async (c) => {
    const tage = Number(c.req.query("tage")) || 0;
    const filter = kantenFilterAusQuery(c.req.query("filter"));

    try {
        const neu = await komentionBootstrap();
        return c.html(
            await netzwerkAnsicht(tage, filter, {
                typ: "success",
                text: neu > 0 ? `${neu} neue Co-Mention-Kanten ergänzt.` : "Co-Mentions sind aktuell — keine neuen Kanten.",
            })
        );
    } catch (fehler) {
        const meldung = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
        return c.html(
            await netzwerkAnsicht(tage, filter, { typ: "error", text: `Aktualisierung fehlgeschlagen: ${meldung}` }),
            500
        );
    }
});
