/* Match-alert push subscriptions, client side.

   Loaded lazily from My XI like account.js is — a visitor who never touches
   alerts never pays for this code. The flow:

     enable()  — permission prompt (must be inside the tap handler: iOS
                 refuses a request that isn't a user gesture), subscribe via
                 the service worker, POST the subscription + followed clubs
                 to /api/push.
     disable() — unsubscribe locally AND delete the row. Off means gone.
     sync()    — re-POST the current club list if already subscribed, so the
                 server tracks follows without any per-follow traffic. Called
                 from My XI's render; subscribers land there every visit.

   iOS reality this code leans on: web push exists only for a PWA launched
   from the home screen (16.4+). In a Safari tab PushManager is simply absent,
   so support() reports 'install' and the UI points at Add to Home Screen
   instead of showing a button that cannot work. */

/* VAPID public key — pairs with ~/.config/rankxi/vapid_private.pem on the
   sending side. Public by design: every subscriber's browser hands it to the
   push service so only our sender can use the subscription. */
import { nativePush } from './native.js?v=__RXIV__';

const VAPID_PUBLIC =
  'BBA0wcgG7nP2Ph6dIAqVEdEQDVaYuxRf40N1JH2Da-5xT2Fba6flVkS4Bc6IJMiNCC7v1t-temcGbB9ZDTNpm3A';

const b64ToBytes = s => {
  const raw = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

const standalone = () => {
  try {
    return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ||
           navigator.standalone === true;
  } catch { return false; }
};

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
              (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document);

const reg = () => navigator.serviceWorker.ready;

/* Native iOS app: APNs through the Capacitor plugin instead of web push.
   The server row uses the pseudo-endpoint apns://<token> so the same
   /api/push table and DELETE path serve both channels. */
const native = () => nativePush.available();
const apnsEndpoint = t => 'apns://' + t;

/* 'ok' | 'on' | 'denied' | 'install' | 'no' */
export async function support() {
  if (native()) {
    if ((await nativePush.permission()) === 'denied') return 'denied';
    return nativePush.token() ? 'on' : 'ok';
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS && !standalone() ? 'install' : 'no';
  }
  if (Notification.permission === 'denied') return 'denied';
  try {
    const sub = await (await reg()).pushManager.getSubscription();
    return sub ? 'on' : 'ok';
  } catch { return 'no'; }
}

async function post(sub, clubs) {
  const r = await fetch('/api/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub.apns ? { apns: sub.apns, clubs } : { sub: sub.toJSON(), clubs }),
  });
  if (!r.ok) throw new Error('push register failed');
}

export async function enable(clubs) {
  if (native()) {
    const token = await nativePush.register();
    await post({ apns: token }, clubs);
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('permission ' + perm);
  const sub = await (await reg()).pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64ToBytes(VAPID_PUBLIC),
  });
  await post(sub, clubs);
}

export async function disable() {
  if (native()) {
    const token = nativePush.token();
    if (token) {
      try {
        await fetch('/api/push', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: apnsEndpoint(token) }),
        });
      } catch { /* reaped at send time */ }
    }
    await nativePush.unregister();
    return;
  }
  const sub = await (await reg()).pushManager.getSubscription();
  if (!sub) return;
  /* Best effort on the server row: if the DELETE is lost the sender will
     hit a dead endpoint, get a 410, and reap it — same end state. */
  try {
    await fetch('/api/push', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch { /* reaped at send time */ }
  await sub.unsubscribe();
}

export async function sync(clubs) {
  if (native()) {
    const token = nativePush.token();
    if (token) { try { await post({ apns: token }, clubs); } catch { /* next visit */ } }
    return;
  }
  try {
    const sub = await (await reg()).pushManager.getSubscription();
    if (sub) await post(sub, clubs);
  } catch { /* next visit syncs */ }
}
