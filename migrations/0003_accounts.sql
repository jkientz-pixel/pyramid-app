-- My XI accounts (2026-08-21).
--
-- Why accounts exist at all, given the site shipped on "no accounts by design":
-- picks lived only in localStorage, which fails two ways that matter. Safari
-- deletes all script-writable storage after seven days of browser use with no
-- interaction with the origin (ITP, iOS 13.4 / Safari 13.1 onward), so an
-- iPhone visitor who does not return within a week loses their XI. And
-- localStorage is per-device, so a desktop XI never reaches the phone. The
-- share link solved neither without the visitor doing the work by hand.
--
-- What this deliberately is NOT:
--   · no passwords. There is no password column, no reset flow, no credential
--     to leak. Identity is a code sent to an email address.
--   · no profile. Nothing here is public and nothing renders a person. The
--     account stores an email and a pick list, and that is the whole record.
--   · not required. Logged-out My XI still works exactly as before, on
--     localStorage. The account is a durability upgrade, never a gate.
--
-- The session cookie is set server-side with Set-Cookie, which is the point:
-- a server-set cookie is not script-writable and so is not subject to the
-- seven-day cap that evicts localStorage. The session outlives the storage it
-- is compensating for.

CREATE TABLE IF NOT EXISTS users (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  email     TEXT NOT NULL,
  created   TEXT NOT NULL,
  last_seen TEXT,
  -- affirmative 13-or-older confirmation, taken at the point of collection
  -- and kept on the row for the same COPPA reason as follows.age13
  age13     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- One row per pending sign-in. The code is stored as a SHA-256 hash: a
-- readable six-digit code sitting in the database would let anyone with query
-- access sign in as anyone, which is a worse credential store than the
-- password table this design exists to avoid.
--
-- `tries` caps brute force on a six-digit space. `sent` throttles resends so
-- the endpoint cannot be used to mailbomb an address.
CREATE TABLE IF NOT EXISTS login_codes (
  email     TEXT PRIMARY KEY,
  hash      TEXT NOT NULL,
  expires   TEXT NOT NULL,
  tries     INTEGER NOT NULL DEFAULT 0,
  sent      TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 1
);

-- Sessions are opaque random tokens, stored hashed for the same reason as
-- codes: a leaked table must not be a set of working sessions.
CREATE TABLE IF NOT EXISTS sessions (
  hash     TEXT PRIMARY KEY,
  user_id  INTEGER NOT NULL,
  created  TEXT NOT NULL,
  expires  TEXT NOT NULL,
  ua       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);

-- The XI itself: one row per user, holding the same opaque pick payload the
-- share link already encodes (encodePicks in js/myxi.js). Reusing that format
-- rather than inventing a schema means the server never needs to know what a
-- club or a player id means -- it stores and returns a string. `rev` lets a
-- client detect that another device wrote after it last read.
CREATE TABLE IF NOT EXISTS user_picks (
  user_id INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  home    INTEGER NOT NULL DEFAULT 0,
  rev     INTEGER NOT NULL DEFAULT 1,
  updated TEXT NOT NULL
);
