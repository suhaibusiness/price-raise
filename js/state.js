// Project state: a fresh project, and upgrade() for anything read back from this browser or a project file.
import * as N from './notices.js';
import * as R from './rules.js';
import * as P from './parse.js';

export function fresh() {
  return {
    v: 1, step: 'clients', source: null, mapping: {}, basis: 'month', defaultFreq: 'monthly', dateOrder: 'auto',
    plan: { rules: { default: { type: 'percent', amount: 5, round: '1', floor: '', cap: '' }, segments: [] },
      excludeTags: [], newerThanMonths: 0, effective: { mode: 'date', date: '' }, leadDays: 30,
      grace: { on: true, minMonths: 24, months: 3 }, lockIn: { on: false, replyDays: 14, months: 6 } },
    per: {}, log: {},
    settings: { business: '', owner: '', currency: '$', dateStyle: 'us', tone: 'warm', trade: 'cleaning', wins: { '*': N.tradeWins('cleaning') } },
    templates: structuredClone(N.DEFAULT_TEMPLATES), tplVersion: 2,
    gen: { tone: 'warm', trade: 'cleaning', wins: N.tradeWins('cleaning'), business: '', owner: '', first: '', service: '', old: '', nw: '', date: '' },
    ui: { sort: 'name', dir: 1, filter: 'all', q: '', limit: 100, previewId: '', churn: 2, replyFilter: 'all', rq: '', winsFor: '*' },
  };
}
// A saved project or a project file can come from anyone (and this browser's storage is shared with the other tools
// on the same site), so every value is reshaped to the type the app writes, and every choice to one the app offers.
// Nothing read back can then reach the page as markup or stop the app.
export const CURRENCIES = ['$', '£', '€', 'R'];
const STEP_KEYS = ['clients', 'rules', 'preview', 'notices', 'send', 'replies'];
const STATUS_KEYS = ['waiting', 'accepted', 'pushback', 'kept', 'left'];
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (v, ok, d) => (ok.includes(v) ? v : d);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const numOrBlank = (v, d) => (v === '' ? '' : num(v, d));
const cell = (v) => (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) ? v : '');
const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
// Dates must exist and fall in a sane range; plan numbers stay within what the app offers. Anything else would make the
// date maths fail and stop the app on every visit.
export const realDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && +v.slice(0, 4) >= 1900 && +v.slice(0, 4) <= 2100
  && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v ? v : '');
export const PLAN_LIMITS = { leadDays: [0, 365], newerThanMonths: [0, 600], 'grace.minMonths': [0, 600], 'grace.months': [0, 24], 'lockIn.replyDays': [0, 60], 'lockIn.months': [0, 24] };
export const inRange = (key, v) => (v === '' ? '' : Number.isFinite(v) ? Math.min(PLAN_LIMITS[key][1], Math.max(PLAN_LIMITS[key][0], v)) : PLAN_LIMITS[key][0]);
const textMap = (o) => (isObj(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string')) : null);
// Same keys and types as the default d; anything else falls back to the default.
function like(d, v) {
  if (isObj(d)) return Object.fromEntries(Object.keys(d).map((k) => [k, like(d[k], isObj(v) ? v[k] : undefined)]));
  if (typeof d === 'number') return numOrBlank(v, d);
  if (typeof d === 'boolean') return typeof v === 'boolean' ? v : d;
  if (typeof d === 'string') return typeof v === 'string' ? v : d;
  return d;
}
const rule = (r, d, seg) => {
  const x = isObj(r) ? r : {};
  return { ...(seg ? { field: one(x.field, ['service', 'tag'], 'service'), value: typeof x.value === 'string' ? x.value : '' } : {}),
    type: one(x.type, ['percent', 'fixed'], d.type), amount: numOrBlank(x.amount, d.amount), round: one(x.round, R.ROUNDING.map(([k]) => k), d.round),
    floor: numOrBlank(x.floor, ''), cap: numOrBlank(x.cap, '') };
};
export function upgrade(s) {
  const f = fresh();
  if (!isObj(s)) return f;
  const out = like(f, s);
  out.step = one(s.step, STEP_KEYS, f.step);
  out.basis = one(s.basis, ['month', 'visit', 'year'], f.basis);
  out.defaultFreq = one(s.defaultFreq, P.FREQ_OPTIONS.map(([k]) => k), f.defaultFreq);
  out.dateOrder = one(s.dateOrder, ['auto', 'mdy', 'dmy'], f.dateOrder);
  const src = s.source;
  out.source = isObj(src) && Array.isArray(src.headers) && Array.isArray(src.rows)
    ? { fileName: typeof src.fileName === 'string' ? src.fileName : '', headers: src.headers.map(cell), rows: src.rows.map((r) => (Array.isArray(r) ? r.map(cell) : [])),
      isSample: src.isSample === true, sampleLabel: typeof src.sampleLabel === 'string' ? src.sampleLabel : '' }
    : null;
  out.mapping = isObj(s.mapping) ? Object.fromEntries(Object.entries(s.mapping).filter(([, v]) => Number.isInteger(v))) : {};
  const entries = (o, fn) => (isObj(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => isObj(v)).map(([k, v]) => [k, fn(v)])) : {});
  out.per = entries(s.per, (e) => Object.fromEntries(Object.entries(e).filter(([k, v]) => (k === 'include' && typeof v === 'boolean') || (k === 'override' && (v === null || num(v, null) !== null)))));
  out.log = entries(s.log, (e) => Object.fromEntries(Object.entries(e).filter(([k, v]) => (k === 'status' && STATUS_KEYS.includes(v)) || (k === 'note' && typeof v === 'string'))));
  const p = isObj(s.plan) ? s.plan : {};
  out.plan.rules = { default: rule(p.rules?.default, f.plan.rules.default), segments: (Array.isArray(p.rules?.segments) ? p.rules.segments : []).filter(isObj).map((x) => rule(x, f.plan.rules.default, true)) };
  out.plan.excludeTags = strings(p.excludeTags);
  out.plan.effective = { mode: one(p.effective?.mode, ['date', 'anniversary'], 'date'), date: realDay(p.effective?.date) };
  const pl = out.plan;
  pl.leadDays = inRange('leadDays', pl.leadDays); pl.newerThanMonths = inRange('newerThanMonths', pl.newerThanMonths);
  for (const [a, b] of [['grace', 'minMonths'], ['grace', 'months'], ['lockIn', 'replyDays'], ['lockIn', 'months']]) pl[a][b] = inRange(`${a}.${b}`, pl[a][b]);
  const st = out.settings;
  st.currency = one(st.currency, CURRENCIES, '$');
  st.dateStyle = one(st.dateStyle, ['us', 'uk'], 'us');
  st.tone = one(st.tone, Object.keys(N.TONES), 'warm');
  st.trade = one(st.trade, Object.keys(N.TRADES), 'cleaning');
  st.wins = textMap(s.settings?.wins) || f.settings.wins;
  out.gen.tone = one(out.gen.tone, Object.keys(N.TONES), 'warm');
  out.gen.trade = one(out.gen.trade, Object.keys(N.TRADES), 'cleaning');
  // Notices written before the five-part structure (v1.1) are replaced by the new wording.
  out.templates = s.tplVersion === 2 ? out.templates : f.templates;
  out.tplVersion = 2;
  return out;
}
