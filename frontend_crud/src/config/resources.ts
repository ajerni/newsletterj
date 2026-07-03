export type FieldType = "text" | "textarea" | "number" | "datetime" | "select" | "array" | "json";

export interface FieldConfig {
    name: string;
    label: string;
    type: FieldType;
    required?: boolean;
    readonly?: boolean;
    hideInList?: boolean;
    /** Static select options or FK lookup */
    options?: Array<{ value: string; label: string }>;
    fk?: { resource: string; labelField?: string };
}

export interface ListSortConfig {
    param: string;
    column: string;
    default: string;
    options: Array<{ value: string; label: string }>;
}

export interface ResourceConfig {
    key: string;
    label: string;
    table: string;
    orderBy: string;
    fields: FieldConfig[];
    /** Select fields excluded from the list filter bar */
    filterExclude?: string[];
    /** Optional date/order toggle in the filter bar */
    listSort?: ListSortConfig;
}

const RELEVANZ = [
    { value: "hoch", label: "hoch" },
    { value: "mittel", label: "mittel" },
    { value: "tief", label: "tief" },
];

const SUCH_ENGINE = [
    { value: "exa", label: "exa" },
    { value: "brave", label: "brave" },
];

const LAUF_STATUS = [
    { value: "gestartet", label: "gestartet" },
    { value: "abgeschlossen", label: "abgeschlossen" },
    { value: "fehlgeschlagen", label: "fehlgeschlagen" },
];

