/* #/claim/<club> — claim a club page, then fill in its data.

   Three faces, decided by /api/claim on every visit:

     1. not signed in   -> sign in with the club email (same passwordless code
                            flow as My XI; account.js owns the state machine)
     2. signed in, no verified claim
                        -> the claim form (who are you at the club), or the
                            "under review" notice once one is filed
     3. verified        -> the intake form: the data points we require first,
                            then every extra the club wants to give us, and a
                            crest upload that must be clean and large.

   The screen is deliberately honest about the gate. If the signed-in email
   is on the club's own domain we say the claim will verify instantly; if it
   is gmail we say a person will look at it. Nobody should file a claim and
   wonder why nothing happened.

   Loaded on demand from app.js (import('./claim.js?v=__RXIV__')): most
   visitors never claim a club, and the form markup is long. Listed in
   preflight CB_FILES because it imports account.js with a version token. */

import { accountState, onAccountChange, bootAccount, requestCode, verifyCode, signOut } from './account.js?v=__RXIV__';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const ROLES = [
  ['owner', 'Owner'], ['president', 'President / board'], ['gm', 'General manager / director'],
  ['coach', 'Head coach / technical staff'], ['media', 'Media / communications'],
  ['staff', 'Other club staff'], ['other', 'Other'],
];

/* The intake form, as data. Each group renders as a fieldset; `req` groups
   sit above the fold and the rest open on demand. Names match the server
   whitelist in functions/api/club-profile.js exactly — a field added here
   without a matching entry there is silently dropped, which is the safe
   failure but still a wasted question. */
const GROUPS = [
  { key: 'core', title: 'The essentials', req: true, fields: [
    { n: 'website', l: 'Official website', t: 'url', req: true, ph: 'https://', hint: 'The club’s own site. Social pages go further down.' },
    { n: 'contactEmail', l: 'Club contact email', t: 'email', req: true, hint: 'Public-facing, not personal. Shown to nobody without your say.' },
    { n: 'venueName', l: 'Home ground', t: 'text', req: true, ph: 'Stadium or field name' },
    { n: 'venueAddress', l: 'Street address', t: 'text', ph: 'Number and street' },
    { n: 'venueCity', l: 'City', t: 'text', req: true, half: true },
    { n: 'venueState', l: 'State', t: 'text', req: true, half: true, ph: 'CA' },
    { n: 'venueZip', l: 'ZIP', t: 'text', half: true },
    { n: 'surface', l: 'Playing surface', t: 'select', req: true, half: true, opts: [['grass', 'Natural grass'], ['turf', 'Artificial turf'], ['hybrid', 'Hybrid']] },
    { n: 'capacity', l: 'Capacity (seats + standing)', t: 'number', req: true, half: true, ph: '2500' },
  ] },
  { key: 'identity', title: 'Identity', fields: [
    { n: 'nickname', l: 'Nickname', t: 'text', half: true, ph: 'The Hoops' },
    { n: 'founded', l: 'Founded (year)', t: 'number', half: true, ph: '2014' },
    { n: 'color1', l: 'Primary colour', t: 'color', half: true },
    { n: 'color2', l: 'Secondary colour', t: 'color', half: true },
    { n: 'kitSupplier', l: 'Kit supplier', t: 'text', half: true, ph: 'Adidas, Capelli…' },
    { n: 'affiliation', l: 'Affiliated / parent club', t: 'text', half: true },
    { n: 'reserveTeams', l: 'Reserve, academy or women’s sides', t: 'text', ph: 'Names and leagues, comma separated' },
  ] },
  { key: 'people', title: 'People', fields: [
    { n: 'headCoach', l: 'Head coach', t: 'text', half: true },
    { n: 'president', l: 'President / owner', t: 'text', half: true },
    { n: 'gm', l: 'General manager', t: 'text', half: true },
    { n: 'contactPhone', l: 'Club phone', t: 'tel', half: true },
    { n: 'mediaContact', l: 'Media contact email', t: 'email' },
  ] },
  { key: 'venue', title: 'More about the ground', fields: [
    { n: 'venueSeating', l: 'Seating', t: 'select', half: true, opts: [['stadium', 'Stadium seating'], ['bleachers', 'Bleachers'], ['standing', 'Standing only'], ['mixed', 'Mixed'], ['none', 'None']] },
    { n: 'venueLights', l: 'Floodlights', t: 'select', half: true, opts: [['yes', 'Yes'], ['no', 'No']] },
    { n: 'venueOwnership', l: 'The ground is', t: 'select', half: true, opts: [['own', 'Club-owned'], ['lease', 'Leased'], ['municipal', 'Municipal / park'], ['school', 'School or college'], ['shared', 'Shared with another club']] },
    { n: 'avgAttendance', l: 'Average attendance', t: 'number', half: true },
    { n: 'ticketPriceMin', l: 'Cheapest ticket ($)', t: 'number', half: true },
    { n: 'ticketPriceMax', l: 'Dearest ticket ($)', t: 'number', half: true },
    { n: 'venueParking', l: 'Parking', t: 'text', ph: 'Free lot on site, street only, $10…' },
    { n: 'seasonStart', l: 'Season runs', t: 'text', half: true, ph: 'May–July' },
  ] },
  { key: 'links', title: 'Links', fields: [
    { n: 'instagram', l: 'Instagram', t: 'url', half: true, ph: 'https://instagram.com/…' },
    { n: 'x', l: 'X / Twitter', t: 'url', half: true, ph: 'https://x.com/…' },
    { n: 'facebook', l: 'Facebook', t: 'url', half: true },
    { n: 'tiktok', l: 'TikTok', t: 'url', half: true },
    { n: 'youtube', l: 'YouTube', t: 'url', half: true },
    { n: 'ticketsUrl', l: 'Tickets', t: 'url', half: true },
    { n: 'streamingUrl', l: 'Match streams', t: 'url', half: true },
    { n: 'scheduleUrl', l: 'Schedule', t: 'url', half: true },
    { n: 'rosterUrl', l: 'Roster', t: 'url', half: true },
    { n: 'tryoutsUrl', l: 'Tryouts', t: 'url', half: true },
    { n: 'shopUrl', l: 'Shop', t: 'url', half: true },
  ] },
  { key: 'notes', title: 'Anything else', fields: [
    { n: 'notes', l: 'Notes for the reviewer', t: 'textarea', ph: 'Corrections to the page, history, what we got wrong…' },
  ] },
];

