// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, gotoRoute } = require('./helpers');

/* js/ssel.js turns every long <select> into a searchable one. The native
   select stays the source of truth (these tests drive it with selectOption
   like every other spec does), so the contract to guard is: long lists get
   the search control, short lists don't, picking from the search sets the
   native value and fires change, and code that sets the value programmatically
   moves the visible label. */

test('a long dropdown gets a search control; picking from it routes like the native select', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/map');
  const sel = page.locator('#statejump');
  await expect(sel).toHaveClass(/ssel-native/);
  const btn = page.locator('#statejump + .ssel-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('Jump to a state');
  await btn.click();
  const pop = page.locator('.ssel-pop');
  await expect(pop).toBeVisible();
  const all = await pop.locator('li[role=option]').count();
  expect(all).toBeGreaterThan(50);
  await page.keyboard.type('calif');
  await expect(pop.locator('li[role=option]')).toHaveCount(1);
  await expect(pop.locator('li[role=option]')).toContainText('California');
  await expect(pop.locator('.ssel-count')).toContainText(`1 of ${all}`);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/state\/CA$/);
  await expect(pop).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('short dropdowns stay native', async ({ page }) => {
  await gotoRoute(page, '#/club/atlanta-united');
  await page.locator('.fixform summary').first().click();
  const kind = page.locator('select[name=kind]');
  await expect(kind).toHaveCount(1);
  await expect(kind).not.toHaveClass(/ssel-native/);
  await expect(page.locator('select[name=kind] + .ssel-btn')).toHaveCount(0);
});

test('a select filled after render is enhanced, and a programmatic value moves the label', async ({ page }) => {
  await gotoRoute(page, '#/radar');
  await page.waitForFunction(() => document.querySelectorAll('#pr-p option').length > 8);
  const btn = page.locator('#pr-p + .ssel-btn');
  await expect(btn).toBeVisible();
  const first = await page.locator('#pr-p option').first().textContent();
  await expect(btn).toContainText((first || '').split(' — ')[0]);
  // app code assigning .value directly (no event) must still move the label
  const third = await page.locator('#pr-p').evaluate(s => { s.value = s.options[2].value; return s.options[2].textContent.trim(); });
  await expect(btn).toContainText(third.split(' — ')[0]);
  // the league picker is short (stays native); switching it rebuilds the player list and the label follows
  await expect(page.locator('#pr-lg + .ssel-btn')).toHaveCount(0);
  await page.selectOption('#pr-lg', 'usls');
  await page.waitForFunction(() => document.querySelector('#pr-p + .ssel-btn')?.textContent.includes(
    document.querySelector('#pr-p option:checked')?.textContent.trim() || ' '));
});

test('typing in the search filters players and Enter selects one, firing change', async ({ page }) => {
  await gotoRoute(page, '#/radar');
  await page.waitForFunction(() => document.querySelectorAll('#pr-p option').length > 8);
  const target = await page.locator('#pr-p option').nth(3).evaluate(o => ({ v: o.value, t: o.textContent.trim() }));
  await page.locator('#pr-p + .ssel-btn').click();
  const q = page.locator('.ssel-pop input');
  await q.fill(target.t.split(' — ')[0]);
  await expect(page.locator('.ssel-pop li[role=option]').first()).toContainText(target.t.split(' — ')[0]);
  await page.keyboard.press('Enter');
  await expect(page.locator('#pr-p')).toHaveValue(target.v);
  await expect(page.locator('#pr-card')).toContainText(target.t.split(' — ')[0]);
});

test('keyboard: arrows open the list, Escape closes it and returns focus', async ({ page }) => {
  await gotoRoute(page, '#/map');
  const btn = page.locator('#statejump + .ssel-btn');
  await btn.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ssel-pop')).toBeVisible();
  await expect(page.locator('.ssel-pop input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ssel-pop')).toHaveCount(0);
  await expect(btn).toBeFocused();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('grouped options keep their group headings in the search list', async ({ page }) => {
  await gotoRoute(page, '#/club/ac-connecticut');
  const btn = page.locator('.beatpro .ssel-btn');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('.ssel-pop li.grp').first()).toBeVisible();
  await page.keyboard.type('atlanta');
  const hits = page.locator('.ssel-pop li[role=option]');
  expect(await hits.count()).toBeGreaterThan(0);
  expect(await hits.count()).toBeLessThan(5);           // Atlanta United, Atlanta United 2 — not the whole list
  await hits.filter({ hasText: /^Atlanta United$/ }).click();
  await expect(page.locator('.beatpro select')).toHaveValue('atlanta-united');
  await expect(btn).toContainText('Atlanta United');
});
