-- Community result submissions (2026-08-24). Regional leagues have no feed;
-- the person at the game is the best sensor we have. Same moderation shape
-- as tryouts: rows land as status='pending' and NOTHING is published — and
-- nothing ever touches a rating — until a human runs scripts/review_results.py,
-- which promotes approved rows into data/community_results.json.
--
-- home_id/away_id are data.js club ids resolved in the browser from the club
-- page the form sits on (the submitter's club) and the picker (the opponent);
-- the raw names ride along so a later id rename can't orphan the row.
CREATE TABLE IF NOT EXISTS results (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,
  date     TEXT NOT NULL,          -- match date YYYY-MM-DD
  home_id  TEXT NOT NULL,
  away_id  TEXT NOT NULL,
  home     TEXT NOT NULL,
  away     TEXT NOT NULL,
  hg       INTEGER NOT NULL,
  ag       INTEGER NOT NULL,
  comp     TEXT,                   -- league | cup | playoff | friendly
  src      TEXT,                   -- link to a scoreboard photo / league page / post
  note     TEXT,
  contact  TEXT,
  page     TEXT,
  ua       TEXT,
  status   TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  reviewed TEXT                    -- ISO timestamp of the review
);
CREATE INDEX IF NOT EXISTS idx_results_status_ts ON results(status, ts);
CREATE INDEX IF NOT EXISTS idx_results_club ON results(home_id, date);
