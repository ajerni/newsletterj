import { exaSuche } from "./exa.js";
import { braveSuche } from "./brave.js";
import { vorhandeneUrls } from "./db.js";
import { MEDIEN_QUELLEN } from "../config/quellen.js";
import { SUCHANFRAGEN } from "../config/suchanfragen.js";
import type { SuchErgebnis } from "./typen.js";

const MIN_ERGEBNISSE = 3;
const BRAVE_VERZOEGERUNG_MS = 1500;

// Tracking-Parameter, die verschiedene URLs für denselben Artikel erzeugen
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|ref$)/i;

/**
 * Normalizes article URLs so that variants of the same page (tracking
 * params, fragments, trailing slashes) deduplicate to one entry.
 */
export function urlNormalisieren(roh: string): string {
    try {
        const url = new URL(roh);
        url.hash = "";
        for (const param of [...url.searchParams.keys()]) {
            if (TRACKING_PARAMS.test(param)) url.searchParams.delete(param);
        }
        if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
            url.pathname = url.pathname.slice(0, -1);
        }
        return url.toString();
    } catch {
        return roh;
    }
}

export async function alleSuchenAusfuehren(): Promise<SuchErgebnis[]> {
    const alleDomains = MEDIEN_QUELLEN.map((q) => q.domain);
    let alleErgebnisse: SuchErgebnis[] = [];

    for (const anfrage of SUCHANFRAGEN) {
        const exaErgebnisse = await exaSuche(anfrage, { inklusiveDomains: alleDomains });

        let kombiniert = exaErgebnisse;
        if (exaErgebnisse.length < MIN_ERGEBNISSE) {
            await verzoegerung(BRAVE_VERZOEGERUNG_MS);
            const braveErgebnisse = await braveSuche(anfrage);
            kombiniert = ergebnisseZusammenfuehren(exaErgebnisse, braveErgebnisse);
        }

        for (const ergebnis of kombiniert) {
            ergebnis.url = urlNormalisieren(ergebnis.url);
        }

        alleErgebnisse = ergebnisseZusammenfuehren(alleErgebnisse, kombiniert);
    }

    // Quelleninformation anreichern
    for (const ergebnis of alleErgebnisse) {
        if (!ergebnis.quellen_name) {
            const quelle = MEDIEN_QUELLEN.find((q) =>
                ergebnis.url.includes(q.domain)
            );
            if (quelle) {
                ergebnis.quellen_name = quelle.name;
                ergebnis.quellen_domain = quelle.domain;
            }
        }
    }

    // Gegen bestehende Artikel deduplizieren
    const bekannteUrls = await vorhandeneUrls(alleErgebnisse.map((e) => e.url));
    return alleErgebnisse.filter((e) => !bekannteUrls.has(e.url));
}

function ergebnisseZusammenfuehren(
    primaer: SuchErgebnis[],
    sekundaer: SuchErgebnis[]
): SuchErgebnis[] {
    const urls = new Set(primaer.map((e) => e.url));
    const zusammengefuehrt = [...primaer];
    for (const e of sekundaer) {
        if (!urls.has(e.url)) {
            urls.add(e.url);
            zusammengefuehrt.push(e);
        }
    }
    return zusammengefuehrt;
}

function verzoegerung(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
