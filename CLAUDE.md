# newsletterj — Education Media Monitor for Canton Zurich

## Project Overview

Specialized investigative media monitoring system focused on **education policy, public schools (Volksschulen), and public administration** in Canton Zurich, Switzerland.

The system:
1. Searches predefined Swiss media sources for school/education-related articles
2. AI-extracts structured metadata (people, roles, municipalities, schools, categories, relevance)
3. Auto-merges person mentions into persistent person profiles across articles
4. Persists all data in a queryable database (supports dashboard views: trending topics, person networks, conflict timelines)
5. Generates a newsletter email summarizing findings per run

Triggered manually from external frontends via Trigger.dev API — no built-in cron.

## Tech Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Runtime | Node.js 20+ | |
| Language | TypeScript 5.x | Strict mode |
| Task Engine | Trigger.dev v3 | Self-hosted instance |
| Database | PostgreSQL 15+ | Self-hosted, tables prefixed `newsletterj_` |
| DB Client | postgres (postgres.js) | Tagged template queries, no ORM |
| Search (primary) | Exa AI | Semantic/neural search |
| Search (fallback) | Brave Search | Broad web/news search |
| AI/LLM | OpenRouter | Extraction + summarization + person matching |
| Email | Resend | HTML email with inline CSS |
| Frontend | Hono + HTMX | Admin + dashboard |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  External Frontend (trigger via Trigger.dev API)             │
└────────────────────────────┬────────────────────────────────┘
                             │ trigger
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  monitor-task.ts (Trigger.dev orchestrator)                 │
│  1. Load sources from config + search queries               │
│  2. For each source/query: search (Exa → Brave fallback)   │
│  3. Deduplicate against DB (by URL)                         │
│  4. For each new article: AI-extract structured metadata    │
│  5. Resolve persons (AI auto-merge against existing)        │
│  6. Persist articles, persons, mentions, events             │
│  7. Generate newsletter email (summary per category)        │
│  8. Send via Resend                                         │
│  9. Log run                                                 │
└─────────────────────────────────────────────────────────────┘
          │ uses
          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐
│ search.ts│ │extract.ts│ │persons.ts│ │ email.ts │ │   db.ts    │
│exa+brave │ │AI extract│ │AI merge  │ │  Resend  │ │  postgres  │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────┘
```

## Domain Model

### Core Entities

- **Artikel** — a media piece found via search (URL, Titel, Datum, Quelle, Ausschnitt)
- **Person** — a tracked individual (merged identity across articles). Has: Name, aktuelle_funktion, aktuelle_gemeinde, Funktionshistorie
- **Erwähnung** — a person appearing in an article (links Person ↔ Artikel, stores funktion_bei_erwaehnung)
- **Organisation** — a school, authority, or institution (Volksschulamt, specific Schule, Schulpflege X)
- **Ereignis** — a notable occurrence extracted from an article (Konflikt, Rücktritt, Wahl, etc.)
- **Gemeinde** — a municipality in Canton Zurich (canonical name + aliase array for AI-merge)

### Categories (from aufgabe_neu.txt)

Fixed set of categories for classifying articles/events:

```
fuehrungswechsel, wahlen, ruecktritte, kuendigungen, freistellungen,
suspendierungen, konflikte, krisen, beschwerden, rekurse,
gerichtsverfahren, strafverfahren, datenschutz, aufsichtsbeschwerden,
personal, lehrpersonen, finanzen, budget, bauprojekte, schulraum,
digitalisierung, lehrmittel, sonderpaedagogik, integration,
gewalt, mobbing, eltern, schulqualitaet, evaluationen,
politische_vorstoesse, medienmitteilungen, vernehmlassungen
```

### Relevance Levels

Each article/event gets: `hoch`, `mittel`, `tief`

## Project Structure

```
newsletterj/
├── src/
│   ├── trigger/
│   │   └── monitor-task.ts       # Main orchestrator (Trigger.dev task)
│   ├── lib/
│   │   ├── db.ts                 # postgres.js client + all query helpers
│   │   ├── exa.ts                # Exa AI search client
│   │   ├── brave.ts              # Brave Search client
│   │   ├── search.ts             # Search orchestration (exa→brave fallback)
│   │   ├── extract.ts            # AI extraction (article → structured data)
│   │   ├── persons.ts            # AI person resolution + merge logic
│   │   ├── email.ts              # Resend sender + newsletter HTML builder
│   │   └── types.ts              # Shared TypeScript types
│   └── config/
│       ├── quellen.ts            # Media source definitions (URLs, domains)
│       ├── suchanfragen.ts       # Search query templates
│       └── kategorien.ts         # Category + organization enums
├── frontend/                     # Admin + Dashboard (Hono + HTMX)
│   ├── src/
│   │   ├── index.ts              # Hono server with basic auth
│   │   ├── db.ts                 # DB connection
│   │   ├── html.ts              # Shared HTML escape utility
│   │   └── routes/
│   │       ├── dashboard.ts      # Overview: trends, recent, stats
│   │       ├── articles.ts       # Article list + detail view
│   │       ├── persons.ts        # Person profiles + network view
│   │       ├── events.ts         # Event timeline
│   │       ├── municipalities.ts # Per-municipality view
│   │       └── runs.ts           # Run log
│   ├── public/
│   │   ├── index.html
│   │   └── styles.css
│   └── .env
├── trigger.config.ts
├── package.json
├── tsconfig.json
└── .env
```

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@host:port/dbname

# Search APIs
EXA_API_KEY=...
BRAVE_API_KEY=...

# AI (OpenRouter)
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=anthropic/claude-sonnet-4   # Any OpenRouter model identifier

# Email (Resend)
RESEND_API_KEY=...
NEWSLETTER_TO_EMAIL=recipient@example.com
NEWSLETTER_FROM_EMAIL=Newsletter <onboarding@resend.dev>   # Optional, has default
```