export const RESOURCES: Record<string, ResourceConfig> = {
    gemeinden: {
        key: "gemeinden",
        label: "Gemeinden",
        table: "newsletterj_gemeinden",
        orderBy: "name ASC",
        fields: [
            { name: "id", label: "ID", type: "number", readonly: true },
            { name: "name", label: "Name", type: "text", required: true },
            { name: "aliase", label: "Aliase (kommagetrennt)", type: "array" },
            { name: "kanton", label: "Kanton", type: "text", required: true },
            { name: "erstellt_am", label: "Erstellt am", type: "datetime", readonly: true },
        ],
    },
    artikel: {
        key: "artikel",
        label: "Artikel",
        table: "newsletterj_artikel",
        orderBy: "veroeffentlicht_am DESC NULLS LAST",
        filterExclude: ["gemeinde_id"],
        listSort: {
            param: "datum",
            column: "veroeffentlicht_am",
            default: "neueste",
            options: [
                { value: "neueste", label: "Neueste zuerst" },
                { value: "aelteste", label: "Älteste zuerst" },
            ],
        },
        fields: [
            { name: "id", label: "ID", type: "number", readonly: true },
            { name: "url", label: "URL", type: "text", required: true },
            { name: "titel", label: "Titel", type: "text" },
            { name: "ausschnitt", label: "Ausschnitt", type: "textarea", hideInList: true },
            { name: "veroeffentlicht_am", label: "Veröffentlicht am", type: "datetime" },
            { name: "quellen_name", label: "Quelle", type: "text" },
            { name: "quellen_domain", label: "Quellen-Domain", type: "text", hideInList: true },
            { name: "such_engine", label: "Such-Engine", type: "select", options: SUCH_ENGINE },
            { name: "kategorie", label: "Kategorie", type: "text" },
            { name: "kategorien", label: "Kategorien (kommagetrennt)", type: "array", hideInList: true },
            { name: "relevanz", label: "Relevanz", type: "select", options: RELEVANZ },
            { name: "gemeinde_id", label: "Gemeinde", type: "select", fk: { resource: "gemeinden" } },
            { name: "schule", label: "Schule", type: "text" },
            { name: "zusammenfassung", label: "Zusammenfassung", type: "textarea", hideInList: true },
            { name: "auswirkungen", label: "Auswirkungen", type: "textarea", hideInList: true },
            { name: "kontext_bezug", label: "Kontext", type: "textarea", hideInList: true },
            { name: "roh_json", label: "Roh-JSON", type: "json", hideInList: true },
            { name: "extrahiert_am", label: "Extrahiert am", type: "datetime", hideInList: true },
            { name: "gesucht_am", label: "Gesucht am", type: "datetime", readonly: true },
            { name: "lauf_id", label: "Lauf", type: "select", fk: { resource: "laeufe" } },
        ],
    },
    personen: {
        key: "personen",
        label: "Personen",
        table: "newsletterj_personen",
        orderBy: "name ASC",
        fields: [
            { name: "id", label: "ID", type: "number", readonly: true },
            { name: "name", label: "Name", type: "text", required: true },
            { name: "aktuelle_funktion", label: "Aktuelle Funktion", type: "text" },
            { name: "aktuelle_gemeinde_id", label: "Gemeinde", type: "select", fk: { resource: "gemeinden" } },
            { name: "aktuelle_organisation", label: "Organisation", type: "text" },
            { name: "notizen", label: "Notizen", type: "textarea", hideInList: true },
            { name: "artikel_anzahl", label: "Artikel-Anzahl", type: "number" },
            { name: "erstmals_gesehen_am", label: "Erstmals gesehen", type: "datetime", readonly: true },
            { name: "zuletzt_gesehen_am", label: "Zuletzt gesehen", type: "datetime", readonly: true },
            { name: "erstellt_am", label: "Erstellt am", type: "datetime", readonly: true },
            { name: "aktualisiert_am", label: "Aktualisiert am", type: "datetime", readonly: true },
        ],
    },
    personen_funktionen: {
        key: "personen_funktionen",
        label: "Personen-Funktionen",
        table: "newsletterj_personen_funktionen",
        orderBy: "id DESC",
        fields: [
            { name: "id", label: "ID", type: "number", readonly: true },
            { name: "person_id", label: "Person", type: "select", fk: { resource: "personen" }, required: true },
            { name: "funktion", label: "Funktion", type: "text", required: true },
            { name: "organisation", label: "Organisation", type: "text" },
            { name: "gemeinde_id", label: "Gemeinde", type: "select", fk: { resource: "gemeinden" } },
            { name: "beginn", label: "Beginn", type: "datetime" },
            { name: "ende", label: "Ende", type: "datetime" },
            { name: "quell_artikel_id", label: "Quell-Artikel", type: "select", fk: { resource: "artikel" } },
            { name: "erstellt_am", label: "Erstellt am", type: "datetime", readonly: true },
        ],
    },
    erwaehnungen: {
        key: "erwaehnungen",
        label: "Erwähnungen",
        table: "newsletterj_erwaehnungen",
        orderBy: "id DESC",
        fields: [
            { name: "id", label: "ID", type: "number", readonly: true },
            { name: "artikel_id", label: "Artikel", type: "select", fk: { resource: "artikel" }, required: true },
            { name: "person_id", label: "Person", type: "select", fk: { resource: "personen" }, required: true },
            { name: "funktion_bei_erwaehnung", label: "Funktion bei Erwähnung", type: "text" },
            { name: "kontext", label: "Kontext", type: "textarea", hideInList: true },
            { name: "erstellt_am", label: "Erstellt am", type: "datetime", readonly: true },
        ],
    },
    organisationen: {
        key: "organisationen",
        label: "Organisationen",
        table: "newsletterj_organisationen",
        orderBy: "name ASC",
        fields: [
            { name: "id", label: "ID", type: "number", readonly: true },
            { name: "name", label: "Name", type: "text", required: true },
            { name: "typ", label: "Typ", type: "text" },
            { name: "gemeinde_id", label: "Gemeinde", type: "select", fk: { resource: "gemeinden" } },
            { name: "uebergeordnete_org_id", label: "Übergeordnete Org.", type: "select", fk: { resource: "organisationen" } },
            { name: "erstellt_am", label: "Erstellt am", type: "datetime", readonly: true },
        ],
    },
    org_erwaehnungen: {
        key: "org_erwaehnungen",
        label: "Org-Erwähnungen",
        table: "newsletterj_org_erwaehnungen",
        orderBy: "id DESC",
        fields: [
            { name: "id", label: "ID", type: "number", readonly: true },
            { name: "artikel_id", label: "Artikel", type: "select", fk: { resource: "artikel" }, required: true },
            { name: "organisation_id", label: "Organisation", type: "select", fk: { resource: "organisationen" }, required: true },
            { name: "erstellt_am", label: "Erstellt am", type: "datetime", readonly: true },
        ],
    },
    ereignisse: {
        key: "ereignisse",
        label: "Ereignisse",
        table: "newsletterj_ereignisse",
        orderBy: "erstellt_am DESC",
        fields: [
            { name: "id", label: "ID", type: "number", readonly: true },
            { name: "artikel_id", label: "Artikel", type: "select", fk: { resource: "artikel" }, required: true },
            { name: "typ", label: "Typ", type: "text", required: true },
            { name: "titel", label: "Titel", type: "text", required: true },
            { name: "beschreibung", label: "Beschreibung", type: "textarea", hideInList: true },
            { name: "gemeinde_id", label: "Gemeinde", type: "select", fk: { resource: "gemeinden" } },
            { name: "schule", label: "Schule", type: "text" },
            { name: "ereignis_datum", label: "Ereignis-Datum", type: "datetime" },
            { name: "relevanz", label: "Relevanz", type: "select", options: RELEVANZ },
            { name: "erstellt_am", label: "Erstellt am", type: "datetime", readonly: true },
        ],
    },
    laeufe: {
        key: "laeufe",
        label: "Läufe",
        table: "newsletterj_laeufe",
        orderBy: "gestartet_am DESC",
        fields: [
            { name: "id", label: "ID", type: "number", readonly: true },
            { name: "status", label: "Status", type: "select", options: LAUF_STATUS, required: true },
            { name: "artikel_gefunden", label: "Artikel gefunden", type: "number" },
            { name: "artikel_neu", label: "Artikel neu", type: "number" },
            { name: "personen_erstellt", label: "Personen erstellt", type: "number" },
            { name: "personen_aktualisiert", label: "Personen aktualisiert", type: "number" },
            { name: "ereignisse_erstellt", label: "Ereignisse erstellt", type: "number" },
            { name: "email_id", label: "E-Mail-ID", type: "text", hideInList: true },
            { name: "fehlermeldung", label: "Fehlermeldung", type: "textarea", hideInList: true },
            { name: "gestartet_am", label: "Gestartet am", type: "datetime", readonly: true },
            { name: "abgeschlossen_am", label: "Abgeschlossen am", type: "datetime" },
        ],
    },
};

