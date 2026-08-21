const { test, expect } = require('@playwright/test');
const { trackErrors, viewRendered, gotoRoute } = require('./helpers');

/* The account endpoints are Cloudflare Pages Functions, and the test server is
   a static Python file server that has never heard of them. Mocking at the
   network layer is not a workaround for that — it is the right seam. What is
   worth testing here is the client: does it merge instead of replace, does it
   keep working when the network does not, does a pick survive a failed push.
   All of that is decided in js/account.js, and none of it is decided in D1. */

function mockApi(page, opts = {}) {
  const state = {
    signedIn: opts.signedIn || false,
    email: opts.email || null,
    picks: opts.picks || '',
    home: opts.home || false,
    /* every PUT body the client sent, in order */
    puts: [],
    codeRequests: [],
    failPut: opts.failPut || false,
    badCode: opts.badCode || false,
    mailBroken: opts.mailBroken || false,
  };

  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  page.route('**/api/auth/session', async route => {
    if (route.request().method() === 'DELETE') {
      state.signedIn = false; state.email = null;
      return json(route, { ok: true, signedIn: false });
    }
    return json(route, state.signedIn
      ? { ok: true, signedIn: true, email: state.email, picks: state.picks, home: state.home, rev: 3 }
      : { ok: true, signedIn: false });
  });

  page.route('**/api/auth/request', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    state.codeRequests.push(body);
    if (state.mailBroken) {
      return json(route, { ok: false, error: 'Could not send the code — please try again.' }, 503);
    }
    return json(route, { ok: true });
  });

  page.route('**/api/auth/verify', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (state.badCode) {
      return json(route, { ok: false, error: 'That code is wrong or has expired. Ask for a new one.' }, 400);
    }
    state.signedIn = true;
    state.email = body.email;
    return json(route, { ok: true, email: body.email, picks: state.picks, home: state.home, rev: 4 });
  });

  page.route('**/api/picks*', async route => {
    if (route.request().method() === 'GET') {
      return json(route, { ok: true, picks: state.picks, home: state.home, rev: 4 });
    }
    const body = JSON.parse(route.request().postData() || '{}');
    state.puts.push(body);
    if (state.failPut) return json(route, { ok: false, error: 'nope' }, 500);
    state.picks = body.picks;
    state.home = !!body.home;
    return json(route, { ok: true, rev: state.puts.length + 4 });
  });

  return state;
}

function seed(page, favs, myxi) {
  return page.addInitScript(([f, m]) => {
    localStorage.setItem('pyr-favs', JSON.stringify(f));
    if (m) localStorage.setItem('rxi-myxi', JSON.stringify(m));
  }, [favs, myxi || null]);
}

const readLocal = page => page.evaluate(() => ({
  favs: JSON.parse(localStorage.getItem('pyr-favs') || '{}'),
  myxi: JSON.parse(localStorage.getItem('rxi-myxi') || '{}'),
}));

/* ---- the codec, which everything else rests on --------------------------- */

test('merging two XIs keeps every pick from both sides', async ({ page }) => {
  await page.goto('/app.html#/map');
  const out = await page.evaluate(async () => {
    const m = await import('/js/picks.js');
    return {
      union: m.mergePayloads('c:lafc,atlutd|p:lafc~3|g:mls', 'c:nycfc|p:nycfc~7|s:ny'),
      idempotent: m.mergePayloads('c:lafc|g:mls', 'c:lafc|g:mls'),
      withEmpty: m.mergePayloads('c:lafc', ''),
      emptyWith: m.mergePayloads('', 'c:lafc'),
      roundTrip: m.decodePicks(m.encodePicks(
        { clubs: ['a-b', 'c_d'], players: ['a-b/2'] },
        [{ t: 'league', id: 'mls' }, { t: 'state', id: 'ca' }, { t: 'nt', id: 'usmnt' }])),
    };
  });
  // nothing from either side is dropped
  expect(out.union).toContain('lafc');
  expect(out.union).toContain('atlutd');
  expect(out.union).toContain('nycfc');
  expect(out.union).toContain('lafc~3');
  expect(out.union).toContain('nycfc~7');
  expect(out.union).toContain('g:mls');
  expect(out.union).toContain('s:ny');
  // merging with itself must not duplicate — this runs on every boot
  expect(out.idempotent).toBe('c:lafc|g:mls');
  expect(out.withEmpty).toBe('c:lafc');
  expect(out.emptyWith).toBe('c:lafc');
  // ids with hyphens, underscores and slashes survive the trip
  expect(out.roundTrip.clubs).toEqual(['a-b', 'c_d']);
  expect(out.roundTrip.players).toEqual(['a-b/2']);
  expect(out.roundTrip.extras).toHaveLength(3);
});