## Database Schema

All tables use the `newsletterj_` prefix with German names. Run these SQL commands manually.

```sql
-- 1. Gemeinden (kanonische Schreibweisen, AI-Merge-Ziel)
CREATE TABLE IF NOT EXISTS newsletterj_gemeinden (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,      -- kanonischer Name (z.B. 'Uster')
    aliase VARCHAR(200)[] DEFAULT '{}',     -- bekannte Varianten (z.B. '{"Stadt Uster","Gemeinde Uster"}')
    kanton VARCHAR(10) NOT NULL DEFAULT 'ZH',
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Artikel (jeder gefundene Medienbeitrag)
CREATE TABLE IF NOT EXISTS newsletterj_artikel (
    id SERIAL PRIMARY KEY,
    url VARCHAR(2000) NOT NULL UNIQUE,
    titel VARCHAR(500),
    ausschnitt TEXT,                        -- Snippet/Auszug
    veroeffentlicht_am TIMESTAMPTZ,
    quellen_name VARCHAR(200),             -- z.B. 'NZZ', 'Tages-Anzeiger'
    quellen_domain VARCHAR(200),           -- z.B. 'nzz.ch'
    such_engine VARCHAR(20) NOT NULL,      -- 'exa' oder 'brave'
    kategorie VARCHAR(100),                -- Hauptkategorie
    kategorien VARCHAR(100)[] DEFAULT '{}', -- alle zutreffenden Kategorien
    relevanz VARCHAR(10) NOT NULL DEFAULT 'mittel', -- hoch/mittel/tief
    gemeinde_id INTEGER REFERENCES newsletterj_gemeinden(id),
    schule VARCHAR(300),                   -- spezifische Schule falls erwähnt
    zusammenfassung TEXT,                  -- KI-generierte Zusammenfassung (3-10 Sätze)
    auswirkungen TEXT,                     -- mögliche Auswirkungen
    kontext_bezug TEXT,                    -- Bezug zu früheren Ereignissen
    roh_json JSONB,
    extrahiert_am TIMESTAMPTZ,
    gesucht_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lauf_id INTEGER
);

-- 3. Personen (zusammengeführte Identitäten)
CREATE TABLE IF NOT EXISTS newsletterj_personen (
    id SERIAL PRIMARY KEY,
    name VARCHAR(300) NOT NULL,
    aktuelle_funktion VARCHAR(300),         -- z.B. 'Schulpräsident'
    aktuelle_gemeinde_id INTEGER REFERENCES newsletterj_gemeinden(id),
    aktuelle_organisation VARCHAR(300),     -- aktuelle Schule/Behörde
    notizen TEXT,                           -- KI-generiertes Profil
    erstmals_gesehen_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    zuletzt_gesehen_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    artikel_anzahl INTEGER NOT NULL DEFAULT 0,
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Personen-Funktionshistorie
CREATE TABLE IF NOT EXISTS newsletterj_personen_funktionen (
    id SERIAL PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES newsletterj_personen(id) ON DELETE CASCADE,
    funktion VARCHAR(300) NOT NULL,
    organisation VARCHAR(300),
    gemeinde_id INTEGER REFERENCES newsletterj_gemeinden(id),
    beginn TIMESTAMPTZ,
    ende TIMESTAMPTZ,
    quell_artikel_id INTEGER REFERENCES newsletterj_artikel(id),
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Erwähnungen (Person ↔ Artikel Verknüpfung)
CREATE TABLE IF NOT EXISTS newsletterj_erwaehnungen (
    id SERIAL PRIMARY KEY,
    artikel_id INTEGER NOT NULL REFERENCES newsletterj_artikel(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES newsletterj_personen(id) ON DELETE CASCADE,
    funktion_bei_erwaehnung VARCHAR(300),   -- Funktion zum Zeitpunkt des Artikels
    kontext TEXT,                           -- wie die Person erwähnt wird
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(artikel_id, person_id)
);

-- 6. Organisationen
CREATE TABLE IF NOT EXISTS newsletterj_organisationen (
    id SERIAL PRIMARY KEY,
    name VARCHAR(400) NOT NULL,
    typ VARCHAR(100),                      -- 'volksschulamt', 'schulpflege', 'primarschule', etc.
    gemeinde_id INTEGER REFERENCES newsletterj_gemeinden(id),
    uebergeordnete_org_id INTEGER REFERENCES newsletterj_organisationen(id),
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(name, gemeinde_id)
);

-- 7. Organisations-Erwähnungen in Artikeln
CREATE TABLE IF NOT EXISTS newsletterj_org_erwaehnungen (
    id SERIAL PRIMARY KEY,
    artikel_id INTEGER NOT NULL REFERENCES newsletterj_artikel(id) ON DELETE CASCADE,
    organisation_id INTEGER NOT NULL REFERENCES newsletterj_organisationen(id) ON DELETE CASCADE,
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(artikel_id, organisation_id)
);

-- 8. Ereignisse (aus Artikeln extrahierte Vorkommnisse)
CREATE TABLE IF NOT EXISTS newsletterj_ereignisse (
    id SERIAL PRIMARY KEY,
    artikel_id INTEGER NOT NULL REFERENCES newsletterj_artikel(id) ON DELETE CASCADE,
    typ VARCHAR(100) NOT NULL,             -- entspricht Kategorien
    titel VARCHAR(500) NOT NULL,
    beschreibung TEXT,
    gemeinde_id INTEGER REFERENCES newsletterj_gemeinden(id),
    schule VARCHAR(300),
    ereignis_datum TIMESTAMPTZ,            -- wann das Ereignis stattfand
    relevanz VARCHAR(10) NOT NULL DEFAULT 'mittel',
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Monitor-Läufe (Protokoll)
CREATE TABLE IF NOT EXISTS newsletterj_laeufe (
    id SERIAL PRIMARY KEY,
    status VARCHAR(50) NOT NULL DEFAULT 'gestartet', -- gestartet, abgeschlossen, fehlgeschlagen
    artikel_gefunden INTEGER NOT NULL DEFAULT 0,
    artikel_neu INTEGER NOT NULL DEFAULT 0,
    personen_erstellt INTEGER NOT NULL DEFAULT 0,
    personen_aktualisiert INTEGER NOT NULL DEFAULT 0,
    ereignisse_erstellt INTEGER NOT NULL DEFAULT 0,
    email_id VARCHAR(200),
    fehlermeldung TEXT,
    gestartet_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    abgeschlossen_am TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_artikel_url ON newsletterj_artikel(url);
CREATE INDEX IF NOT EXISTS idx_artikel_gesucht ON newsletterj_artikel(gesucht_am DESC);
CREATE INDEX IF NOT EXISTS idx_artikel_kategorie ON newsletterj_artikel(kategorie);
CREATE INDEX IF NOT EXISTS idx_artikel_gemeinde ON newsletterj_artikel(gemeinde_id);
CREATE INDEX IF NOT EXISTS idx_artikel_relevanz ON newsletterj_artikel(relevanz);
CREATE INDEX IF NOT EXISTS idx_artikel_veroeffentlicht ON newsletterj_artikel(veroeffentlicht_am DESC);
CREATE INDEX IF NOT EXISTS idx_artikel_lauf ON newsletterj_artikel(lauf_id);
CREATE INDEX IF NOT EXISTS idx_personen_name ON newsletterj_personen(name);
CREATE INDEX IF NOT EXISTS idx_personen_gemeinde ON newsletterj_personen(aktuelle_gemeinde_id);
CREATE INDEX IF NOT EXISTS idx_personen_zuletzt ON newsletterj_personen(zuletzt_gesehen_am DESC);
CREATE INDEX IF NOT EXISTS idx_erwaehnungen_artikel ON newsletterj_erwaehnungen(artikel_id);
CREATE INDEX IF NOT EXISTS idx_erwaehnungen_person ON newsletterj_erwaehnungen(person_id);
CREATE INDEX IF NOT EXISTS idx_ereignisse_typ ON newsletterj_ereignisse(typ);
CREATE INDEX IF NOT EXISTS idx_ereignisse_gemeinde ON newsletterj_ereignisse(gemeinde_id);
CREATE INDEX IF NOT EXISTS idx_ereignisse_datum ON newsletterj_ereignisse(ereignis_datum DESC);
CREATE INDEX IF NOT EXISTS idx_personen_funktionen_person ON newsletterj_personen_funktionen(person_id);
CREATE INDEX IF NOT EXISTS idx_org_erwaehnungen_artikel ON newsletterj_org_erwaehnungen(artikel_id);
CREATE INDEX IF NOT EXISTS idx_org_erwaehnungen_org ON newsletterj_org_erwaehnungen(organisation_id);
CREATE INDEX IF NOT EXISTS idx_gemeinden_name ON newsletterj_gemeinden(name);
```

