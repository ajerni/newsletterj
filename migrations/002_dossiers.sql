-- On-demand research dossiers (parameterized by time window).

CREATE TABLE IF NOT EXISTS newsletterj_dossiers (
    id SERIAL PRIMARY KEY,
    status VARCHAR(50) NOT NULL DEFAULT 'gestartet',
    tage INTEGER NOT NULL DEFAULT 0,
    zeitraum_label VARCHAR(100) NOT NULL,
    inhalt_html TEXT,
    statistik_json JSONB,
    gestartet_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    abgeschlossen_am TIMESTAMPTZ,
    fehlermeldung TEXT
);

CREATE INDEX IF NOT EXISTS idx_dossiers_gestartet ON newsletterj_dossiers(gestartet_am DESC);
CREATE INDEX IF NOT EXISTS idx_dossiers_status ON newsletterj_dossiers(status);
