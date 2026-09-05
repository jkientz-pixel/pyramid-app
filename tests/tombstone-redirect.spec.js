// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* CLUBS is append-only: a duplicate entry is hidden with h:1 plus a `dup`
   pointer, never deleted, so its old URL has to land on the surviving club. */
test('tombstoned duplicate club URLs redirect to the surviving club', async ({ page }) => {
  const errors = trackErrors(page);
  for (const [dupe, canon, name] of [
      ['gfi-academy', 'global-football-innovation-academy', 'Global Football Innovation Academy'],
      ['real-central-new-jersey', 'real-central-nj-2026', 'Real Central NJ (2026)']]) {
    await gotoRoute(page, '#/club/' + dupe);
    await expect(page).toHaveURL(new RegExp('#/club/' + canon + '$'));
    await expect(page.locator('h2.disp').first()).toHaveText(name);
  }
  expect(errors).toEqual([]);
});
