-- Club claims + club profile submissions (2026-08-24).
--
-- Why this exists: every "Run this club? Add to this page" CTA has been a
-- free-text interest row that a human has to chase by email before anything
-- can be trusted. This is the structured version: a club representative
-- proves who they are, and only then sees the intake form that asks for the
-- data points we actually want — starting with a clean, large crest.
--
-- Two tables, two questions.
--
-- club_claims answers "who may speak for club X". One row per (club, account).
-- The account is the existing passwordless My XI sign-in (migrations/0003):
-- the person has already proven they can read mail at `email`. `domain_match`
-- records whether that address sits on the club's own website domain — the
-- cheap, strong signal — and when it does the claim is `verified` on the spot.
-- When it doesn't (gmail clubs, clubs with no website in our data) the row is
-- `pending` and the intake form stays hidden until someone flips it by hand
-- with scripts/review_claims.py. Never auto-verify a mismatch: a Ranked XI
-- page is the kind of thing a rival or a prankster would happily "claim".
--
-- club_submissions answers "what did a verified rep tell us". One row per
-- form submission (a club can resubmit; the newest `applied=0` row is the
-- one to act on). `payload` is JSON text rather than fifty nullable columns:
-- the field list will grow (Jeremy: "unlock all possible data points"), and
-- nothing queries by field — the review script reads whole rows.
--
-- The crest lives in the row as base64 TEXT, not BLOB and not R2. R2 is not
-- enabled on this account (wrangler: code 10042), and base64 text is what
-- `wrangler d1 execute --json` hands back losslessly, so retrieval is one
-- command. D1's per-row ceiling is 1,000,000 bytes; the endpoint caps the
-- raw file at 700 KB so the base64 (+33%) plus the payload fits with room.
-- A crest that big is a 2048px PNG or any sane SVG — plenty for "clean,
-- large logos". Moving to R2 later is one edit in functions/api/club-profile.js.
--
-- Nothing here publishes anything. Live data (CLUBS in js/data.js) changes
-- only through the review script, which honours the append-only invariant.

CREATE TABLE IF NOT EXISTS club_claims (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,                  -- claimed (ISO)
  club_id      TEXT NOT NULL,                  -- CLUBS[].id slug
  club_name    TEXT NOT NULL,                  -- snapshot, for reading the queue without the app
  user_id      INTEGER NOT NULL,               -- users.id (migrations/0003)
  email        TEXT NOT NULL,                  -- snapshot of users.email at claim time
  club_domain  TEXT,                           -- registrable host of CLUBS[].url, if any
  domain_match INTEGER NOT NULL DEFAULT 0,     -- 1 = email domain is the club's domain
  status       TEXT NOT NULL DEFAULT 'pending',-- pending | verified | rejected
  rep_name     TEXT,                           -- who they say they are
  rep_role     TEXT,                           -- owner / GM / coach / media / other
  note         TEXT,                           -- anything they added for the reviewer
  ua           TEXT,
  reviewed_ts  TEXT,                           -- when a human changed status
  UNIQUE(club_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_club_claims_open ON club_claims(status, ts);

CREATE TABLE IF NOT EXISTS club_submissions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  claim_id   INTEGER NOT NULL,                 -- club_claims.id, must be verified at submit time
  club_id    TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  payload    TEXT NOT NULL,                    -- JSON: every field the form collected
  logo_mime  TEXT,                             -- image/png | image/svg+xml | image/jpeg
  logo_name  TEXT,                             -- original filename, for the export
  logo_bytes INTEGER,                          -- raw size before base64
  logo_w     INTEGER,                          -- PNG/JPEG pixel width when known
  logo_h     INTEGER,
  logo_b64   TEXT,                             -- the file itself
  ua         TEXT,
  applied    INTEGER NOT NULL DEFAULT 0        -- 1 once review_claims.py has folded it into data
);
CREATE INDEX IF NOT EXISTS idx_club_submissions_open ON club_submissions(applied, ts);
CREATE INDEX IF NOT EXISTS idx_club_submissions_club ON club_submissions(club_id, ts);
