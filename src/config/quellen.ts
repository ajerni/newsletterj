export interface MedienQuelle {
    name: string;
    domain: string;
    typ: "zeitung" | "rundfunk" | "online" | "offiziell" | "andere";
    sprache: "de" | "fr" | "it" | "multi";
}

export const MEDIEN_QUELLEN: MedienQuelle[] = [
    // Tageszeitungen
    { name: "Tages-Anzeiger", domain: "tagesanzeiger.ch", typ: "zeitung", sprache: "de" },
    { name: "NZZ", domain: "nzz.ch", typ: "zeitung", sprache: "de" },
    { name: "NZZ am Sonntag", domain: "nzzas.nzz.ch", typ: "zeitung", sprache: "de" },
    // Regional (Zürich)
    { name: "Zürcher Unterländer", domain: "zuercherunterlaender.ch", typ: "zeitung", sprache: "de" },
    { name: "Zürcher Oberländer", domain: "zuercheroberlander.ch", typ: "zeitung", sprache: "de" },
    { name: "Zürichsee-Zeitung", domain: "zsz.ch", typ: "zeitung", sprache: "de" },
    { name: "Landbote", domain: "landbote.ch", typ: "zeitung", sprache: "de" },
    { name: "Limmattaler Zeitung", domain: "limmattalerzeitung.ch", typ: "zeitung", sprache: "de" },
    { name: "Anzeiger Affoltern", domain: "affolteranzeiger.ch", typ: "zeitung", sprache: "de" },
    // CH Media
    { name: "Aargauer Zeitung", domain: "aargauerzeitung.ch", typ: "zeitung", sprache: "de" },
    // Rundfunk
    { name: "SRF", domain: "srf.ch", typ: "rundfunk", sprache: "de" },
    // Online
    { name: "Blick", domain: "blick.ch", typ: "online", sprache: "de" },
    { name: "Watson", domain: "watson.ch", typ: "online", sprache: "de" },
    { name: "Republik", domain: "republik.ch", typ: "online", sprache: "de" },
    { name: "WOZ", domain: "woz.ch", typ: "online", sprache: "de" },
    { name: "Inside Paradeplatz", domain: "insideparadeplatz.ch", typ: "online", sprache: "de" },
    // Offiziell
    { name: "Kanton Zürich", domain: "zh.ch", typ: "offiziell", sprache: "de" },
    { name: "Bildungsdirektion ZH", domain: "bi.zh.ch", typ: "offiziell", sprache: "de" },
];
