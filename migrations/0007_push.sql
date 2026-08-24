-- Web-push subscriptions for match alerts (2026-08-23).
--
-- Why this exists: an installed app that never gives anyone a reason to
-- reopen it is how 49 Play Store downloads became one active user. Match
-- alerts for followed clubs are the reopen reason, and web push is the one
-- channel that reaches an installed PWA on iOS (16.4+), the Android TWA, and
-- desktop alike — no APNs, no Firebase, no third party in the path.
--
-- What a row holds: the push endpoint URL plus the two client-minted crypto
-- keys the Web Push standard requires (p256dh, auth), and the list of club
-- slugs the subscriber follows. The endpoint is minted by the browser's push
-- service and identifies a browser install, not a person. No email, no name,
-- no IP — consistent with everything else in this database.
--
-- `clubs` is JSON text rather than a join table on purpose: the sender reads
-- whole rows and matches in Python, nothing ever queries by club, and one
-- table keeps the unsubscribe path (DELETE by endpoint) trivial.
--
-- Rows die two ways: the visitor turns alerts off (DELETE from the client),
-- or the push service returns 404/410 at send time and scripts/push_alerts.py
-- deletes the corpse.

CREATE TABLE IF NOT EXISTS push_subs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,             -- subscribed / last synced (ISO)
  endpoint TEXT NOT NULL UNIQUE,      -- push-service URL, one per browser install
  p256dh   TEXT NOT NULL,             -- client public key (base64url)
  auth     TEXT NOT NULL,             -- client auth secret (base64url)
  clubs    TEXT NOT NULL DEFAULT '[]',-- JSON array of followed club slugs
  plat     TEXT                       -- coarse platform bucket, same as hits.plat
);
