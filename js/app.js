import * as P from './parse.js';
import * as R from './rules.js';
import * as N from './notices.js';
import * as X from './exports.js';
import { fresh, upgrade, realDay, inRange } from './state.js';

const KEY = 'price-raise-v1';
// SheetJS 0.20.3 (Apache-2.0, js/vendor/SheetJS-LICENSE.txt), served from this site: 0.18.5 on cdnjs has
// CVE-2023-30533 (prototype pollution when reading a crafted file) and CVE-2024-22363 (ReDoS), fixed in 0.19.3/0.20.2.
const XLSX_SRC = 'js/vendor/xlsx-0.20.3.full.min.js';
const XLSX_SRI = 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT';
const STEPS = [['clients', 'Your clients'], ['rules', 'Your rule'], ['preview', 'Preview'], ['notices', 'Notices'], ['send', 'Send & export'], ['replies', 'Replies']];
const STATUSES = [['waiting', 'No reply yet'], ['accepted', 'Accepted'], ['pushback', 'Pushed back'], ['kept', 'Kept old price'], ['left', 'Left']];
const SAMPLES = {
  clients: { url: 'fixtures/sample-clients-700.csv', label: '700 made-up cleaning clients' },
  jobber: { url: 'fixtures/sample-jobber-recurring-report.csv', label: '60 made-up jobs laid out like a Jobber Recurring Jobs report' },
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const cur = () => S.settings.currency || '$';
const m0 = (n) => (n < 0 ? '-' : '') + cur() + Math.round(Math.abs(n)).toLocaleString('en-US');
const m2 = (n) => N.money(n, cur());
const signed0 = (n) => (n >= 0 ? '+' : '') + m0(n);

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return upgrade(JSON.parse(raw));
  } catch (e) { return null; }
}
let S = load() || fresh();
let built = null, results = [], tot = null, saveTimer = null, saveWarned = false;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { if (!saveWarned) { saveWarned = true; toast('Your browser would not keep an autosave. Use Save to keep a project file.'); } }
  }, 300);
}
function recompute() {
  if (!S.source) { built = null; results = []; tot = null; return; }
  built = P.buildClients(S.source.headers, S.source.rows, S.mapping, { basis: S.basis, defaultFreq: S.defaultFreq, dateOrder: S.dateOrder });
  if (!S.plan.effective.date) S.plan.effective.date = R.defaultEffectiveDate(R.todayISO(), S.plan.leadDays);
  results = R.computeAll(built.clients, S.plan, S.per);
  tot = R.totals(results);
}
const ready = () => !!(S.source && (S.mapping.name >= 0 || S.mapping.firstName >= 0) && S.mapping.price >= 0 && built && built.clients.length);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 3200);
}

// ---------- routing and shell ----------
function route() {
  const app = location.hash.startsWith('#/app');
  $('#home').classList.toggle('hidden', app);
  $('#app').classList.toggle('hidden', !app);
  $('#project-actions').classList.toggle('hidden', !S.source);
  if (app) renderApp();
  else renderGen();
}
window.addEventListener('hashchange', () => { route(); if (location.hash.startsWith('#/')) window.scrollTo(0, 0); });

function go(step) {
  S.step = step;
  save();
  if (!location.hash.startsWith('#/app')) location.hash = '#/app';
  else renderApp();
  window.scrollTo(0, 0);
}

function renderApp() {
  recompute();
  if (S.step !== 'clients' && !ready()) S.step = 'clients';
  $('#stepper').innerHTML = STEPS.map(([k, t], i) => `<li><button type="button" data-step="${k}" ${k === S.step ? 'aria-current="step"' : ''} ${k !== 'clients' && !ready() ? 'disabled' : ''}><span class="n">${i + 1}</span><span class="t">${t}</span></button></li>`).join('');
  const b = $('#sample-banner');
  b.classList.toggle('hidden', !S.source?.isSample);
  if (S.source?.isSample) b.innerHTML = `<span><strong>Sample data:</strong> ${esc(S.source.sampleLabel)}. None of them are real people.</span><button class="btn sm" data-action="clear">Use my own list</button>`;
  $('#project-actions').classList.toggle('hidden', !S.source);
  renderPanel();
}

// Re-render the panel and put focus back where it was.
function renderPanel() {
  const a = document.activeElement;
  const id = a && a.id && $('#panel').contains(a) ? a.id : null;
  const sel = id && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  $('#panel').innerHTML = ({ clients: viewClients, rules: viewRules, preview: viewPreview, notices: viewNotices, send: viewSend, replies: viewReplies })[S.step]();
  if (id) {
    const el = document.getElementById(id);
    if (el) { el.focus({ preventScroll: true }); try { if (sel) el.setSelectionRange(...sel); } catch (e) {} }
  }
}

const head = (title, sub, extra = '') => `<div class="panel-head"><div><h2>${title}</h2><p>${sub}</p></div>${extra}</div>`;
const foot = (back, next, nextLabel) => `<div class="panel-foot">${back ? `<button class="btn" data-step="${back}">Back</button>` : '<span></span>'}${next ? `<button class="btn primary" data-step="${next}" ${ready() ? '' : 'disabled'}>${nextLabel}</button>` : ''}</div>`;

