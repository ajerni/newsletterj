import sql from "../db.js";
import { esc } from "../html.js";
import { kategorieLabel, datumFormatieren, relevanzBadge } from "../ui.js";
import { netzwerkHtml } from "./netzwerk.js";

export function zeitraumLabel(tage: number): string {
    switch (tage) {
        case 7: return "Letzte 7 Tage";
        case 30: return "Letzte 30 Tage";
        case 90: return "Letzte 90 Tage";
        case 365: return "Letztes Jahr";
        default: return "Gesamter Zeitraum";
    }
}

function artikelZeitraumBedingung(tage: number) {
    if (tage > 0) {
        return sql`COALESCE(a.veroeffentlicht_am, a.gesucht_am) > NOW() - make_interval(days => ${tage})`;
    }
    return sql`TRUE`;
}

interface DossierStatistik {
    artikel: number;
    ereignisse: number;
    personen: number;
    gemeinden: number;
    faelle_aktiv: number;
    hoch_relevant: number;
}

async function dossierStatistikLaden(tage: number): Promise<DossierStatistik> {
    const zeitraum = artikelZeitraumBedingung(tage);

    const [artikel] = await sql`
        SELECT COUNT(*)::int AS count FROM newsletterj_artikel a WHERE ${zeitraum}
    ` as unknown as [{ count: number }];

    const [ereignisse] = await sql`
        SELECT COUNT(*)::int AS count
        FROM newsletterj_ereignisse e
        JOIN newsletterj_artikel a ON a.id = e.artikel_id
        WHERE ${zeitraum}
    ` as unknown as [{ count: number }];

    const [personen] = await sql`
        SELECT COUNT(DISTINCT e.person_id)::int AS count
        FROM newsletterj_erwaehnungen e
        JOIN newsletterj_artikel a ON a.id = e.artikel_id
        WHERE ${zeitraum}
    ` as unknown as [{ count: number }];

    const [gemeinden] = await sql`
        SELECT COUNT(DISTINCT a.gemeinde_id)::int AS count
        FROM newsletterj_artikel a
        WHERE a.gemeinde_id IS NOT NULL AND ${zeitraum}
    ` as unknown as [{ count: number }];

    const [faelleAktiv] = await sql`
        SELECT COUNT(DISTINCT f.id)::int AS count
        FROM newsletterj_faelle f
        JOIN newsletterj_fall_artikel fa ON fa.fall_id = f.id
        JOIN newsletterj_artikel a ON a.id = fa.artikel_id
        WHERE f.status = 'aktiv' AND ${zeitraum}
    ` as unknown as [{ count: number }];

    const [hochRelevant] = await sql`
        SELECT COUNT(*)::int AS count
        FROM newsletterj_artikel a
        WHERE a.relevanz = 'hoch' AND ${zeitraum}
    ` as unknown as [{ count: number }];

    return {
        artikel: artikel.count,
        ereignisse: ereignisse.count,
        personen: personen.count,
        gemeinden: gemeinden.count,
        faelle_aktiv: faelleAktiv.count,
        hoch_relevant: hochRelevant.count,
    };
}

function executiveSummaryHtml(stats: DossierStatistik, zeitraum: string, topKategorien: string[]): string {
    const themen = topKategorien.length
        ? topKategorien.map((k) => kategorieLabel(k)).join(", ")
        : "keine dominanten Themen";

    return `
        <p>Zeitraum: <strong>${esc(zeitraum)}</strong></p>
        <ul class="dossier-stats">
            <li><strong>${stats.artikel}</strong> Artikel erfasst</li>
            <li><strong>${stats.ereignisse}</strong> Ereignisse extrahiert</li>
            <li><strong>${stats.personen}</strong> Personen erwähnt</li>
            <li><strong>${stats.gemeinden}</strong> Gemeinden betroffen</li>
            <li><strong>${stats.hoch_relevant}</strong> hoch relevante Beiträge</li>
            <li><strong>${stats.faelle_aktiv}</strong> aktive Fälle mit Bezug zum Zeitraum</li>
        </ul>
        <p>Schwerpunktthemen: ${esc(themen)}.</p>
    `;
}

