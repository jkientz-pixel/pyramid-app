// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

/* Instagram, Facebook and iMessage cache a link preview by image URL, so a
   share card re-rendered at the same URL keeps showing a stale rating. A club
   page's og:image therefore carries the card's content signature. The cards
   come from gen_og_cards.py, which needs Pillow; CI has none, the page falls
   back to the site-wide banner there, and this test has nothing to check. */
const cards = path.join(__dirname, '..', 'og', '.cards.json');

test('a club page versions its share-card URL by content signature', async ({ page }) => {
  test.skip(!fs.existsSync(cards), 'no share cards in this checkout (gen_og_cards.py needs Pillow)');
  const sig = JSON.parse(fs.readFileSync(cards, 'utf8'))['vermont-green-fc'];
  expect(sig).toMatch(/^[0-9a-f]{32}$/);
  await page.goto('/club/vermont-green-fc.html');
  const img = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(img).toMatch(new RegExp(`/og/vermont-green-fc\\.jpg\\?v=${sig.slice(0, 10)}$`));
  expect(await page.locator('meta[name="twitter:image"]').getAttribute('content')).toBe(img);
});
