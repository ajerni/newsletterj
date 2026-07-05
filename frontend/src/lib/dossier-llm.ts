import sql from "../db.js";
import { marked } from "marked";
import { esc } from "../html.js";
import { kategorieLabel } from "../ui.js";
import { openRouterChat } from "./openrouter.js";

export interface DossierQuelle {
    nr: number;
    id: number;
    titel: string;
    url: string | null;
    text: string;
    quellen_name: string | null;
    typ: "artikel" | "fall";
}

export interface DossierStatistikBundle {
    artikel: number;
    ereignisse: number;
    personen: number;
    gemeinden: number;
    faelle_aktiv: number;
    hoch_relevant: number;
}

export interface DossierTrendZeile {
    kategorie: string;
    aktuell: number;
    vorher: number;
}

function artikelZeitraumBedingung(tage: number) {
    if (tage > 0) {
        return sql`COALESCE(a.veroeffentlicht_am, a.gesucht_am) > NOW() - make_interval(days => ${tage})`;
    }
    return sql`TRUE`;
}

export async function dossierQuellenLaden(tage: number): Promise<DossierQuelle[]> {
    const zeitraum = artikelZeitraumBedingung(tage);

    const artikel = await sql`
        SELECT a.id, a.titel, a.url, a.zusammenfassung, a.ausschnitt, a.quellen_name, a.kategorie, a.relevanz
        FROM newsletterj_artikel a
        WHERE ${zeitraum}
        ORDER BY
            CASE a.relevanz WHEN 'hoch' THEN 1 WHEN 'mittel' THEN 2 ELSE 3 END,
            COALESCE(a.veroeffentlicht_am, a.gesucht_am) DESC NULLS LAST
        LIMIT 10
    `;

    const faelle = await sql`
        SELECT f.id, f.titel, f.beschreibung, f.relevanz, f.status, g.name AS gemeinde_name
        FROM newsletterj_faelle f
        LEFT JOIN newsletterj_gemeinden g ON g.id = f.gemeinde_id
        WHERE EXISTS (
            SELECT 1 FROM newsletterj_fall_artikel fa
            JOIN newsletterj_artikel a ON a.id = fa.artikel_id
            WHERE fa.fall_id = f.id AND ${zeitraum}
        )
        ORDER BY
            CASE f.relevanz WHEN 'hoch' THEN 1 WHEN 'mittel' THEN 2 ELSE 3 END,
            f.artikel_anzahl DESC,
            f.titel
        LIMIT 6
    `;

    const quellen: DossierQuelle[] = [];

    for (const a of artikel) {
        const text = (a.zusammenfassung?.trim() || a.ausschnitt?.trim() || "").slice(0, 1800);
        if (!text) continue;
        quellen.push({
            nr: quellen.length + 1,
            id: a.id,
            titel: a.titel?.trim() || "Ohne Titel",
            url: a.url,
            text,
            quellen_name: a.quellen_name,
            typ: "artikel",
        });
    }

    for (const f of faelle) {
        const text = [f.beschreibung?.trim(), `Status: ${f.status}`, f.gemeinde_name ? `Gemeinde: ${f.gemeinde_name}` : null]
            .filter(Boolean)
            .join("\n")
            .slice(0, 1200);
        if (!text) continue;
        quellen.push({
            nr: quellen.length + 1,
            id: f.id,
            titel: f.titel,
            url: null,
            text,
            quellen_name: "Fall",
            typ: "fall",
        });
    }

    return quellen;
}

function quellenBlock(quellen: DossierQuelle[]): string {
    return quellen
        .map((q) => {
            const meta = q.quellen_name ? `Quelle: ${q.quellen_name}\n` : "";
            const url = q.url ? `URL: ${q.url}\n` : "";
            return `[${q.nr}] (${q.typ}) Titel: ${q.titel}\n${meta}${url}Inhalt: ${q.text}`;
        })
        .join("\n\n");
}

