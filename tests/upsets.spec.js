// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* Giant-Killings reads 1,584 Open Cup rows and calls some of them upsets. The
   claim only holds if the tier map behind it is right, so these tests check the
   arithmetic and the honesty of the disclosure, not just that pixels appeared. */

const ready = async page => { await gotoRoute(page, '#/upsets'); await page.waitForSelector('.gk-row'); };

test('the giant-killings list renders and its totals agree with the rows', async ({ page }) => {
  const errors = trackErrors(page);
  await ready(page);
  const rows = await page.locator('.gk-row').count();
  expect(rows).toBeGreaterThan(100);
  /* the headline number must be the number of rows actually shown */
  await expect(page.locator('.stat').first()).toContainText(String(rows));
  await expect(page.locator('#gk-count')).toHaveText(`${rows} results`);
  expect(errors).toEqual([]);
});

test('the underdog share is consistent with the two counts above it', async ({ page }) => {
  await ready(page);
  const nums = await page.$$eval('.stat b', els => els.map(e => Number(e.textContent.replace('%', ''))));
  const [upsets, cross, pct] = nums;
  expect(cross).toBeGreaterThan(upsets);
  expect(pct).toBe(Math.round(100 * upsets / cross));
});

test('filtering by year narrows the list to that year', async ({ page }) => {
  await ready(page);
  const all = await page.locator('.gk-row').count();
  await page.click('[data-yr="2017"]');
  const some = await page.locator('.gk-row').count();
  expect(some).toBeLessThan(all);
  for (const y of await page.$$eval('.gk-yr', els => els.map(e => e.textContent))) {
    expect(y).toBe('2017');
  }
  await expect(page.locator('[data-yr="2017"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the two-tier filter only keeps matches that really jumped two tiers', async ({ page }) => {
  await ready(page);
  const all = await page.locator('.gk-row').count();
  await page.click('#gk-gap');
  const big = await page.locator('.gk-row').count();
  expect(big).toBeGreaterThan(0);
  expect(big).toBeLessThan(all);
  for (const t of await page.$$eval('.gk-meta', els => els.map(e => e.textContent))) {
    expect(t).toMatch(/tiers up/);
  }
});

/* The whole feature rests on never calling a same-tier win an upset. Every row
   must pair two different tier badges, with the winner's the lower one. */
test('no row claims an upset between clubs on the same tier', async ({ page }) => {
  await ready(page);
  const pairs = await page.$$eval('.gk-line', lines => lines.map(l => {
    const b = l.querySelectorAll('.gk-tier');
    const tierOf = el => Number([...el.classList].find(c => /^gk-t\d$/.test(c)).slice(4));
    return [tierOf(b[0]), tierOf(b[1])];
  }));
  expect(pairs.length).toBeGreaterThan(100);
  for (const [winner, loser] of pairs) expect(winner).toBeGreaterThan(loser);
});

/* Silent exclusion would make the headline number look like the whole truth. */
test('the note discloses how many matches could not be tiered', async ({ page }) => {
  await ready(page);
  const note = await page.locator('.note').last().innerText();
  expect(note).toMatch(/\d{3} of the [\d,]+ matches on file/);
  expect(note).toMatch(/local qualifying/i);
  expect(note).toMatch(/Wikipedia/);
});

test('a level score is labelled rather than shown as a win by that score', async ({ page }) => {
  await ready(page);
  const levels = page.locator('.gk-score:has(small)');
  if (await levels.count()) {
    await expect(levels.first()).toContainText('after level');
    const txt = await levels.first().innerText();
    const [a, b] = txt.split('\n')[0].split('–');
    expect(a).toBe(b);
  }
});

test('the Trophy Room links through to the giant-killings', async ({ page }) => {
  await gotoRoute(page, '#/cups');
  const cta = page.locator('a.gk-cta');
  await expect(cta).toHaveAttribute('href', '#/upsets');
  await cta.click();
  await page.waitForSelector('.gk-row');
  expect(page.url()).toContain('#/upsets');
});
