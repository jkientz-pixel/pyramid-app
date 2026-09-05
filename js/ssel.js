/* Searchable selects — a progressive enhancement over every native <select>
   in the app that has enough options to be worth searching.

   The native <select> stays in the DOM as the source of truth: every screen
   keeps reading `.value` and listening for `change`, tests keep driving it
   with selectOption, forms keep submitting it. What changes is the control the
   user touches — a button that opens a filterable list — and the select is
   parked visually (1px, transparent, not focusable) rather than removed.

   Nothing else has to opt in. A document-level observer enhances any select
   that appears or grows past MIN_OPTIONS; `data-nosearch` on a select opts it
   out. Short lists (a 4-way "competition" picker, a yes/no) stay native, where
   a search box would be clutter. */

const MIN_OPTIONS = 8;
const MOBILE_MAX = 599;                 // px; below this the list is a top sheet
const enhanced = new WeakMap();
let openState = null;

const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* The button's accessible name comes from the same places the select's did:
   aria-label, or the text of the wrapping/associated label minus the select
   itself (the app's labels wrap the control: <label><span>League</span><select>). */
function fieldName(sel) {
  const al = sel.getAttribute('aria-label'); if (al) return al;
  const lab = sel.labels && sel.labels[0]; if (!lab) return '';
  return [...lab.childNodes].filter(n => n !== sel && !(n.nodeType === 1 && n.classList.contains('ssel-btn')))
    .map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
}

function flatOptions(sel) {
  const out = [];
  for (const el of sel.children) {
    if (el.tagName === 'OPTGROUP') { for (const o of el.children) if (o.tagName === 'OPTION') out.push({ o, grp: el.label }); }
    else if (el.tagName === 'OPTION') out.push({ o: el, grp: null });
  }
  return out;
}

/* `sel.value = x` from app code must move the button label too; the native
   setter is wrapped on the instance so no caller has to know about this. */
function watchValue(sel, sync) {
  const proto = HTMLSelectElement.prototype;
  for (const key of ['value', 'selectedIndex']) {
    const d = Object.getOwnPropertyDescriptor(proto, key);
    if (!d || !d.set) continue;
    Object.defineProperty(sel, key, {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) { d.set.call(this, v); sync(); },
    });
  }
}

