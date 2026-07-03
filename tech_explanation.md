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

## 5. Article Deduplication

Duplicate articles are prevented at three levels, all keyed on **exact URL match**.

### Within a single run (in memory)

`ergebnisseZusammenfuehren()` in `src/lib/suche.ts` merges Exa/Brave results and results across the 15 queries using a `Set` of URLs — the same URL appears only once per run.

### Before processing (DB pre-check)

After search, known URLs are filtered out before any OpenRouter calls:

```typescript
const bekannteUrls = await vorhandeneUrls(alleErgebnisse.map((e) => e.url));
return alleErgebnisse.filter((e) => !bekannteUrls.has(e.url));
```

`vorhandeneUrls()` loads existing URLs from `newsletterj_artikel`. Anything already in the DB is skipped entirely — no re-extraction, no re-save, no newsletter entry.

### On insert (database constraint)

The schema defines `url VARCHAR(2000) NOT NULL UNIQUE`. `artikelSpeichern` uses `ON CONFLICT (url) DO NOTHING`; if a URL slips through the pre-check, Postgres rejects the duplicate. `monitor-task.ts` skips further processing when no row id is returned.

### What happens on a later run (e.g. 2 days later)

Search still runs (Exa looks back 7 days), so many URLs from a previous run may appear again. For URLs already in the DB:

- No duplicate rows in the database
- No second OpenRouter call
- No re-entry in the newsletter
- Existing article records are **not updated** (no refreshed summary or categories)

If every URL was already known, the newsletter is not sent (unless there are newly failed URLs in the *"Nicht automatisch verarbeitet"* section).

### Billing on later runs

Deduplication happens **after** Exa search completes. Known URLs are filtered out only before OpenRouter — not before Exa.

| Service | Known URL returned again? | Charged again on a later run? |
|--------|---------------------------|-------------------------------|
| **Exa Search** | — | **Yes** — all 15 queries run every time |
| **Exa Summaries** | Yes | **Yes** — summaries are fetched during search, before the DB filter |
| **OpenRouter** | Yes | **No** — skipped after `vorhandeneUrls()` |

So sequential runs (today, then 2 days later) do **not** double OpenRouter cost for the same URL. Exa search and summary charges can still apply for results Exa returns again.

### What is not covered

- **Same article, different URLs** — e.g. with/without query params (`?utm_source=...`), or `http` vs `https`. Treated as separate articles.
- **URL normalization** — no trailing-slash or redirect canonicalization.
- **Parallel runs (edge case only)** — if two monitor runs execute **at the same time**, both may call OpenRouter for the same *new* URL before either saves it. Only one row is saved (`UNIQUE`), but OpenRouter cost is paid twice. This does not happen with one run at a time.

---

## 6. Exa Summary vs OpenRouter Summary

| | Exa Summary | OpenRouter `zusammenfassung` |
|---|---|---|
| **Purpose** | Generic page digest | Investigative education-policy analysis |
| **Scope** | Any page content | Kanton Zürich, Volksschulen only |
| **Stored in** | `ausschnitt`, `roh_json` | `zusammenfassung` |
| **Used in newsletter** | No | Yes (truncated to 300 chars) |
| **Billing** | Exa Summaries | OpenRouter tokens |

---

## 7. Error Handling

- Each article is processed inside its own `try/catch` — one failure does not abort the run.
- Failed URLs are logged, collected, and included in the newsletter as links.
- Task `maxDuration`: 7200 s (2 hours).

---

## 8. Deployment (Trigger.dev)

Deploy to the self-hosted Trigger.dev instance (`https://triggerdev.wineagent.ch`, profile `wineagent`):

```bash
npm run deploy
```

The CLI version is pinned in `package.json` to match `@trigger.dev/sdk`, with profile and API URL baked into the scripts — same pinned version every time, no prompt, no flags to remember. When upgrading in the future, bump both the SDK in `dependencies` and the version in the `dev`/`deploy` scripts together.

Note: the deployed worker reads env vars (e.g. `OPENROUTER_MODEL`, `NEWSLETTER_TO_EMAIL`) from the Trigger.dev project settings, not from the local `.env`. After changing them there, redeploy.

---

## 9. Frontend (Medienspiegel Dashboard)

**Stack:** Hono + HTMX, server-rendered HTML fragments, no build step. Basic auth (`admin` / `FRONTEND_PW`). Runs on port 3001.

```bash
cd frontend
npm run dev
```

**Views** (all under `frontend/src/routes/`):

| View | Features |
|------|----------|
| **Übersicht** (`dashboard.ts`) | Stats cards, top stories (high relevance, 14 days), category trend bars, top persons/municipalities/sources, latest events — everything clickable, jumping to the pre-filtered article list |
| **Medienspiegel** (`artikel.ts`) | Article cards with full-text search (title, summary, snippet, school), filters for category/relevance/municipality/source/time range, pagination, article detail page with persons, organisations, and events |
| **Personen** (`personen.ts`) | Search, municipality filter, sorting, pagination; detail page with role history, network (people from shared articles), and all mentions |
| **Ereignisse** (`ereignisse.ts`) | Search plus category/relevance/municipality/time filters, pagination |
| **Gemeinden** (`gemeinden.ts`) | Search; detail page per municipality with topics, persons, events, and recent articles |
| **Läufe** (`laeufe.ts`) | Monitor run log with status and error messages |

**Implementation notes:**

- Filters are composed as postgres.js SQL fragments (no string concatenation) and freely combinable.
- Dropdowns (municipality, source) are populated from actual DB contents.
- Shared UI helpers (category list, badges, date formatting, pagination) live in `frontend/src/ui.ts`.
- The frontend is read-only — it displays what the monitor task has collected and never writes to the database.
