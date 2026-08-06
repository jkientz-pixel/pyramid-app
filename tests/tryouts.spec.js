// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

test('tryouts board renders heading, filter and post form', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/tryouts');
  await expect(page.locator('h2.disp')).toHaveText('Open Tryouts');
  await expect(page.locator('#tsex')).toBeVisible();
  await expect(page.locator('.tryform')).toBeVisible();
  expect(errors).toEqual([]);
});

test('tryouts sex filter toggles without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/tryouts');
  await page.click('#tsex [data-tsx="w"]');
  await expect(page.locator('#tsex [data-tsx="w"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tryform')).toBeVisible();
  expect(errors).toEqual([]);
});

test('tryout form validates before posting', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/tryouts');
  await page.click('.tryform .joinbtn');
  await expect(page.locator('.try-msg')).toContainText('Club name is required');
  expect(errors).toEqual([]);
});

test('tryout submission posts to /api/tryouts and confirms', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/tryouts');
  let posted = null;
  await page.route('**/api/tryouts', route => {
    posted = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.fill('.tryform input[name=club]', 'Testville FC');
  await page.fill('.tryform input[name=date]', '2027-01-15');
  await page.fill('.tryform input[name=email]', 'coach@testville.example');
  await page.click('.tryform .joinbtn');
  await expect(page.locator('.try-msg')).toContainText('human review');
  expect(posted.club).toBe('Testville FC');
  expect(posted.date).toBe('2027-01-15');
  expect(errors).toEqual([]);
});

test('player page shows claim form and posts a claim', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/player/atlanta-united/0');
  const box = page.locator('details', { hasText: 'Claim your profile' });
  await expect(box).toBeVisible();
  await box.locator('summary').click();
  let posted = null;
  await page.route('**/api/signup', route => {
    posted = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.fill('.claimform input[name=email]', 'player@example.com');
  await page.check('.claimform input[name=fa]');
  await page.click('.claimform .joinbtn');
  await expect(page.locator('.claim-msg')).toContainText('Claim received');
  expect(posted.kind).toBe('claim');
  expect(posted.message).toContain('fa:yes');
  expect(errors).toEqual([]);
});
