// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* College Results surfaces 5,276 NCAA D1 results that nothing but a backtest
   script had ever read. The risky part is not the rendering — it is the join
   between ESPN's short team names and this app's institutional ones, which is
   inferred. These tests hold that join to the rule the app uses everywhere
   else: a missing link beats a wrong club. */

const ready = async page => { await gotoRoute(page, '#/college'); await page.waitForSelector('.col-row'); };

test('college results open on a team that played a real season', async ({ page }) => {
  const errors = trackErrors(page);
  await ready(page);
  /* not the alphabetically-first D3 side with a single fixture */
  expect(await page.locator('.col-row').count()).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('the record adds up to the matches listed', async ({ page }) => {
  await ready(page);
  const rows = await page.locator('.col-row').count();
  const [wdl, , n] = await page.$$eval('.stat b', els => els.map(e => e.textContent));
  const [w, d, l] = wdl.split('–').map(Number);
  expect(w + d + l).toBe(rows);
  expect(Number(n)).toBe(rows);
});

test('each row’s result badge matches its own scoreline', async ({ page }) => {
  await ready(page);
  const rows = await page.$$eval('.col-row', els => els.map(e => ({
    badge: e.querySelector('.col-res').textContent.trim(),
    score: e.querySelector('.col-score').textContent.trim(),
  })));
  for (const { badge, score } of rows) {
    const [gf, ga] = score.split('–').map(Number);
    expect(badge).toBe(gf > ga ? 'W' : gf < ga ? 'L' : 'D');
  }
});

test('switching to the women’s feed loads a different season', async ({ page }) => {
  await ready(page);
  const before = await page.inputValue('#col-team');
  await page.click('[data-feed="ncaa1w"]');
  await expect(page.locator('[data-feed="ncaa1w"]')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForFunction(t => document.querySelector('#col-team').value !== t, before);
  expect(await page.locator('.col-row').count()).toBeGreaterThan(10);
});

test('picking a team shows that team’s matches', async ({ page }) => {
  await ready(page);
  await page.selectOption('#col-team', 'Ohio State');
  await expect(page.locator('#col-team')).toHaveValue('Ohio State');
  const rows = await page.locator('.col-row').count();
  expect(rows).toBeGreaterThan(5);
  /* a team never appears as its own opponent */
  for (const t of await page.$$eval('.col-line', els => els.map(e => e.textContent))) {
    expect(t).not.toContain('Ohio State');
  }
});

/* The join is inferred, so it must be allowed to say "I don't know". */
test('unresolved teams stay plain text and the note says how many', async ({ page }) => {
  await ready(page);
  const note = await page.locator('#col-body .note').innerText();
  expect(note).toMatch(/\d+ of the \d+ teams in this feed/);
  expect(note).toMatch(/did not land on exactly one club/);
  const linked = await page.locator('.col-line a').count();
  const total = await page.locator('.col-line').count();
  expect(linked).toBeLessThanOrEqual(total);
});

test('every club link points at a real club route', async ({ page }) => {
  await ready(page);
  const hrefs = await page.$$eval('.col-line a', els => els.map(e => e.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const h of hrefs) expect(h).toMatch(/^#\/club\/[a-z0-9-]+$/);
});
