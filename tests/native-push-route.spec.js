const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

/* The iOS notification tap handler must follow only our own app routes. */
test('a push payload url maps to an app route, and nothing else does', async () => {
  const { routeFromPush } = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'native.js')).href);
  expect(routeFromPush('/app#/myxi')).toBe('#/myxi');
  expect(routeFromPush('/app')).toBe('#/');
  expect(routeFromPush('https://evil.example/app#/myxi')).toBeNull();
  expect(routeFromPush('/app#/x"><script>')).toBeNull();
  expect(routeFromPush(undefined)).toBeNull();
});
