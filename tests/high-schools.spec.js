// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoRoute } = require('./helpers');

/* High schools are a directory layer, not clubs: off by default, fetched only
   when toggled on, drawn only when zoomed in, and never counted in the club
   copy. The JSON is ~2 MB raw, so "off by default" is a page-weight promise. */

const LOS_ANGELES = [34.05, -118.24];

const mapReady = page => page.waitForFunction(() => document.querySelector('.leafmap')?._rxiMap?.getBounds());

test('high schools are an opt-in directory layer', async ({ page }) => {
  const fetched = [];
  page.on('request', r => { if (r.url().includes('data/high_schools.json')) fetched.push(r.url()); });
  await gotoRoute(page, '#/map');
  await mapReady(page);
  const chip = page.locator('#lgchips [data-hs]');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  expect(fetched.length, 'the directory must not load until asked for').toBe(0);

  await chip.click();
  await expect(page.locator('#lgchips [data-hs]')).toHaveAttribute('aria-pressed', 'true');
  await mapReady(page);
  // national frame: nothing drawn, the reader is told to zoom in
  await expect(page.locator('.hsnote')).toBeVisible();
  await expect(page.locator('.hsnote')).toContainText('Zoom in');
  expect(fetched.length).toBe(1);

  await page.evaluate(ll => { document.querySelector('.leafmap')._rxiMap.setView(ll, 10); }, LOS_ANGELES);
  await page.waitForFunction(() => document.querySelector('.leafmap')._rxiHsCount > 50);
  await expect(page.locator('.hsnote')).toBeHidden();
  // the club count copy is untouched: schools are not clubs
  await expect(page.locator('.kicker').first()).toContainText(/of \d+ men's clubs/);
  await expect(page.locator('#view')).toContainText('not counted among the clubs');
});

test('the toggle is remembered and the table screen does not offer it', async ({ page }) => {
  await gotoRoute(page, '#/map');
  await mapReady(page);
  await page.locator('#lgchips [data-hs]').click();
  await page.reload();
  await mapReady(page);
  await expect(page.locator('#lgchips [data-hs]')).toHaveAttribute('aria-pressed', 'true');
  await gotoRoute(page, '#/table');
  await expect(page.locator('#lgchips [data-hs]')).toHaveCount(0);
});
