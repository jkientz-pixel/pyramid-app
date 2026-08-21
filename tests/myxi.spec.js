const { test, expect } = require('@playwright/test');
const { trackErrors, viewRendered, gotoRoute } = require('./helpers');

/* Seed follows before the app boots — pyr-favs is the source of truth the
   star buttons write, and My XI reads it rather than keeping its own copy. */
async function seed(page, favs, myxi) {
  await page.addInitScript(([f, m]) => {
    localStorage.setItem('pyr-favs', JSON.stringify(f));
    if (m) localStorage.setItem('rxi-myxi', JSON.stringify(m));
  }, [favs, myxi || null]);
}

test('My XI replaces Follow in the tab bar', async ({ page }) => {
  await gotoRoute(page, '#/map');
  const tab = page.locator('.tabbar a[data-tab="myxi"]');
  await expect(tab).toHaveAttribute('href', '#/myxi');
  await expect(tab).toContainText('My XI');
  await expect(page.locator('.tabbar a[data-tab="following"]')).toHaveCount(0);
});

test('every old Follow entrypoint redirects to My XI', async ({ page }) => {
  for (const old of ['#/following', '#/follow', '#/favorites']) {
    await page.goto('/app.html' + old);
    await viewRendered(page);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/myxi');
  }
});

test('empty My XI explains itself and offers a way in', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/myxi');
  await expect(page.locator('#view h2.disp')).toHaveText('My XI');
  await expect(page.locator('#view')).toContainText('Pick up to eleven things');
  // an empty state that is only an apology is a dead end
  await expect(page.locator('#view a[href="#/table"]').first()).toBeVisible();
  await expect(page.locator('#view a[href="#/map"]').first()).toBeVisible();
  // and the app's own accounts are reachable from here
  await expect(page.locator('.mx-social a')).toHaveCount(4);
  for (const href of ['https://x.com/rankedxi',
                      'https://www.instagram.com/rankedxi.app/',
                      'https://www.facebook.com/rankedxi',
                      'https://www.linkedin.com/company/rankedxi/']) {
    await expect(page.locator(`.mx-social a[href="${href}"]`)).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});

