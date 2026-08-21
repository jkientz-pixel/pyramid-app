// @ts-check
/* Club-follow email capture. The load-bearing promise on the privacy page is
   that following a club is local-only, so the first test here guards that the
   capture is strictly opt-in and the rest guard the 13+ gate. */
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/** Follow a club and return the posted /api/follow bodies. */
async function followClub(page, { stubOk = true } = {}) {
  const posts = [];
  await page.route('**/api/follow', async route => {
    posts.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(stubOk ? { ok: true } : { ok: false, error: 'nope' }) });
  });
  await gotoRoute(page, '#/club/vermont-green-fc');
  await page.locator('.favbtn').first().click();
  return posts;
}

test('following a club sends nothing until an email is submitted', async ({ page }) => {
  const errors = trackErrors(page);
  const posts = await followClub(page);
  // the prompt appears, but the network stays silent
  await expect(page.locator('.followmail')).toBeVisible();
  await page.waitForTimeout(300);
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
});

test('the follow itself still works and persists locally', async ({ page }) => {
  await followClub(page);
  await expect(page.locator('.favbtn').first()).toHaveClass(/on/);
  const favs = await page.evaluate(() => JSON.parse(localStorage.getItem('pyr-favs')).clubs);
  expect(favs).toContain('vermont-green-fc');
});

test('submitting without the 13+ box is refused client-side', async ({ page }) => {
  const posts = await followClub(page);
  await page.locator('.followmail input[name=email]').fill('someone@example.com');
  await page.locator('.followmail button[type=submit]').click();
  await expect(page.locator('.fm-msg')).toContainText('13 or older');
  expect(posts).toEqual([]);
});

test('a bad email is refused client-side', async ({ page }) => {
  const posts = await followClub(page);
  await page.locator('.followmail input[name=email]').fill('not-an-email');
  await page.locator('.followmail input[name=age13]').check();
  await page.locator('.followmail button[type=submit]').click();
  await expect(page.locator('.fm-msg')).toContainText('real email address');
  expect(posts).toEqual([]);
});

test('a valid submit posts the club, the email and the age confirmation', async ({ page }) => {
  const posts = await followClub(page);
  await page.locator('.followmail input[name=email]').fill('Someone@Example.com');
  await page.locator('.followmail input[name=age13]').check();
  await page.locator('.followmail button[type=submit]').click();
  await expect(page.locator('.followmail')).toContainText("You're on the list");
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ club: 'vermont-green-fc', age13: true, source: 'follow-btn' });
  expect(posts[0].email).toBe('Someone@Example.com');
});

test('once subscribed the prompt never returns', async ({ page }) => {
  await followClub(page);
  await page.locator('.followmail input[name=email]').fill('someone@example.com');
  await page.locator('.followmail input[name=age13]').check();
  await page.locator('.followmail button[type=submit]').click();
  await expect(page.locator('.followmail')).toContainText("You're on the list");
  await gotoRoute(page, '#/club/detroit-city-fc');
  await page.locator('.favbtn').first().click();
  await expect(page.locator('.followmail')).toHaveCount(0);
});

test('dismissing is remembered across clubs', async ({ page }) => {
  await followClub(page);
  await page.locator('.followmail .fm-no').click();
  await expect(page.locator('.followmail')).toHaveCount(0);
  await gotoRoute(page, '#/club/detroit-city-fc');
  await page.locator('.favbtn').first().click();
  await expect(page.locator('.followmail')).toHaveCount(0);
});

test('a server error is surfaced, not swallowed', async ({ page }) => {
  await followClub(page, { stubOk: false });
  await page.locator('.followmail input[name=email]').fill('someone@example.com');
  await page.locator('.followmail input[name=age13]').check();
  await page.locator('.followmail button[type=submit]').click();
  await expect(page.locator('.fm-msg')).toContainText('nope');
  // a failed save must not mark the visitor as done
  expect(await page.evaluate(() => localStorage.getItem('rxi-followmail'))).toBeNull();
});

