// @ts-check
const { test, expect } = require('@playwright/test');
const { viewRendered, gotoRoute, gotoIllustrated } = require('./helpers');

/* The detailed (Leaflet) map opens framed on the contiguous states, the same
   ground the illustrated map covers. Fitting it to every club instead spans
   19.7N-64.8N and shrinks the lower 48 to a strip — Alaska and Hawaii still
   plot, they just don't get a vote on the opening frame. */

const ANCHORAGE = [61.22, -149.9];
const HONOLULU = [21.31, -157.86];

async function openDetailed(page, hash) {
  await gotoRoute(page, hash);
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

/* The map box must not resize when the offline fallback stands in for the tile
   map — a reader who loses the network should see the same shaped map, not a
   layout jump. This used to be a mode-toggle test; the toggle is gone, the
   invariant is not. */
test('the offline fallback map is the same size as the tile map', async ({ page }) => {
  await gotoRoute(page, '#/map');
  await page.waitForSelector('.leafmap.leaflet-container');
  const street = await page.locator('.mapbox').boundingBox();
  await gotoIllustrated(page, '#/map');
  const art = await page.locator('.mapbox').boundingBox();
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
  await gotoIllustrated(page, '#/state/AK');
  await page.waitForSelector('svg.usmap image.pin', { state: 'attached' });
  const zoomIn = page.locator('.mapctl [data-z="in"]');
  for (let i = 0; i < 12; i++) await zoomIn.click();
  const px = await page.locator('svg.usmap image.pin').first().evaluate(
    el => el.getBoundingClientRect().width);
  expect(px).toBeGreaterThan(8);    // still visible
  expect(px).toBeLessThan(70);      // not a badge swallowing the map
});

/* Zooming to your town and then filtering to your division used to be
   impossible: every league/level/sex toggle rebuilds the screen, and the
   rebuild re-fitted the map to the national frame. So did routing into a club
   page and back. Both threw away the only thing the reader had done. */
async function mapView(page) {
  await page.waitForSelector('.leafmap.leaflet-container');
  await page.waitForFunction(() => document.querySelector('.leafmap')?._rxiMap?.getBounds());
  return page.evaluate(() => {
    const m = document.querySelector('.leafmap')._rxiMap;
    const c = m.getCenter();
    return { lat: c.lat, lng: c.lng, zoom: m.getZoom() };
  });
}
async function zoomToPortland(page) {
  await mapView(page);          // map built and bounded before we drive it
  /* braces, not a bare arrow: setView returns the Leaflet map itself, and
     Playwright cannot serialize that back across the boundary. */
  await page.evaluate(() => { document.querySelector('.leafmap')._rxiMap.setView([45.52, -122.68], 9); });
  await page.waitForFunction(() => document.querySelector('.leafmap')._rxiMap.getZoom() === 9);
  return mapView(page);
}

test('the map viewport survives a level filter', async ({ page }) => {
  await gotoRoute(page, '#/map');
  const before = await zoomToPortland(page);
  /* "Pro", not "All levels" — the default chip is already pressed, so it would
     not force the rebuild this test exists to survive. */
  await page.click('[data-lvl="pro"]');
  await viewRendered(page);
  const after = await mapView(page);
  expect(after.zoom).toBe(before.zoom);
  expect(Math.abs(after.lat - before.lat)).toBeLessThan(0.5);
  expect(Math.abs(after.lng - before.lng)).toBeLessThan(0.5);
});

test('the map viewport survives a club round-trip', async ({ page }) => {
  await gotoRoute(page, '#/map');
  const before = await zoomToPortland(page);
  await gotoRoute(page, '#/club/portland-timbers');
  /* #view still holds the map's children the instant the hash changes, so
     "has children" is already true and says nothing about the club. Wait for
     the club screen itself, or Back races a render that has not happened yet
     and this measures a round trip that never went anywhere. */
  await page.waitForSelector('#view .clubhead');
  await page.goBack();
  await viewRendered(page);
  const after = await mapView(page);
  expect(after.zoom).toBe(before.zoom);
  expect(Math.abs(after.lat - before.lat)).toBeLessThan(0.5);
  expect(Math.abs(after.lng - before.lng)).toBeLessThan(0.5);
});
