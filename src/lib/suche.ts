import { exaSuche } from "./exa.js";
import { braveSuche } from "./brave.js";
import { vorhandeneUrls } from "./db.js";
import { MEDIEN_QUELLEN } from "../config/quellen.js";
import { SUCHANFRAGEN } from "../config/suchanfragen.js";
import type { SuchErgebnis } from "./typen.js";

const MIN_ERGEBNISSE = 3;
const BRAVE_VERZOEGERUNG_MS = 1500;

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