async function chronologieHtml(tage: number): Promise<string> {
    const zeitraum = artikelZeitraumBedingung(tage);

    const eintraege = await sql`
        SELECT * FROM (
            SELECT
                'ereignis' AS typ,
                e.titel,
                COALESCE(e.ereignis_datum, e.erstellt_am) AS datum,
                e.typ AS kategorie,
                e.relevanz,
                g.name AS gemeinde_name,
                a.url AS quelle_url,
                a.quellen_name
            FROM newsletterj_ereignisse e
            JOIN newsletterj_artikel a ON a.id = e.artikel_id
            LEFT JOIN newsletterj_gemeinden g ON g.id = e.gemeinde_id
            WHERE ${zeitraum}

            UNION ALL

            SELECT
                'artikel' AS typ,
                a.titel,
                COALESCE(a.veroeffentlicht_am, a.gesucht_am) AS datum,
                a.kategorie,
                a.relevanz,
                g.name AS gemeinde_name,
                a.url AS quelle_url,
                a.quellen_name
            FROM newsletterj_artikel a
            LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
            WHERE ${zeitraum}
        ) kombiniert
        ORDER BY datum DESC NULLS LAST
        LIMIT 80
    `;

    if (eintraege.length === 0) {
        return `<p class="muted">Keine Einträge im gewählten Zeitraum.</p>`;
    }

    const zeilen = eintraege.map((e) => `
        <tr>
            <td class="muted">${datumFormatieren(e.datum, true)}</td>
            <td><span class="badge badge-kategorie">${esc(e.typ === "ereignis" ? "Ereignis" : "Artikel")}</span></td>
            <td>${esc(e.titel ?? "—")}</td>
            <td>${e.kategorie ? esc(kategorieLabel(String(e.kategorie))) : "—"}</td>
            <td>${relevanzBadge(String(e.relevanz ?? "mittel"))}</td>
            <td>${e.gemeinde_name ? esc(String(e.gemeinde_name)) : "—"}</td>
            <td>${e.quelle_url ? `<a href="${esc(String(e.quelle_url))}" target="_blank" rel="noopener">${esc(e.quellen_name ?? "Quelle")}</a>` : "—"}</td>
        </tr>
    `).join("");

    return `
        <table class="dossier-table">
            <thead><tr><th>Datum</th><th>Typ</th><th>Titel</th><th>Kategorie</th><th>Relevanz</th><th>Gemeinde</th><th>Quelle</th></tr></thead>
            <tbody>${zeilen}</tbody>
        </table>
    `;
}

async function themenHtml(tage: number): Promise<{ html: string; top: string[] }> {
    const zeitraum = artikelZeitraumBedingung(tage);

    const themen = await sql`
        SELECT a.kategorie, COUNT(*)::int AS anzahl
        FROM newsletterj_artikel a
        WHERE a.kategorie IS NOT NULL AND ${zeitraum}
        GROUP BY a.kategorie
        ORDER BY anzahl DESC, a.kategorie
    `;

    if (themen.length === 0) {
        return { html: `<p class="muted">Keine kategorisierten Artikel.</p>`, top: [] };
    }

    const max = Math.max(...themen.map((t) => t.anzahl));
    const zeilen = themen.map((t) => {
        const breite = max > 0 ? Math.round((t.anzahl / max) * 100) : 0;
        return `
            <tr>
                <td>${esc(kategorieLabel(String(t.kategorie)))}</td>
                <td>${t.anzahl}</td>
                <td><div class="dossier-bar" style="width:${breite}%"></div></td>
            </tr>
        `;
    }).join("");

    return {
        html: `
            <table class="dossier-table">
                <thead><tr><th>Kategorie</th><th>Artikel</th><th>Anteil</th></tr></thead>
                <tbody>${zeilen}</tbody>
            </table>
        `,
        top: themen.slice(0, 5).map((t) => String(t.kategorie)),
    };
}

async function gemeindenHtml(tage: number): Promise<string> {
    const zeitraum = artikelZeitraumBedingung(tage);

    const gemeinden = await sql`
        SELECT g.name, COUNT(a.id)::int AS artikel_anzahl,
            COUNT(DISTINCT CASE WHEN a.relevanz = 'hoch' THEN a.id END)::int AS hoch_relevant
        FROM newsletterj_artikel a
        JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
        WHERE ${zeitraum}
        GROUP BY g.id, g.name
        ORDER BY artikel_anzahl DESC, g.name
        LIMIT 40
    `;

    if (gemeinden.length === 0) {
        return `<p class="muted">Keine Gemeinden im Zeitraum.</p>`;
    }

    const zeilen = gemeinden.map((g) => `
        <tr>
            <td>${esc(g.name)}</td>
            <td>${g.artikel_anzahl}</td>
            <td>${g.hoch_relevant}</td>
        </tr>
    `).join("");

    return `
        <table class="dossier-table">
            <thead><tr><th>Gemeinde</th><th>Artikel</th><th>hoch relevant</th></tr></thead>
            <tbody>${zeilen}</tbody>
        </table>
    `;
}