/* Atlanta United rather than a USL2 side: this needs a club with a real squad,
   and skipping quietly when there are no players would make the test look
   green while asserting nothing. */
test('player follows do not trigger the club email prompt', async ({ page }) => {
  await gotoRoute(page, '#/club/atlanta-united');
  const playerLink = page.locator('a[href^="#/player/"]').first();
  await expect(playerLink).toBeVisible();
  await playerLink.click();
  const fav = page.locator('.favbtn[data-ft=players]').first();
  await expect(fav).toBeVisible();
  await fav.click();
  await expect(fav).toHaveClass(/on/);
  await expect(page.locator('.followmail')).toHaveCount(0);
});

/* ---- the endpoint itself -------------------------------------------------
   The browser tests above stub /api/follow, so nothing there exercises the
   server-side checks. The 13+ gate in particular is the actual COPPA control:
   the checkbox is a courtesy, this is the enforcement. Driven directly with
   Node's own Request/Response rather than a worker runtime. */
async function callFollow(body, db) {
  const { onRequestPost } = await import('../functions/api/follow.js');
  const calls = [];
  const env = { DB: { prepare: sql => ({ bind: (...args) => ({ run: async () => {
    calls.push({ sql, args }); if (db?.throw) throw new Error('boom'); return {};
  } }) }) } };
  const request = new Request('https://x/api/follow', {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'ua' },
    body: JSON.stringify(body),
  });
  const res = await onRequestPost({ request, env });
  return { status: res.status, body: await res.json(), calls };
}

test('endpoint rejects a missing age confirmation and writes nothing', async () => {
  const r = await callFollow({ email: 'a@b.co', club: 'vermont-green-fc' });
  expect(r.status).toBe(400);
  expect(r.body.error).toMatch(/13 or older/);
  expect(r.calls).toEqual([]);
});

test('endpoint rejects age13 sent as a truthy non-true value', async () => {
  // a bot posting age13:"1" or age13:1 must not clear the gate
  for (const age13 of ['1', 1, 'true', {}]) {
    const r = await callFollow({ email: 'a@b.co', club: 'vermont-green-fc', age13 });
    expect(r.status).toBe(400);
    expect(r.calls).toEqual([]);
  }
});

test('endpoint rejects a bad email and a bad club slug', async () => {
  expect((await callFollow({ email: 'nope', club: 'vermont-green-fc', age13: true })).status).toBe(400);
  expect((await callFollow({ email: 'a@b.co', club: '../etc/passwd', age13: true })).status).toBe(400);
  expect((await callFollow({ email: 'a@b.co', club: '', age13: true })).status).toBe(400);
});

test('endpoint silently absorbs the honeypot without writing', async () => {
  const r = await callFollow({ email: 'a@b.co', club: 'x', age13: true, website: 'spam' });
  expect(r.status).toBe(200);
  expect(r.body.ok).toBe(true);
  expect(r.calls).toEqual([]);
});

test('a valid post lowercases the email and stores the club', async () => {
  const r = await callFollow({ email: '  Someone@Example.COM ', club: 'vermont-green-fc', age13: true });
  expect(r.status).toBe(200);
  expect(r.calls).toHaveLength(1);
  expect(r.calls[0].args[1]).toBe('someone@example.com');
  expect(r.calls[0].args[2]).toBe('vermont-green-fc');
  expect(r.calls[0].sql).toMatch(/ON CONFLICT\(email, club\) DO UPDATE/);
  // re-following after an unsubscribe must clear the unsub flag
  expect(r.calls[0].sql).toMatch(/unsub=0/);
});

test('a database failure returns 500 rather than a false success', async () => {
  const r = await callFollow({ email: 'a@b.co', club: 'x', age13: true }, { throw: true });
  expect(r.status).toBe(500);
  expect(r.body.ok).toBe(false);
});
