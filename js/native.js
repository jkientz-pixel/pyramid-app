/* Native-shell bridge (Capacitor, ~/rankedxi-ios).

   The iOS app is a WKWebView pointed at this same site, with Capacitor's
   bridge injected before any page script runs. That leaves `window.Capacitor`
   on the page and native plugins reachable through `Capacitor.Plugins.*`
   without importing @capacitor/core here — this file must stay a plain
   module with no build step, like everything else in js/.

   Everything is feature-detected. On the web (Safari tab, installed PWA,
   Android TWA) every call here falls through to the web behaviour, so this
   module is safe to import unconditionally. */

const cap = () => (typeof window !== 'undefined' && window.Capacitor) || null;

export const isNative = () => {
  try { return !!cap()?.isNativePlatform?.(); } catch { return false; }
};

const plugin = name => {
  const c = cap();
  return c && c.Plugins && c.Plugins[name] ? c.Plugins[name] : null;
};

/* Share a link. Resolves true when a share UI handled it (including the
   visitor dismissing the sheet — that is not a failure) and false when no
   share affordance exists and the caller should fall back to the clipboard. */
export async function share({ title, url }) {
  const Share = isNative() && plugin('Share');
  if (Share) {
    try { await Share.share({ title, url }); } catch { /* sheet dismissed */ }
    return true;
  }
  if (navigator.share) {
    try { await navigator.share({ title, url }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return true; }
  }
  return false;
}

/* Light haptic tick for confirmations (follow, pick). No-op on the web. */
export async function tap() {
  const H = isNative() && plugin('Haptics');
  if (H) { try { await H.impact({ style: 'LIGHT' }); } catch { /* optional */ } }
}

/* APNs registration through the Capacitor PushNotifications plugin. The
   token is an opaque device handle minted by Apple; it identifies an app
   install, not a person — same footing as a web-push endpoint. */
const TOKEN_KEY = 'rxi-apns';

export const nativePush = {
  available: () => isNative() && !!plugin('PushNotifications'),

  token: () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },

  async permission() {
    const P = plugin('PushNotifications');
    try { return (await P.checkPermissions()).receive; } catch { return 'prompt'; }
  },

  /* Must run inside a user gesture, like the web prompt. Resolves the token. */
  async register() {
    const P = plugin('PushNotifications');
    const perm = await P.requestPermissions();
    if (perm.receive !== 'granted') throw new Error('permission ' + perm.receive);
    const token = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('apns timeout')), 15000);
      P.addListener('registration', r => { clearTimeout(t); resolve(r.value); });
      P.addListener('registrationError', e => { clearTimeout(t); reject(new Error(e?.error || 'apns')); });
      P.register().catch(reject);
    });
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* still registered */ }
    return token;
  },

  async unregister() {
    const P = plugin('PushNotifications');
    try { await P.unregister(); } catch { /* best effort */ }
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* fine */ }
  },
};
