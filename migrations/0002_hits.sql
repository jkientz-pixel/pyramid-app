-- First-party pageview analytics (2026-08-20).
--
-- Self-hosted rather than a third-party tag on purpose: the site already
-- promises it carries no ad pixels, and a tracker loaded from someone else's
-- domain would break that promise no matter how privacy-friendly its vendor
-- claims to be. Everything here stays in our own D1.
--
-- What is deliberately NOT stored: IP address, full user-agent, full referrer
-- URL, and any identifier that outlives the browser it was minted in. `vid` is
-- a random string the browser generates for itself and can erase by clearing
-- site data; it is not derived from anything about the person.
--
-- `d` duplicates the date part of `ts` so the common "traffic by day" query is
-- an index scan instead of a string function over every row.
CREATE TABLE IF NOT EXISTS hits (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    TEXT NOT NULL,
  d     TEXT NOT NULL,
  path  TEXT NOT NULL,
  ref   TEXT,
  vid   TEXT NOT NULL,
  sid   TEXT NOT NULL,
  plat  TEXT,
  ctry  TEXT,
  fresh INTEGER NOT NULL DEFAULT 0
);
-- traffic-by-day and top-pages-in-range both lead with d
CREATE INDEX IF NOT EXISTS idx_hits_d_path ON hits(d, path);
-- return-visitor questions group by vid
CREATE INDEX IF NOT EXISTS idx_hits_vid ON hits(vid, d);
-- "where did they come from" and "what platform" roll-ups
CREATE INDEX IF NOT EXISTS idx_hits_d_ref ON hits(d, ref);