export function resourceConfig(key: string): ResourceConfig {
    const config = RESOURCES[key];
    if (!config) throw new Error(`Unbekannte Ressource: ${key}`);
    return config;
}

export function resourceKeys(): string[] {
    return Object.keys(RESOURCES);
}

export function editableFields(config: ResourceConfig): FieldConfig[] {
    return config.fields.filter((f) => !f.readonly && f.name !== "id");
}

export function listFields(config: ResourceConfig): FieldConfig[] {
    return config.fields.filter((f) => !f.hideInList).slice(0, 8);
}

export function searchableFieldNames(config: ResourceConfig): string[] {
    return config.fields
        .filter((f) => (f.type === "text" || f.type === "textarea") && !f.readonly)
        .map((f) => f.name);
}

export function filterFields(config: ResourceConfig): FieldConfig[] {
    const exclude = new Set(config.filterExclude ?? []);
    return config.fields.filter((f) => f.type === "select" && f.name !== "id" && !exclude.has(f.name));
}

export function resolveListOrderBy(config: ResourceConfig, sort?: string): string {
    if (!config.listSort) return config.orderBy;
    const value = sort || config.listSort.default;
    if (value === "aelteste") return `${config.listSort.column} ASC NULLS LAST`;
    if (value === "neueste") return `${config.listSort.column} DESC NULLS LAST`;
    return config.orderBy;
}