function zitateVerlinken(html: string, quellen: DossierQuelle[]): string {
    const quellenMap = new Map(quellen.map((q) => [q.nr, q]));

    return html.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_match, nummern: string) => {
        const teile = nummern.split(",").map((n) => Number(n.trim())).filter((n) => n > 0);
        const links = teile.map((nr) => {
            const q = quellenMap.get(nr);
            if (!q) return `[${nr}]`;
            return `<sup class="dossier-fn"><a href="#dossier-quelle-${nr}" title="${esc(q.titel)}">[${nr}]</a></sup>`;
        });
        return links.join("");
    });
}

function markdownZuHtml(text: string): string {
    const bereinigt = text
        .replace(/^Gerne[,!.].*?\n+/i, "")
        .replace(/^Hier (sind|ist).*?\n+/i, "")
        .trim();

    return marked.parse(bereinigt, {
        async: false,
        gfm: true,
        breaks: false,
    }) as string;
}

export function dossierLlmTextHtml(text: string, quellen: DossierQuelle[]): string {
    const body = zitateVerlinken(markdownZuHtml(text), quellen);

    const quellenListe = quellen.length
        ? `<ol class="dossier-quellen">${quellen.map((q) => `
            <li id="dossier-quelle-${q.nr}" value="${q.nr}">
                ${q.url
                    ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.titel)}</a>`
                    : `<span>${esc(q.titel)}</span>`}
                ${q.quellen_name ? `<span class="muted"> — ${esc(q.quellen_name)}</span>` : ""}
                ${q.typ === "artikel"
                    ? `<span class="chat-quelle-link"><a href="#" hx-get="/api/artikel/${q.id}" hx-target="#content">Details</a></span>`
                    : `<span class="chat-quelle-link"><a href="#" hx-get="/api/faelle/${q.id}" hx-target="#content">Fall</a></span>`}
            </li>
        `).join("")}</ol>`
        : "";

    return `<div class="dossier-llm-text">${body}${quellenListe}</div>`;
}

const EXECUTIVE_SYSTEM = `Du bist «Schulmonitor», Investigativ-Analyst für Bildungspolitik und Volksschulen im Kanton Zürich.

Aufgabe: Schreibe eine Executive Summary für ein Recherche-Dossier.

Regeln:
- Nutze die gelieferten Statistiken als Faktenrahmen und die nummerierten Quellen [1], [2], … für inhaltliche Aussagen.
- Jede inhaltliche Behauptung muss mit [n] belegt sein.
- Keine Erfindungen — wenn die Quellen dünn sind, sage das.
- Deutsch, sachlich, 4–8 Sätze in 1–2 Absätzen.
- Fokus: wichtigste Entwicklungen, Konflikte, Akteure, Gemeinden.`;

const RISIKEN_SYSTEM = `Du bist «Schulmonitor», Analyst für Bildungspolitik im Kanton Zürich.

Aufgabe: Formuliere «Risiken und Trends» für ein Recherche-Dossier.

Format (Markdown):
## Risiken
- 3–6 Bulletpoints mit **Fettem Titel:** und Kurztext

## Trends
- 3–6 Bulletpoints mit **Fettem Titel:** und Kurztext

Regeln:
- Beginne direkt mit ## Risiken — keine Einleitung.
- Nutze Statistiken, Fälle und Trends aus dem Kontext; inhaltliche Aussagen mit [n] belegen (einzeln: [3][7], nicht [3, 7]).
- Risiken: laufende Konflikte, aktive Fälle, hochrelevante Themen, Gemeinde-Hotspots.
- Trends: steigende/fallende Kategorien, neue Muster — nur wenn Daten vorliegen.
- Deutsch, präzise, keine Erfindungen.`;

export async function dossierExecutiveSummaryGenerieren(
    zeitraumLabel: string,
    stats: DossierStatistikBundle,
    topKategorien: string[],
    quellen: DossierQuelle[]
): Promise<string> {
    const themen = topKategorien.map((k) => kategorieLabel(k)).join(", ") || "—";

    const user = `Zeitraum: ${zeitraumLabel}

