// @ts-check
const { test, expect } = require('@playwright/test');
const { viewRendered, gotoRoute } = require('./helpers');

/* The detailed (Leaflet) map opens framed on the contiguous states, the same
   ground the illustrated map covers. Fitting it to every club instead spans
   19.7N-64.8N and shrinks the lower 48 to a strip — Alaska and Hawaii still
   plot, they just don't get a vote on the opening frame. */

const ANCHORAGE = [61.22, -149.9];
const HONOLULU = [21.31, -157.86];

async function openDetailed(page, hash) {
  await gotoRoute(page, hash);
  await page.click('.mapmode [data-mode="street"]');
  await page.waitForSelector('.leafmap.leaflet-container');
  await page.waitForFunction(() => document.querySelector('.leafmap')?._rxiMap?.getBounds());
  return page.evaluate(([ak, hi]) => {
    const b = document.querySelector('.leafmap')._rxiMap.getBounds();
    return { north: b.getNorth(), south: b.getSouth(), ak: b.contains(ak), hi: b.contains(hi) };
  }, [ANCHORAGE, HONOLULU]);
}

test('the national detailed map opens on the contiguous states', async ({ page }) => {
  const b = await openDetailed(page, '#/map');
  expect(b.ak).toBe(false);
  expect(b.hi).toBe(false);
  // the lower 48 run 25.5N-49.3N; allow generous padding but not a continent
  expect(b.north).toBeLessThan(56);
  expect(b.south).toBeGreaterThan(18);
});

test('an Alaska scope still frames Alaska', async ({ page }) => {
  const b = await openDetailed(page, '#/state/AK');
  expect(b.ak).toBe(true);
});

test('switching map modes does not change the box height', async ({ page }) => {
  await gotoRoute(page, '#/map');
  /* Detailed is the default now, so start from Illustrated to measure both */
  await page.click('.mapmode [data-mode="art"]');
  await page.waitForSelector('svg.usmap', { state: 'visible' });
  const art = await page.locator('.mapbox').boundingBox();
  await page.click('.mapmode [data-mode="street"]');
  await page.waitForSelector('.leafmap.leaflet-container');
  const street = await page.locator('.mapbox').boundingBox();
  expect(Math.abs(street.height - art.height)).toBeLessThan(2);
  expect(Math.abs(street.width - art.width)).toBeLessThan(2);
});

/* A scoped screen has its own home extent, so a constant pin-scale floor blows
   crests up on tight scopes: the Alaska inset is 232 units wide against the
   national 980, and at its zoom limit one crest rendered ~150px — a single
   badge filling the box with no coastline behind it. The floor now scales with
   the screen's own extent. Alaska is the tightest scope we ship, so it is the
   one that guards this. */
test('crests stay a sane size at max zoom on a tight scope (Alaska)', async ({ page }) => {
  await gotoRoute(page, '#/state/AK');
  await page.click('.mapmode [data-mode="art"]');
  await page.waitForSelector('svg.usmap image.pin', { state: 'attached' });
  const zoomIn = page.locator('.mapctl [data-z="in"]');
  for (let i = 0; i < 12; i++) await zoomIn.click();
  const px = await page.locator('svg.usmap image.pin').first().evaluate(
    el => el.getBoundingClientRect().width);
  expect(px).toBeGreaterThan(8);    // still visible
  expect(px).toBeLessThan(70);      // not a badge swallowing the map
});
