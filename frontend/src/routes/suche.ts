import { Hono } from "hono";
import { esc } from "../html.js";
import { hybrideArtikelSuche, hatEinbettungen } from "../lib/semantik.js";
import { relevanzBadge, kategorieBadge, datumRelativ } from "../ui.js";

export const sucheRoutes = new Hono();

function matchBadge(t: { match_typ: string; similarity: number | null }): string {
    if (t.match_typ === "stichwort") {
        return '<span class="badge badge-keyword" title="Stichwort-Treffer">Stichwort</span>';
    }
    if (t.similarity != null) {
        return `<span class="badge badge-similarity" title="Semantische Ähnlichkeit">${Math.round(t.similarity * 100)}% Match</span>`;
    }
    return "";
}

sucheRoutes.get("/", async (c) => {
    const query = (c.req.query("q") || "").trim();
    const einbettungenVorhanden = await hatEinbettungen().catch(() => false);

    let trefferHtml = "";
    let fehlerHtml = "";
    let hinweisHtml = "";

    if (query) {
        try {
            const treffer = await hybrideArtikelSuche(query, 20, einbettungenVorhanden);

            const hatSemantisch = treffer.some((t) => t.match_typ === "semantisch");
            const hatStichwort = treffer.some((t) => t.match_typ === "stichwort");

            if (hatSemantisch && hatStichwort) {
                hinweisHtml = '<p class="muted suche-hinweis">Kombiniert semantische Treffer mit Stichwort-Ergänzungen (kurze Begriffe wie «Gewalt»).</p>';
            } else if (hatStichwort && !hatSemantisch) {
                hinweisHtml = '<p class="muted suche-hinweis">Stichwort-Suche — für längere Fragen werden zusätzlich semantische Treffer geliefert.</p>';
            }

            if (treffer.length === 0) {
                trefferHtml = '<p class="empty">Keine passenden Artikel gefunden. Versuchen Sie eine andere Formulierung.</p>';
            } else {
                trefferHtml = treffer.map((t) => `
                    <article class="artikel-karte suche-treffer suche-treffer-${t.match_typ}">
                        <div class="artikel-karte-meta">
                            ${matchBadge(t)}
                            ${relevanzBadge(t.relevanz)}
                            ${t.kategorie ? kategorieBadge(t.kategorie) : ""}
                            ${t.gemeinde_name ? `<span class="badge badge-gemeinde">${esc(t.gemeinde_name)}</span>` : ""}
                            <span class="muted">${datumRelativ(t.gesucht_am)}</span>
                        </div>
                        <h3 class="artikel-karte-titel">
                            <a href="#" hx-get="/api/artikel/${t.id}" hx-target="#content">${esc(t.titel || "Ohne Titel")}</a>
                        </h3>
                    </article>
                `).join("");
            }
        } catch (fehler) {
            const meldung = fehler instanceof Error ? fehler.message : "Suche fehlgeschlagen";
            fehlerHtml = `<div class="login-alert" role="alert">${esc(meldung)}</div>`;
        }
    }

    return c.html(`
        <div class="header-row">
            <h2>Semantische Suche</h2>
        </div>
        <p class="muted section-intro">Suchen nach Bedeutung oder Stichwort — Embeddings für Fragen, Stichwort-Fallback für kurze Begriffe.</p>
        <form class="filter-bar suche-form" hx-get="/api/suche" hx-target="#content" hx-trigger="submit">
            <input type="search" name="q" placeholder="z.B. «Schulleitung Rücktritt nach Mobbing-Vorwürfen in Uster» oder «Gewalt»" value="${esc(query)}" class="filter-suche suche-input" autofocus>
            <button type="submit" class="btn btn-primary">Suchen</button>
        </form>
        ${fehlerHtml}
        ${hinweisHtml}
        <div class="artikel-liste">${trefferHtml}</div>
        ${!query ? `<p class="muted empty-hint">Geben Sie eine Frage oder einen Begriff ein — lange Fragen nutzen Embeddings, kurze Begriffe auch Stichwort-Match.</p>` : ""}
    `);
});