## Config Files

### quellen.ts — Media Sources

```typescript
// src/config/quellen.ts
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
    // CH Media / Aargauer Zeitung
    { name: "Aargauer Zeitung", domain: "aargauerzeitung.ch", typ: "zeitung", sprache: "de" },
    // Rundfunk
    { name: "SRF", domain: "srf.ch", typ: "rundfunk", sprache: "de" },
    { name: "RTS", domain: "rts.ch", typ: "rundfunk", sprache: "fr" },
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
```

### suchanfragen.ts — Search Queries

```typescript
// src/config/suchanfragen.ts
export const SUCHANFRAGEN: string[] = [
    "Volksschule Kanton Zürich",
    "Schulpflege Zürich",
    "Schulleitung Kanton Zürich Konflikt",
    "Bildungsdirektion Zürich",
    "Schulpräsident Zürich Rücktritt Wahl",
    "Volksschulamt Zürich",
    "Schulhaus Zürich Bauprojekt",
    "Primarschule Zürich",
    "Sekundarschule Zürich",
    "Sonderschule Zürich",
    "Schulqualität Zürich Evaluation",
    "Lehrpersonen Zürich Kündigung",
    "Schule Zürich Gewalt Mobbing",
    "Schule Zürich Digitalisierung",
    "Schule Zürich Finanzen Budget",
];
```

