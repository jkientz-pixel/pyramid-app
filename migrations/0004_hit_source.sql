-- Campaign source on pageviews (2026-08-22).
--
-- Why this exists: on 2026-08-22 the site had 31 visitors and 29 of them were
-- recorded as "(direct)". That was not a finding about how people arrive, it
-- was a hole in the instrument. Social platforms strip or rewrite referrers,
-- and a tap from inside the Facebook, Reddit or X app looks identical to
-- someone typing the address. Every channel therefore read as direct, and the
-- iOS build decision due 2026-09-12 had no evidence under it.
--
-- What this deliberately is NOT: a general query-string log. functions/api/hit.js
-- still truncates paths at the '?' and drops every other parameter. Only a
-- value matching the fixed SOURCES allowlist in that file is ever written here
-- -- 'facebook', 'reddit', 'x' and so on. A hand-crafted or third-party
-- parameter is discarded rather than stored as "other", so this cannot become
-- a back door for arbitrary tracking data.
--
-- It identifies a channel, never a person. The column holds one short word
-- from our own list and nothing derived from the visitor.
--
-- Only the landing pageview of a visit carries a value; the rest of the visit
-- is tied to it by `sid`, which is how scripts/traffic.py attributes a whole
-- session to the channel that produced it.
--
-- NOTE: SQLite has no ADD COLUMN IF NOT EXISTS. Re-running this fails with
-- "duplicate column name: src" and changes nothing, which is the safe outcome.

ALTER TABLE hits ADD COLUMN src TEXT;

CREATE INDEX IF NOT EXISTS idx_hits_src ON hits(src);