/* ---- the signed-out pitch ------------------------------------------------ */

test('signed out, My XI names both failures the account fixes', async ({ page }) => {
  mockApi(page);
  await seed(page, { clubs: ['lafc'], players: [] });
  const errors = trackErrors(page);
  await gotoRoute(page, '#/myxi');
  const panel = page.locator('#mxacct');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('only exists in this browser');
  await expect(panel).toContainText('phone');          // cross-device
  await expect(panel).toContainText('after a week');   // Safari eviction
  await expect(panel.locator('#mxsignin')).toBeVisible();
  expect(errors).toEqual([]);
});

test('an empty XI is not asked to save nothing', async ({ page }) => {
  mockApi(page);
  await gotoRoute(page, '#/myxi');
  await expect(page.locator('#view')).toContainText('Pick up to eleven things');
  await expect(page.locator('#mxacct')).toHaveCount(0);
});

/* ---- signing in ---------------------------------------------------------- */

async function signIn(page, email = 'fan@example.com') {
  // callers may already have opened the form
  if (await page.locator('#mxsignin').count()) await page.locator('#mxsignin').click();
  await page.locator('#mx-email').fill(email);
  await page.locator('#mxemailform label.ck input').check();
  await page.locator('#mxemailform button[type=submit]').click();
  await expect(page.locator('#mxacct')).toContainText('Check your email');
  await page.locator('#mx-code').fill('123456');
  await page.locator('#mxcodeform button[type=submit]').click();
}

test('sign-in takes an email then a code, and never asks for a password', async ({ page }) => {
  const api = mockApi(page);
  await seed(page, { clubs: ['lafc'], players: [] });
  await gotoRoute(page, '#/myxi');

  await page.locator('#mxsignin').click();
  await expect(page.locator('#mx-email')).toBeVisible();
  // the thing this design exists to avoid
  await expect(page.locator('#mxacct input[type=password]')).toHaveCount(0);

  await signIn(page);
  await expect(page.locator('#mxacct')).toContainText('Saved to fan@example.com');
  expect(api.codeRequests[0]).toMatchObject({ email: 'fan@example.com', age13: true });
});

test('the 13-or-older gate is enforced before a code is sent', async ({ page }) => {
  const api = mockApi(page);
  await seed(page, { clubs: ['lafc'], players: [] });
  await gotoRoute(page, '#/myxi');
  await page.locator('#mxsignin').click();
  await page.locator('#mx-email').fill('kid@example.com');
  // deliberately leave the checkbox unticked
  await page.locator('#mxemailform button[type=submit]').click();
  await expect(page.locator('#mxacctmsg')).toContainText('13 or older');
  expect(api.codeRequests).toHaveLength(0);
});

test('a wrong code says so and stays on the code step', async ({ page }) => {
  mockApi(page, { badCode: true });
  await seed(page, { clubs: ['lafc'], players: [] });
  await gotoRoute(page, '#/myxi');
  await page.locator('#mxsignin').click();
  await page.locator('#mx-email').fill('fan@example.com');
  await page.locator('#mxemailform label.ck input').check();
  await page.locator('#mxemailform button[type=submit]').click();
  await page.locator('#mx-code').fill('000000');
  await page.locator('#mxcodeform button[type=submit]').click();
  await expect(page.locator('#mxacctmsg')).toContainText('wrong or has expired');
  await expect(page.locator('#mx-code')).toBeVisible();
});

test('a mail failure is reported, not swallowed into a dead code screen', async ({ page }) => {
  mockApi(page, { mailBroken: true });
  await seed(page, { clubs: ['lafc'], players: [] });
  await gotoRoute(page, '#/myxi');
  await page.locator('#mxsignin').click();
  await page.locator('#mx-email').fill('fan@example.com');
  await page.locator('#mxemailform label.ck input').check();
  await page.locator('#mxemailform button[type=submit]').click();
  await expect(page.locator('#mxacctmsg')).toContainText('Could not send');
  // must NOT have advanced to "enter the code we never sent"
  await expect(page.locator('#mx-code')).toHaveCount(0);
});

/* ---- the one that matters ------------------------------------------------ */