test('a followed club renders with its rank, rival and a matchup', async ({ page }) => {
  const errors = trackErrors(page);
  await seed(page, { clubs: ['atlanta-united'], players: [] });
  await gotoRoute(page, '#/myxi');
  await page.waitForSelector('.mx-clubs');
  const row = page.locator('.mx-clubs li').first();
  await expect(row).toContainText('Atlanta United');
  await expect(row).toContainText(/#\d+ in the men's table/);
  await expect(page.locator('.mx-rival').first()).toContainText(/Nearest rival:/);
  // rule 2: no scheduled fixture must still produce a real card
  await page.waitForSelector('#mx-next .match, #mx-next .note');
  await expect(page.locator('#mx-next')).not.toContainText('Checking fixtures');
  expect(errors).toEqual([]);
});

test('the slot meter counts clubs, players and extras together', async ({ page }) => {
  await seed(page,
    { clubs: ['atlanta-united', 'milwaukee-torrent'], players: [] },
    { picks: [{ t: 'league', id: 'npsl' }, { t: 'state', id: 'CA' }] });
  await gotoRoute(page, '#/myxi');
  await page.waitForSelector('.mx-count');
  await expect(page.locator('.mx-count')).toContainText('4 of 11 picked');
  await expect(page.locator('.mx-meter i.on')).toHaveCount(4);
  // extras render their own top-five snapshot, not just a link
  await expect(page.locator('#view')).toContainText('Your league');
  await expect(page.locator('#view')).toContainText('Your state');
});

test('a shared XI can be loaded on another device', async ({ page }) => {
  const errors = trackErrors(page);
  const payload = encodeURIComponent('c:atlanta-united,milwaukee-torrent|g:npsl');
  await page.goto('/app.html#/myxi/i/' + payload);
  await viewRendered(page);
  await page.waitForSelector('#mxload');
  await page.click('#mxload');
  await page.waitForSelector('.mx-clubs');
  await expect(page.locator('.mx-clubs li')).toHaveCount(2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pyr-favs')));
  expect(saved.clubs).toEqual(['atlanta-united', 'milwaukee-torrent']);
  expect(errors).toEqual([]);
});

test('an import payload cannot inject markup or unknown ids', async ({ page }) => {
  const payload = encodeURIComponent('c:<img src=x onerror=alert(1)>,not-a-real-club|g:npsl');
  await page.goto('/app.html#/myxi/i/' + payload);
  await viewRendered(page);
  await page.waitForSelector('#mxload');
  await page.click('#mxload');
  await page.waitForSelector('.mx-count');
  // the bogus club id is dropped; only the league survives
  await expect(page.locator('.mx-clubs')).toHaveCount(0);
  await expect(page.locator('.mx-count')).toContainText('1 of 11 picked');
});

test('"open My XI when I launch" only applies to a hashless launch', async ({ page }) => {
  await seed(page, { clubs: ['atlanta-united'], players: [] }, { home: true, picks: [] });
  // installed launch: start_url is /app, no hash
  await page.goto('/app.html');
  await viewRendered(page);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/myxi');
  // a shared or typed link always wins
  await page.goto('/app.html#/table');
  await viewRendered(page);
  expect(await page.evaluate(() => location.hash)).toBe('#/table');
});

test('the pyramid narrows towards the top', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoRoute(page, '#/tiers');
  await page.waitForSelector('.tier');
  const widths = await page.locator('.tier').evaluateAll(
    els => els.map(e => e.getBoundingClientRect().width));
  expect(widths.length).toBeGreaterThan(3);
  // Division I sits at the apex and must be the narrowest box on the page
  expect(widths[0]).toBeLessThan(widths[widths.length - 1]);
  expect(widths[0]).toBe(Math.min(...widths));
  expect(widths[widths.length - 1]).toBe(Math.max(...widths));
  expect(errors).toEqual([]);
});

test('picking from the top of the page does not move the page', async ({ page }) => {
  await seed(page, { clubs: ['atlanta-united'], players: [] });
  await gotoRoute(page, '#/myxi');
  await page.waitForSelector('#mxadd');
  // the picker sits above the content a pick would add, not below it
  const order = await page.evaluate(() => {
    const ids = ['mxadd', 'mx-move', 'mx-next'];
    return ids.map(id => {
      const el = document.getElementById(id);
      return el ? [...document.querySelector('#view').children].indexOf(el.closest('#view > *')) : -1;
    });
  });
  expect(order[0]).toBeLessThan(order[2]);
  // and toggling a chip re-renders in place instead of jumping to the top.
  // The click is dispatched rather than page.click'd on purpose: Playwright
  // scrolls a target into view before clicking, which would zero the scroll
  // itself and make this assert nothing.
  const kept = await page.evaluate(() => {
    const v = document.querySelector('#view');
    v.scrollTop = 240;
    if (!v.scrollTop) return 'page too short to scroll';
    document.querySelector('#mxadd [data-add="league"][data-id="npsl"]').click();
    return v.scrollTop;
  });
  expect(kept).toBe(240);
  await expect(page.locator('#mxadd [data-add="league"][data-id="npsl"]'))
    .toHaveAttribute('aria-pressed', 'true');
  // picking never goes through the router — the hash must not move
  expect(await page.evaluate(() => location.hash)).toBe('#/myxi');
  await expect(page.locator('#view')).toContainText('Your league');
});

test('My XI offers a route to following players', async ({ page }) => {
  await seed(page, { clubs: ['atlanta-united'], players: [] });
  await gotoRoute(page, '#/myxi');
  await page.waitForSelector('.mx-clubs');
  // with no players followed the section is an invitation, not an absence
  await expect(page.locator('#view')).toContainText('Your players');
  await page.click('#view a[href="#/table/players"]');
  await viewRendered(page);
  await expect(page.locator('[data-mode="players"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a followed player pins to My XI and the empty prompt goes away', async ({ page }) => {
  await gotoRoute(page, '#/table/players');
  await page.click('.clublist a[href^="#/player/"]');
  await viewRendered(page);
  await page.click('.favbtn[data-ft="players"]');
  await gotoRoute(page, '#/myxi');
  await page.waitForSelector('.mx-count');
  await expect(page.locator('#view')).toContainText('Your players · 1');
  await expect(page.locator('#view a[href="#/table/players"]')).toHaveCount(1); // picker link only
});

test('two picks of the same kind share one heading', async ({ page }) => {
  await seed(page, { clubs: [], players: [] }, { picks: [
    { t: 'league', id: 'npsl' }, { t: 'league', id: 'mls' },
    { t: 'nt', id: 'usmnt' }, { t: 'nt', id: 'uswnt' },
  ] });
  await gotoRoute(page, '#/myxi');
  await page.waitForSelector('.mx-count');
  const text = await page.locator('#view').innerText();
  const count = needle => text.split(needle).length - 1;
  expect(count('YOUR NATIONAL TEAM')).toBe(1);   // "Your national teams", once
  expect(count('YOUR LEAGUE')).toBe(1);
  await expect(page.locator('#view')).toContainText('Your leagues');
  await expect(page.locator('#view')).toContainText('Your national teams');
  // both picks still render their own card
  await expect(page.locator('#view a[href^="#/nt/"]')).toHaveCount(2);
  await expect(page.locator('#view a[href^="#/league/"]')).toHaveCount(2);
});
