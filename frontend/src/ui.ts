import { esc } from "./html.js";

export const KATEGORIEN = [
    "fuehrungswechsel", "wahlen", "ruecktritte", "kuendigungen",
    "freistellungen", "suspendierungen", "konflikte", "krisen",
    "beschwerden", "rekurse", "gerichtsverfahren", "strafverfahren",
    "datenschutz", "aufsichtsbeschwerden", "personal", "lehrpersonen",
    "finanzen", "budget", "bauprojekte", "schulraum", "digitalisierung",
    "lehrmittel", "sonderpaedagogik", "integration", "gewalt", "mobbing",
    "eltern", "schulqualitaet", "evaluationen", "politische_vorstoesse",
    "medienmitteilungen", "vernehmlassungen",
];

export function kategorieLabel(k: string): string {
    return k.replace(/_/g, " ");
}

export function kategorieOptionen(ausgewaehlt: string | null): string {
    return KATEGORIEN.map(
        (k) => `<option value="${k}" ${ausgewaehlt === k ? "selected" : ""}>${kategorieLabel(k)}</option>`
    ).join("");
}

export function relevanzOptionen(ausgewaehlt: string | null): string {
    return ["hoch", "mittel", "tief"]
        .map((r) => `<option value="${r}" ${ausgewaehlt === r ? "selected" : ""}>${r}</option>`)
        .join("");
}

export function zeitraumOptionen(ausgewaehlt: string | null): string {
    const optionen = [
        ["7", "Letzte 7 Tage"],
        ["30", "Letzte 30 Tage"],
        ["90", "Letzte 90 Tage"],
        ["365", "Letztes Jahr"],
    ];
    return optionen
        .map(([wert, label]) => `<option value="${wert}" ${ausgewaehlt === wert ? "selected" : ""}>${label}</option>`)
        .join("");
}

export function datumFormatieren(d: Date | string | null, mitZeit = false): string {
    if (!d) return "—";
    return new Date(d).toLocaleString("de-CH", mitZeit
        ? { dateStyle: "short", timeStyle: "short" }
        : { dateStyle: "medium" });
}

export function datumRelativ(d: Date | string | null): string {
    if (!d) return "";
    const diffMs = Date.now() - new Date(d).getTime();
    const stunden = Math.floor(diffMs / 3_600_000);
    if (stunden < 1) return "vor wenigen Minuten";
    if (stunden < 24) return `vor ${stunden} Std.`;
    const tage = Math.floor(stunden / 24);
    if (tage === 1) return "gestern";
    if (tage < 30) return `vor ${tage} Tagen`;
    return datumFormatieren(d);
}

export function relevanzBadge(relevanz: string): string {
    return `<span class="badge badge-${esc(relevanz)}">${esc(relevanz)}</span>`;
}

/** Category badge that navigates to the filtered article list when clicked */
export function kategorieBadge(kategorie: string | null): string {
    if (!kategorie) return "";
    return `<span class="badge badge-kategorie" hx-get="/api/artikel?kategorie=${esc(kategorie)}" hx-target="#content">${esc(kategorieLabel(kategorie))}</span>`;
}

export function seitenNavigation(seite: number, gesamt: number, basisUrl: string): string {
    if (gesamt <= 1) return "";
    const zurueck = seite > 1
        ? `<button class="btn btn-sm" hx-get="${basisUrl}&seite=${seite - 1}" hx-target="#content">← Zurück</button>`
        : "";
    const weiter = seite < gesamt
        ? `<button class="btn btn-sm" hx-get="${basisUrl}&seite=${seite + 1}" hx-target="#content">Weiter →</button>`
        : "";
    return `<div class="pagination">${zurueck}<span>Seite ${seite} von ${gesamt}</span>${weiter}</div>`;
}
