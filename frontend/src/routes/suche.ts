import { Hono } from "hono";
import { esc } from "../html.js";
import { semantischeArtikelSuche, hatEinbettungen } from "../lib/semantik.js";
import { relevanzBadge, kategorieBadge, datumRelativ } from "../ui.js";

export const sucheRoutes = new Hono();

sucheRoutes.get("/", async (c) => {
    const query = (c.req.query("q") || "").trim();
    const einbettungenVorhanden = await hatEinbettungen().catch(() => false);

    let trefferHtml = "";
    let fehlerHtml = "";

    if (query && einbettungenVorhanden) {
        try {
            const treffer = await semantischeArtikelSuche(query, 20, 0.55);

            if (treffer.length === 0) {
                trefferHtml = '<p class="empty">Keine semantisch ähnlichen Artikel gefunden. Versuchen Sie eine andere Formulierung.</p>';
            } else {
                trefferHtml = treffer.map((t) => `
                    <article class="artikel-karte suche-treffer">
                        <div class="artikel-karte-meta">
                            <span class="badge badge-similarity" title="Semantische Ähnlichkeit">${Math.round(t.similarity * 100)}% Match</span>
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
    } else if (query && !einbettungenVorhanden) {
        fehlerHtml = `<div class="login-alert" role="alert">Noch keine Embeddings vorhanden. Führen Sie zuerst einen Monitor-Lauf aus oder starten Sie den Task «einbettungen-nachziehen».</div>`;
    }

    return c.html(`
        <div class="header-row">
            <h2>Semantische Suche</h2>
        </div>
        <p class="muted section-intro">Suchen nach Bedeutung — nicht nur Stichwörter. Nutzt Embeddings aller verarbeiteten Artikel.</p>
        <form class="filter-bar suche-form" hx-get="/api/suche" hx-target="#content" hx-trigger="submit">
            <input type="search" name="q" placeholder="z.B. «Schulleitung Rücktritt nach Mobbing-Vorwürfen in Uster»" value="${esc(query)}" class="filter-suche suche-input" autofocus>
            <button type="submit" class="btn btn-primary">Suchen</button>
        </form>
        ${fehlerHtml}
        <div class="artikel-liste">${trefferHtml}</div>
        ${!query ? `<p class="muted empty-hint">Geben Sie eine Frage oder Beschreibung ein — die Suche findet inhaltlich ähnliche Berichte.</p>` : ""}
    `);
});
