export const KATEGORIEN = [
    "fuehrungswechsel", "wahlen", "ruecktritte", "kuendigungen",
    "freistellungen", "suspendierungen", "konflikte", "krisen",
    "beschwerden", "rekurse", "gerichtsverfahren", "strafverfahren",
    "datenschutz", "aufsichtsbeschwerden", "personal", "lehrpersonen",
    "finanzen", "budget", "bauprojekte", "schulraum", "digitalisierung",
    "lehrmittel", "sonderpaedagogik", "integration", "gewalt", "mobbing",
    "eltern", "schulqualitaet", "evaluationen", "politische_vorstoesse",
    "medienmitteilungen", "vernehmlassungen",
] as const;

export type Kategorie = typeof KATEGORIEN[number];

export const RELEVANZ_STUFEN = ["hoch", "mittel", "tief"] as const;
export type Relevanz = typeof RELEVANZ_STUFEN[number];

export const ORG_TYPEN = [
    "volksschulamt", "bildungsdirektion", "bildungsrat",
    "fachstelle_schulbeurteilung", "schulpflege", "schulpraesidium",
    "schulleitung", "schulverwaltung", "kreisschulbehoerde",
    "zweckverband", "primarschule", "sekundarschule", "sonderschule",
    "tagesschule", "berufsschule", "kantonsschule", "gemeinde",
] as const;

export type OrgTyp = typeof ORG_TYPEN[number];