const LOGO_MIN_PX = 512;
const LOGO_MAX_KB = 700;

let root, crumb, club, api = null, unsub = null;

const fetchJson = async (url, opts = {}) => {
  const r = await fetch(url, { credentials: 'same-origin', ...opts });
  let d = {};
  try { d = await r.json(); } catch { /* non-JSON error page */ }
  return { status: r.status, ok: r.ok, ...d };
};

/* ---- entry -------------------------------------------------------------- */

export async function screenClaim({ club: c, view, crumb: cr }) {
  root = view; crumb = cr; club = c;
  crumb.textContent = 'Claim ' + club.n;
  if (unsub) { unsub(); unsub = null; }
  root.innerHTML = shell('<p class="note">Checking your claim…</p>');
  await bootAccount();
  await refresh();
}

async function refresh() {
  try { api = await fetchJson('/api/claim?club=' + encodeURIComponent(club.id)); }
  catch { api = { ok: false, error: 'offline' }; }
  if (!api.ok) {
    root.innerHTML = shell(`<p class="note">${api.status === 404 ? 'This club cannot be claimed.' : 'Could not reach the server — check your connection and try again.'}</p>`);
    return;
  }
  if (!api.signedIn) renderSignIn();
  else if (!api.claim) renderClaimForm();
  else if (api.claim.status === 'verified') await renderIntake();
  else renderClaimState();
}

const shell = inner => `<div class="about claimscr">
  <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/club/${esc(club.id)}'">&larr; ${esc(club.n)}</button>
  <div class="kicker">Claim your club</div>
  <h2 class="disp">${esc(club.n)}</h2>
  ${inner}</div>`;

const domainLine = () => club.url
  ? `<p class="note">Sign in with an address on <b>${esc(api.club.domain || hostOf(club.url))}</b> and the claim verifies instantly. Any other address goes to a person to check — usually within a couple of days.</p>`
  : `<p class="note">We don’t have a website on file for this club, so a person will check every claim — usually within a couple of days. Add the site in the form and next time it’s instant.</p>`;

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/* ---- face 1: sign in ---------------------------------------------------- */

