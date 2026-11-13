const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

/* Server-side checks for the two App Review additions. These import the real
   Pages Function modules and run them against a fake D1 that records every
   statement, so what is asserted is the SQL that would hit production --
   the browser tests in account.spec.js mock the network and cannot see it. */

const load = rel => import(pathToFileURL(path.join(__dirname, '..', rel)).href);

function fakeDb({ session, failBatch = false, codeRow = null } = {}) {
  const log = { batches: [], runs: [] };
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    first: async () => {
      if (/FROM sessions s JOIN users/.test(sql)) return session || null;
      if (/FROM login_codes/.test(sql)) return codeRow;
      return null;
    },
    run: async () => { log.runs.push({ sql, args }); return {}; },
  });
  return {
    log,
    prepare: sql => stmt(sql),
    batch: async list => {
      if (failBatch) throw new Error('D1 down');
      log.batches.push(list.map(s => ({ sql: s.sql, args: s.args })));
      return [];
    },
  };
}

const TOKEN = 'a'.repeat(64);
const req = (method, body, { cookie = true, origin = 'https://www.rankedxi.com' } = {}) =>
  new Request('https://www.rankedxi.com/api/auth/account', {
    method,
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie: `rxi_s=${TOKEN}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });

const SESSION = { userId: 7, email: 'fan@example.com', expires: new Date(Date.now() + 864e5).toISOString() };

test('account delete erases every table that names the person, in one batch', async () => {
  const { onRequestDelete } = await load('functions/api/auth/account.js');
  const db = fakeDb({ session: SESSION });
  const r = await onRequestDelete({ request: req('DELETE', { confirm: 'delete' }), env: { DB: db } });
  expect(r.status).toBe(200);
  expect(r.headers.get('set-cookie')).toMatch(/rxi_s=;.*Max-Age=0/);
  expect(db.log.batches).toHaveLength(1);
  const tables = db.log.batches[0].map(s => s.sql.match(/FROM (\w+)/)[1]).sort();
  expect(tables).toEqual(['club_claims', 'club_submissions', 'follows', 'interest',
    'login_codes', 'sessions', 'user_picks', 'users'].sort());
  for (const s of db.log.batches[0]) {
    expect(s.args).toEqual([/email/.test(s.sql) ? 'fan@example.com' : 7]);
  }
});

test('account delete refuses without the confirm word, a session, or our origin', async () => {
  const { onRequestDelete } = await load('functions/api/auth/account.js');
  const db = fakeDb({ session: SESSION });
  expect((await onRequestDelete({ request: req('DELETE', {}), env: { DB: db } })).status).toBe(400);
  expect((await onRequestDelete({ request: req('DELETE', { confirm: 'delete' }, { cookie: false }), env: { DB: db } })).status).toBe(401);
  expect((await onRequestDelete({ request: req('DELETE', { confirm: 'delete' }, { origin: 'https://evil.example' }), env: { DB: db } })).status).toBe(403);
  expect(db.log.batches).toHaveLength(0);
});

test('a failed delete batch reports failure and keeps the cookie', async () => {
  const { onRequestDelete } = await load('functions/api/auth/account.js');
  const db = fakeDb({ session: SESSION, failBatch: true });
  const r = await onRequestDelete({ request: req('DELETE', { confirm: 'delete' }), env: { DB: db } });
  expect(r.status).toBe(500);
  expect(r.headers.get('set-cookie')).toBeNull();
});

test('review code: only the configured address, only with a well-formed hash', async () => {
  const { reviewCodeHash, sha256 } = await load('lib/auth.js');
  const hash = await sha256('424242');
  const env = { REVIEW_EMAIL: ' Review@RankedXI.com ', REVIEW_CODE_SHA256: hash.toUpperCase() };
  expect(reviewCodeHash(env, 'review@rankedxi.com')).toBe(hash);
  expect(reviewCodeHash(env, 'someone@else.com')).toBeNull();
  expect(reviewCodeHash({ REVIEW_EMAIL: 'review@rankedxi.com', REVIEW_CODE_SHA256: '123' }, 'review@rankedxi.com')).toBeNull();
  expect(reviewCodeHash({}, 'review@rankedxi.com')).toBeNull();
});

test('review address gets the fixed code hash stored and no mail is sent', async () => {
  const { onRequestPost } = await load('functions/api/auth/request.js');
  const { sha256 } = await load('lib/auth.js');
  const hash = await sha256('424242');
  const db = fakeDb();
  let mailed = 0;
  const realFetch = global.fetch;
  global.fetch = async () => { mailed++; return new Response('{}'); };
  try {
    const r = await onRequestPost({
      request: new Request('https://www.rankedxi.com/api/auth/request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'review@rankedxi.com', age13: true }),
      }),
      env: { DB: db, RESEND_API_KEY: 'k', REVIEW_EMAIL: 'review@rankedxi.com', REVIEW_CODE_SHA256: hash },
    });
    expect(r.status).toBe(200);
  } finally { global.fetch = realFetch; }
  expect(mailed).toBe(0);
  const insert = db.log.runs.find(x => /INSERT INTO login_codes/.test(x.sql));
  expect(insert.args[0]).toBe('review@rankedxi.com');
  expect(insert.args[1]).toBe(hash);
});
