// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoRoute, trackErrors } = require('./helpers');

/* Elite Academy club pages say which age groups the club fields, read from the
   league's own standings divisions. It is membership, not results: youth pages
   carry no ratings, fixtures or records, and these are children down to U11. */

test('an Elite Academy club page lists the age groups it fields', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/club/rangers-fc-ea');
  const block = page.locator('#ea-ages');
  await expect(block).toBeVisible();
  // Rangers FC fields EA sides at every age incl. the 2026-27 U11/U12 additions
  await expect(block.locator('[data-tier="ea"]')).toContainText('U11');
  await expect(block.locator('[data-tier="ea"]')).toContainText('U12');
  await expect(block.locator('[data-tier="ea"]')).toContainText('U19');
  // and second teams in EA2 at the two youngest ages
  await expect(block.locator('[data-tier="ea2"]')).toContainText('U11');
  await expect(block).toContainText('Southwest');
  // membership only — never a record, points or a score
  await expect(block).not.toContainText(/\d+\s*-\s*\d+\s*-\s*\d+|\bpts\b/i);
  expect(errors).toEqual([]);
});

test('a club with no Elite Academy sides shows no age-group block', async ({ page, request }) => {
  const { clubs } = await (await request.get('/data/ea_age_groups.json')).json();
  await gotoRoute(page, '#/league/ecnlb');
  const hrefs = await page.locator('#view a[href^="#/club/"]').evaluateAll(as => as.map(a => a.getAttribute('href')));
  const outside = hrefs.find(h => !(h.replace('#/club/', '') in clubs));
  expect(outside, 'an ECNL club that is not also an EA member').toBeTruthy();
  await gotoRoute(page, outside);
  await expect(page.locator('#view')).toContainText('Youth directory listing');
  await expect(page.locator('#ea-ages')).toHaveCount(0);
});

/* EA members fold into a higher pin when they have one, so the roll follows the
   club, not the league tag: Total Futbol Academy is pinned under MLS NEXT. */
test('an Elite Academy member pinned under another league still lists its sides', async ({ page }) => {
  await gotoRoute(page, '#/club/total-futbol-academy');
  await expect(page.locator('#ea-ages [data-tier="ea"]')).toContainText('U12');
});

/* A shared name is not a shared organization. EA's 'FC Stars' plays in its
   Mid-America conference; FC Stars of Massachusetts is an ECNL club. A state
   joined in by name from another league's directory once put the EA roll on
   the Massachusetts page — a Mid-America division on a Massachusetts club. */
test('an Elite Academy roll never lands on a same-name club in another state', async ({ page }) => {
  await gotoRoute(page, '#/club/fc-stars');
  await expect(page.locator('#view')).toContainText('FC Stars');
  await expect(page.locator('#ea-ages')).toHaveCount(0);
});