function renderSignIn() {
  const st = accountState();
  const email = st.step === 'code';
  root.innerHTML = shell(`
    <p>Run this club? Claim the page and you can give us the data the map can’t find on its own — a clean crest, the ground, the surface, the capacity, your links.</p>
    ${domainLine()}
    <form class="joinform claimauth" novalidate>
      ${email
        ? `<p class="note">We sent a six-digit code to <b>${esc(st.codeEmail)}</b>.</p>
           <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" required>
           <button type="submit" class="joinbtn">Verify</button>
           <button type="button" class="linkbtn" data-act="back">Use a different email</button>`
        : `<input name="email" type="email" autocomplete="email" placeholder="you@yourclub.org" required>
           <label class="chk"><input type="checkbox" name="age13" required> I’m 13 or older</label>
           <button type="submit" class="joinbtn">Email me a code</button>`}
      <p class="note claim-msg" aria-live="polite"></p>
    </form>`);
  const f = root.querySelector('form');
  const msg = f.querySelector('.claim-msg');
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = f.querySelector('.joinbtn');
    btn.disabled = true;
    const d = email ? await verifyCode(f.code.value) : await requestCode(f.email.value, f.age13.checked);
    btn.disabled = false;
    if (!d.ok) { msg.textContent = d.error || 'Something went wrong.'; return; }
    if (email) await refresh(); else renderSignIn();
  });
  const back = f.querySelector('[data-act=back]');
  if (back) back.addEventListener('click', () => { signOutStep(); renderSignIn(); });
}
/* leaving the code step without a verified code: account.js keeps codeEmail
   until cancel, so drop it explicitly */
function signOutStep() { import('./account.js?v=__RXIV__').then(m => m.cancelSignIn()); }

/* ---- face 2: the claim -------------------------------------------------- */

function whoLine() {
  return `<p class="note">Signed in as <b>${esc(api.email)}</b> &middot; <button type="button" class="linkbtn" data-act="signout">not you?</button></p>`;
}

