// @ts-check
/* The landing page must link into the generated tree.
   On 2026-08-20 Search Console reported /club/atlanta-united as "URL is unknown
   to Google — referring page: none detected". The homepage was indexed and
   linked only to /app, /methodology and /privacy, so all 3,336 generated pages
   were unreachable by any crawler that started at the front door. These tests
   guard the entry point, not the tree — the tree links to itself fine. */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const index = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** Every hub link the browse block emits. */
function hubLinks() {
  const html = index();
  const start = html.indexOf('<!-- browse:start -->');
  const end = html.indexOf('<!-- browse:end -->');
  expect(start, 'browse block markers must exist in index.html').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = html.slice(start, end);
  return [...block.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
}

test('the landing page links into the generated tree', () => {
  const links = hubLinks();
  const leagues = links.filter(h => h.startsWith('/league/') || h.endsWith('-rankings'));
  const states = links.filter(h => h.startsWith('/state/'));
  expect(leagues.length, 'league hubs linked from the homepage').toBeGreaterThan(15);
  expect(states.length, 'state hubs linked from the homepage').toBeGreaterThan(45);
});

test('every browse link points at a page that was actually generated', () => {
  for (const href of hubLinks()) {
    const file = path.join(ROOT, `${href}.html`);
    expect(fs.existsSync(file), `${href} has no generated file`).toBe(true);
  }
});

test('every browse link is also in the sitemap', () => {
  // sitemap.xml is an index; the page URLs live in the children it names, so
  // the whole set has to be concatenated before anything can be looked up
  const index = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const children = [...index.matchAll(/<loc>https:\/\/www\.rankedxi\.com\/(sitemap-[^<]*)<\/loc>/g)]
    .map(m => m[1]);
  expect(children.length, 'sitemap.xml should be an index of child sitemaps').toBeGreaterThan(2);
  const sitemap = children.map(c => fs.readFileSync(path.join(ROOT, c), 'utf8')).join('');
  for (const href of hubLinks()) {
    expect(sitemap, `${href} missing from sitemap`).toContain(`<loc>https://www.rankedxi.com${href}</loc>`);
  }
});

test('the browse links are real anchors, not script-driven', async ({ page }) => {
  // A crawler follows href attributes. Anything that needs a click handler to
  // resolve is invisible to it, which is how the tree got orphaned in the
  // first place — the app's own navigation is all hash routes.
  await page.goto('/index.html');
  const hrefs = await page.locator('nav.browse a').evaluateAll(
    els => els.map(e => e.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(60);
  for (const h of hrefs) {
    expect(h, 'browse links must be crawlable paths, not fragments').toMatch(/^\/[a-z]/);
    expect(h).not.toContain('#');
  }
});
