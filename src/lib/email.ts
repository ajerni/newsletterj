import type { SuchErgebnis, ArtikelExtraktion } from "./typen.js";

interface ResendAntwort {
    id: string;
}

interface ArtikelMitExtraktion {
    ergebnis: SuchErgebnis;
    extraktion: ArtikelExtraktion;
}

export interface FehlgeschlagenerArtikel {
    url: string;
    titel?: string | null;
    quellen_name?: string | null;
    fehler?: string;
}

const STANDARD_EMPFAENGER = ["ajerni@gmail.com", "jeanine.erni@gmail.com"];

function newsletterEmpfaenger(): string[] {
    const ausEnv = process.env.NEWSLETTER_TO_EMAIL
        ?.split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    return ausEnv?.length ? ausEnv : STANDARD_EMPFAENGER;
}

export async function newsletterSenden(html: string, betreff: string): Promise<string> {
    const von = process.env.NEWSLETTER_FROM_EMAIL || "Schulmonitor <onboarding@resend.dev>";
    const an = newsletterEmpfaenger();

    const antwort = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: von, to: an, subject: betreff, html }),
    });

    if (!antwort.ok) {
        throw new Error(`Resend fehlgeschlagen: ${antwort.status} ${antwort.statusText}`);
    }

    const daten: ResendAntwort = await antwort.json();
    return daten.id;
}

export function newsletterHtmlErstellen(
    artikel: ArtikelMitExtraktion[],
    fehlgeschlagen: FehlgeschlagenerArtikel[] = []
): string {
    const datum = new Date().toLocaleDateString("de-CH", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    // Group by primary category
    const nachKategorie = new Map<string, ArtikelMitExtraktion[]>();
    for (const a of artikel) {
        const kat = a.extraktion.kategorie || "sonstiges";
        if (!nachKategorie.has(kat)) nachKategorie.set(kat, []);
        nachKategorie.get(kat)!.push(a);
    }

    const sektionen = Array.from(nachKategorie.entries())
        .map(([kategorie, eintraege]) => {
            const artikelHtml = eintraege
                .map((a) => `
                    <li style="margin-bottom:14px;">
                        <a href="${htmlEscape(a.ergebnis.url)}" style="color:#1d4ed8;text-decoration:none;font-weight:500;">${htmlEscape(a.ergebnis.titel)}</a>
                        <span style="color:#6b7280;font-size:12px;margin-left:8px;">${htmlEscape(a.ergebnis.quellen_name || "")}</span>
                        <span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:11px;background:${relevanzFarbe(a.extraktion.relevanz)};margin-left:6px;">${a.extraktion.relevanz}</span>
                        ${a.extraktion.gemeinde ? `<span style="color:#6b7280;font-size:12px;margin-left:6px;">${htmlEscape(a.extraktion.gemeinde)}</span>` : ""}
                        <p style="margin:4px 0 0;color:#374151;font-size:14px;line-height:1.4;">${htmlEscape(a.extraktion.zusammenfassung.slice(0, 300))}</p>
                        ${a.extraktion.personen.length > 0 ? `<p style="margin:4px 0 0;color:#6b7280;font-size:12px;">Personen: ${a.extraktion.personen.map((p) => htmlEscape(`${p.name} (${p.funktion})`)).join(", ")}</p>` : ""}
                    </li>`)
                .join("");

            return `
                <div style="margin-bottom:28px;">
                    <h2 style="color:#111827;font-size:18px;margin-bottom:10px;text-transform:capitalize;">${htmlEscape(kategorie.replace(/_/g, " "))}</h2>
                    <ul style="list-style:none;padding:0;">${artikelHtml}</ul>
                </div>`;
        })
        .join("");

    const fehlgeschlagenHtml =
        fehlgeschlagen.length > 0
            ? `
                <div style="margin-bottom:28px;">
                    <h2 style="color:#111827;font-size:18px;margin-bottom:6px;">Nicht automatisch verarbeitet (${fehlgeschlagen.length})</h2>
                    <p style="color:#6b7280;font-size:13px;margin:0 0 10px;">Diese Beiträge konnten nicht analysiert werden und sind hier als Links aufgeführt:</p>
                    <ul style="list-style:none;padding:0;">
                        ${fehlgeschlagen
                            .map(
                                (f) => `
                        <li style="margin-bottom:8px;">
                            <a href="${htmlEscape(f.url)}" style="color:#1d4ed8;text-decoration:none;">${htmlEscape(f.titel || f.url)}</a>
                            ${f.quellen_name ? `<span style="color:#6b7280;font-size:12px;margin-left:8px;">${htmlEscape(f.quellen_name)}</span>` : ""}
                        </li>`
                            )
                            .join("")}
                    </ul>
                </div>`
            : "";

    return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#111827;">
    <h1 style="font-size:22px;margin-bottom:4px;">Schulmonitor Kanton Zürich</h1>
    <p style="color:#6b7280;margin-bottom:24px;">${datum} — ${artikel.length} neue Artikel${fehlgeschlagen.length > 0 ? `, ${fehlgeschlagen.length} nicht verarbeitet` : ""}</p>
    ${sektionen || '<p style="color:#6b7280;">Keine neuen Artikel in diesem Lauf gefunden.</p>'}
    ${fehlgeschlagenHtml}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin-top:32px;">
    <p style="color:#9ca3af;font-size:11px;">Automatisiert generiert durch newsletterj Schulmonitor</p>
</body>
</html>`;
}

function relevanzFarbe(relevanz: string): string {
    switch (relevanz) {
        case "hoch": return "#fecaca";
        case "mittel": return "#fef3c7";
        default: return "#f3f4f6";
    }
}

function htmlEscape(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