### kategorien.ts — Enums

```typescript
// src/config/kategorien.ts
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
```

## AI Extraction Schema

When processing each article, the AI receives the article content and returns structured JSON:

```typescript
interface ArtikelExtraktion {
    zusammenfassung: string;           // 3-10 sentences
    kategorie: Kategorie;              // primary category
    kategorien: Kategorie[];           // all applicable
    relevanz: Relevanz;
    gemeinde: string | null;           // primary Gemeinde mentioned
    schule: string | null;             // specific school if mentioned
    auswirkungen: string | null;       // possible effects
    kontext_bezug: string | null;      // relation to earlier events
    personen: Array<{
        name: string;
        funktion: string;              // function at time of article
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
        ereignis_datum: string | null;  // ISO date if mentioned
        relevanz: Relevanz;
    }>;
}
```

## Person Resolution (AI Auto-Merge)

When a person is extracted from an article:
1. Query `newsletterj_personen` for potential matches (by name similarity + municipality)
2. Send candidate list + new mention to AI: "Is this the same person?"
3. If match → update existing person (zuletzt_gesehen_am, possibly aktuelle_funktion)
4. If new → create person record
5. In both cases → create mention linking person ↔ article

## Municipality Resolution (AI Auto-Merge)

When a municipality name is extracted from an article:
1. Query `newsletterj_gemeinden` for exact match on `name` or contained in `aliase`
2. If no match → send to AI with all known Gemeinden: "Which municipality does this refer to, or is it new?"
3. If match → use existing `gemeinde_id`
4. If new → create new Gemeinde record (add original spelling as alias if it differs from canonical name)

Handles variants like "Stadt Zürich" / "Zürich" / "Kreis 4 Zürich" → same Gemeinde, or "Gemeinde Uster" / "Uster" → same.