function enhance(sel) {
  if (enhanced.has(sel) || sel.multiple || sel.dataset.nosearch != null || !sel.isConnected) return;
  if (sel.options.length < MIN_OPTIONS) return;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'ssel-btn';
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<span class="sr-only ssel-name"></span><span class="ssel-val"></span>${CHEVRON}`;
  const nameEl = btn.querySelector('.ssel-name'), valEl = btn.querySelector('.ssel-val');
  const sync = () => {
    const o = sel.selectedOptions[0];
    const txt = o ? o.textContent.trim() : '';
    valEl.textContent = txt || '—';
    valEl.classList.toggle('ph', !o || o.value === '');
    const nm = fieldName(sel); nameEl.textContent = nm ? nm + ': ' : '';
    btn.disabled = sel.disabled;
    if (openState && openState.sel === sel) openState.render(openState.input.value);
  };
  sel.classList.add('ssel-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  sel.after(btn);
  sync();
  btn.addEventListener('click', () => openState && openState.sel === sel ? closePop() : openFor(sel, btn));
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openFor(sel, btn); }
  });
  sel.addEventListener('change', sync); sel.addEventListener('input', sync);
  sel.addEventListener('focus', () => btn.focus());   // a label click lands here; hand it on
  watchValue(sel, sync);
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
  enhanced.set(sel, { btn, sync });
}

function place(pop, btn) {
  const r = btn.getBoundingClientRect();
  const vv = window.visualViewport;
  const vw = vv ? vv.width : innerWidth, vh = vv ? vv.height : innerHeight;
  const ox = vv ? vv.offsetLeft : 0, oy = vv ? vv.offsetTop : 0;
  pop.classList.remove('up');
  pop.style.top = pop.style.bottom = pop.style.left = pop.style.width = '';
  if (vw <= MOBILE_MAX) {
    /* a sheet pinned to the top keeps the search box above the keyboard */
    pop.style.top = (oy + 8) + 'px';
    pop.style.left = (ox + 8) + 'px';
    pop.style.width = (vw - 16) + 'px';
    pop.style.maxHeight = (vh - 16) + 'px';
    return;
  }
  const w = Math.min(Math.max(r.width, 260), vw - 16);
  const left = Math.min(Math.max(ox + 8, r.left), ox + vw - w - 8);
  const below = oy + vh - r.bottom - 8, above = r.top - oy - 8;
  const goUp = below < 220 && above > below;
  pop.style.left = left + 'px'; pop.style.width = w + 'px';
  pop.style.maxHeight = Math.min(360, goUp ? above : below) + 'px';
  if (goUp) { pop.style.bottom = (innerHeight - r.top + 4) + 'px'; pop.classList.add('up'); }
  else pop.style.top = (r.bottom + 4) + 'px';
}

function openFor(sel, btn) {
  closePop();
  const pop = document.createElement('div');
  pop.className = 'ssel-pop';
  const lid = 'ssel-l' + Math.random().toString(36).slice(2, 8);
  pop.innerHTML = `<div class="ssel-search"><input type="search" placeholder="Type to search…" aria-label="Search ${esc(fieldName(sel) || 'options')}" aria-controls="${lid}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" role="combobox" aria-expanded="true" aria-autocomplete="list"><button type="button" class="ssel-close" aria-label="Close">&times;</button></div>
    <ul class="ssel-list" id="${lid}" role="listbox"></ul>
    <div class="ssel-empty" hidden>Nothing matches</div>
    <div class="ssel-count"></div>`;
  const scrim = document.createElement('div'); scrim.className = 'ssel-scrim';
  document.body.append(scrim, pop);
  const input = pop.querySelector('input'), list = pop.querySelector('ul');
  pop.querySelector('.ssel-close').addEventListener('click', () => { closePop(); btn.focus(); });
  const empty = pop.querySelector('.ssel-empty'), count = pop.querySelector('.ssel-count');
  const items = flatOptions(sel);
  let shown = [], active = -1;

  const setActive = i => {
    active = i;
    list.querySelectorAll('li.act').forEach(li => li.classList.remove('act'));
    const li = i >= 0 && list.querySelector(`li[data-i="${shown[i]}"]`);
    if (li) { li.classList.add('act'); li.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', li.id); }
    else input.removeAttribute('aria-activedescendant');
  };
  const hi = (t, q) => { if (!q) return esc(t); const i = fold(t).indexOf(q); return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)); };
  const render = q => {
    const needle = fold(q); let html = '', lastGrp = null; shown = [];
    items.forEach(({ o, grp }, idx) => {
      const t = o.textContent.trim();
      if (needle && !fold(t).includes(needle) && !(grp && fold(grp).includes(needle))) return;
      if (grp && grp !== lastGrp) { html += `<li class="grp" role="presentation">${esc(grp)}</li>`; lastGrp = grp; }
      html += `<li role="option" id="${lid}-${idx}" data-i="${idx}" aria-selected="${o.selected}"${o.disabled ? ' class="dis" aria-disabled="true"' : ''}>${hi(t, needle)}</li>`;
      shown.push(idx);
    });
    list.innerHTML = html;
    empty.hidden = shown.length > 0;
    count.textContent = shown.length === items.length ? `${items.length} options` : `${shown.length} of ${items.length}`;
    const cur = shown.findIndex(i => items[i].o.selected && !items[i].o.disabled);
    setActive(cur >= 0 ? cur : shown.findIndex(i => !items[i].o.disabled));
  };
  const pick = idx => {
    const { o } = items[idx]; if (o.disabled) return;
    if (!o.selected) {
      sel.value = o.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closePop(); btn.focus();
  };

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!shown.length) return;
      let i = active; const step = e.key === 'ArrowDown' ? 1 : -1;
      for (let n = 0; n < shown.length; n++) { i = (i + step + shown.length) % shown.length; if (!items[shown[i]].o.disabled) break; }
      setActive(i);
    } else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) pick(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); closePop(); btn.focus(); }
    else if (e.key === 'Tab') closePop();
  });
  list.addEventListener('pointerdown', e => e.preventDefault());   // keep focus in the search box
  list.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) pick(+li.dataset.i); });

  const onDown = e => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closePop(); };
  const onScroll = e => { if (!pop.contains(e.target)) place(pop, btn); };
  const onKey = e => { if (e.key === 'Escape') { closePop(); btn.focus(); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('scroll', onScroll, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onScroll);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onScroll);
  btn.setAttribute('aria-expanded', 'true');
  openState = { sel, btn, pop, scrim, input, render, teardown() {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onScroll);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', onScroll);
  } };
  render('');
  place(pop, btn);
  input.focus({ preventScroll: true });
}

function closePop() {
  if (!openState) return;
  openState.teardown();
  openState.pop.remove();
  openState.scrim.remove();
  openState.btn.setAttribute('aria-expanded', 'false');
  openState = null;
}

/* One sweep per mutation batch: screens render with innerHTML and fill their
   selects afterwards, so both "a select appeared" and "a select grew past the
   threshold" have to be caught, and neither is worth a per-select hook. */
let sweepQueued = false;
function sweep() {
  sweepQueued = false;
  for (const sel of document.querySelectorAll('select:not(.ssel-native)')) enhance(sel);
  if (openState && !openState.btn.isConnected) closePop();
}
function queueSweep() { if (!sweepQueued) { sweepQueued = true; queueMicrotask(sweep); } }

new MutationObserver(queueSweep).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('hashchange', closePop);
sweep();

export { enhance, closePop };
