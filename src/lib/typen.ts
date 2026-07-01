import type { Kategorie, Relevanz, OrgTyp } from "../config/kategorien.js";

export interface SuchErgebnis {
    titel: string;
    url: string;
    ausschnitt: string;
    veroeffentlicht_am: string | null;
    such_engine: "exa" | "brave";
    quellen_name?: string;
    quellen_domain?: string;
    roh_json?: Record<string, unknown>;
}

export interface Gemeinde {
    id: number;
    name: string;
    aliase: string[];
    kanton: string;
    erstellt_am: Date;
}

export interface Artikel {
    id: number;
    url: string;
    titel: string | null;
    ausschnitt: string | null;
    veroeffentlicht_am: Date | null;
    quellen_name: string | null;
    quellen_domain: string | null;
    such_engine: "exa" | "brave";
    kategorie: Kategorie | null;
    kategorien: Kategorie[];
    relevanz: Relevanz;
    gemeinde_id: number | null;
    schule: string | null;
    zusammenfassung: string | null;
    auswirkungen: string | null;
    kontext_bezug: string | null;
    roh_json: Record<string, unknown> | null;
    extrahiert_am: Date | null;
    gesucht_am: Date;
    lauf_id: number | null;
}

export interface Person {
    id: number;
    name: string;
    aktuelle_funktion: string | null;
    aktuelle_gemeinde_id: number | null;
    aktuelle_organisation: string | null;
    notizen: string | null;
    erstmals_gesehen_am: Date;
    zuletzt_gesehen_am: Date;
    artikel_anzahl: number;
    erstellt_am: Date;
    aktualisiert_am: Date;
}

export interface PersonFunktion {
    id: number;
    person_id: number;
    funktion: string;
    organisation: string | null;
    gemeinde_id: number | null;
    beginn: Date | null;
    ende: Date | null;
    quell_artikel_id: number | null;
    erstellt_am: Date;
}

export interface Erwaehnung {
    id: number;
    artikel_id: number;
    person_id: number;
    funktion_bei_erwaehnung: string | null;
    kontext: string | null;
    erstellt_am: Date;
}

export interface Organisation {
    id: number;
    name: string;
    typ: OrgTyp | null;
    gemeinde_id: number | null;
    uebergeordnete_org_id: number | null;
    erstellt_am: Date;
}

export interface Ereignis {
    id: number;
    artikel_id: number;
    typ: Kategorie;
    titel: string;
    beschreibung: string | null;
    gemeinde_id: number | null;
    schule: string | null;
    ereignis_datum: Date | null;
    relevanz: Relevanz;
    erstellt_am: Date;
}

export interface MonitorLauf {
    id: number;
    status: "gestartet" | "abgeschlossen" | "fehlgeschlagen";
    artikel_gefunden: number;
    artikel_neu: number;
    personen_erstellt: number;
    personen_aktualisiert: number;
    ereignisse_erstellt: number;
    email_id: string | null;
    fehlermeldung: string | null;
    gestartet_am: Date;
    abgeschlossen_am: Date | null;
}

// AI extraction output schema
export interface ArtikelExtraktion {
    zusammenfassung: string;
    kategorie: Kategorie;
    kategorien: Kategorie[];
    relevanz: Relevanz;
    gemeinde: string | null;
    schule: string | null;
    auswirkungen: string | null;
    kontext_bezug: string | null;
    personen: Array<{
        name: string;
        funktion: string;
        organisation: string | null;
        gemeinde: string | null;
    }>;
    organisationen: Array<{
        name: string;
        typ: OrgTyp;
        gemeinde: string | null;
    }>;
    ereignisse: Array<{
        typ: Kategorie;
        titel: string;
        beschreibung: string;
        ereignis_datum: string | null;
        relevanz: Relevanz;
    }>;
}
