import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";
import { seitenNavigation } from "../ui.js";

export const laeufeRoutes = new Hono();

const SEITEN_GROESSE = 30;

const MONITOR_WEBHOOK_URL =
    process.env.MONITOR_WEBHOOK_URL ??
    "https://webhooks.wineagent.ch/api/webhooks/production/schulmonitor-ausfuehren";
const MONITOR_WEBHOOK_SECRET = process.env.MONITOR_WEBHOOK_SECRET ?? "your-secret";

async function laeufeAnsicht(
    seite = 1,
    hinweis?: { typ: "success" | "error"; text: string }
): Promise<string> {
    const offset = (seite - 1) * SEITEN_GROESSE;

    const laeufe = await sql`
        SELECT * FROM newsletterj_laeufe
        ORDER BY gestartet_am DESC
        LIMIT ${SEITEN_GROESSE} OFFSET ${offset}
    `;

    const [{ count: anzahl }] = await sql`
        SELECT COUNT(*)::int as count FROM newsletterj_laeufe
    ` as unknown as [{ count: number }];

    const gesamtSeiten = Math.ceil(anzahl / SEITEN_GROESSE);

    const zeilen = laeufe.map((l) => `
        <tr>
            <td><span class="badge badge-${statusKlasse(l.status)}">${esc(l.status)}</span></td>
            <td>${l.artikel_gefunden}</td>
            <td>${l.artikel_neu}</td>
            <td>${l.personen_erstellt} / ${l.personen_aktualisiert}</td>
            <td>${l.ereignisse_erstellt}</td>
            <td class="muted">${datumFormatieren(l.gestartet_am)}</td>
            <td class="muted">${l.abgeschlossen_am ? datumFormatieren(l.abgeschlossen_am) : "—"}</td>
            <td>${l.fehlermeldung ? `<span class="error">${esc(l.fehlermeldung.slice(0, 60))}</span>` : "—"}</td>
        </tr>
    `).join("");

    return `
        <div class="header-row">
            <div class="header-row-title">
                <h2>Läufe</h2>
                <button type="button" class="btn btn-sm btn-primary"
                    hx-post="/api/laeufe/run"
                    hx-target="#content"
                    hx-swap="innerHTML">
                    Run
                </button>
            </div>
            <div class="header-row-actions">
                <span class="muted">${anzahl} Einträge</span>
                ${anzahl > 0 ? `
                <button class="btn btn-sm btn-danger"
                    hx-delete="/api/laeufe"
                    hx-target="#content"
                    hx-confirm="Gesamte Lauf-Historie löschen? Artikel, Personen und Ereignisse bleiben erhalten.">
                    Historie löschen
                </button>` : ""}
            </div>
        </div>
        ${hinweis ? `<div class="flash flash-${hinweis.typ}" role="status">${esc(hinweis.text)}</div>` : ""}
        <table>
            <thead><tr><th>Status</th><th>Gefunden</th><th>Neu</th><th>Personen (neu/akt.)</th><th>Ereignisse</th><th>Start</th><th>Ende</th><th>Fehler</th></tr></thead>
            <tbody>${zeilen || '<tr><td colspan="8" class="empty">Noch keine Läufe</td></tr>'}</tbody>
        </table>
        ${seitenNavigation(seite, gesamtSeiten, "/api/laeufe")}
    `;
}

laeufeRoutes.get("/", async (c) => {
    const seite = Math.max(1, Number(c.req.query("seite")) || 1);
    return c.html(await laeufeAnsicht(seite));
});

laeufeRoutes.post("/run", async (c) => {
    try {
        const antwort = await fetch(MONITOR_WEBHOOK_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Webhook-Secret": MONITOR_WEBHOOK_SECRET,
            },
            body: "{}",
        });

        if (!antwort.ok) {
            const detail = (await antwort.text()).slice(0, 200);
            return c.html(
                await laeufeAnsicht(1, {
                    typ: "error",
                    text: `Webhook fehlgeschlagen (${antwort.status}): ${detail || antwort.statusText}`,
                }),
                502
            );
        }

        return c.html(
            await laeufeAnsicht(1, {
                typ: "success",
                text: "Monitor-Lauf wurde ausgelöst. Der neue Eintrag erscheint in der Liste, sobald der Lauf gestartet ist.",
            })
        );
    } catch (fehler) {
        const meldung = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
        return c.html(
            await laeufeAnsicht(1, { typ: "error", text: `Webhook-Aufruf fehlgeschlagen: ${meldung}` }),
            502
        );
    }
});

laeufeRoutes.delete("/", async (c) => {
    await sql`DELETE FROM newsletterj_laeufe`;
    return c.html(await laeufeAnsicht(1));
});

function statusKlasse(status: string): string {
    switch (status) {
        case "abgeschlossen": return "sent";
        case "fehlgeschlagen": return "failed";
        default: return "started";
    }
}

function datumFormatieren(d: Date | string): string {
    return new Date(d).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}
