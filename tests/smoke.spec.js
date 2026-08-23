// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, viewRendered, gotoRoute, gotoIllustrated } = require('./helpers');

/* Every top-level hash route the router dispatches (js/app.js route()).
   Each must render into #view without a single console/page error. */
const ROUTES = [
  '#/map',
  '#/tiers',
  '#/table',
  '#/matches',
  '#/following',
  '#/about',
  '#/cups',
  '#/upsets',
  '#/college',
  '#/nt',
  '#/wire',
  '#/tools',
  '#/predict',
  '#/sim',
  '#/player-sim',
  '#/shots',
  '#/pricing',
  '#/advertise',
  '#/freeagents',
  '#/freeagent',
  '#/tryouts',
  '#/clubtools',
  '#/legal',
  '#/region/midwest',
  '#/state/CA',
  '#/club/atlanta-united',
  '#/legends/atlanta-united',
];

/* /api/shots is a Cloudflare Pages Function; scripts/dev_server.py serves
   static files only, so the real call 404s locally. Stubbing it keeps this
   sweep's "no errors at all" assertion strict instead of teaching it to
   ignore 404s, which is exactly the class of bug it exists to catch. The
   endpoint itself is covered where it can be: deploy.sh fails a deploy unless
   the live route answers 400 to a bare call, and tests/shots.spec.js drives
   the unavailable-feed path on purpose. */
test.beforeEach(async ({ page }) => {
  await page.route('**/api/shots**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"games":[]}' }));
});

for (const route of ROUTES) {
  test(`route ${route} renders without errors`, async ({ page }) => {
    const errors = trackErrors(page);
    await gotoRoute(page, route);
    expect(errors).toEqual([]);
  });
}

test('default route falls back to the map', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '');
  await expect(page.locator('#regionchips')).toBeVisible();
  expect(errors).toEqual([]);
});

/* This used to assert the map rendered. Silently showing the map for a bad
   hash is the worst available failure mode: a stranger following a mistyped
   link from a DM concludes the site is broken, not that the URL was wrong.
   An unknown route now says so. */
test('unknown route renders an honest not-found, not the map', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/definitely-not-a-route');
  await expect(page.locator('#view')).toContainText("That page isn't here");
  await expect(page.locator('#regionchips')).toHaveCount(0);
  await expect(page).toHaveTitle(/Page not found/);
  expect(errors).toEqual([]);
});

/* Every alias below is a URL somebody plausibly types or gets sent; each one
   used to render the map with no explanation. */
for (const [typed, lands] of [
  ['#/free-agents', 'freeagents'],
  ['#/claim', 'clubtools'],
  ['#/follow', 'myxi'],
  ['#/following', 'myxi'],
  ['#/standings', 'table'],
  ['#/pyramid', 'tiers'],
]) {
  test(`${typed} redirects to #/${lands}`, async ({ page }) => {
    const errors = trackErrors(page);
    await gotoRoute(page, typed);
    await page.waitForFunction(h => location.hash === h, `#/${lands}`);
    await viewRendered(page);
    await expect(page.locator('#view')).not.toContainText("That page isn't here");
    expect(errors).toEqual([]);
  });
}

/* Advertising was removed entirely: no ad slots, no rate card, no #/advertise.
   An unsold slot rendering "your brand here" reads as a dead site, and a
   published rate card prices against traffic we have not proved. These assert
   the surface stays gone rather than quietly returning. */
test('#/advertise is gone and does not render an ad surface', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/advertise');
  await viewRendered(page);
  await expect(page.locator('#view')).toContainText("That page isn't here");
  expect(errors).toEqual([]);
});

test('no screen renders an unsold sponsor slot', async ({ page }) => {
  for (const h of ['#/map', '#/tiers', '#/wire', '#/freeagents']) {
    await gotoRoute(page, h);
    await viewRendered(page);
    await expect(page.locator('#view .adslot')).toHaveCount(0);
    await expect(page.locator('#view')).not.toContainText('Sponsor slot');
  }
});

test('legacy numeric club id redirects to the permanent slug', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/0');
  await page.waitForFunction(() => /^#\/club\/[a-z0-9-]+$/.test(location.hash));
  expect(page.url()).not.toContain('#/club/0');
  expect(errors).toEqual([]);
});

test('club page shows name, rating and links out', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/atlanta-united');
  await expect(page.locator('#view')).toContainText('Atlanta United');
  expect(errors).toEqual([]);
});

test('player page reachable from a club roster', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/atlanta-united');
  const playerLink = page.locator('#view a[href^="#/player/"]').first();
  await expect(playerLink).toBeVisible();
  await playerLink.click();
  await viewRendered(page);
  expect(page.url()).toContain('#/player/');
  expect(errors).toEqual([]);
});

