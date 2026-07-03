# newsletterj — Technical Data Pipeline

How articles are discovered, summarized, analyzed, and stored.

## Overview

```
Exa Search → Exa Summaries → OpenRouter → PostgreSQL → Newsletter (Resend)
     ↑              ↑              ↑
  find URLs    raw content    structured analysis
```

Each monitor run (`schulmonitor-ausfuehren`) executes 15 search queries (`src/config/suchanfragen.ts`) against predefined Swiss media domains (`src/config/quellen.ts`). New URLs are deduplicated against the database, then processed one by one. Per-article failures are logged and collected; the run continues and finishes.

---

## 1. Exa Search

**File:** `src/lib/exa.ts`, orchestrated by `src/lib/suche.ts`

- One API call per search query (15 per run).
- Returns up to 10 results per query: URL, title, published date.
- Filtered to configured media domains and articles from the last 7 days.
- Billed as **Search** in the Exa dashboard.

If Exa returns fewer than 3 results for a query, Brave Search supplements (`src/lib/brave.ts`).

---

## 2. Exa Summaries

**Request flag:** `contents: { highlights: true, summary: true }` in `exa.ts`

For every search result, Exa fetches the page and generates a short AI summary server-side. This is billed separately as **Summaries** (one charge per result, not per search).

The summary becomes the article snippet (`ausschnitt`):

```typescript
ausschnitt: r.summary || r.highlights?.join(" ") || ""
```

**Important:** The project never scrapes full article pages. The Exa summary (or highlight fallback) is the only raw text the pipeline ever sees. Downstream quality depends entirely on how good that summary is.

Typical billing ratio: ~15 searches × ~10 results ≈ ~150 summaries per run (varies with result count and number of runs).

---

## 3. OpenRouter (own LLM)

**Files:** `src/lib/extraktion.ts`, `src/lib/personen.ts`

OpenRouter receives **title + Exa `ausschnitt`** and produces domain-specific structured data. This is separate from Exa billing.

| Call | Purpose |
|------|---------|
| `artikelExtrahieren` | Main extraction: Zusammenfassung, Kategorie(n), Relevanz, Gemeinde, Schule, Personen, Organisationen, Ereignisse |
| `kiPersonAbgleich` | Match extracted persons against existing DB records (auto-merge identities) |
| `kiGemeindeAbgleich` | Resolve municipality name variants to canonical Gemeinde records |

OpenRouter output is normalized before DB insert (missing fields → `null`, invalid enums → defaults).

---

## 4. What Gets Saved to the Database

Table: `newsletterj_artikel` (`src/lib/db.ts` → `artikelSpeichern`)

| Column | Source | Content |
|--------|--------|---------|
| `ausschnitt` | Exa | Raw Exa summary (or highlights fallback), stored as-is |
| `zusammenfassung` | OpenRouter | Education-policy-focused summary (3–10 sentences) |
| `kategorie`, `kategorien`, `relevanz` | OpenRouter | Classification |
| `gemeinde_id`, `schule` | OpenRouter + resolver | Location |
| `auswirkungen`, `kontext_bezug` | OpenRouter | Analysis fields |
| `roh_json` | Exa | Full Exa API response (summary, highlights, dates, etc.) |
| `titel`, `url`, `veroeffentlicht_am` | Exa / Brave | Metadata |

Related records: persons, mentions, organisations, events — all derived from OpenRouter extraction.

**If OpenRouter fails:** nothing is saved for that URL. The link is collected and appended to the newsletter under *"Nicht automatisch verarbeitet"* as a plain hyperlink.

---

## 5. Exa Summary vs OpenRouter Summary

| | Exa Summary | OpenRouter `zusammenfassung` |
|---|---|---|
| **Purpose** | Generic page digest | Investigative education-policy analysis |
| **Scope** | Any page content | Kanton Zürich, Volksschulen only |
| **Stored in** | `ausschnitt`, `roh_json` | `zusammenfassung` |
| **Used in newsletter** | No | Yes (truncated to 300 chars) |
| **Billing** | Exa Summaries | OpenRouter tokens |

---

## 6. Error Handling

- Each article is processed inside its own `try/catch` — one failure does not abort the run.
- Failed URLs are logged, collected, and included in the newsletter as links.
- Task `maxDuration`: 7200 s (2 hours).
