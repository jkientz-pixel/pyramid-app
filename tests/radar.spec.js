// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* Player Radar reads data/player_radar.json straight off the static server, so
   unlike Shot Maps there is nothing to stub — these run against the real
   payload. That is deliberate: the failure this screen is most likely to have
   is a bad pool or a percentile that drifts out of 0-100 on real data, and a
   fixture would hide exactly that. */

const radarReady = async (page) => {
  await gotoRoute(page, '#/radar');
  await page.waitForSelector('.pr-radar polygon.pr-poly');
};

test('the radar draws six axes and one polygon per player', async ({ page }) => {
  const errors = trackErrors(page);
  await radarReady(page);
  await expect(page.locator('.pr-radar text.pr-axis')).toHaveCount(6);
  await expect(page.locator('.pr-radar polygon.pr-poly')).toHaveCount(1);
  await expect(page.locator('.pr-radar circle.pr-node')).toHaveCount(6);
  /* One series carries no legend — the card names the player. */
  await expect(page.locator('#pr-legend')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('picking a second player adds a series, a legend and a second bar chart', async ({ page }) => {
  await radarReady(page);
  await page.selectOption('#pr-cmp', { index: 3 });
  await expect(page.locator('.pr-radar polygon.pr-poly')).toHaveCount(2);
  await expect(page.locator('.pr-radar circle.pr-node')).toHaveCount(12);
  await expect(page.locator('#pr-legend .pr-swatch')).toHaveCount(2);
  await expect(page.locator('.pr-bars')).toHaveCount(2);
  /* The two series must not share a hue, or the legend is decoration. */
  await expect(page.locator('#pr-legend .pr-swatch.pr-a')).toHaveCount(1);
  await expect(page.locator('#pr-legend .pr-swatch.pr-b')).toHaveCount(1);
});

test('every percentile stays inside 0-100 and the table mirrors the radar', async ({ page }) => {
  await radarReady(page);
  const pcts = await page.locator('#pr-table tbody tr td:nth-child(3)').allTextContents();
  expect(pcts.length).toBe(7);                       // six actions plus the total
  for (const p of pcts) {
    const v = Number(p);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  }
  const hero = Number(await page.locator('.pr-hero b').textContent());
  expect(hero).toBe(Number(pcts[6]));                // hero is the total row
});

test('a thin pool widens one step and says so instead of ranking against a handful', async ({ page }) => {
  await radarReady(page);
  await page.selectOption('#pr-lg', 'usls');         // 4 attacking mids clear the floor
  await page.waitForTimeout(200);
  const picked = await page.evaluate(() => {
    const sel = /** @type {HTMLSelectElement} */ (document.querySelector('#pr-p'));
    const o = [...sel.options].find(x => x.textContent.includes('· AM'));
    if (!o) return false;
    sel.value = o.value; sel.dispatchEvent(new Event('change'));
    return true;
  });
  expect(picked).toBe(true);
  const note = page.locator('#pr-card .note');
  await expect(note).toContainText('Pool widened');
  await expect(note).toContainText('midfielders');
  await expect(note).toHaveClass(/cch-warn/);
});

test('forcing same-position-only drops the widen notice back off', async ({ page }) => {
  await radarReady(page);
  await page.selectOption('#pr-lg', 'usls');
  await page.waitForTimeout(200);
  await page.selectOption('#pr-scope', 'pos');
  await expect(page.locator('#pr-card .note')).not.toContainText('Pool widened');
});

test('raising the minutes floor shrinks the pool the charts are drawn from', async ({ page }) => {
  await radarReady(page);
  const before = await page.locator('#pr-swarmwrap circle').count();
  await page.locator('#pr-floor').fill('1400');
  await page.locator('#pr-floor').dispatchEvent('input');
  await page.waitForTimeout(200);
  const after = await page.locator('#pr-swarmwrap circle').count();
  expect(after).toBeLessThan(before);
  await expect(page.locator('#pr-card .note')).toContainText('1,400 minutes');
});

test('the swarm and scatter tag every dot with a player, so tooltips cannot mismatch', async ({ page }) => {
  await radarReady(page);
  for (const wrap of ['#pr-swarmwrap', '#pr-scatterwrap']) {
    const all = await page.locator(`${wrap} circle`).count();
    const tagged = await page.locator(`${wrap} circle[data-id]`).count();
    expect(tagged).toBe(all);
  }
});

test('every league loads and leaves no goalkeepers on an outfield radar', async ({ page }) => {
  const errors = trackErrors(page);
  await radarReady(page);
  for (const lg of ['mls', 'nwsl', 'uslc', 'usl1', 'mlsnp', 'usls']) {
    await page.selectOption('#pr-lg', lg);
    await page.waitForSelector('.pr-radar polygon.pr-poly');
    await expect(page.locator('.pr-who b')).not.toBeEmpty();
    const positions = await page.locator('#pr-p option').allTextContents();
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.some(o => o.endsWith('· GK'))).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('the standalone /radar page points at the app route', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/radar');
  await expect(page.locator('h1')).toHaveText('Player Radar');
  await expect(page.locator('a.cta').first()).toHaveAttribute('href', '/app#/radar');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://www.rankedxi.com/radar');
  expect(errors).toEqual([]);
});