// ---------- step 1: clients ----------
function viewClients() {
  if (!S.source) {
    return head('Bring in your client list', 'A CSV or Excel file with one row per client (or per recurring job) and their current price.') + `
    <label class="drop" id="drop" for="file">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" style="color:var(--accent)"><path d="M12 16V4m0 0l-4 4m4-4l4 4"/><path d="M4 16v4h16v-4"/></svg>
      <h3 style="margin:8px 0 0">Drop your file here, or click to choose it</h3>
      <p>CSV, XLSX or XLS. It's read on this computer and never uploaded.</p>
      <input type="file" id="file" class="sr-only" accept=".csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
    </label>
    <div id="file-error" class="note warn hidden" role="alert" style="margin-top:16px"></div>
    <div class="import-grid" style="margin-top:16px">
      <div class="card">
        <h3>Using Jobber?</h3>
        <p class="muted small">Jobber's client export has no prices, because prices sit on your recurring jobs. Export the Recurring Jobs report instead:</p>
        <ol class="small" style="margin:0 0 0 18px;padding:0">
          <li>Go to <strong>Insights</strong>, then <strong>Reports</strong>.</li>
          <li>Under Work reports, open <strong>Recurring jobs</strong>.</li>
          <li>Click <strong>Export to CSV</strong>. Jobber emails you the file.</li>
        </ol>
        <p class="muted small" style="margin:10px 0 0">From another tool? Any export with a name and a price per client works.</p>
      </div>
      <div class="card">
        <h3>Just looking?</h3>
        <p class="muted small">Try the whole thing with made-up clients first.</p>
        <div class="row" style="gap:8px">
          <button class="btn" data-action="sample" data-kind="clients">700 sample clients</button>
          <button class="btn" data-action="sample" data-kind="jobber">Jobber-style sample</button>
        </div>
      </div>
    </div>`;
  }
  const h = S.source.headers;
  const ex = (i) => S.source.rows.map((r) => r[i]).filter((v) => String(v ?? '').trim() !== '').slice(0, 3).map(String).join(' · ');
  const opts = (sel) => `<option value="-1">Not in my file</option>` + h.map((x, i) => `<option value="${i}" ${+sel === i ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const mapRows = P.FIELDS.map((f) => `<tr><td><label for="map-${f.key}">${f.label}${f.required ? ' <span class="req" aria-label="required">*</span>' : ''}</label></td>
    <td><select id="map-${f.key}" data-map="${f.key}">${opts(S.mapping[f.key])}</select>${S.mapping[f.key] >= 0 ? `<span class="eg">${esc(ex(S.mapping[f.key])) || 'empty column'}</span>` : ''}</td></tr>`).join('');
  const nameOk = S.mapping.name >= 0 || S.mapping.firstName >= 0;
  const priceOk = S.mapping.price >= 0;
  let checks = '';
  if (built) {
    const is = built.issues;
    const li = (t, w) => `<li class="${w ? 'warn' : ''}"><span>${t}</span></li>`;
    const priced = built.clients.filter((c) => c.price !== null).length;
    checks = [
      li(`<strong>${plural(priced, 'client')}</strong> ready to raise`),
      tot && li(`Together they pay <strong>${m0(tot.oldMonthly)} a month</strong> now`),
      is.blank && li(`Skipped ${plural(is.blank, 'blank row')}`),
      is.duplicates && li(`Removed ${plural(is.duplicates, 'exact duplicate row')}`),
      is.noPrice && li(`${plural(is.noPrice, 'client')} with no price we could read. They're left out; you'll see them in the preview.`, 1),
      is.freqUnknown && li(`${plural(is.freqUnknown, 'frequency', 'frequencies')} we couldn't read, so we used your default for those.`, 1),
      is.dupNames.length && li(`${plural(is.dupNames.length, 'name')} ${is.dupNames.length === 1 ? 'appears' : 'appear'} more than once (for example ${esc(is.dupNames.slice(0, 2).map(titleCase).join(', '))}). That's fine if they have more than one service.`, 1),
    ].filter(Boolean).join('');
  }
  const freqSel = P.FREQ_OPTIONS.map(([k, t]) => `<option value="${k}" ${S.defaultFreq === k ? 'selected' : ''}>${t}</option>`).join('');
  return head('Match your columns', `From <strong>${esc(S.source.fileName)}</strong>. We've matched what we could; check the two starred ones.`,
    `<button class="btn" data-action="clear">Use a different file</button>`) + `
  <div class="import-grid">
    <div class="card"><table class="map-table"><tbody>${mapRows}</tbody></table></div>
    <div>
      <div class="card">
        <h3>How are prices written?</h3>
        <div class="field" role="radiogroup" aria-label="Price basis">
          ${[['visit', 'Per visit', 'We work out the monthly value from how often you visit.'], ['month', 'Per month', 'One monthly price per client.'], ['year', 'Per year', 'Yearly contracts.']]
            .map(([k, t, d]) => `<label class="radio"><input type="radio" name="basis" value="${k}" ${S.basis === k ? 'checked' : ''}><span><strong>${t}</strong><br><span class="muted small">${d}</span></span></label>`).join('')}
        </div>
        ${S.basis === 'visit' ? `<div class="field"><label for="def-freq">${S.mapping.frequency >= 0 ? 'If a frequency is blank or unclear, use' : 'How often do you visit most clients?'}</label><select id="def-freq" data-k="defaultFreq">${freqSel}</select></div>` : ''}
        ${S.mapping.since >= 0 ? `<div class="field"><label for="date-order">Dates like 03/04/2024 mean</label><select id="date-order" data-k="dateOrder">
          <option value="auto" ${S.dateOrder === 'auto' ? 'selected' : ''}>Work it out (now: ${built?.dateOrder === 'dmy' ? '3 April' : 'March 4'})</option>
          <option value="mdy" ${S.dateOrder === 'mdy' ? 'selected' : ''}>Month first (March 4, US)</option>
          <option value="dmy" ${S.dateOrder === 'dmy' ? 'selected' : ''}>Day first (3 April, UK/AU)</option></select></div>` : ''}
      </div>
      <div class="card"><h3>What we found</h3>
        ${!nameOk || !priceOk ? `<p class="note warn" role="alert">Choose which column holds the ${!nameOk ? 'client name' : ''}${!nameOk && !priceOk ? ' and the ' : ''}${!priceOk ? 'current price' : ''}.</p>` : `<ul class="checks">${checks}</ul>`}
      </div>
    </div>
  </div>` + foot(null, 'rules', 'Next: set your rule');
}
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function guessBasis(headers, mapping) {
  const h = (headers[mapping.price] || '').toLowerCase();
  if (/visit|each|per job/.test(h)) return 'visit';
  if (/month/.test(h)) return 'month';
  if (/year|annual/.test(h)) return 'year';
  if (mapping.frequency >= 0) return 'visit';
  if (headers.some((x) => /billing type/i.test(x))) return 'visit';
  return 'month';
}

function setSource(fileName, sheet, sample) {
  const { headers, rows } = P.splitHeader(sheet);
  if (!headers.length || !rows.length) throw new Error('empty');
  const keep = { settings: S.settings, templates: S.templates, gen: S.gen };
  S = { ...fresh(), ...keep };
  S.source = { fileName, headers, rows, isSample: !!sample, sampleLabel: sample ? SAMPLES[sample].label : '' };
  S.mapping = P.guessMapping(headers);
  S.basis = guessBasis(headers, S.mapping);
  S.defaultFreq = S.mapping.frequency >= 0 ? 'monthly' : (S.basis === 'visit' ? 'fortnightly' : 'monthly');
  S.step = 'clients';
  save();
}

async function readFile(file) {
  const err = $('#file-error');
  const fail = (msg) => { if (err) { err.innerHTML = msg; err.classList.remove('hidden'); } else toast(msg.replace(/<[^>]+>/g, '')); };
  try {
    let sheet;
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      await loadXLSX();
      const wb = window.XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.SheetNames.map((n) => wb.Sheets[n]).find((s) => s['!ref']);
      if (!ws) throw new Error('empty');
      sheet = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
        .map((r) => r.map((c) => (c instanceof Date ? `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}` : c)));
    } else {
      sheet = P.parseCSV(await file.text());
    }
    setSource(file.name, sheet);
    renderApp();
    toast(`Loaded ${file.name}`);
  } catch (e) {
    if (e.message === 'xlsx-load') fail('We couldn’t load the Excel reader (it needs an internet connection the first time). Save the sheet as <strong>CSV</strong> and drop that in instead.');
    else if (e.message === 'empty') fail('We couldn’t find a header row with clients under it in that file. Check it’s your client list; if it’s a spreadsheet, save it as <strong>CSV</strong> and try again.');
    else fail('We couldn’t read that file. In Excel or Google Sheets, use <strong>File, Save as (or Download), CSV</strong>, then try again.');
  }
}
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = XLSX_SRC; s.integrity = XLSX_SRI; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => rej(new Error('xlsx-load'));
    document.head.appendChild(s);
  });
}
async function loadSample(kind = 'clients') {
  try {
    const text = await (await fetch(SAMPLES[kind].url, { cache: 'no-store' })).text();
    setSource(SAMPLES[kind].url.split('/').pop(), P.parseCSV(text), kind);
    go('clients');
  } catch (e) { toast('The sample file could not be loaded.'); }
}

