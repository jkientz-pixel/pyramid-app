// @ts-check
/* The static long-tail surface: club/, league/ and state/ pages plus the
   sitemap that points at them. These pages ARE the search channel — the SPA's
   hash routes are invisible to crawlers — so a silent regression here costs
   the whole distribution model, and nothing else in the suite touches them. */
const { test, expect } = require('@playwright/test');

const locs = xml =>
  [...xml.matchAll(/<loc>https:\/\/www\.rankedxi\.com([^<]*)<\/loc>/g)].map(m => m[1]);

/** Every page <loc> in the deployed sitemap, path-only.
    sitemap.xml is a sitemap *index*: its own <loc>s name child sitemaps, and
    the pages live one level down. Reading only the index found zero pages and
    passed the "no .html in the sitemap" checks vacuously, so this follows it. */
async function sitemapPaths(request) {
  const index = await (await request.get('/sitemap.xml')).text();
  const children = locs(index);
  expect(children.length, 'sitemap.xml should be an index of child sitemaps').toBeGreaterThan(2);
  const paths = [];
  for (const child of children) {
    const r = await request.get(child);
    expect(r.ok(), `${child} listed in the index but not served`).toBe(true);
    paths.push(...locs(await r.text()));
  }
  return paths;
}

test('sitemap lists league and state pages, not just clubs', async ({ request }) => {
  const paths = await sitemapPaths(request);
  expect(paths.filter(p => p.startsWith('/league/')).length).toBeGreaterThan(10);
  expect(paths.filter(p => p.startsWith('/state/')).length).toBeGreaterThan(40);
  expect(paths.filter(p => p.startsWith('/club/')).length).toBeGreaterThan(3000);
});

test('no sitemap URL is a .html form that would redirect', async ({ request }) => {
  const paths = await sitemapPaths(request);
  expect(paths.filter(p => p.endsWith('.html'))).toEqual([]);
});

test('every sitemapped league and state page exists on disk', async ({ request }) => {
  const paths = await sitemapPaths(request);
  const hubs = paths.filter(p => p.startsWith('/league/') || p.startsWith('/state/'));
  const missing = [];
  for (const p of hubs) {
    const r = await request.get(`${p}.html`);
    if (!r.ok()) missing.push(`${p} -> ${r.status()}`);
  }
  expect(missing).toEqual([]);
});

for (const [path, mustSay] of [['/league/usl2.html', 'USL League Two'],
                               ['/state/ca.html', 'California']]) {
  test(`${path} is a real indexable page`, async ({ page }) => {
    await page.goto(path);
    // canonical must be the extensionless form; a .html canonical routes every
    // crawler through a 308 and splits the ranking signal (external audit #5)
    const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
    expect(canonical).toBe(`https://www.rankedxi.com${path.replace(/\.html$/, '')}`);
    await expect(page).toHaveTitle(new RegExp(mustSay));
    expect(await page.locator('meta[name=description]').getAttribute('content'))
      .toContain(mustSay);
    // one script tag holding an @graph, so @id references resolve in-document;
    // the ItemList is a node inside it rather than the root object
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText());
    const list = ld['@graph'].find(n => n['@type'] === 'ItemList');
    expect(list, 'the hub must publish an ItemList node').toBeTruthy();
    expect(list.itemListElement.length).toBeGreaterThan(5);
    // the table has to actually link out to club pages, or the hub passes
    // no authority to the leaves and the whole point is lost
    expect(await page.locator('table a[href^="/club/"]').count()).toBeGreaterThan(5);
  });
}

test('a club page links back up to its league and its state', async ({ page }) => {
  await page.goto('/club/vermont-green-fc.html');
  await expect(page.locator('a[href="/league/usl2"]').first()).toBeVisible();
  // the hub is linked from the header crumb, the table caption and the footer
  await expect(page.locator('a[href="/state/vt"]').first()).toBeVisible();
});

test('UPSL and NPSL hubs point at their hand-built landing pages, not duplicates', async ({ request }) => {
  // gen_seo_pages.py owns these two; an auto-generated /league/upsl would
  // compete with /upsl-rankings for the same query
  expect((await request.get('/league/upsl.html')).status()).toBe(404);
  expect((await request.get('/league/npsl.html')).status()).toBe(404);
  const ca = await (await request.get('/state/ca.html')).text();
  expect(ca).toContain('href="/upsl-rankings"');
});