async function schulenHtml(tage: number): Promise<string> {
    const zeitraum = artikelZeitraumBedingung(tage);

    const schulen = await sql`
        SELECT a.schule, COUNT(*)::int AS anzahl
        FROM newsletterj_artikel a
        WHERE a.schule IS NOT NULL AND TRIM(a.schule) <> '' AND ${zeitraum}
        GROUP BY a.schule
        ORDER BY anzahl DESC, a.schule
        LIMIT 40
    `;

    if (schulen.length === 0) {
        return `<p class="muted">Keine Schulen explizit genannt.</p>`;
    }

    const zeilen = schulen.map((s) => `
        <tr><td>${esc(s.schule)}</td><td>${s.anzahl}</td></tr>
    `).join("");

    return `
        <table class="dossier-table">
            <thead><tr><th>Schule</th><th>Artikel</th></tr></thead>
            <tbody>${zeilen}</tbody>
        </table>
    `;
}

async function personenHtml(tage: number): Promise<string> {
    const zeitraum = artikelZeitraumBedingung(tage);

    const personen = await sql`
        SELECT p.name, p.aktuelle_funktion, g.name AS gemeinde_name,
            COUNT(e.id)::int AS erwaehnungen
        FROM newsletterj_erwaehnungen e
        JOIN newsletterj_artikel a ON a.id = e.artikel_id
        JOIN newsletterj_personen p ON p.id = e.person_id
        LEFT JOIN newsletterj_gemeinden g ON g.id = p.aktuelle_gemeinde_id
        WHERE ${zeitraum}
        GROUP BY p.id, p.name, p.aktuelle_funktion, g.name
        ORDER BY erwaehnungen DESC, p.name
        LIMIT 40
    `;

    if (personen.length === 0) {
        return `<p class="muted">Keine Personen erwähnt.</p>`;
    }

    const zeilen = personen.map((p) => `
        <tr>
            <td>${esc(p.name)}</td>
            <td>${p.aktuelle_funktion ? esc(p.aktuelle_funktion) : "—"}</td>
            <td>${p.gemeinde_name ? esc(String(p.gemeinde_name)) : "—"}</td>
            <td>${p.erwaehnungen}</td>
        </tr>
    `).join("");

    return `
        <table class="dossier-table">
            <thead><tr><th>Person</th><th>Funktion</th><th>Gemeinde</th><th>Erwähnungen</th></tr></thead>
            <tbody>${zeilen}</tbody>
        </table>
    `;
}