// ---------- step 2: rules ----------
function ruleFields(rule, id) {
  return `<div class="row">
    <div class="field"><label for="${id}-amount">Raise by</label><div class="inline-input">
      <input type="number" id="${id}-amount" data-rule="${id}" data-k="amount" min="0" step="0.5" value="${esc(rule.amount)}" inputmode="decimal">
      <select id="${id}-type" data-rule="${id}" data-k="type" aria-label="Percent or fixed amount"><option value="percent" ${rule.type === 'percent' ? 'selected' : ''}>%</option><option value="fixed" ${rule.type === 'fixed' ? 'selected' : ''}>${esc(cur())} flat</option></select></div></div>
    <div class="field"><label for="${id}-round">Round new prices to</label><select id="${id}-round" data-rule="${id}" data-k="round">${R.ROUNDING.map(([k, t]) => `<option value="${k}" ${rule.round === k ? 'selected' : ''}>${t.replace('$', cur())}</option>`).join('')}</select></div>
  </div>
  <div class="row">
    <div class="field"><label for="${id}-floor">Lowest new price <span class="muted small">(optional)</span></label><div class="prefix"><span>${esc(cur())}</span><input type="number" id="${id}-floor" data-rule="${id}" data-k="floor" min="0" step="1" value="${esc(rule.floor)}" placeholder="none"></div></div>
    <div class="field"><label for="${id}-cap">Biggest rise allowed <span class="muted small">(optional)</span></label><div class="prefix"><span>${esc(cur())}</span><input type="number" id="${id}-cap" data-rule="${id}" data-k="cap" min="0" step="1" value="${esc(rule.cap)}" placeholder="no cap"></div></div>
  </div>`;
}
function viewRules() {
  const services = [...new Set(built.clients.map((c) => c.service).filter(Boolean))].sort();
  const tags = [...new Set(built.clients.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b));
  const segs = S.plan.rules.segments.map((seg, i) => {
    const vals = seg.field === 'tag' ? tags : services;
    return `<div class="rule"><div class="rule-head"><div class="row" style="flex:1;gap:8px">
      <div style="flex:0 1 150px"><label class="sr-only" for="seg${i}-field">Rule for</label><select id="seg${i}-field" data-rule="seg${i}" data-k="field"><option value="service" ${seg.field === 'service' ? 'selected' : ''}>Service is</option><option value="tag" ${seg.field === 'tag' ? 'selected' : ''}>Tag is</option></select></div>
      <div><label class="sr-only" for="seg${i}-value">Which one</label><select id="seg${i}-value" data-rule="seg${i}" data-k="value"><option value="">Choose…</option>${vals.map((v) => `<option ${seg.value === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div></div>
      <button class="btn ghost sm" data-action="del-seg" data-i="${i}" aria-label="Remove this rule">Remove</button></div>
      ${ruleFields(seg, 'seg' + i)}</div>`;
  }).join('');
  const lead = S.plan.leadDays;
  const anniv = S.plan.effective.mode === 'anniversary';
  const noSince = built.clients.filter((c) => !c.since).length;
  const late = tot.lateNotice;
  return head('Set your rule', 'One rule for everyone, or a different one for certain services or tags. The numbers on the right update as you type.') + `
  <div class="rules-grid"><div>
    <div class="card"><h3>Everyone${S.plan.rules.segments.length ? ' else' : ''}</h3>${ruleFields(S.plan.rules.default, 'def')}
      ${S.plan.rules.segments.length ? `<h3 style="margin-top:8px">Special rules <span class="muted small">(the first one that matches wins)</span></h3>` : ''}${segs}
      <button class="btn sm" data-action="add-seg" ${services.length || tags.length ? '' : 'disabled title="Your file has no services or tags to choose from"'}>+ Different rule for a service or tag</button>
    </div>
    <div class="card"><h3>Who to leave out</h3>
      ${tags.length ? `<div class="field"><span class="muted small" style="display:block;margin-bottom:6px">Don't raise clients tagged:</span><div class="tag-list">${tags.map((t, i) => `<label><input type="checkbox" id="xt${i}" data-xtag="${esc(t)}" ${S.plan.excludeTags.includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div></div>` : ''}
      <div class="field"><label for="newer">Leave out clients who joined in the last</label><div class="row" style="align-items:center"><input type="number" id="newer" data-plan="newerThanMonths" min="0" step="1" value="${esc(S.plan.newerThanMonths)}" style="max-width:110px"> <span>months</span></div>
        ${S.mapping.since < 0 ? '<div class="hint">Your file has no "client since" column, so this has no effect.</div>' : ''}</div>
      <p class="muted small" style="margin:0">You can also untick anyone by hand in the preview.</p>
    </div>
    <div class="card"><h3>When it starts</h3>
      <div class="field" role="radiogroup" aria-label="Start date">
        <label class="radio"><input type="radio" name="eff" value="date" ${!anniv ? 'checked' : ''}><span><strong>One date for everyone</strong></span></label>
        ${!anniv ? `<div style="margin:0 0 10px 26px;max-width:220px"><label class="sr-only" for="eff-date">Start date</label><input type="date" id="eff-date" value="${esc(S.plan.effective.date)}"></div>` : ''}
        <label class="radio"><input type="radio" name="eff" value="anniversary" ${anniv ? 'checked' : ''} ${S.mapping.since < 0 ? 'disabled' : ''}><span><strong>Each client's anniversary month</strong><br><span class="muted small">${S.mapping.since < 0 ? 'Needs a "client since" column.' : 'Spreads the change across the year. Starts on the 1st of the month they joined.'}${anniv && noSince ? ` ${plural(noSince, 'client')} with no start date use ${esc(N.longDate(S.plan.effective.date, S.settings.dateStyle))}.` : ''}</span></span></label>
      </div>
      <div class="field"><label for="lead">Tell clients this many days before</label><input type="number" id="lead" data-plan="leadDays" min="0" step="1" value="${esc(lead)}" style="max-width:110px"><div class="hint">30 days is the usual courtesy, and some contracts ask for it.</div></div>
      ${late ? `<p class="note warn" role="alert">${plural(late, 'client')} would get less notice than that, because the date to tell them has passed. Choose a later start date.</p>` : ''}
    </div>
    ${loyaltyCard()}
  </div>
  <aside class="sticky">${summaryCard()}</aside></div>` + foot('clients', 'preview', 'Next: see every client');
}
function loyaltyCard() {
  const g = S.plan.grace, k = S.plan.lockIn;
  const num = (id, key, val, min, max) => `<input type="number" id="${id}" data-loyal="${key}" min="${min}" max="${max}" step="1" value="${esc(val)}" style="max-width:90px">`;
  return `<div class="card"><h3>Thank long-time clients</h3>
    <label class="radio"><input type="checkbox" id="grace-on" data-loyal="grace.on" ${g.on ? 'checked' : ''} ${S.mapping.since < 0 ? 'disabled' : ''}><span><strong>Let them keep their current price for longer</strong><br><span class="muted small">${S.mapping.since < 0 ? 'Needs a "client since" column.' : "They hear about the change on the same day as everyone else, so they simply get more time. Their letter says it's a thank-you."}</span></span></label>
    ${g.on && S.mapping.since >= 0 ? `<div class="row tight" style="margin:6px 0 4px 26px;align-items:center;gap:8px"><label for="grace-min">With you at least</label>${num('grace-min', 'grace.minMonths', g.minMonths, 0, 600)}<span>months</span></div>
    <div class="row tight" style="margin:0 0 6px 26px;align-items:center;gap:8px"><label for="grace-months">Extra time at their old price</label><select id="grace-months" data-loyal="grace.months">${[3, 4, 5, 6].map((m) => `<option value="${m}" ${+g.months === m ? 'selected' : ''}>${m} months</option>`).join('')}</select></div>
    <p class="muted small" style="margin:0 0 10px 26px" aria-live="polite">${graceLine()}</p>` : ''}
    <label class="radio" style="margin-top:6px"><input type="checkbox" id="lock-on" data-loyal="lockIn.on" ${k.on ? 'checked' : ''}><span><strong>Offer to lock in their current price</strong> <span class="muted small">(optional)</span><br><span class="muted small">Anyone who replies in time to say they're staying keeps their old price for a while longer. Mark them "Kept old price" on the Replies step.</span></span></label>
    ${k.on ? `<div class="row tight" style="margin:6px 0 4px 26px;align-items:center;gap:8px"><label for="lock-days">They reply within</label>${num('lock-days', 'lockIn.replyDays', k.replyDays, 1, 60)}<span>days of the notice</span></div>
    <div class="row tight" style="margin:0 0 4px 26px;align-items:center;gap:8px"><label for="lock-months">and keep the old price</label>${num('lock-months', 'lockIn.months', k.months, 1, 24)}<span>months past their start date</span></div>` : ''}
  </div>`;
}
function graceLine() {
  if (!tot.graceClients) return `No raised client has been with you ${S.plan.grace.minMonths} months or more yet.`;
  return `${plural(tot.graceClients, 'client')} start ${S.plan.grace.months} months later. That costs you about <strong>${m0(tot.graceCost)}</strong> over the next 12 months.`;
}
function summaryCard() {
  return `<div class="card" aria-live="polite"><div class="muted small">Your gain</div>
    <div class="num gain" style="font-size:34px;font-weight:700;letter-spacing:-.02em">${signed0(tot.gainMonthly)}<span style="font-size:16px;font-weight:500"> a month</span></div>
    <div class="num muted">${signed0(tot.gainYearly)} a year</div>
    <ul class="checks" style="margin-top:12px">
      <li>${plural(tot.raised, 'client')} raised</li>
      ${tot.excluded ? `<li class="warn">${plural(tot.excluded, 'client')} left as they are</li>` : ''}
      <li>${m0(tot.oldMonthly)} → ${m0(tot.newMonthly)} a month</li>
      ${tot.graceClients ? `<li>Loyalty grace costs ${m0(tot.graceCost)} this year (${plural(tot.graceClients, 'client')})</li>` : ''}
    </ul></div>`;
}
function ruleById(id) {
  if (id === 'def') return S.plan.rules.default;
  return S.plan.rules.segments[+id.slice(3)];
}

// ---------- step 3: preview ----------
function filtered() {
  const q = S.ui.q.trim().toLowerCase();
  let list = results.filter((r) => {
    if (S.ui.filter === 'raised' && !r.raised) return false;
    if (S.ui.filter === 'out' && r.raised) return false;
    if (S.ui.filter === 'override' && !r.overridden) return false;
    if (!q) return true;
    const c = r.client;
    return [c.name, c.service, c.email, c.jobNumber, ...c.tags].some((x) => String(x).toLowerCase().includes(q));
  });
  const k = S.ui.sort, d = S.ui.dir;
  const val = (r) => ({ name: r.client.name.toLowerCase(), service: r.client.service.toLowerCase(), old: r.old ?? -1, price: r.price ?? -1,
    change: r.raised ? (r.price - r.old) * r.client.factor : -1e9, effective: r.effective || '9999' })[k];
  return list.sort((a, b) => (val(a) < val(b) ? -d : val(a) > val(b) ? d : 0));
}
function viewPreview() {
  const p = S.ui.churn / 100;
  const after = R.gainAfterChurn(tot, p);
  const leave = Math.round(tot.raised * p);
  const be = tot.breakEvenChurn;
  const list = filtered();
  const shown = list.slice(0, S.ui.limit);
  const th = (k, t, cls = '') => `<th class="${cls}" aria-sort="${S.ui.sort === k ? (S.ui.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-sort="${k}">${t}${S.ui.sort === k ? (S.ui.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
  const rows = shown.map((r) => {
    const c = r.client;
    const lockReason = r.old === null || /tag|Client for/.test(r.excluded);
    const ch = r.raised ? r.price - r.old : 0;
    return `<tr class="${r.raised ? '' : 'off'}">
      <td><input type="checkbox" data-inc="${c.id}" aria-label="Raise ${esc(c.name)}" ${S.per[c.id]?.include === false || lockReason ? '' : 'checked'} ${lockReason ? 'disabled' : ''}></td>
      <td>${esc(c.name)}<span class="sub">${r.excluded ? esc(r.excluded) : r.reason === 'cap' ? 'Held to your biggest rise' : r.reason === 'floor' ? 'Raised to your lowest price' : esc(c.tags.join(', '))}</span></td>
      <td>${esc(c.service) || '<span class="muted">—</span>'}<span class="sub">${esc(c.freqLabel)}</span></td>
      <td class="r num">${r.old === null ? '<span class="chip warn">no price</span>' : m2(r.old)}</td>
      <td class="r">${r.old === null ? '' : `<input class="ov num ${r.overridden ? 'changed' : ''}" type="text" inputmode="decimal" data-ov="${c.id}" id="ov-${c.id}" value="${r.excluded && !r.overridden ? '' : esc(r.price)}" placeholder="${esc(r.old)}" aria-label="New price for ${esc(c.name)}" ${lockReason || S.per[c.id]?.include === false ? 'disabled' : ''}>`}</td>
      <td class="r num">${r.raised ? `<span class="${ch > 0 ? 'gain' : 'loss'}">${ch > 0 ? '+' : ''}${m2(ch)}</span><span class="sub">${Math.round((ch / r.old) * 1000) / 10}% · ${signed0(ch * c.factor)}/mo</span>` : ''}</td>
      <td class="num">${r.effective ? esc(shortDate(r.effective)) : ''}${r.grace ? `<span class="sub">+${r.grace} months, thank-you</span>` : ''}</td>
      <td class="num">${r.notice ? `<span class="${r.notice < R.todayISO() ? 'loss' : ''}">${esc(shortDate(r.notice))}</span>` : ''}</td></tr>`;
  }).join('');
  return head('Check every client', 'Untick anyone you want to leave alone, or type a different new price. Nothing changes anywhere until you say so.') + `
  <div class="stats">
    <div class="stat"><div class="k">You get now</div><div class="v">${m0(tot.oldMonthly)}</div><div class="s">a month</div></div>
    <div class="stat"><div class="k">After the raise</div><div class="v">${m0(tot.newMonthly)}</div><div class="s">a month</div></div>
    <div class="stat hl"><div class="k">Extra each month</div><div class="v gain">${signed0(tot.gainMonthly)}</div><div class="s">${signed0(tot.gainYearly)} a year</div></div>
    <div class="stat"><div class="k">Clients raised</div><div class="v">${tot.raised.toLocaleString('en-US')}</div><div class="s">${tot.excluded ? `${tot.excluded.toLocaleString('en-US')} left as they are` : 'everyone'}</div></div>
  </div>
  ${tot.lateNotice ? `<p class="note warn" role="alert">${plural(tot.lateNotice, 'client')} would get less than ${S.plan.leadDays} days' notice. <button class="btn sm" data-step="rules">Change the start date</button></p>` : ''}
  ${tot.graceClients ? `<p class="note">Loyalty grace: ${plural(tot.graceClients, 'long-time client')} keep their current price ${S.plan.grace.months} months longer, which costs about <strong>${m0(tot.graceCost)}</strong> this year (over the next 12 months). Their start dates below already include it.</p>` : ''}
  <div class="card churn" style="margin-bottom:16px">
    <div><label for="churn">What if some clients leave?</label>
      <input type="range" id="churn" min="0" max="20" step="1" value="${S.ui.churn}" aria-valuetext="${S.ui.churn} percent">
      <div class="muted small num" style="display:flex;justify-content:space-between"><span>0%</span><span>10%</span><span>20%</span></div></div>
    <div class="answer" aria-live="polite" id="churn-answer">${churnText(p, after, leave, be)}</div>
  </div>
  <div class="toolbar">
    <label class="sr-only" for="q">Search clients</label><input type="search" id="q" placeholder="Search name, service, tag" value="${esc(S.ui.q)}">
    <label class="sr-only" for="filter">Show</label><select id="filter">
      ${[['all', 'All clients'], ['raised', 'Being raised'], ['out', 'Left as they are'], ['override', 'Changed by hand']].map(([k, t]) => `<option value="${k}" ${S.ui.filter === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <span class="muted small">${plural(list.length, 'client')}</span>
  </div>
  <div class="table-wrap"><table class="data"><thead><tr><th><span class="sr-only">Raise</span></th>${th('name', 'Client')}${th('service', 'Service')}${th('old', 'Now', 'r')}${th('price', 'New', 'r')}${th('change', 'Change', 'r')}${th('effective', 'Starts')}<th>Tell them by</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">No clients match.</td></tr>`}</tbody></table>
  ${list.length > shown.length ? `<div class="more"><button class="btn sm" data-action="more">Show ${Math.min(100, list.length - shown.length)} more</button> <button class="btn sm ghost" data-action="all">Show all ${list.length.toLocaleString('en-US')}</button></div>` : ''}</div>` + foot('rules', 'notices', 'Next: write the notices');
}
function churnText(p, after, leave, be) {
  if (!tot.raised) return 'Nobody is being raised yet.';
  if (p === 0) return `If nobody leaves, you gain <strong class="gain">${signed0(tot.gainMonthly)} a month</strong>. You'd still come out ahead unless more than <strong>${Math.round(be * 1000) / 10}%</strong> of raised clients leave.`;
  return `If <strong>${S.ui.churn}%</strong> leave (about ${plural(leave, 'client')}), ${after >= 0 ? `you still gain <strong class="gain">${m0(after)} a month</strong>` : `you'd be <strong class="loss">${m0(-after)} a month</strong> worse off than today`}. You come out ahead unless more than <strong>${Math.round(be * 1000) / 10}%</strong> leave.`;
}
const shortDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString(S.settings.dateStyle === 'uk' ? 'en-GB' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// ---------- step 4: notices ----------
const raisedList = () => results.filter((r) => r.raised);
function previewResult() {
  const list = raisedList();
  return list.find((r) => r.id === S.ui.previewId) || list[0];
}
function viewNotices() {
  const tone = S.settings.tone;
  const t = S.templates[tone];
  const unknown = [...new Set([...N.unknownTags(t.subject), ...N.unknownTags(t.body), ...N.unknownTags(t.sms)])];
  const long = raisedList().filter((r) => N.renderNotice(r, t, S.settings).smsTooLong).length;
  const edited = JSON.stringify(t) !== JSON.stringify(N.DEFAULT_TEMPLATES[tone]);
  return head('Write the notices', 'Pick a tone, then change any words you like. Every client gets their own name, service, prices and date.') + `
  <div class="card" style="margin-bottom:16px"><div class="row">
    <div class="field"><label for="set-business">Business name</label><input type="text" id="set-business" data-set="business" value="${esc(S.settings.business)}" placeholder="e.g. Brightside Cleaning"></div>
    <div class="field"><label for="set-owner">Your name (signs the note)</label><input type="text" id="set-owner" data-set="owner" value="${esc(S.settings.owner)}" placeholder="e.g. Sam"></div>
    <div class="field" style="flex:0 1 120px"><label for="set-currency">Currency</label><select id="set-currency" data-set="currency">${['$', '£', '€', 'R'].map((c) => `<option ${S.settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field" style="flex:0 1 190px"><label for="set-date">Dates look like</label><select id="set-date" data-set="dateStyle"><option value="us" ${S.settings.dateStyle === 'us' ? 'selected' : ''}>December 1, 2026</option><option value="uk" ${S.settings.dateStyle === 'uk' ? 'selected' : ''}>1 December 2026</option></select></div>
  </div></div>
  ${winsCard()}
  <div class="notice-grid">
    <div class="card">
      <div class="tabs" role="tablist" aria-label="Tone">${Object.entries(N.TONES).map(([k, v]) => `<button role="tab" id="tone-${k}" aria-selected="${k === tone}" data-tone="${k}">${v.label}</button>`).join('')}</div>
      <p class="muted small">${N.TONES[tone].hint}</p>
      <div class="field"><label for="tpl-subject">Email subject</label><input type="text" id="tpl-subject" data-tpl="subject" value="${esc(t.subject)}"></div>
      <div class="field"><label for="tpl-body">Email</label><textarea id="tpl-body" data-tpl="body" rows="14">${esc(t.body)}</textarea></div>
      <div class="field"><label for="tpl-sms">Text message <span class="muted small">(keep it under 160 characters so it sends as one text)</span></label><textarea id="tpl-sms" data-tpl="sms" rows="3">${esc(t.sms)}</textarea></div>
      <div class="muted small">Insert into the box you were last typing in:</div>
      <div class="chips">${N.MERGE_FIELDS.map((f) => `<button type="button" data-ins="{${f}}">{${f}}</button>`).join('')}</div>
      <p class="muted small">Every letter runs in five parts: what they've had from you, the change stated plainly, what it pays for, a thank-you for loyal clients, then a P.S. for worries. A paragraph whose field is empty for a client, such as {wins} with no wins or {lock_in} when it's off, is left out of that client's letter.</p>
      <div id="tpl-warn">${tplWarn(unknown, long)}</div>
      <div class="row" style="justify-content:space-between;align-items:center"><span class="muted small" id="tpl-saved">${edited ? 'Your changes are kept for this tone.' : 'This is our original wording.'}</span>
        <button class="btn sm" data-action="reset-tpl" ${edited ? '' : 'disabled'}>Back to original wording</button></div>
    </div>
    <div class="card" id="notice-preview">${noticePreview()}</div>
  </div>` + foot('preview', 'send', 'Next: send and export');
}
const winsHint = (key, n) => (n ? `${n} of 5 used.` : key === '*' ? 'No wins, so letters skip that part.' : 'Empty, so these clients get the every-service wins.');
function winsCard() {
  const services = [...new Set(built.clients.map((c) => c.service).filter(Boolean))].sort();
  const key = services.includes(S.ui.winsFor) ? S.ui.winsFor : '*';
  return `<div class="card" style="margin-bottom:16px"><h3>What your clients have had from you</h3>
    <p class="muted small" style="margin-top:0">These open every letter as short bullet points. Up to 5, one per line. Keep only what's true for you.</p>
    <div class="row">
      <div class="field" style="flex:0 1 200px"><label for="set-trade">Your trade</label><select id="set-trade">${Object.entries(N.TRADES).map(([k, v]) => `<option value="${k}" ${S.settings.trade === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="field" style="flex:0 1 260px"><label for="wins-for">Wins for</label><select id="wins-for">${['*', ...services].map((v) => `<option value="${esc(v)}" ${key === v ? 'selected' : ''}>${v === '*' ? 'Every service' : esc(v) + (N.winLines(S.settings.wins[v]).length ? '' : ' (uses every-service wins)')}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="wins-text">${key === '*' ? 'Wins for every service' : `Wins for ${esc(key)} only`}</label><textarea id="wins-text" rows="6">${esc(S.settings.wins[key] || '')}</textarea>
      <div class="hint" id="wins-hint">${winsHint(key, N.winLines(S.settings.wins[key]).length)}</div></div>
  </div>`;
}
function tplWarn(unknown, long) {
  return (unknown.length ? `<p class="note warn" role="alert">We don't recognise ${unknown.map((u) => `<code>{${esc(u)}}</code>`).join(', ')}. It will appear exactly like that in the message. Check the spelling against the buttons above.</p>` : '')
    + (long ? `<p class="note warn">For ${plural(long, 'client')} the text runs over 160 characters, so it may arrive as two texts. A shorter service name or wording fixes it.</p>` : '');
}
function noticePreview() {
  const r = previewResult();
  if (!r) return '<p class="muted">Nobody is being raised yet, so there is nothing to preview.</p>';
  const n = N.renderNotice(r, S.templates[S.settings.tone], S.settings);
  const list = raisedList();
  const i = list.indexOf(r);
  return `<div class="pick"><button class="btn sm icon-btn" data-action="prev-client" aria-label="Previous client" ${i <= 0 ? 'disabled' : ''}>‹</button>
    <label class="sr-only" for="pick-client">Preview for</label><select id="pick-client">${list.slice(0, 2000).map((x) => `<option value="${x.id}" ${x === r ? 'selected' : ''}>${esc(x.client.name)}: ${esc(m2(x.old))} → ${esc(m2(x.price))}</option>`).join('')}</select>
    <button class="btn sm icon-btn" data-action="next-client" aria-label="Next client" ${i >= list.length - 1 ? 'disabled' : ''}>›</button></div>
    <p class="muted small" style="margin:10px 0">To: ${esc(r.client.email || 'no email on file')}${r.client.phone ? ' · ' + esc(r.client.phone) : ''} · send by ${esc(shortDate(r.notice))}${r.grace ? ` · long-time client, starts ${r.grace} months later` : ''}${N.isBusiness(r.client) ? ' · business P.S.' : ''}</p>
    <div class="letter"><div class="letter-subject">${esc(n.subject)}</div>${esc(n.body)}</div>
    <div class="copy-row"><h3 style="margin:0">Text message</h3><span class="count ${n.smsTooLong ? 'over' : ''}">${n.smsLength} / ${N.SMS_LIMIT}</span></div>
    <div class="sms-bubble">${esc(n.sms)}</div>`;
}

// ---------- step 5: send and export ----------
function viewSend() {
  const list = raisedList();
  const noEmail = list.filter((r) => !r.client.email).length;
  const dates = [...new Set(list.map((r) => r.notice))].sort();
  const missing = !S.settings.business || !S.settings.owner;
  return head('Send and export', 'Everything is a normal file you open in tools you already have.') + `
  ${missing ? `<p class="note warn" role="alert">Your notices still say "${!S.settings.business ? 'your business name' : 'your name'}". <button class="btn sm" data-step="notices">Add it on the Notices step</button></p>` : ''}
  ${tot.lateNotice ? `<p class="note warn" role="alert">${plural(tot.lateNotice, 'client')} would get less than ${S.plan.leadDays} days' notice. <button class="btn sm" data-step="rules">Change the start date</button></p>` : ''}
  <div class="export-grid">
    <div class="card"><h3>1. Notices for mail merge</h3>
      <p>One row per client with their finished email subject, email and text message. Open it with Gmail or Outlook mail merge, or your texting tool. ${plural(list.length, 'client')}${noEmail ? `, ${noEmail} without an email (they have the text version)` : ''}. First send date: ${dates[0] ? esc(shortDate(dates[0])) : 'none'}.</p>
      <button class="btn primary" data-action="x-merge" ${list.length ? '' : 'disabled'}>Download notices (CSV)</button></div>
    <div class="card"><h3>2. Price changes to make</h3>
      <p>Jobber's help pages don't describe a way to update the prices on existing recurring jobs by import, so this is a checklist: <strong>edit these ${plural(list.length, 'client')}</strong>, each with the new price and the date it starts. Your original columns are kept alongside, so other software that does import prices can use it.</p>
      <button class="btn" data-action="x-list" ${list.length ? '' : 'disabled'}>Download checklist (CSV)</button></div>
    <div class="card"><h3>3. Calendar reminders</h3>
      <p>Reminders on the days to send notices, a week later to check replies, and on each start date to update prices. Works with Google Calendar, Outlook and Apple Calendar.</p>
      <button class="btn" data-action="x-ics" ${list.length ? '' : 'disabled'}>Download reminders (.ics)</button></div>
    <div class="card"><h3>4. One-page summary</h3>
      <p>The numbers, the rule and the dates on one page, to print or save as PDF for your records or your bookkeeper.</p>
      <button class="btn" data-action="print">Print summary</button></div>
  </div>
  <div class="card" style="margin-top:16px"><h3>Keep your work</h3>
    <p class="muted small">Your work is kept in this browser automatically. To move it to another computer, or keep a copy, save a project file and open it here later.</p>
    <button class="btn" data-action="save">Save project file</button></div>` + foot('notices', 'replies', 'Next: track replies');
}
function mergeRows() {
  const t = S.templates[S.settings.tone];
  return [['Name', 'First name', 'Email', 'Phone', 'Subject', 'Email body', 'Text message', 'Text length', 'Price now', 'New price', 'Starts', 'Send by'],
    ...raisedList().map((r) => {
      const n = N.renderNotice(r, t, S.settings);
      return [r.client.name, r.client.firstName, r.client.email, r.client.phone, n.subject, n.body, n.sms, n.smsLength, m2(r.old), m2(r.price), r.effective, r.notice];
    })];
}
function checklistRows() {
  const h = S.source.headers;
  const lock = S.plan.lockIn.on;
  return [['Done', 'Client', 'Job #', 'Service', 'Price now', 'New price', 'Change', 'New price starts', 'Tell client by', 'Loyalty months', ...(lock ? ['Lock-in reply by', 'If locked in, starts'] : []), ...h.map((x) => 'Original: ' + x)],
    ...raisedList().sort((a, b) => (a.effective + a.client.name).localeCompare(b.effective + b.client.name))
      .map((r) => ['', r.client.name, r.client.jobNumber, r.client.service, r.old, r.price, Math.round((r.price - r.old) * 100) / 100, r.effective, r.notice, r.grace || '', ...(lock ? [r.lockBy, r.lockUntil] : []), ...S.source.rows[r.client.row]])];
}
function icsEvents() {
  const by = (key) => raisedList().reduce((m, r) => ((m[r[key]] ||= []).push(r), m), {});
  const names = (list) => list.slice(0, 25).map((r) => `${r.client.name}: ${m2(r.old)} to ${m2(r.price)}`).join('\n') + (list.length > 25 ? `\n...and ${list.length - 25} more (see your checklist file)` : '');
  const ev = [];
  for (const [d, list] of Object.entries(by('notice'))) {
    ev.push({ date: d, title: `Send price notices to ${plural(list.length, 'client')}`, description: `Their new prices start ${N.longDate(list[0].effective, S.settings.dateStyle)}.\n\n${names(list)}` });
    ev.push({ date: R.addDays(d, 7), title: `Check replies to your price notices (${plural(list.length, 'client')})`, description: 'Mark who accepted, pushed back or left on the Replies step.' });
    if (S.plan.lockIn.on) ev.push({ date: list[0].lockBy, title: `Last day to lock in old prices (${plural(list.length, 'client')})`, description: `Anyone who replied by today to say they're staying keeps their old price for ${S.plan.lockIn.months} more months. Mark them "Kept old price" on the Replies step.` });
  }
  for (const [d, list] of Object.entries(by('effective'))) {
    ev.push({ date: d, title: `New prices start for ${plural(list.length, 'client')}`, description: `Update these prices in Jobber or your billing software today.\n\n${names(list)}` });
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date));
}
function printSummary() {
  const def = S.plan.rules.default;
  const ruleText = (r) => `${r.type === 'percent' ? r.amount + '%' : m2(r.amount) + ' flat'}${r.round !== 'none' ? ', ' + R.ROUNDING.find((x) => x[0] === r.round)[1].toLowerCase().replace('$', cur()) : ''}${r.floor ? `, lowest ${m2(r.floor)}` : ''}${r.cap ? `, rise capped at ${m2(r.cap)}` : ''}`;
  const dates = [...new Set(raisedList().map((r) => r.effective))].sort();
  const rt = R.replyTotals(results, S.log);
  $('#print-summary').innerHTML = `<h1>Price rise summary${S.settings.business ? ': ' + esc(S.settings.business) : ''}</h1>
    <p>Prepared ${esc(N.longDate(R.todayISO(), S.settings.dateStyle))} from ${esc(S.source.fileName)}${S.source.isSample ? ' (SAMPLE DATA, made-up clients)' : ''}.</p>
    <div class="big">${signed0(tot.gainMonthly)} a month (${signed0(tot.gainYearly)} a year)</div>
    <table><tbody>
      <tr><td>Monthly revenue now</td><td class="r">${m0(tot.oldMonthly)}</td></tr>
      <tr><td>Monthly revenue after the rise</td><td class="r">${m0(tot.newMonthly)}</td></tr>
      <tr><td>Clients raised / left as they are</td><td class="r">${tot.raised} / ${tot.excluded}</td></tr>
      <tr><td>Still ahead unless more than this share leave</td><td class="r">${Math.round(tot.breakEvenChurn * 1000) / 10}%</td></tr>
      <tr><td>Rule for everyone${S.plan.rules.segments.length ? ' else' : ''}</td><td class="r">${esc(ruleText(def))}</td></tr>
      ${S.plan.rules.segments.filter((s) => s.value).map((s) => `<tr><td>${s.field === 'tag' ? 'Tag' : 'Service'}: ${esc(s.value)}</td><td class="r">${esc(ruleText(s))}</td></tr>`).join('')}
      ${S.plan.excludeTags.length ? `<tr><td>Not raised (tags)</td><td class="r">${esc(S.plan.excludeTags.join(', '))}</td></tr>` : ''}
      ${S.plan.newerThanMonths > 0 ? `<tr><td>Not raised (joined within)</td><td class="r">${S.plan.newerThanMonths} months</td></tr>` : ''}
      <tr><td>New prices start</td><td class="r">${dates.length === 1 ? esc(N.longDate(dates[0], S.settings.dateStyle)) : dates.length ? `${dates.length} dates, ${esc(shortDate(dates[0]))} to ${esc(shortDate(dates[dates.length - 1]))}` : 'none'}</td></tr>
      <tr><td>Notice given</td><td class="r">${S.plan.leadDays} days</td></tr>
      ${tot.graceClients ? `<tr><td>Loyalty grace (${plural(tot.graceClients, 'client')}, ${S.plan.grace.months} extra months)</td><td class="r">costs ${m0(tot.graceCost)} over the next 12 months</td></tr>` : ''}
      ${S.plan.lockIn.on ? `<tr><td>Lock-in offer</td><td class="r">reply within ${S.plan.lockIn.replyDays} days, old price kept ${S.plan.lockIn.months} months longer</td></tr>` : ''}
      <tr><td>Replies so far</td><td class="r">${rt.accepted} accepted, ${rt.pushback} pushed back, ${rt.kept} kept old price, ${rt.left} left, ${rt.waiting} waiting</td></tr>
    </tbody></table>
    <h2>Biggest changes</h2><table><thead><tr><th>Client</th><th>Service</th><th class="r">Now</th><th class="r">New</th><th>Starts</th></tr></thead><tbody>
    ${raisedList().sort((a, b) => (b.price - b.old) * b.client.factor - (a.price - a.old) * a.client.factor).slice(0, 12).map((r) => `<tr><td>${esc(r.client.name)}</td><td>${esc(r.client.service)}</td><td class="r">${m2(r.old)}</td><td class="r">${m2(r.price)}</td><td>${esc(shortDate(r.effective))}</td></tr>`).join('')}
    </tbody></table>`;
  window.print();
}

// ---------- step 6: replies ----------
function viewReplies() {
  const rt = R.replyTotals(results, S.log);
  const marked = rt.raised - rt.waiting;
  const q = S.ui.rq.trim().toLowerCase();
  const list = raisedList().filter((r) => (S.ui.replyFilter === 'all' || (S.log[r.id]?.status || 'waiting') === S.ui.replyFilter)
    && (!q || r.client.name.toLowerCase().includes(q))).sort((a, b) => a.client.name.localeCompare(b.client.name));
  const shown = list.slice(0, S.ui.limit);
  const seg = (k) => rt.raised ? `<span class="st-${k}" style="width:${(rt[k] / rt.raised) * 100}%"></span>` : '';
  return head('Track replies', 'As clients answer, mark what happened. The totals keep score for you.') + `
  <div class="card" style="margin-bottom:16px" aria-live="polite">
    <p class="reply-sum">${marked ? `Kept <strong>${Math.round(rt.keptShare * 1000) / 10}%</strong> of clients, ${rt.netGain >= 0 ? `gained <strong class="gain">${m0(rt.netGain)} a month</strong>` : `down <strong class="loss">${m0(-rt.netGain)} a month</strong>`} so far.` : 'Nobody marked yet. Start as the first replies come in.'}</p>
    <p class="muted small" style="margin:0">${rt.waiting + rt.pushback ? `${plural(rt.waiting + rt.pushback, 'client')} still open, worth up to ${m0(rt.openGain)} a month more.` : 'Every client is marked.'}${rt.left ? ` ${plural(rt.left, 'client')} left, taking ${m0(rt.lostMonthly)} a month.` : ''}</p>
    <div class="bar" aria-hidden="true">${['accepted', 'pushback', 'kept', 'left', 'waiting'].map(seg).join('')}</div>
    <div class="legend">${STATUSES.map(([k, t]) => `<span><i class="st-${k}"></i>${t}: ${rt[k]}</span>`).join('')}</div>
  </div>
  <div class="toolbar">
    <label class="sr-only" for="rq">Search clients</label><input type="search" id="rq" placeholder="Search by name" value="${esc(S.ui.rq)}">
    <label class="sr-only" for="rfilter">Show</label><select id="rfilter"><option value="all">Everyone</option>${STATUSES.map(([k, t]) => `<option value="${k}" ${S.ui.replyFilter === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <span class="muted small">${plural(list.length, 'client')}</span>
  </div>
  <div class="table-wrap"><table class="data"><thead><tr><th>Client</th><th class="r">Now</th><th class="r">New</th><th>Reply</th><th>Note</th></tr></thead><tbody>
  ${shown.map((r) => `<tr><td>${esc(r.client.name)}<span class="sub">${esc(r.client.service)}</span></td><td class="r num">${m2(r.old)}</td><td class="r num">${m2(r.price)}</td>
    <td><label class="sr-only" for="st-${r.id}">Reply from ${esc(r.client.name)}</label><select id="st-${r.id}" data-status="${r.id}">${STATUSES.map(([k, t]) => `<option value="${k}" ${(S.log[r.id]?.status || 'waiting') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
    <td><label class="sr-only" for="nt-${r.id}">Note about ${esc(r.client.name)}</label><input type="text" class="note-in" id="nt-${r.id}" data-note="${r.id}" value="${esc(S.log[r.id]?.note || '')}" placeholder="e.g. asked to stay at old price till March"></td></tr>`).join('')
    || `<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No clients here.</td></tr>`}
  </tbody></table>
  ${list.length > shown.length ? `<div class="more"><button class="btn sm" data-action="more">Show ${Math.min(100, list.length - shown.length)} more</button> <button class="btn sm ghost" data-action="all">Show all ${list.length.toLocaleString('en-US')}</button></div>` : ''}</div>` + foot('send', null);
}

// ---------- events ----------
const panel = $('#panel');
document.addEventListener('click', (e) => {
  const b = e.target.closest('button, [data-action]');
  if (!b || b.disabled) return;
  if (b.dataset.step) { S.ui.limit = 100; go(b.dataset.step); return; }
  if (b.dataset.sort) { S.ui.dir = S.ui.sort === b.dataset.sort ? -S.ui.dir : 1; S.ui.sort = b.dataset.sort; save(); renderPanel(); return; }
  if (b.dataset.tone) { S.settings.tone = b.dataset.tone; save(); renderPanel(); $('#tone-' + b.dataset.tone)?.focus(); return; }
  if (b.dataset.ins) { insertTag(b.dataset.ins); return; }
  if (b.dataset.copy) { copyText($('#' + b.dataset.copy).innerText, b); return; }
  const a = b.dataset.action;
  if (!a) return;
  if (a === 'sample') loadSample(b.dataset.kind || 'clients');
  else if (a === 'clear') {
    if (!S.source || confirm('Start again with a different file? Your rule, notices and replies for this list will be cleared. Your business name and wording stay.')) {
      const keep = { settings: S.settings, templates: S.templates, gen: S.gen };
      S = { ...fresh(), ...keep }; save(); go('clients');
    }
  }
  else if (a === 'add-seg') { const d = S.plan.rules.default; S.plan.rules.segments.push({ field: built.clients.some((c) => c.service) ? 'service' : 'tag', value: '', type: d.type, amount: d.amount, round: d.round, floor: '', cap: '' }); changed(); }
  else if (a === 'del-seg') { S.plan.rules.segments.splice(+b.dataset.i, 1); changed(); }
  else if (a === 'more') { S.ui.limit += 100; renderPanel(); }
  else if (a === 'all') { S.ui.limit = 1e9; renderPanel(); }
  else if (a === 'prev-client' || a === 'next-client') {
    const list = raisedList(); const i = list.indexOf(previewResult());
    const n = list[i + (a === 'next-client' ? 1 : -1)]; if (n) { S.ui.previewId = n.id; save(); $('#notice-preview').innerHTML = noticePreview(); $(`[data-action="${a}"]`)?.focus(); }
  }
  else if (a === 'reset-tpl') { if (confirm('Go back to our original wording for this tone? Your edits to it will be lost.')) { S.templates[S.settings.tone] = structuredClone(N.DEFAULT_TEMPLATES[S.settings.tone]); changed(); } }
  else if (a === 'x-merge') { X.download(fileBase() + 'notices.csv', X.toCSV(mergeRows())); toast('Notices downloaded'); }
  else if (a === 'x-list') { X.download(fileBase() + 'price-changes-to-make.csv', X.toCSV(checklistRows())); toast('Checklist downloaded'); }
  else if (a === 'x-ics') { X.download(fileBase() + 'reminders.ics', X.toICS(icsEvents()), 'text/calendar;charset=utf-8'); toast('Calendar reminders downloaded'); }
  else if (a === 'print') printSummary();
  else if (a === 'save') saveProject();
});
const fileBase = () => 'price-raise-' + (S.source?.isSample ? 'SAMPLE-' : '') + R.todayISO() + '-';

let lastTpl = null;
for (const ev of ['focusin', 'click', 'keyup', 'select']) document.addEventListener(ev, (e) => { if (e.target.dataset?.tpl) lastTpl = e.target.id; });
function insertTag(tag) {
  const el = document.getElementById(lastTpl || 'tpl-body');
  if (!el) return;
  const s = el.selectionStart ?? el.value.length, en = el.selectionEnd ?? s;
  el.value = el.value.slice(0, s) + tag + el.value.slice(en);
  el.focus(); el.setSelectionRange(s + tag.length, s + tag.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e2) {} ta.remove();
  }
  const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = old), 1400);
}

function changed(full = true) { save(); recompute(); if (full) renderPanel(); }

panel.addEventListener('input', (e) => {
  const t = e.target, d = t.dataset;
  if (d.note) { (S.log[d.note] ||= {}).note = t.value; save(); return; }
  if (t.id === 'wins-text') {
    const key = $('#wins-for').value; S.settings.wins[key] = t.value; save();
    $('#wins-hint').textContent = winsHint(key, N.winLines(t.value).length);
    $('#notice-preview').innerHTML = noticePreview(); return;
  }
  if (d.loyal && t.type === 'number') { if (t.value !== '') setLoyal(d.loyal, Math.max(0, Number(t.value))); return; }
  if (d.rule) { ruleById(d.rule)[d.k] = t.type === 'number' ? (t.value === '' ? '' : Number(t.value)) : t.value; if (d.k === 'field') ruleById(d.rule).value = ''; return changedRules(); }
  if (d.plan) { S.plan[d.plan] = t.value === '' ? '' : inRange(d.plan, Number(t.value) || 0); if (d.plan === 'leadDays') S.plan.effective.date = S.plan.effective.date || ''; return changedRules(); }
  if (t.id === 'eff-date') { if (realDay(t.value)) { S.plan.effective.date = t.value; changedRules(); } return; }
  if (t.id === 'churn') {
    S.ui.churn = +t.value; save(); t.setAttribute('aria-valuetext', t.value + ' percent');
    const p = S.ui.churn / 100; $('#churn-answer').innerHTML = churnText(p, R.gainAfterChurn(tot, p), Math.round(tot.raised * p), tot.breakEvenChurn); return;
  }
  if (t.id === 'q') { S.ui.q = t.value; S.ui.limit = 100; save(); return renderPanel(); }
  if (t.id === 'rq') { S.ui.rq = t.value; S.ui.limit = 100; save(); return renderPanel(); }
  if (d.tpl) {
    S.templates[S.settings.tone][d.tpl] = t.value; save();
    const tt = S.templates[S.settings.tone];
    $('#notice-preview').innerHTML = noticePreview();
    $('#tpl-warn').innerHTML = tplWarn([...new Set([...N.unknownTags(tt.subject), ...N.unknownTags(tt.body), ...N.unknownTags(tt.sms)])], raisedList().filter((r) => N.renderNotice(r, tt, S.settings).smsTooLong).length);
    $('#tpl-saved').textContent = 'Your changes are kept for this tone.';
    $('[data-action="reset-tpl"]').disabled = JSON.stringify(tt) === JSON.stringify(N.DEFAULT_TEMPLATES[S.settings.tone]);
    return;
  }
  if (d.set && t.tagName === 'INPUT') { S.settings[d.set] = t.value; save(); $('#notice-preview').innerHTML = noticePreview(); }
});
function changedRules() { save(); recompute(); renderPanel(); }
function setLoyal(path, v) { const [a, b] = path.split('.'); S.plan[a][b] = path in PLAN_KEYS ? inRange(path, v) : v; changedRules(); }
const PLAN_KEYS = { 'grace.minMonths': 1, 'grace.months': 1, 'lockIn.replyDays': 1, 'lockIn.months': 1 };

panel.addEventListener('change', (e) => {
  const t = e.target, d = t.dataset;
  if (t.id === 'file' && t.files[0]) return readFile(t.files[0]);
  if (d.map) { S.mapping[d.map] = +t.value; if (d.map === 'price' || d.map === 'frequency') S.basis = guessBasis(S.source.headers, S.mapping); S.per = {}; return changed(); }
  if (t.name === 'basis') { S.basis = t.value; return changed(); }
  if (d.k === 'defaultFreq' || d.k === 'dateOrder') { if (!d.rule) { S[d.k] = t.value; return changed(); } }
  if (t.name === 'eff') { S.plan.effective.mode = t.value; return changed(); }
  if (d.xtag !== undefined) { const set = new Set(S.plan.excludeTags); t.checked ? set.add(d.xtag) : set.delete(d.xtag); S.plan.excludeTags = [...set]; return changed(); }
  if (d.inc) { (S.per[d.inc] ||= {}).include = t.checked; if (t.checked) delete S.per[d.inc].override; return changed(); }
  if (d.ov) {
    const r = results.find((x) => x.id === d.ov);
    const v = t.value.trim() === '' ? null : P.parseMoney(t.value);
    if (t.value.trim() !== '' && v === null) { toast('That price isn’t a number we can use. Try something like 125 or 125.50.'); return renderPanel(); }
    (S.per[d.ov] ||= {}).override = v === null || v === r.autoPrice ? null : v;
    return changed();
  }
  if (t.id === 'filter') { S.ui.filter = t.value; S.ui.limit = 100; return changed(); }
  if (t.id === 'rfilter') { S.ui.replyFilter = t.value; S.ui.limit = 100; return changed(); }
  if (t.id === 'pick-client') { S.ui.previewId = t.value; save(); $('#notice-preview').innerHTML = noticePreview(); $('#pick-client').focus(); return; }
  if (d.set && t.tagName === 'SELECT') { S.settings[d.set] = t.value; return changed(); }
  if (d.status) { (S.log[d.status] ||= {}).status = t.value; return changed(); }
  if (d.loyal && t.type !== 'number') return setLoyal(d.loyal, t.type === 'checkbox' ? t.checked : Number(t.value));
  if (t.id === 'wins-for') { S.ui.winsFor = t.value; return changed(); }
  if (t.id === 'set-trade') {
    const w = S.settings.wins, now = (w['*'] || '').trim(), isDefault = !now || Object.keys(N.TRADES).some((k) => N.tradeWins(k) === now);
    S.settings.trade = t.value;
    if (isDefault || confirm('Replace your every-service wins with our ideas for this trade?')) { w['*'] = N.tradeWins(t.value); S.ui.winsFor = '*'; }
    return changed();
  }
  if (d.note) { (S.log[d.note] ||= {}).note = t.value; save(); return; }
});

// drag and drop
panel.addEventListener('dragover', (e) => { const z = e.target.closest('#drop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
panel.addEventListener('dragleave', (e) => { e.target.closest('#drop')?.classList.remove('over'); });
panel.addEventListener('drop', (e) => { const z = e.target.closest('#drop'); if (!z) return; e.preventDefault(); z.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readFile(f); });

// project file
function saveProject() {
  X.download(fileBase() + 'project.json', JSON.stringify({ app: 'price-raise', version: 1, savedAt: new Date().toISOString(), state: S }), 'application/json');
  toast('Project saved. Open it here any time to carry on.');
}
$('#save-project').addEventListener('click', saveProject);
$('#open-project').addEventListener('click', () => $('#project-file').click());
$('#project-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'price-raise' || !data.state) throw new Error('not ours');
    if (S.source && !confirm('Open this project? It replaces the list you have open now.')) return;
    S = upgrade(data.state); save(); location.hash = '#/app'; renderApp(); toast('Project opened');
  } catch (err) { toast('That file isn’t a Price Raise project file.'); }
});

// theme
$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('pr-theme', document.documentElement.dataset.theme); } catch (e) {}
});

// ---------- free letter generator (landing) ----------
function renderGen() {
  const g = S.gen;
  const sel = $('#g-tone');
  if (!sel.options.length) {
    sel.innerHTML = Object.entries(N.TONES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    $('#g-trade').innerHTML = Object.entries(N.TRADES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    for (const [id, k] of [['g-business', 'business'], ['g-owner', 'owner'], ['g-first', 'first'], ['g-service', 'service'], ['g-old', 'old'], ['g-new', 'nw'], ['g-date', 'date'], ['g-tone', 'tone'], ['g-trade', 'trade'], ['g-wins', 'wins']]) {
      const el = document.getElementById(id);
      el.value = k === 'wins' ? g.wins ?? N.tradeWins(g.trade) : g[k] || (k === 'date' ? R.defaultEffectiveDate(R.todayISO(), 30) : k === 'tone' ? 'warm' : k === 'trade' ? 'cleaning' : '');
      el.addEventListener('input', () => {
        if (k === 'trade') {
          const w = $('#g-wins'), now = w.value.trim();
          if (!now || Object.keys(N.TRADES).some((x) => N.tradeWins(x) === now)) w.value = g.wins = N.tradeWins(el.value);
        }
        g[k] = el.value; save(); genOut();
      });
    }
  }
  genOut();
}
function genOut() {
  const v = (id) => document.getElementById(id).value.trim();
  const old = P.parseMoney(v('g-old')), nw = P.parseMoney(v('g-new'));
  const result = { client: { firstName: v('g-first') || 'Jordan', service: v('g-service') || 'fortnightly clean' }, old: old ?? 120, price: nw ?? (old != null ? Math.round(old * 1.05) : 126),
    effective: v('g-date') || R.defaultEffectiveDate(R.todayISO(), 30) };
  const n = N.renderNotice(result, N.DEFAULT_TEMPLATES[v('g-tone') || 'warm'], { business: v('g-business') || 'Brightside Cleaning', owner: v('g-owner') || 'Sam', currency: '$', dateStyle: 'us', wins: { '*': $('#g-wins').value } });
  $('#gen-email').innerHTML = `<div class="letter-subject">Subject: ${esc(n.subject)}</div>${esc(n.body)}`;
  $('#gen-sms').textContent = n.sms;
  const c = $('#gen-sms-count'); c.textContent = `${n.smsLength} / ${N.SMS_LIMIT}`; c.classList.toggle('over', n.smsTooLong);
}

route();