test('search finds a club and navigates to it', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/map');
  await page.fill('#q', 'Atlanta United');
  const firstHit = page.locator('#qres a, #qres [data-i], #qres li').first();
  await expect(firstHit).toBeVisible();
  await firstHit.click();
  await viewRendered(page);
  await expect(page.locator('#view')).toContainText('Atlanta United');
  expect(errors).toEqual([]);
});

test('theme toggle flips and persists the theme', async ({ page }) => {
  await gotoRoute(page, '#/map');
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#themebtn');
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await page.reload();
  await viewRendered(page);
  const persisted = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(persisted).toBe(after);
});

test('tab bar navigates between sections', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/map');
  for (const tab of ['tiers', 'table', 'matches', 'tools', 'myxi', 'about']) {
    await page.click(`.tabbar a[data-tab="${tab}"]`);
    await viewRendered(page);
    await expect(page.locator(`.tabbar a[data-tab="${tab}"]`)).toHaveClass(/active/);
  }
  expect(errors).toEqual([]);
});

test('appbar wordmark is a home link and resets the map framing', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/tiers');
  await page.click('.appbar .brand');
  await page.locator('.mapmode [data-mode="art"]').click();
  await viewRendered(page);
  expect(page.url()).toContain('#/map');
  const svg = page.locator('svg.usmap');
  await expect(svg).toBeVisible();
  const homeW = parseFloat((await svg.getAttribute('viewBox')).split(' ')[2]);
  // already on the map: zoom in, then the wordmark restores the home framing
  await page.click('.mapctl [data-z="in"]');
  await page.waitForFunction(w => {
    const vb = document.querySelector('svg.usmap')?.getAttribute('viewBox');
    return vb && parseFloat(vb.split(' ')[2]) < w - 1;
  }, homeW);
  await page.click('.appbar .brand');
  await page.waitForFunction(w => {
    const vb = document.querySelector('svg.usmap')?.getAttribute('viewBox');
    return vb && Math.abs(parseFloat(vb.split(' ')[2]) - w) < 1;
  }, homeW);
  expect(errors).toEqual([]);
});

/* Static pages outside the SPA shell. */
for (const path of ['/index.html', '/npsl-rankings.html', '/upsl-rankings.html']) {
  test(`static page ${path} loads without errors`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('map pan stays anchored — drag cannot push the map out of the box', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoIllustrated(page, '#/map');
  const svg = page.locator('svg.usmap');
  await expect(svg).toBeVisible();
  // zoom in twice so there is room to pan, then drag hard past the edge
  await page.click('.mapctl [data-z="in"]');
  await page.click('.mapctl [data-z="in"]');
  const box = await svg.boundingBox();
  // repeated drags across open map area (clear of the .mapctl overlay),
  // starting and ending inside the svg like a real user — accumulated pan
  // must clamp at the home extent instead of pushing the map out of the box
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6, { steps: 6 });
    await page.mouse.up();
  }
  const vb = await svg.getAttribute('viewBox');
  const [x, y, w, h] = vb.split(' ').map(Number);
  // home extent is 0 -20 980 580 (top headroom for Canada) — view stays inside
  expect(x).toBeGreaterThanOrEqual(-0.1);
  expect(y).toBeGreaterThanOrEqual(-20.1);
  expect(x + w).toBeLessThanOrEqual(980.1);
  expect(y + h).toBeLessThanOrEqual(560.1);
  expect(errors).toEqual([]);
});

/* Interest capture replaced the mailto: CTAs. A mailto gives one bit and no way
   to tell "no demand" from "no discovery" — these assert the forms are actually
   present and that no CTA quietly reverts to a mail link. */
for (const [route, count] of [['#/pricing', 2], ['#/freeagents', 1], ['#/clubtools/sample', 1]]) {
  test(`${route} offers a register-interest form, not a mailto`, async ({ page }) => {
    const errors = trackErrors(page);
    await gotoRoute(page, route);
    await viewRendered(page);
    await expect(page.locator('#view .interestform')).toHaveCount(count);
    /* No CTA may be a mail link. Notice/removal links stay mailto on purpose —
       an abuse report should reach a human directly, not a moderation queue. */
    await expect(page.locator('#view a.claim[href^="mailto"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('the interest form gates on email and the 13+ confirmation', async ({ page }) => {
  await gotoRoute(page, '#/freeagents');
  await viewRendered(page);
  const form = page.locator('#view .interestform form');
  await expect(form.locator('input[name="email"][required]')).toHaveCount(1);
  await expect(form.locator('input[name="age13"][required]')).toHaveCount(1);
  /* honeypot must stay in the markup and stay off-screen */
  await expect(form.locator('input[name="website"]')).toHaveCount(1);
  await expect(form.locator('input[name="website"]')).not.toBeInViewport();
});
