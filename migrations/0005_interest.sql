-- Interest capture (2026-08-22): the replacement for the mailto: links that
-- used to sit on every "register interest" CTA.
--
-- Why a table and not a mailto. A mailto gives us exactly one bit — an email
-- arrived, or it didn't — and no way to tell "nobody wants this" apart from
-- "nobody found it". Every paid tier came down off the pricing page precisely
-- because there was no demand signal to justify one; this is the instrument
-- that produces that signal. Rows are the evidence for putting a price back.
--
-- Not folded into `signups`: that table's UNIQUE(email, kind) is right for
-- one-shot lists ("launch updates"). Here one person can legitimately submit
-- several times — claim their player page, then add their club, then ask about
-- recruiting tools — and each is a distinct request we need to action
-- separately. Deduping those would destroy the thing we're measuring.
--
-- age13 mirrors follows: COPPA attaches at collection, so the affirmative
-- confirmation is enforced at the endpoint and kept on the row rather than
-- merely asserted in the surrounding copy.
--
-- `handled` is the moderation flag. Same flow as tryouts and corrections:
-- read with wrangler, action by hand, mark done.
CREATE TABLE IF NOT EXISTS interest (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  kind    TEXT NOT NULL,          -- player-claim | club-add | free-agent | club-tools
  email   TEXT NOT NULL,
  name    TEXT,
  subject TEXT,                   -- the club or player page this is about
  page    TEXT,                   -- hash route it was submitted from
  detail  TEXT,                   -- what they told us
  age13   INTEGER NOT NULL DEFAULT 0,
  src     TEXT,                   -- attribution channel, when we have one
  ua      TEXT,
  handled INTEGER NOT NULL DEFAULT 0
);
-- the two reads that matter: "what came in for X" and "what's still open"
CREATE INDEX IF NOT EXISTS idx_interest_kind_ts ON interest(kind, ts);
CREATE INDEX IF NOT EXISTS idx_interest_open ON interest(handled, ts);
