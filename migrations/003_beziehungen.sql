-- Knowledge graph (graph-lite): co-mention edges between persons in the same article.

CREATE TABLE IF NOT EXISTS newsletterj_beziehungen (
    id SERIAL PRIMARY KEY,
    von_typ VARCHAR(20) NOT NULL CHECK (von_typ IN ('person', 'organisation')),
    von_id INTEGER NOT NULL,
    zu_typ VARCHAR(20) NOT NULL CHECK (zu_typ IN ('person', 'organisation')),
    zu_id INTEGER NOT NULL,
    relation VARCHAR(50) NOT NULL DEFAULT 'erwaehnt_zusammen',
    quell_artikel_id INTEGER NOT NULL REFERENCES newsletterj_artikel(id) ON DELETE CASCADE,
    erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (von_typ, von_id, zu_typ, zu_id, relation, quell_artikel_id)
);

CREATE INDEX IF NOT EXISTS idx_beziehungen_quell_artikel ON newsletterj_beziehungen(quell_artikel_id);
CREATE INDEX IF NOT EXISTS idx_beziehungen_von ON newsletterj_beziehungen(von_typ, von_id);
CREATE INDEX IF NOT EXISTS idx_beziehungen_zu ON newsletterj_beziehungen(zu_typ, zu_id);
CREATE INDEX IF NOT EXISTS idx_beziehungen_relation ON newsletterj_beziehungen(relation);

-- Bootstrap co-mention edges from existing person mentions (canonical: lower person id = von)
INSERT INTO newsletterj_beziehungen (von_typ, von_id, zu_typ, zu_id, relation, quell_artikel_id)
SELECT
    'person',
    LEAST(e1.person_id, e2.person_id),
    'person',
    GREATEST(e1.person_id, e2.person_id),
    'erwaehnt_zusammen',
    e1.artikel_id
FROM newsletterj_erwaehnungen e1
JOIN newsletterj_erwaehnungen e2
    ON e2.artikel_id = e1.artikel_id
    AND e2.person_id > e1.person_id
ON CONFLICT DO NOTHING;
