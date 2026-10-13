// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute, viewRendered } = require('./helpers');

/* a held data.js request keeps the page's load event open (the full file is
   requested on idle, before load), so held-back tests wait on 'commit' instead */
async function gotoHeld(page, hash) {
  await page.goto(`/app.html${hash}`, { waitUntil: 'commit' });
  await viewRendered(page);
}

/* js/data.js is 1.1 MB; the national map paints from js/data-slim.js (generated
   from it by scripts/gen_slim.py) and the full records merge in after paint. */

const SLIM_KEYS = ['n', 'id', 'g', 'x', 'h', 'la', 'lo', 'st', 'r', 'rr', 'acc', 'dup'];

test('the generated slim file is in sync with data.js: same clubs, same order, same values', async ({ page }) => {
  await page.goto('/app.html#/map', { waitUntil: 'commit' });
  const res = await page.evaluate(async (keys) => {
    const [slim, full] = await Promise.all([import('/js/data-slim.js'), import('/js/data.js')]);
    if (slim.CLUBS.length !== full.CLUBS.length) return `count ${slim.CLUBS.length} != ${full.CLUBS.length}`;
    for (let i = 0; i < full.CLUBS.length; i++) {
      for (const k of keys) {
        if (JSON.stringify(slim.CLUBS[i][k]) !== JSON.stringify(full.CLUBS[i][k])) return `club ${i} ${k}: ${slim.CLUBS[i][k]} != ${full.CLUBS[i][k]}`;
      }
    }
    if (JSON.stringify(slim.LEAGUES) !== JSON.stringify(full.LEAGUES)) return 'LEAGUES differ';
    if (JSON.stringify(slim.REGIONS) !== JSON.stringify(full.REGIONS)) return 'REGIONS differ';
    return 'ok';
  }, SLIM_KEYS);
  expect(res).toBe('ok');
});

test('the map paints before data.js is requested, then the full records merge in', async ({ page }) => {
  const errors = trackErrors(page);
  const order = [];
  page.on('request', r => { const m = r.url().match(/\/js\/(data|data-slim)\.js/); if (m) order.push(m[1]); });
  await gotoHeld(page, '#/map');
  await page.waitForSelector('.leafmap.leaflet-container');
  expect(order[0]).toBe('data-slim');
  /* the full file arrives on idle; crests only exist in it */
  await expect.poll(() => order.includes('data')).toBe(true);
  expect(errors).toEqual([]);
});

test('a deep link to a club waits for the full records and renders crest, site and socials', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/atlanta-united');
  await expect(page.locator('#view')).toContainText('Atlanta United');
  await expect(page.locator('#view img.crest').first()).toHaveAttribute('src', /crests\/atlanta-united\.png/);
  await expect(page.locator('#view a[href^="https://atlutd.com"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('tapping through from the map to a club still gets full data', async ({ page }) => {
  /* hold data.js back so the click happens while only the slim slice exists */
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route('**/js/data.js*', async route => { await gate; await route.continue(); });
  await gotoHeld(page, '#/map');
  await page.waitForSelector('.leafmap.leaflet-container');
  await page.evaluate(() => { location.hash = '#/club/atlanta-united'; });
  /* nothing renders for the club while it waits... */
  await page.waitForTimeout(300);
  await expect(page.locator('#view')).not.toContainText('Ranked XI rating');
  release();
  await expect(page.locator('#view img.crest').first()).toHaveAttribute('src', /crests\/atlanta-united\.png/);
});

test('search before the full records land finds clubs, then upgrades rows to crests', async ({ page }) => {
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route('**/js/data.js*', async route => { await gate; await route.continue(); });
  await gotoHeld(page, '#/map');
  await page.locator('#q').click();
  await page.locator('#q').pressSequentially('atlanta uni');
  const row = page.locator('#qres a.qrow').first();
  await expect(row).toContainText('Atlanta United');
  await expect(row.locator('img.crest')).toHaveCount(0);
  release();
  await expect(row.locator('img.crest')).toHaveCount(1);
});