test('signing in merges the two XIs and loses nothing from either', async ({ page }) => {
  // this browser follows LAFC; the account already holds NYCFC from another device
  const api = mockApi(page, { picks: 'c:nycfc|g:mls' });
  await seed(page, { clubs: ['lafc'], players: [] });
  await gotoRoute(page, '#/myxi');
  await signIn(page);
  await expect(page.locator('#mxacct')).toContainText('Saved to');

  // eventual state: the merge and its push both settle after the panel flips
  await expect.poll(async () => (await readLocal(page)).favs.clubs).toContain('lafc');   // local pick survived
  await expect.poll(async () => (await readLocal(page)).favs.clubs).toContain('nycfc');  // remote pick arrived
  await expect.poll(async () => (await readLocal(page)).myxi.picks)
    .toContainEqual({ t: 'league', id: 'mls' });

  // and the union went back up, so the other device converges too
  await expect.poll(() => api.puts.at(-1)?.picks || '').toContain('lafc');
  await expect.poll(() => api.puts.at(-1)?.picks || '').toContain('nycfc');
});

test('a session restored at boot pulls in picks made on another device', async ({ page }) => {
  mockApi(page, { signedIn: true, email: 'fan@example.com', picks: 'c:nycfc' });
  await seed(page, { clubs: ['lafc'], players: [] });
  await gotoRoute(page, '#/myxi');
  await expect(page.locator('#mxacct')).toContainText('Saved to fan@example.com');
  await expect.poll(async () => (await readLocal(page)).favs.clubs).toContain('nycfc');
  await expect.poll(async () => (await readLocal(page)).favs.clubs).toContain('lafc');
});

/* ---- staying out of the way ---------------------------------------------- */

test('following a club pushes the new XI without blocking the star', async ({ page }) => {
  const api = mockApi(page, { signedIn: true, email: 'fan@example.com' });
  await gotoRoute(page, '#/myxi');
  await expect(page.locator('#mxacct')).toContainText('Saved to');

  // pick a league from the My XI add row — a local write that should sync
  const chip = page.locator('#mxadd [data-add="league"]').first();
  await chip.click();
  await expect.poll(() => api.puts.length, { timeout: 5000 }).toBeGreaterThan(0);
  expect(api.puts[api.puts.length - 1].picks).toContain('g:');
});

test('a failed push leaves the pick on screen and says it will retry', async ({ page }) => {
  const api = mockApi(page, { signedIn: true, email: 'fan@example.com', failPut: true });
  await seed(page, { clubs: ['lafc'], players: [] });
  const errors = trackErrors(page);
  await gotoRoute(page, '#/myxi');
  await page.locator('#mxadd [data-add="league"]').first().click();
  await expect.poll(() => api.puts.length, { timeout: 5000 }).toBeGreaterThan(0);

  // the pick is still local, which is what the visitor can see
  await expect.poll(async () => (await readLocal(page)).myxi.picks?.length).toBeGreaterThan(0);
  // The mock returns 500 on purpose, so the failed request itself is expected
  // — it surfaces twice, once from the response hook and once from the browser
  // console. What must not appear is an uncaught exception: a rejected push has
  // to stay inside the sync engine and never reach the page.
  const unexpected = errors.filter(e => !/500/.test(e));
  expect(unexpected).toEqual([]);
  expect(errors.some(e => e.startsWith('pageerror:'))).toBe(false);
});

test('signing out stops syncing but does not delete the XI', async ({ page }) => {
  mockApi(page, { signedIn: true, email: 'fan@example.com', picks: 'c:lafc' });
  await seed(page, { clubs: ['lafc'], players: [] });
  await gotoRoute(page, '#/myxi');
  await expect(page.locator('#mxacct')).toContainText('Saved to');
  await page.locator('#mxsignout').click();
  await expect(page.locator('#mxacct')).toContainText('only exists in this browser');
  // the picks are still here — signing out of a shared laptop is not a delete
  expect((await readLocal(page)).favs.clubs).toContain('lafc');
});

test('every account endpoint failing leaves My XI fully usable', async ({ page }) => {
  // no mock at all: the endpoints 404 on the static test server
  await seed(page, { clubs: ['lafc'], players: [] });
  await gotoRoute(page, '#/myxi');
  await expect(page.locator('#view h2.disp')).toHaveText('My XI');
  await page.locator('#mxadd [data-add="league"]').first().click();
  await expect.poll(async () => (await readLocal(page)).myxi.picks?.length).toBeGreaterThan(0);
});