## Key Patterns

### Search Strategy (search.ts)
```
1. For each query in SEARCH_QUERIES:
   a. Search Exa (includeDomains from sources config)
   b. If < 3 results → supplement with Brave (country=CH)
2. Merge all results, deduplicate by URL
3. Check against newsletterj_articles table (skip existing URLs)
4. Return list of genuinely new articles
```

### Extraction Pipeline (extract.ts)
```
For each new article:
1. Send title + snippet to OpenRouter
2. System prompt: investigative education journalist role
3. Request structured JSON output (ArticleExtraction schema)
4. Validate and store
```

### Error Handling
- All lib functions throw on failure
- Orchestrator processes articles individually — one failure doesn't abort the run
- Rate limiting: 1-2s delay between Brave requests, respect Exa limits
- Trigger.dev retry: `{ maxAttempts: 3 }` for transient failures

### Database Access (db.ts)
- Use `postgres` (postgres.js) with tagged template literals
- Connection: `const sql = postgres(process.env.DATABASE_URL!)`
- Never string concatenation for queries

### Conventions
- No ORM — always postgres.js tagged templates
- No barrel exports — import specific modules
- Functions over classes in lib modules
- Types in `types.ts`, config in `src/config/`
- Categories and org types are compile-time constants, not DB-managed

## API References

### Exa AI Search

**POST** `https://api.exa.ai/search`

Headers: `x-api-key: <EXA_API_KEY>`, `Content-Type: application/json`

```json
{
    "query": "Volksschule Zürich",
    "type": "auto",
    "numResults": 10,
    "includeDomains": ["nzz.ch", "tagesanzeiger.ch", "srf.ch"],
    "startPublishedDate": "2025-06-01T00:00:00.000Z",
    "contents": { "highlights": true, "summary": true }
}
```

Key params: `type` ("auto"|"neural"|"keyword"), `numResults` (1-10), `includeDomains` (array), `startPublishedDate` (ISO8601), `contents.text`/`highlights`/`summary`.

Response: `{ requestId, results: [{ title, url, publishedDate, author, highlights?, summary?, score }] }`

### Brave Search

**GET** `https://api.search.brave.com/res/v1/web/search`

Headers: `X-Subscription-Token: <BRAVE_API_KEY>`, `Accept: application/json`

Params: `q` (required), `count` (1-20), `freshness` ("pd"|"pw"|"pm"), `country` ("CH"), `search_lang` ("de")

Response: `{ web: { results: [{ title, url, description, age, page_age, language }] } }`

Rate limit: 1 req/sec on free tier. Add 1-2s delay between requests.

### OpenRouter

**POST** `https://openrouter.ai/api/v1/chat/completions`

Headers: `Authorization: Bearer <OPENROUTER_API_KEY>`, `Content-Type: application/json`

```json
{
    "model": "<OPENROUTER_MODEL>",
    "messages": [
        { "role": "system", "content": "..." },
        { "role": "user", "content": "..." }
    ],
    "max_tokens": 2000,
    "temperature": 0.2,
    "response_format": { "type": "json_object" }
}
```

Response: Standard OpenAI chat completion format.

### Resend

**POST** `https://api.resend.com/emails`

Headers: `Authorization: Bearer <RESEND_API_KEY>`, `Content-Type: application/json`

```json
{
    "from": "Schulmonitor <onboarding@resend.dev>",
    "to": ["recipient@example.com"],
    "subject": "Schulmonitor ZH — 2025-07-01",
    "html": "<div>...</div>"
}
```

Response: `{ "id": "email-id" }`

## Development

### Backend (monitor task)
```bash
npm install
npx trigger.dev@3 dev      # local dev
npx trigger.dev@3 deploy   # deploy to self-hosted instance
```

### Frontend (admin + dashboard)
```bash
cd frontend
npm install
npm run dev                 # http://localhost:3001 (auth: admin / FRONTEND_PW)
```

## Dashboard Views (Frontend)

The frontend serves as both admin panel and analytical dashboard:

1. **Dashboard** — overview with: articles this week, trending categories, most-mentioned persons, active municipalities
2. **Articles** — searchable/filterable list of all articles with category/relevance badges
3. **Persons** — person profiles showing role history, municipality connections, all mentions with links
4. **Events** — timeline view of events, filterable by category and municipality
5. **Municipalities** — per-Gemeinde view showing all activity
6. **Runs** — monitor task execution log
