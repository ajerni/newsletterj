import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";
import { zeitraumOptionen } from "../ui.js";
import { zeitraumLabel } from "../lib/dossier.js";
import {
    komentionBootstrap,
    netzwerkGraphLaden,
    netzwerkStaerksteVerbindungen,
    netzwerkZentralitaet,
} from "../lib/netzwerk.js";

export const netzwerkRoutes = new Hono();

async function netzwerkAnsicht(
    tage = 0,
    hinweis?: { typ: "success" | "error"; text: string }
): Promise<string> {
    const [{ count: kantenGesamt }] = await sql`
        SELECT COUNT(*)::int AS count FROM newsletterj_beziehungen
    ` as unknown as [{ count: number }];

    const [zentral, verbindungen] = await Promise.all([
        netzwerkZentralitaet(tage, 20),
        netzwerkStaerksteVerbindungen(tage, 30),
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
            <td>${esc(String(v.relation).replace(/_/g, " "))}</td>
            <td>${v.artikel_anzahl}</td>
        </tr>
    `).join("");

    return `
        <div class="header-row">
            <div class="header-row-title">
                <h2>Netzwerk</h2>
            </div>
            <div class="header-row-actions">
                <span class="muted">${kantenGesamt} Kanten gespeichert</span>
                <button type="button" class="btn btn-sm"
                    hx-post="/api/netzwerk/aktualisieren?tage=${tage || ""}"
                    hx-target="#content">
                    Graph aktualisieren
                </button>
            </div>
        </div>

        <p class="section-intro muted">Personen, die in denselben Artikeln erwähnt werden (Co-Mentions). Explizite Beziehungen folgen später.</p>

        <form class="filter-bar filter-bar-grid" hx-get="/api/netzwerk" hx-target="#content" hx-trigger="change, submit">
            <label>
                Zeitraum
                <select name="tage">
                    <option value="">Gesamter Zeitraum</option>
                    ${zeitraumOptionen(tage ? String(tage) : null)}
                </select>
            </label>
        </form>

        ${hinweis ? `<div class="flash flash-${hinweis.typ}" role="status">${esc(hinweis.text)}</div>` : ""}

        <h3>Meistvernetzte Personen — ${esc(zeitraumText)}</h3>
        <table>
            <thead><tr><th>Person</th><th>Funktion</th><th>Gemeinsame Artikel</th><th>Verbindungen</th></tr></thead>
            <tbody>${zentralZeilen || '<tr><td colspan="4" class="empty">Keine Verbindungen im Zeitraum</td></tr>'}</tbody>
        </table>

        <h3 style="margin-top:28px">Stärkste Verbindungen</h3>
        <table>
            <thead><tr><th>Person A</th><th>Person B</th><th>Beziehung</th><th>Gemeinsame Artikel</th></tr></thead>
            <tbody>${verbindungsZeilen || '<tr><td colspan="4" class="empty">Keine Verbindungen im Zeitraum</td></tr>'}</tbody>
        </table>
    `;
}

netzwerkRoutes.get("/", async (c) => {
    const tage = Number(c.req.query("tage")) || 0;

    const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM newsletterj_beziehungen
    ` as unknown as [{ count: number }];

    if (count === 0) {
        await komentionBootstrap();
    }

    return c.html(await netzwerkAnsicht(tage));
});

netzwerkRoutes.get("/daten", async (c) => {
    const tage = Number(c.req.query("tage")) || 0;
    const limit = Math.min(Number(c.req.query("limit")) || 80, 200);

    const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM newsletterj_beziehungen
    ` as unknown as [{ count: number }];

    if (count === 0) {
        await komentionBootstrap();
    }

    const graph = await netzwerkGraphLaden(tage, limit);
    return c.json(graph);
});

netzwerkRoutes.post("/aktualisieren", async (c) => {
    const tage = Number(c.req.query("tage")) || 0;

    try {
        const neu = await komentionBootstrap();
        return c.html(
            await netzwerkAnsicht(tage, {
                typ: "success",
                text: neu > 0 ? `${neu} neue Kanten ergänzt.` : "Graph ist aktuell — keine neuen Kanten.",
            })
        );
    } catch (fehler) {
        const meldung = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
        return c.html(
            await netzwerkAnsicht(tage, { typ: "error", text: `Aktualisierung fehlgeschlagen: ${meldung}` }),
            500
        );
    }
});
