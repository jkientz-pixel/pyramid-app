-- Club follow email capture (2026-08-20).
--
-- Not folded into `signups`: that table carries UNIQUE(email, kind), which is
-- exactly right for one-shot lists ("launch updates") and exactly wrong here,
-- where one person follows many clubs. A row is (email, club).
--
-- age13 records the affirmative 13-or-older confirmation taken at the form.
-- COPPA attaches to collecting personal information from children under 13, so
-- the gate has to be enforced at the point of collection and kept on the row,
-- not merely stated in the surrounding copy.
CREATE TABLE IF NOT EXISTS follows (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  email   TEXT NOT NULL,
  club    TEXT NOT NULL,
  age13   INTEGER NOT NULL DEFAULT 0,
  unsub   INTEGER NOT NULL DEFAULT 0,
  source  TEXT,
  ua      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_follows_email_club ON follows(email, club);
-- every send filters on this
CREATE INDEX IF NOT EXISTS idx_follows_club ON follows(club, unsub);