Statistiken (verbindlich):
- ${stats.artikel} Artikel
- ${stats.ereignisse} Ereignisse
- ${stats.personen} erwähnte Personen
- ${stats.gemeinden} Gemeinden
- ${stats.hoch_relevant} hoch relevante Artikel
- ${stats.faelle_aktiv} aktive Fälle mit Bezug zum Zeitraum
- Schwerpunktthemen (Kategorien): ${themen}

Quellen:
${quellen.length ? quellenBlock(quellen) : "Keine nummerierten Quellen — fasse nur die Statistiken zusammen."}`;

    return openRouterChat(EXECUTIVE_SYSTEM, user, 1200);
}

export async function dossierRisikenTrendsGenerieren(
    zeitraumLabel: string,
    stats: DossierStatistikBundle,
    topKategorien: string[],
    trends: DossierTrendZeile[],
    faelleTitel: string[],
    quellen: DossierQuelle[]
): Promise<string> {
    const trendText = trends.length
        ? trends.map((t) => {
            const diff = t.aktuell - t.vorher;
            const pfeil = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
            return `- ${kategorieLabel(t.kategorie)}: ${t.aktuell} (vorher ${t.vorher}, ${pfeil}${Math.abs(diff)})`;
        }).join("\n")
        : "Kein Vergleichszeitraum oder keine Trenddaten.";

    const faelleText = faelleTitel.length
        ? faelleTitel.map((t) => `- ${t}`).join("\n")
        : "Keine aktiven Fälle im Zeitraum.";

    const user = `Zeitraum: ${zeitraumLabel}

Statistiken:
- ${stats.artikel} Artikel, ${stats.hoch_relevant} hoch relevant
- ${stats.faelle_aktiv} aktive Fälle

Top-Kategorien: ${topKategorien.map((k) => kategorieLabel(k)).join(", ") || "—"}

Aktive Fälle (Titel):
${faelleText}

Themen-Trend (aktuell vs. vorheriger gleicher Zeitraum):
${trendText}

Quellen:
${quellen.length ? quellenBlock(quellen) : "Keine nummerierten Quellen."}`;

    return openRouterChat(RISIKEN_SYSTEM, user, 1600);
}

export async function dossierTrendDatenLaden(tage: number): Promise<DossierTrendZeile[]> {
    if (tage <= 0) return [];

    const trends = await sql`
        SELECT
            a.kategorie,
            COUNT(*) FILTER (
                WHERE COALESCE(a.veroeffentlicht_am, a.gesucht_am) > NOW() - make_interval(days => ${tage})
            )::int AS aktuell,
            COUNT(*) FILTER (
                WHERE COALESCE(a.veroeffentlicht_am, a.gesucht_am) <= NOW() - make_interval(days => ${tage})
                  AND COALESCE(a.veroeffentlicht_am, a.gesucht_am) > NOW() - make_interval(days => ${tage * 2})
            )::int AS vorher
        FROM newsletterj_artikel a
        WHERE a.kategorie IS NOT NULL
          AND COALESCE(a.veroeffentlicht_am, a.gesucht_am) > NOW() - make_interval(days => ${tage * 2})
        GROUP BY a.kategorie
        HAVING COUNT(*) FILTER (
            WHERE COALESCE(a.veroeffentlicht_am, a.gesucht_am) > NOW() - make_interval(days => ${tage})
        ) > 0
        ORDER BY COUNT(*) FILTER (
            WHERE COALESCE(a.veroeffentlicht_am, a.gesucht_am) > NOW() - make_interval(days => ${tage})
        ) DESC
        LIMIT 12
    `;

    return trends.map((t) => ({
        kategorie: String(t.kategorie),
        aktuell: t.aktuell,
        vorher: t.vorher,
    }));
}
