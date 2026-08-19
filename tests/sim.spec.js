// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

test('#/sim lands straight in the simulator without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/sim');
  await page.waitForFunction(() => /^#\/sim\/[a-z0-9-]+/.test(location.hash));
  await expect(page.locator('#simbook')).toBeVisible();
  expect(errors).toEqual([]);
});

test('#/sim/<club> books a result and the log and delta update', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/sim/atlanta-united');
  await expect(page.locator('h2.disp')).toHaveText('Atlanta United');
  await page.locator('#simbook').click();
  await expect(page.locator('.simlog li')).toHaveCount(1);
  await expect(page.locator('.statgrid .stat').nth(2)).not.toContainText('—');
  expect(errors).toEqual([]);
});

test('picker sheet browses a league and picks a club', async ({ page }) => {
  const errors = trackErrors(page);
  // start from a fixed MLS club so the first USLC row is guaranteed different
  await gotoRoute(page, '#/sim/atlanta-united');
  await page.locator('#simswap').click();
  await page.locator('#simlg').selectOption('uslc');
  const rows = page.locator('#simlist .qrow');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await page.waitForFunction(() =>
    /^#\/sim\/[a-z0-9-]+/.test(location.hash) && location.hash !== '#/sim/atlanta-united');
  await expect(page.locator('#simbook')).toBeVisible();
  expect(errors).toEqual([]);
});

test('picker sheet random button picks a club', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/sim/atlanta-united');
  await page.locator('#simswap').click();
  await page.locator('#simrand').click();
  await page.waitForFunction(() => /^#\/sim\/[a-z0-9-]+/.test(location.hash));
  // a pick closes the sheet and lands on that club's simulator
  await expect(page.locator('#simlist')).toBeHidden();
  await expect(page.locator('#simbook')).toBeVisible();
  expect(errors).toEqual([]);
});

test('club page has a Rank Simulator button that routes to #/sim', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/atlanta-united');
  await page.locator('[data-sim]').click();
  await page.waitForFunction(() => location.hash === '#/sim/atlanta-united');
  await expect(page.locator('#simbook')).toBeVisible();
  expect(errors).toEqual([]);
});
