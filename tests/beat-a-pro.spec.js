// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

test('an amateur men\'s club page answers "could you beat a pro club?"', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/woodland-fc');
  const box = page.locator('#beatpro');
  await expect(box).toBeVisible();
  await expect(box).toContainText('Could you beat a pro club?');
  await expect(box.locator('.bp-num b')).toHaveText(/^(<1|\d{1,2})%$/);
  /* nearest pro club is the default pick: Woodland FC plays in Topeka, KS */
  await expect(box.locator('select option:checked')).toHaveText(/Kansas City/);
  await box.locator('select').selectOption('atlanta-united');
  /* the block re-renders against the chosen club and keeps the range */
  await expect(page.locator('#beatpro select option:checked')).toHaveText('Atlanta United');
  await expect(page.locator('#beatpro')).toContainText(/(between \S+% and \S+%|stays (under|about) \S+% either way)/);
  expect(errors).toEqual([]);
});

test('the line stays off pro, women\'s, college and youth club pages', async ({ page }) => {
  for (const id of ['atlanta-united', 'louisville-city', 'arizona-arsenal-soccer-club',
                    'university-at-albany-great-danes', 'ac-river']) {
    await gotoRoute(page, '#/club/' + id);
    await expect(page.locator('#beatpro')).toHaveCount(0);
  }
});
