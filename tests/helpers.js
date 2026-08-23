/* Shared test helpers: console/page error tracking and view-render waits. */

/** Collect page errors and console errors for later assertion. */
function trackErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('response', r => {
    if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  return errors;
}

/** Wait until the SPA router has rendered something into #view. */
async function viewRendered(page) {
  await page.waitForFunction(() => {
    const v = document.querySelector('#view');
    return v && v.children.length > 0;
  });
}

/** Navigate to an app hash route and wait for the view to render. */
async function gotoRoute(page, hash) {
  await page.goto(`/app.html${hash}`);
  await viewRendered(page);
}

/* There is one map now: the detailed Leaflet one. The illustrated SVG survives
   only as the no-network fallback, with no control that reaches it, so tests
   that exercise it — its viewBox framing, its pan clamp, its zoom controls —
   ask for the offline path with ?nobasemap=1. That is also the only coverage
   the fallback itself gets, which is the point: it has to keep working for the
   offline PWA even though nobody can choose it. */
async function gotoIllustrated(page, hash) {
  await page.goto(`/app.html?nobasemap=1${hash}`);
  await viewRendered(page);
  await page.waitForSelector('svg.usmap', { state: 'visible' });
}

module.exports = { trackErrors, viewRendered, gotoRoute, gotoIllustrated };
