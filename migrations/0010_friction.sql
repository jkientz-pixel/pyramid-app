-- First-party friction signals (2026-10-01).
--
-- Why this exists: `hits` says which pages people open, never where a page got
-- in their way. The question "where do users struggle?" had no data under it,
-- and the usual answer — a session-replay vendor's script tag — would break the
-- published promise of no third-party analytics. So the three signals that
-- carry most of a replay tool's value are recorded here instead, by
-- js/rxi-a.js and functions/api/friction.js:
--
--   rage  three or more clicks in quick succession on the same spot
--   dead  a click on a link or button after which nothing on the page changed
--   err   an uncaught error thrown by our own scripts
--
-- What is deliberately NOT stored: anything typed into a form, the text of the
-- page, screen recordings, mouse paths, IP, full user-agent. `tgt` is a short
-- selector built from our own markup (tag, id, class names), never from text
-- content. `detail` is only filled for errors: a clipped message plus the
-- script file and line, scrubbed of e-mail-shaped strings and query strings.
--
-- `vid`/`sid` are the same browser-minted random ids as `hits`, so a friction
-- event can be joined to the visit it happened in. Nothing new identifies a
-- person.

CREATE TABLE IF NOT EXISTS friction (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL,
  d      TEXT NOT NULL,
  path   TEXT NOT NULL,
  kind   TEXT NOT NULL,   -- 'rage' | 'dead' | 'err'
  tgt    TEXT,            -- e.g. "button#follow.btn" — our markup, not page text
  detail TEXT,            -- errors only: "TypeError: x is undefined @app.js:812"
  vid    TEXT NOT NULL,
  sid    TEXT NOT NULL,
  plat   TEXT
);
-- "where do users struggle, last N days" leads with d
CREATE INDEX IF NOT EXISTS idx_friction_d_kind_path ON friction(d, kind, path);
-- joining back to the visit in `hits`
CREATE INDEX IF NOT EXISTS idx_friction_sid ON friction(sid);
