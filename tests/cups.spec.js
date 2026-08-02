// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

test('trophy room shows all four tiers of competitions', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/cups');
  await expect(page.locator('#view')).toContainText('The open cups');
  await expect(page.locator('#view')).toContainText('Professional titles');
  await expect(page.locator('#view')).toContainText('Amateur national titles');
  await expect(page.locator('#view')).toContainText('The College Cups');
  /* 16 tournaments shipped — a refresh that loses most of them should fail
     loudly here, not render a thin page silently */
  expect(await page.locator('#view details').count()).toBeGreaterThanOrEqual(12);
  await expect(page.locator('#view details[open] summary')).toContainText('U.S. Open Cup');
  expect(errors).toEqual([]);
});

test('trophy room lists never show a dangling def. with no opponent', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/cups');
  const dangling = await page.locator('#view .cw-stat', { hasText: /^def\.\s*$/ }).count();
  expect(dangling).toBe(0);
  expect(errors).toEqual([]);
});