async function risikenTrendsHtml(tage: number): Promise<string> {
    const zeitraum = artikelZeitraumBedingung(tage);

    const faelle = await sql`
        SELECT f.titel, f.status, f.relevanz, g.name AS gemeinde_name, f.artikel_anzahl
        FROM newsletterj_faelle f
        LEFT JOIN newsletterj_gemeinden g ON g.id = f.gemeinde_id
        WHERE EXISTS (
            SELECT 1 FROM newsletterj_fall_artikel fa
            JOIN newsletterj_artikel a ON a.id = fa.artikel_id
            WHERE fa.fall_id = f.id AND ${zeitraum}
        )
        ORDER BY f.relevanz DESC, f.artikel_anzahl DESC, f.titel
        LIMIT 20
    `;

    let trendHtml = "";
    if (tage > 0) {
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
            LIMIT 15
        `;

        if (trends.length > 0) {
            const trendZeilen = trends.map((t) => {
                const diff = t.aktuell - t.vorher;
                const pfeil = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
                const diffLabel = diff === 0 ? "±0" : (diff > 0 ? `+${diff}` : String(diff));
                return `
                    <tr>
                        <td>${esc(kategorieLabel(String(t.kategorie)))}</td>
                        <td>${t.aktuell}</td>
                        <td>${t.vorher}</td>
                        <td>${pfeil} ${diffLabel}</td>
                    </tr>
                `;
            }).join("");

            trendHtml = `
                <h4>Themen-Trend (vs. vorheriger gleicher Zeitraum)</h4>
                <table class="dossier-table">
                    <thead><tr><th>Kategorie</th><th>Aktuell</th><th>Vorher</th><th>Δ</th></tr></thead>
                    <tbody>${trendZeilen}</tbody>
                </table>
            `;
        }
    } else {
        trendHtml = `<p class="muted">Trendvergleich nur bei begrenztem Zeitraum (7–365 Tage).</p>`;
    }

    const faelleHtml = faelle.length === 0
        ? `<p class="muted">Keine Fälle mit Artikeln im Zeitraum.</p>`
        : `
            <table class="dossier-table">
                <thead><tr><th>Fall</th><th>Status</th><th>Relevanz</th><th>Gemeinde</th><th>Artikel</th></tr></thead>
                <tbody>${faelle.map((f) => `
                    <tr>
                        <td>${esc(f.titel)}</td>
                        <td>${esc(f.status)}</td>
                        <td>${relevanzBadge(String(f.relevanz))}</td>
                        <td>${f.gemeinde_name ? esc(String(f.gemeinde_name)) : "—"}</td>
                        <td>${f.artikel_anzahl}</td>
                    </tr>
                `).join("")}</tbody>
            </table>
        `;

    return `${faelleHtml}${trendHtml}`;
}

async function quellenHtml(tage: number): Promise<string> {
    const zeitraum = artikelZeitraumBedingung(tage);

    const quellen = await sql`
        SELECT
            COALESCE(a.veroeffentlicht_am, a.gesucht_am) AS datum,
            a.titel,
            a.quellen_name,
            a.url,
            g.name AS gemeinde_name,
            a.relevanz
        FROM newsletterj_artikel a
        LEFT JOIN newsletterj_gemeinden g ON g.id = a.gemeinde_id
        WHERE ${zeitraum}
        ORDER BY COALESCE(a.veroeffentlicht_am, a.gesucht_am) DESC NULLS LAST, a.id DESC
    `;

    if (quellen.length === 0) {
        return `<p class="muted">Keine Quellen im Zeitraum.</p>`;
    }

    const zeilen = quellen.map((q) => `
        <tr>
            <td class="muted">${datumFormatieren(q.datum)}</td>
            <td>${esc(q.titel ?? "—")}</td>
            <td>${q.quellen_name ? esc(q.quellen_name) : "—"}</td>
            <td>${q.gemeinde_name ? esc(String(q.gemeinde_name)) : "—"}</td>
            <td>${relevanzBadge(String(q.relevanz ?? "mittel"))}</td>
            <td><a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.url)}</a></td>
        </tr>
    `).join("");

    return `
        <p class="muted">${quellen.length} Quellen</p>
        <table class="dossier-table dossier-table-quellen">
            <thead><tr><th>Datum</th><th>Titel</th><th>Medium</th><th>Gemeinde</th><th>Relevanz</th><th>Link</th></tr></thead>
            <tbody>${zeilen}</tbody>
        </table>
    `;
}

function dossierAbschnitt(nummer: number, titel: string, inhalt: string): string {
    return `
        <section class="dossier-section" id="dossier-abschnitt-${nummer}">
            <h3>${nummer}. ${esc(titel)}</h3>
            ${inhalt}
        </section>
    `;
}

export async function dossierInhaltGenerieren(tage: number): Promise<{ html: string; statistik: DossierStatistik }> {
    const label = zeitraumLabel(tage);
    const stats = await dossierStatistikLaden(tage);
    const { html: themenInhalt, top } = await themenHtml(tage);

    const [
        chronologie,
        gemeinden,
        schulen,
        personen,
        netzwerk,
        risiken,
        quellen,
    ] = await Promise.all([
        chronologieHtml(tage),
        gemeindenHtml(tage),
        schulenHtml(tage),
        personenHtml(tage),
        netzwerkHtml(tage),
        risikenTrendsHtml(tage),
        quellenHtml(tage),
    ]);

    const html = `
        <article class="dossier-report">
            <header class="dossier-report-header">
                <h2>Recherche-Dossier — ${esc(label)}</h2>
                <p class="muted">Erstellt am ${datumFormatieren(new Date(), true)} · SQL-Auswertung (v1)</p>
            </header>
            ${dossierAbschnitt(1, "Executive Summary", executiveSummaryHtml(stats, label, top))}
            ${dossierAbschnitt(2, "Chronologische Übersicht", chronologie)}
            ${dossierAbschnitt(3, "Themenübersicht", themenInhalt)}
            ${dossierAbschnitt(4, "Übersicht nach Gemeinden", gemeinden)}
            ${dossierAbschnitt(5, "Übersicht nach Schulen", schulen)}
            ${dossierAbschnitt(6, "Übersicht nach Personen", personen)}
            ${dossierAbschnitt(7, "Netzwerk der beteiligten Personen und Organisationen", netzwerk)}
            ${dossierAbschnitt(8, "Risiken und Trends", risiken)}
            ${dossierAbschnitt(10, "Vollständige Quellenliste", quellen)}
        </article>
    `;

    return { html, statistik: stats };
}

export async function dossierErstellen(tage: number): Promise<number> {
    const label = zeitraumLabel(tage);

    const [row] = await sql`
        INSERT INTO newsletterj_dossiers (status, tage, zeitraum_label)
        VALUES ('gestartet', ${tage}, ${label})
        RETURNING id
    `;

    try {
        const { html, statistik } = await dossierInhaltGenerieren(tage);

        await sql`
            UPDATE newsletterj_dossiers SET
                status = 'abgeschlossen',
                inhalt_html = ${html},
                statistik_json = ${sql.json(statistik as unknown as Record<string, number>)},
                abgeschlossen_am = NOW()
            WHERE id = ${row.id}
        `;

        return row.id;
    } catch (fehler) {
        const meldung = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
        await sql`
            UPDATE newsletterj_dossiers SET
                status = 'fehlgeschlagen',
                fehlermeldung = ${meldung},
                abgeschlossen_am = NOW()
            WHERE id = ${row.id}
        `;
        throw fehler;
    }
}