function renderClaimForm() {
  const instant = api.selfVerifies;
  root.innerHTML = shell(`
    ${whoLine()}
    ${instant
      ? `<p class="claim-ok">&#10003; <b>${esc(api.emailDomain)}</b> is this club’s domain — your claim will verify instantly.</p>`
      : api.freeMail
        ? `<p class="claim-warn">${esc(api.emailDomain)} is a personal email provider, so a person will check this claim before the form opens. ${api.club.domain ? `Have an address on <b>${esc(api.club.domain)}</b>? Sign out and use that instead — it’s instant.` : ''}</p>`
        : `<p class="claim-warn">${esc(api.emailDomain)} isn’t the domain we have for this club${api.club.domain ? ` (<b>${esc(api.club.domain)}</b>)` : ''}, so a person will check this claim before the form opens.</p>`}
    <form class="claimform" novalidate>
      <label>Your name<input name="repName" maxlength="80" autocomplete="name" required></label>
      <label>Your role at the club<select name="repRole" required><option value="">Choose…</option>${ROLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label>Anything that helps us confirm it’s you <span class="opt">(optional)</span><textarea name="note" rows="3" maxlength="500" placeholder="A page on the club site that lists you, a league contact, your title…"></textarea></label>
      <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
      <button type="submit" class="joinbtn">${instant ? 'Claim and open the form' : 'File the claim'}</button>
      <p class="note claim-msg" aria-live="polite"></p>
    </form>
    <p class="note">Claiming records your name, role and email against this club so a person can act on what you send. Nothing you submit publishes on its own.</p>`);
  wireSignOut();
  const f = root.querySelector('form.claimform');
  const msg = f.querySelector('.claim-msg');
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!f.repName.value.trim()) { msg.textContent = 'Your name is required.'; return; }
    if (!f.repRole.value) { msg.textContent = 'Pick your role at the club.'; return; }
    const btn = f.querySelector('.joinbtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    let d;
    try {
      d = await fetchJson('/api/claim', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ club: club.id, repName: f.repName.value, repRole: f.repRole.value, note: f.note.value, website: f.website.value }) });
    } catch { d = { ok: false, error: 'Could not reach the server — check your connection.' }; }
    if (!d.ok) { btn.disabled = false; btn.textContent = 'File the claim'; msg.textContent = d.error || 'Something went wrong.'; return; }
    await refresh();
  });
}

function renderClaimState() {
  const s = api.claim.status;
  root.innerHTML = shell(`
    ${whoLine()}
    ${s === 'pending'
      ? `<p class="claim-warn"><b>Claim filed, under review.</b> A person checks every claim that isn’t on the club’s own domain. We’ll email <b>${esc(api.email)}</b> when the form opens — usually within a couple of days.</p>
         ${api.club.domain ? `<p class="note">Faster: sign out and sign back in with an address on <b>${esc(api.club.domain)}</b>. That verifies on the spot.</p>` : ''}
         <p class="note">Filed ${new Date(api.claim.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} as ${esc(api.claim.repName)} (${esc(api.claim.repRole)}). Questions: <a href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('Club claim: ' + club.n)}">hello@rankedxi.com</a>.</p>`
      : `<p class="claim-warn"><b>This claim was not approved.</b> If you think that’s wrong, email <a href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('Club claim: ' + club.n)}">hello@rankedxi.com</a> from a club address.</p>`}`);
  wireSignOut();
}

function wireSignOut() {
  const b = root.querySelector('[data-act=signout]');
  if (b) b.addEventListener('click', async () => { await signOut(); await refresh(); });
}

/* ---- face 3: the intake form ------------------------------------------- */

function fieldHtml(f, val) {
  const v = val == null ? '' : String(val);
  const req = f.req ? ' required' : '';
  const label = `${esc(f.l)}${f.req ? ' <span class="req">*</span>' : ''}`;
  let input;
  if (f.t === 'select') {
    input = `<select name="${f.n}"${req}><option value="">${f.req ? 'Choose…' : '—'}</option>${f.opts.map(([o, l]) => `<option value="${o}"${o === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  } else if (f.t === 'textarea') {
    input = `<textarea name="${f.n}" rows="4" maxlength="2000" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  } else if (f.t === 'color') {
    input = `<span class="colorwrap"><input type="color" name="${f.n}" value="${/^#[0-9a-f]{6}$/i.test(v) ? esc(v) : '#000000'}" data-empty="${v ? '' : '1'}"><button type="button" class="linkbtn" data-clear="${f.n}">clear</button></span>`;
  } else {
    input = `<input type="${f.t}" name="${f.n}" value="${esc(v)}" placeholder="${esc(f.ph || '')}"${req}${f.t === 'number' ? ' inputmode="numeric" min="0"' : ''}>`;
  }
  return `<label class="${f.half ? 'half' : ''}"><span>${label}</span>${input}${f.hint ? `<small>${f.hint}</small>` : ''}</label>`;
}

/* what we already know, so the club corrects rather than retypes */
function seed() {
  return {
    website: club.url || '', venueCity: club.ct || '', venueState: club.st || '',
    capacity: club.cap || '', instagram: club.si || '', x: club.sx || '', facebook: club.sf || '',
  };
}

async function renderIntake() {
  let prev = null;
  try { const d = await fetchJson('/api/club-profile?club=' + encodeURIComponent(club.id)); if (d.ok) prev = d.submission; } catch { /* prefill is a courtesy */ }
  const vals = { ...seed(), ...(prev ? prev.payload : {}) };

  root.innerHTML = shell(`
    ${whoLine()}
    <p class="claim-ok">&#10003; <b>Verified.</b> You can update ${esc(club.n)}’s page. Fill in the essentials, then open any of the extra sections — every data point you add goes on the record.</p>
    ${prev ? `<p class="note">Last submitted ${new Date(prev.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${prev.applied ? ' and applied to the page' : ' — waiting to be applied'}. Sending again replaces it.</p>` : ''}
    <form class="intake" enctype="multipart/form-data" novalidate>
      <fieldset class="logo-fs">
        <legend>Crest <span class="req">*</span></legend>
        <div class="logodrop">
          <div class="logoprev">${club.img ? `<img src="${esc(club.img)}" alt="" class="current">` : ''}<img alt="" class="incoming" hidden></div>
          <div>
            <p><b>Upload the clean, full-size crest.</b> PNG with a transparent background (at least ${LOGO_MIN_PX}px on each side) or an SVG. Under ${LOGO_MAX_KB} KB. No screenshots, no white boxes, no favicons.</p>
            <input type="file" name="logo" accept="image/png,image/svg+xml,image/jpeg" required>
            <p class="note logo-msg" aria-live="polite"></p>
          </div>
        </div>
      </fieldset>
      ${GROUPS.map(g => g.req
        ? `<fieldset><legend>${g.title}</legend><div class="fgrid">${g.fields.map(f => fieldHtml(f, vals[f.n])).join('')}</div></fieldset>`
        : `<details class="fgroup"${g.fields.some(f => vals[f.n]) ? ' open' : ''}><summary>${g.title} <span class="opt">optional</span></summary><div class="fgrid">${g.fields.map(f => fieldHtml(f, vals[f.n])).join('')}</div></details>`
      ).join('')}
      <input type="hidden" name="club" value="${esc(club.id)}">
      <input name="website_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
      <p class="note">A person reviews every submission before anything changes on the page. The crest and the data are kept in full on our side either way.</p>
      <button type="submit" class="joinbtn">Send it in</button>
      <p class="note claim-msg" aria-live="polite"></p>
    </form>`);
  wireSignOut();
  wireIntake(root.querySelector('form.intake'));
}

function wireIntake(f) {
  const msg = f.querySelector('.claim-msg');
  const logoMsg = f.querySelector('.logo-msg');
  const incoming = f.querySelector('img.incoming');
  const current = f.querySelector('img.current');
  let logoOk = false;

  f.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => {
    const inp = f.querySelector(`input[name=${b.dataset.clear}]`);
    inp.value = '#000000'; inp.dataset.empty = '1';
  }));
  f.querySelectorAll('input[type=color]').forEach(i => i.addEventListener('input', () => { i.dataset.empty = ''; }));

  f.logo.addEventListener('change', () => {
    logoOk = false;
    const file = f.logo.files[0];
    if (!file) { incoming.hidden = true; if (current) current.hidden = false; logoMsg.textContent = ''; return; }
    if (file.size > LOGO_MAX_KB * 1024) { logoMsg.textContent = `Too big (${Math.round(file.size / 1024)} KB). Keep it under ${LOGO_MAX_KB} KB.`; return; }
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      const isSvg = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
      if (!isSvg && (probe.naturalWidth < LOGO_MIN_PX || probe.naturalHeight < LOGO_MIN_PX)) {
        logoMsg.textContent = `${probe.naturalWidth}×${probe.naturalHeight}px is too small — at least ${LOGO_MIN_PX}px on each side, please.`;
        incoming.hidden = true; return;
      }
      logoOk = true;
      logoMsg.textContent = isSvg ? `SVG ✓` : `${probe.naturalWidth}×${probe.naturalHeight}px ✓`;
      incoming.src = url; incoming.hidden = false; if (current) current.hidden = true;
    };
    probe.onerror = () => { logoMsg.textContent = 'That file isn’t an image we can read.'; incoming.hidden = true; };
    probe.src = url;
  });

  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    msg.textContent = '';
    if (!f.logo.files[0]) { msg.textContent = 'The crest is required.'; f.logo.focus(); return; }
    if (!logoOk) { msg.textContent = logoMsg.textContent || 'The crest didn’t pass the size check.'; return; }
    const missing = [...f.querySelectorAll('[required]')].find(i => i.name !== 'logo' && !String(i.value).trim());
    if (missing) { msg.textContent = 'Fill in the essentials marked * first.'; missing.focus(); return; }

    const fd = new FormData(f);
    /* an untouched colour input still posts #000000; drop it unless chosen */
    f.querySelectorAll('input[type=color]').forEach(i => { if (i.dataset.empty) fd.delete(i.name); });
    const btn = f.querySelector('.joinbtn');
    btn.disabled = true; btn.textContent = 'Sending…';
    let d;
    try {
      const r = await fetch('/api/club-profile', { method: 'POST', body: fd, credentials: 'same-origin' });
      d = await r.json();
    } catch { d = { ok: false, error: 'Could not reach the server — check your connection.' }; }
    if (!d.ok) { btn.disabled = false; btn.textContent = 'Send it in'; msg.textContent = d.error || 'Something went wrong.'; return; }
    root.innerHTML = shell(`
      <p class="claim-ok"><b>&#10003; Got it — thank you.</b> ${d.fields} data points and a ${d.logo && d.logo.w ? `${d.logo.w}×${d.logo.h}px` : 'vector'} crest are on the record for ${esc(club.n)}. A person reviews it and the page updates, usually within a few days.</p>
      <div class="linkrow"><a href="#/club/${esc(club.id)}"><b>Back to the club page</b></a><a href="#/claim/${esc(club.id)}">Send an update</a></div>`);
    root.scrollTop = 0;
  });
}
