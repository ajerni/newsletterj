import { task } from "@trigger.dev/sdk/v3";
import { alleSuchenAusfuehren } from "../lib/suche.js";
import { artikelExtrahieren } from "../lib/extraktion.js";
import { personenAufloesen, gemeindeIdAufloesen } from "../lib/personen.js";
import { artikelSpeichern, organisationFindenOderErstellen, orgErwaehnungErstellen, ereignisErstellen, laufErstellen, laufAbschliessen } from "../lib/db.js";
import { newsletterHtmlErstellen, newsletterSenden } from "../lib/email.js";
import type { SuchErgebnis, ArtikelExtraktion } from "../lib/typen.js";

export const monitorTask = task({
    id: "schulmonitor-ausfuehren",
    maxDuration: 600,
    retry: { maxAttempts: 1 },
    run: async () => {
        const laufId = await laufErstellen();
        let artikelGefunden = 0;
        let artikelNeu = 0;
        let personenErstellt = 0;
        let personenAktualisiert = 0;
        let ereignisseErstellt = 0;

        try {
            const neueErgebnisse = await alleSuchenAusfuehren();
            artikelGefunden = neueErgebnisse.length;

            const verarbeiteteArtikel: Array<{ ergebnis: SuchErgebnis; extraktion: ArtikelExtraktion }> = [];

            for (const ergebnis of neueErgebnisse) {
                try {
                    const extraktion = await artikelExtrahieren(
                        ergebnis.titel,
                        ergebnis.ausschnitt,
                        ergebnis.quellen_name ?? null
                    );

                    // Resolve municipality
                    const gemeindeId = extraktion.gemeinde
                        ? await gemeindeIdAufloesen(extraktion.gemeinde)
                        : null;

                    // Save article
                    const artikelId = await artikelSpeichern(ergebnis, extraktion, gemeindeId, laufId);
                    if (!artikelId) continue;
                    artikelNeu++;

                    // Resolve persons
                    const personenErgebnis = await personenAufloesen(extraktion.personen, artikelId);
                    personenErstellt += personenErgebnis.personen_erstellt;
                    personenAktualisiert += personenErgebnis.personen_aktualisiert;

                    // Resolve organizations
                    for (const org of extraktion.organisationen) {
                        const orgGemeindeId = org.gemeinde
                            ? await gemeindeIdAufloesen(org.gemeinde)
                            : gemeindeId;
                        const orgId = await organisationFindenOderErstellen(org.name, org.typ, orgGemeindeId);
                        await orgErwaehnungErstellen(artikelId, orgId);
                    }

                    // Create events
                    for (const ereignis of extraktion.ereignisse) {
                        const ereignisGemeindeId = gemeindeId;
                        await ereignisErstellen(artikelId, {
                            typ: ereignis.typ,
                            titel: ereignis.titel,
                            beschreibung: ereignis.beschreibung,
                            gemeinde_id: ereignisGemeindeId,
                            schule: null,
                            ereignis_datum: ereignis.ereignis_datum,
                            relevanz: ereignis.relevanz,
                        });
                        ereignisseErstellt++;
                    }

                    verarbeiteteArtikel.push({ ergebnis, extraktion });
                } catch (fehler) {
                    const meldung = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
                    console.error(`Fehler bei Artikel ${ergebnis.url}: ${meldung}`);
                }
            }

            // Generate and send newsletter
            let emailId: string | undefined;
            if (verarbeiteteArtikel.length > 0) {
                const html = newsletterHtmlErstellen(verarbeiteteArtikel);
                const heute = new Date().toISOString().split("T")[0];
                const betreff = `Schulmonitor ZH — ${heute}`;
                emailId = await newsletterSenden(html, betreff);
            }

            await laufAbschliessen(laufId, {
                status: "abgeschlossen",
                artikel_gefunden: artikelGefunden,
                artikel_neu: artikelNeu,
                personen_erstellt: personenErstellt,
                personen_aktualisiert: personenAktualisiert,
                ereignisse_erstellt: ereignisseErstellt,
                email_id: emailId,
            });

            return {
                status: "abgeschlossen",
                artikel_gefunden: artikelGefunden,
                artikel_neu: artikelNeu,
                personen_erstellt: personenErstellt,
                personen_aktualisiert: personenAktualisiert,
                ereignisse_erstellt: ereignisseErstellt,
                email_id: emailId,
            };
        } catch (fehler) {
            const meldung = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
            await laufAbschliessen(laufId, {
                status: "fehlgeschlagen",
                artikel_gefunden: artikelGefunden,
                artikel_neu: artikelNeu,
                personen_erstellt: personenErstellt,
                personen_aktualisiert: personenAktualisiert,
                ereignisse_erstellt: ereignisseErstellt,
                fehlermeldung: meldung,
            });
            throw fehler;
        }
    },
});
