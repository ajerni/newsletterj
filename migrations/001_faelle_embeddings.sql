-- Case threading + article embeddings for semantic search and context linking.
-- Run manually against your PostgreSQL database (requires pgvector).

CREATE EXTENSION IF NOT EXISTS vector;

-- Article embeddings (OpenAI text-embedding-3-small: 1536 dimensions)
ALTER TABLE newsletterj_artikel
    ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_artikel_embedding
    ON newsletterj_artikel
    USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;

-- Ongoing cases / story threads
CREATE TABLE IF NOT EXISTS newsletterj_faelle (
    id SERIAL PRIMARY KEY,
    titel VARCHAR(500) NOT NULL,
    beschreibung TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'aktiv',
    gemeinde_id INTEGER REFERENCES newsletterj_gemeinden(id),
    schule VARCHAR(300),
    hauptkategorie VARCHAR(100),
    relevanz VARCHAR(10) NOT NULL DEFAULT 'mittel',
    artikel_anzahl INTEGER NOT NULL DEFAULT 0,
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    letzter_artikel_am TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_faelle_status ON newsletterj_faelle(status);
CREATE INDEX IF NOT EXISTS idx_faelle_gemeinde ON newsletterj_faelle(gemeinde_id);
CREATE INDEX IF NOT EXISTS idx_faelle_aktualisiert ON newsletterj_faelle(aktualisiert_am DESC);

-- Articles linked to a case
CREATE TABLE IF NOT EXISTS newsletterj_fall_artikel (
    id SERIAL PRIMARY KEY,
    fall_id INTEGER NOT NULL REFERENCES newsletterj_faelle(id) ON DELETE CASCADE,
    artikel_id INTEGER NOT NULL REFERENCES newsletterj_artikel(id) ON DELETE CASCADE,
    aehnlichkeit REAL,
    verknuepfungs_grund TEXT,
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(fall_id, artikel_id)
);

CREATE INDEX IF NOT EXISTS idx_fall_artikel_fall ON newsletterj_fall_artikel(fall_id);
CREATE INDEX IF NOT EXISTS idx_fall_artikel_artikel ON newsletterj_fall_artikel(artikel_id);

-- Cross-article context links (kontext_bezug made explicit)
CREATE TABLE IF NOT EXISTS newsletterj_artikel_bezuege (
    id SERIAL PRIMARY KEY,
    artikel_id INTEGER NOT NULL REFERENCES newsletterj_artikel(id) ON DELETE CASCADE,
    bezug_artikel_id INTEGER NOT NULL REFERENCES newsletterj_artikel(id) ON DELETE CASCADE,
    aehnlichkeit REAL,
    bezug_typ VARCHAR(50) NOT NULL DEFAULT 'kontext',
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(artikel_id, bezug_artikel_id),
    CHECK (artikel_id != bezug_artikel_id)
);

CREATE INDEX IF NOT EXISTS idx_artikel_bezuege_artikel ON newsletterj_artikel_bezuege(artikel_id);
CREATE INDEX IF NOT EXISTS idx_artikel_bezuege_bezug ON newsletterj_artikel_bezuege(bezug_artikel_id);

-- Events linked to cases
CREATE TABLE IF NOT EXISTS newsletterj_fall_ereignisse (
    fall_id INTEGER NOT NULL REFERENCES newsletterj_faelle(id) ON DELETE CASCADE,
    ereignis_id INTEGER NOT NULL REFERENCES newsletterj_ereignisse(id) ON DELETE CASCADE,
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (fall_id, ereignis_id)
);

-- Find similar articles by cosine similarity
CREATE OR REPLACE FUNCTION newsletterj_aehnliche_artikel(
    p_embedding vector(1536),
    p_ausser_id integer,
    p_gemeinde_id integer DEFAULT NULL,
    p_limit integer DEFAULT 8,
    p_min_similarity real DEFAULT 0.65
)
RETURNS TABLE (
    id integer,
    titel varchar,
    gemeinde_id integer,
    kategorie varchar,
    similarity real
)
LANGUAGE sql STABLE AS $$
    SELECT
        a.id,
        a.titel,
        a.gemeinde_id,
        a.kategorie,
        (1 - (a.embedding <=> p_embedding))::real AS similarity
    FROM newsletterj_artikel a
    WHERE a.embedding IS NOT NULL
      AND a.id != p_ausser_id
      AND (p_gemeinde_id IS NULL OR a.gemeinde_id = p_gemeinde_id)
      AND (1 - (a.embedding <=> p_embedding)) >= p_min_similarity
    ORDER BY a.embedding <=> p_embedding
    LIMIT p_limit;
$$;

-- Semantic search across all embedded articles
CREATE OR REPLACE FUNCTION newsletterj_semantische_suche(
    p_embedding vector(1536),
    p_limit integer DEFAULT 20,
    p_min_similarity real DEFAULT 0.55
)
RETURNS TABLE (
    id integer,
    titel varchar,
    gemeinde_id integer,
    kategorie varchar,
    relevanz varchar,
    gesucht_am timestamptz,
    similarity real
)
LANGUAGE sql STABLE AS $$
    SELECT
        a.id,
        a.titel,
        a.gemeinde_id,
        a.kategorie,
        a.relevanz,
        a.gesucht_am,
        (1 - (a.embedding <=> p_embedding))::real AS similarity
    FROM newsletterj_artikel a
    WHERE a.embedding IS NOT NULL
      AND (1 - (a.embedding <=> p_embedding)) >= p_min_similarity
    ORDER BY a.embedding <=> p_embedding
    LIMIT p_limit;
$$;
