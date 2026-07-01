import { Hono } from "hono";
import sql from "../db.js";
import { esc } from "../html.js";

export const laeufeRoutes = new Hono();

laeufeRoutes.get("/", async (c) => {
    const laeufe = await sql`
        SELECT * FROM newsletterj_laeufe ORDER BY gestartet_am DESC LIMIT 30
    `;

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

    return c.html(`
        <div class="header-row">
            <h2>Läufe</h2>
            <span class="muted">${laeufe.length} Einträge</span>
        </div>
        <table>
            <thead><tr><th>Status</th><th>Gefunden</th><th>Neu</th><th>Personen (neu/akt.)</th><th>Ereignisse</th><th>Start</th><th>Ende</th><th>Fehler</th></tr></thead>
            <tbody>${zeilen || '<tr><td colspan="8" class="empty">Noch keine Läufe</td></tr>'}</tbody>
        </table>
    `);
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
