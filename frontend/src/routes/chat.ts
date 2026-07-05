import { Hono } from "hono";
import { esc } from "../html.js";
import { ragAntwortGenerieren, ragKontextLaden, type RagQuelle } from "../lib/rag.js";

export const chatRoutes = new Hono();

function antwortHtml(text: string, quellen: RagQuelle[]): string {
    let body = esc(text);
    for (const q of quellen) {
        body = body.replaceAll(
            `[${q.nr}]`,
            `<a href="#chat-quelle-${q.nr}" class="chat-fn" title="${esc(q.titel)}">[${q.nr}]</a>`
        );
    }
    const absaetze = body
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
        .join("");

    const quellenListe = quellen.length
        ? `<ol class="chat-quellen">${quellen.map((q) => `
            <li id="chat-quelle-${q.nr}" value="${q.nr}">
                <a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.titel)}</a>
                ${q.quellen_name ? `<span class="muted"> — ${esc(q.quellen_name)}</span>` : ""}
                <span class="chat-quelle-link">
                    <a href="#" hx-get="/api/artikel/${q.id}" hx-target="#content">Details</a>
                </span>
            </li>
        `).join("")}</ol>`
        : "";

    return `${absaetze || `<p>${body}</p>`}${quellenListe}`;
}

function turnHtml(frage: string, antwort: string, quellen: RagQuelle[], fehler?: string): string {
    const assistentInhalt = fehler
        ? `<p class="error">${esc(fehler)}</p>`
        : antwortHtml(antwort, quellen);

    return `
        <div class="chat-turn">
            <div class="chat-bubble chat-user">
                <div class="chat-label">Sie</div>
                <div class="chat-text">${esc(frage).replace(/\n/g, "<br>")}</div>
            </div>
            <div class="chat-bubble chat-assistant">
                <div class="chat-label">Schulmonitor</div>
                <div class="chat-text">${assistentInhalt}</div>
            </div>
        </div>
    `;
}

chatRoutes.get("/", async (c) => {
    return c.html(`
        <div class="chat-shell">
            <div class="header-row">
                <h2>Schulmonitor fragen</h2>
            </div>
            <p class="muted section-intro">
                Stellen Sie eine Frage.
            </p>
            <div id="chat-messages" class="chat-messages"></div>
            <div id="chat-loading" class="htmx-indicator chat-loading">
                <div class="chat-bubble chat-assistant">
                    <div class="chat-label">Schulmonitor</div>
                    <div class="chat-text muted">Recherchiere in der Datenbank…</div>
                </div>
            </div>
            <form class="chat-form"
                hx-post="/api/chat/ask"
                hx-target="#chat-messages"
                hx-swap="beforeend"
                hx-indicator="#chat-loading"
                hx-on::after-request="if(event.detail.successful){ this.reset(); const m=document.getElementById('chat-messages'); if(m) m.scrollTop=m.scrollHeight; }">
                <textarea id="chat-input" name="frage" rows="3" required
                    placeholder="Ihre Frage an den Schulmonitor…"
                    class="chat-input"></textarea>
                <button type="submit" class="btn btn-primary">Senden</button>
            </form>
        </div>
    `);
});

chatRoutes.post("/ask", async (c) => {
    const body = await c.req.parseBody();
    const frage = typeof body.frage === "string" ? body.frage.trim() : "";

    if (!frage) {
        return c.html(turnHtml("—", "", [], "Bitte geben Sie eine Frage ein."), 400);
    }

    try {
        const quellen = await ragKontextLaden(frage);
        const antwort = await ragAntwortGenerieren(frage, quellen);
        return c.html(turnHtml(frage, antwort, quellen));
    } catch (fehler) {
        const meldung = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
        return c.html(turnHtml(frage, "", [], meldung), 500);
    }
});
