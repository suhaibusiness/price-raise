// Rules engine: new prices, exclusions, effective and notice dates, totals. Pure functions, all money in cents inside.

export const ROUNDING = [
  ['none', 'No rounding (to the cent)'],
  ['1', 'Nearest $1'],
  ['5', 'Nearest $5'],
  ['99', 'Ending in .99'],
];

const toC = (n) => Math.round(n * 100);
const fromC = (c) => c / 100;

// Rounded value nearest to c (cents), plus helpers for the next step up and the step at or below.
function roundC(c, mode) {
  if (mode === '1') return Math.round(c / 100) * 100;
  if (mode === '5') return Math.round(c / 500) * 500;
  if (mode === '99') return Math.round((c + 1) / 100) * 100 - 1;
  return c;
}
function downC(c, mode) {
  if (mode === '1') return Math.floor(c / 100) * 100;
  if (mode === '5') return Math.floor(c / 500) * 500;
  if (mode === '99') return Math.floor((c + 1) / 100) * 100 - 1;
  return c;
}
function upC(c, mode) { // smallest rounded value strictly above c
  if (mode === '1') return Math.floor(c / 100) * 100 + 100;
  if (mode === '5') return Math.floor(c / 500) * 500 + 500;
  if (mode === '99') return Math.floor((c + 1) / 100) * 100 + 99;
  return c + 1;
}

// One price through one rule. rule: { type: 'percent'|'fixed', amount, round, floor, cap }
// Order: rise -> round -> never below old -> cap on the rise -> floor (the owner's minimum wins over the cap).
export function raisePrice(old, rule) {
  const o = toC(old);
  const amt = Number(rule.amount) || 0;
  if (amt <= 0 && !(Number(rule.floor) > old)) return { price: old, reason: 'no-rise' };
  let c = rule.type === 'fixed' ? o + toC(amt) : Math.round(o * (1 + amt / 100));
  let reason = 'rule';
  if (amt > 0) {
    c = roundC(c, rule.round);
    if (c <= o) c = upC(o, rule.round);
    const cap = Number(rule.cap);
    if (cap > 0 && c - o > toC(cap)) {
      c = downC(o + toC(cap), rule.round);
      if (c <= o) c = o + toC(cap);
      reason = 'cap';
    }
  } else c = o;
  const floor = Number(rule.floor);
  if (floor > 0 && c < toC(floor)) { c = toC(floor); reason = 'floor'; }
  return { price: fromC(c), reason };
}

// ---- dates (all "YYYY-MM-DD", computed in UTC so time zones never shift a day) ----
const D = (s) => new Date(s + 'T00:00:00Z');
const S = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
export const addMonths = (s, n) => { const d = D(s); d.setUTCMonth(d.getUTCMonth() + n); return S(d); };
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// First of the month on or after a date.
export function firstOfMonthOnOrAfter(s) {
  const d = D(s);
  if (d.getUTCDate() === 1) return s;
  return S(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
}
// Default single effective date: the first of the month after the notice period.
export const defaultEffectiveDate = (today, leadDays) => firstOfMonthOnOrAfter(addDays(today, leadDays));

// Anniversary: the 1st of the client's start month, the first one that still leaves the full notice period.
export function anniversaryDate(since, today, leadDays) {
  const month = D(since).getUTCMonth();
  const earliest = addDays(today, leadDays);
  let y = D(today).getUTCFullYear();
  for (let i = 0; i < 3; i++, y++) {
    const cand = S(new Date(Date.UTC(y, month, 1)));
    if (cand >= earliest) return cand;
  }
  return null;
}

export function matchRule(client, rules) {
  for (const seg of rules.segments || []) {
    if (!seg.value) continue;
    if (seg.field === 'service' && client.service.toLowerCase() === seg.value.toLowerCase()) return seg;
    if (seg.field === 'tag' && client.tags.some((t) => t.toLowerCase() === seg.value.toLowerCase())) return seg;
  }
  return rules.default;
}

// plan: { rules, excludeTags[], newerThanMonths, effective: { mode: 'date'|'anniversary', date }, leadDays,
//   grace: { on, minMonths, months }, lockIn: { on, replyDays, months } }
// Loyalty grace: clients with you minMonths or longer start months later. Notices still go out on the usual day,
// so they simply get more warning. Lock-in: reply within replyDays of the notice to keep the old price for months more.
// per: { [clientId]: { include: bool, override: number|null } }
export function computeAll(clients, plan, per = {}, today = todayISO()) {
  const lead = Number(plan.leadDays) >= 0 ? Number(plan.leadDays) : 30;
  const fixed = plan.effective?.date || defaultEffectiveDate(today, lead);
  const excludeTags = (plan.excludeTags || []).map((t) => t.toLowerCase());
  const newer = Number(plan.newerThanMonths) || 0;
  const cutoff = newer > 0 ? addMonths(today, -newer) : null;
  const graceMonths = plan.grace?.on ? Math.max(0, Math.round(Number(plan.grace.months) || 0)) : 0;
  const graceCut = graceMonths ? addMonths(today, -(Math.max(0, Number(plan.grace.minMonths) || 0))) : null;
  return clients.map((c) => {
    const p = per[c.id] || {};
    const r = { id: c.id, client: c, old: c.price, price: c.price, autoPrice: c.price, raised: false, excluded: '', reason: '',
      overridden: false, effective: '', baseEffective: '', notice: '', grace: 0, lockBy: '', lockUntil: '', rule: null };
    if (c.price === null) { r.excluded = 'No price in your file'; return r; }
    if (p.include === false) r.excluded = 'You unticked this client';
    else if (excludeTags.length && c.tags.some((t) => excludeTags.includes(t.toLowerCase()))) r.excluded = 'Excluded tag';
    else if (cutoff && c.since && c.since > cutoff) r.excluded = `Client for under ${newer} month${newer === 1 ? '' : 's'}`;
    const rule = matchRule(c, plan.rules);
    r.rule = rule;
    const out = raisePrice(c.price, rule);
    r.autoPrice = out.price;
    r.reason = out.reason;
    if (r.excluded) return r;
    const ov = p.override;
    r.price = ov !== null && ov !== undefined && ov !== '' && Number.isFinite(Number(ov)) ? Number(ov) : out.price;
    r.overridden = r.price !== out.price;
    r.raised = r.price !== c.price;
    if (!r.raised) { r.excluded = r.overridden ? 'Kept at current price' : 'No rise under this rule'; return r; }
    r.baseEffective = plan.effective?.mode === 'anniversary' && c.since ? anniversaryDate(c.since, today, lead) : fixed;
    r.notice = addDays(r.baseEffective, -lead);
    r.effective = r.baseEffective;
    if (graceCut && c.since && c.since <= graceCut) { r.grace = graceMonths; r.effective = addMonths(r.baseEffective, graceMonths); }
    if (plan.lockIn?.on) { r.lockBy = addDays(r.notice, Number(plan.lockIn.replyDays) || 14); r.lockUntil = addMonths(r.effective, Number(plan.lockIn.months) || 6); }
    return r;
  });
}

// Monthly money. factor turns one price into its monthly value.
// graceCost: the rise you give up while long-time clients keep their old price, over the next 12 months from today.
export function totals(results, today = todayISO()) {
  let oldM = 0, newM = 0, raisedNewM = 0, raised = 0, excluded = 0, lateNotice = 0, graceClients = 0, graceCost = 0;
  const yearOut = addMonths(today, 12);
  for (const r of results) {
    if (r.old === null) { excluded++; continue; }
    const f = r.client.factor;
    oldM += r.old * f;
    newM += r.price * f;
    if (r.raised) {
      raised++; raisedNewM += r.price * f; if (r.notice && r.notice < today) lateNotice++;
      if (r.grace) {
        graceClients++;
        for (let k = 0; k < r.grace; k++) { const m = addMonths(r.baseEffective, k); if (m >= today && m < yearOut) graceCost += (r.price - r.old) * f; }
      }
    }
    else excluded++;
  }
  const gain = newM - oldM;
  return { oldMonthly: oldM, newMonthly: newM, gainMonthly: gain, gainYearly: gain * 12, raisedNewMonthly: raisedNewM,
    raised, excluded, lateNotice, graceClients, graceCost, breakEvenChurn: raisedNewM > 0 ? gain / raisedNewM : 0 };
}

// If a share p (0..1) of raised clients leave, the monthly gain that remains (average client).
export const gainAfterChurn = (t, p) => t.gainMonthly - p * t.raisedNewMonthly;

// Pushback log totals. log: { [id]: { status: 'waiting'|'accepted'|'pushback'|'kept'|'left', note } }
export function replyTotals(results, log = {}) {
  const out = { waiting: 0, accepted: 0, pushback: 0, kept: 0, left: 0, raised: 0, confirmedGain: 0, lostMonthly: 0, openGain: 0 };
  for (const r of results) {
    if (!r.raised) continue;
    out.raised++;
    const f = r.client.factor;
    const st = log[r.id]?.status || 'waiting';
    out[st]++;
    if (st === 'accepted') out.confirmedGain += (r.price - r.old) * f;
    else if (st === 'left') out.lostMonthly += r.old * f;
    else if (st === 'waiting' || st === 'pushback') out.openGain += (r.price - r.old) * f;
  }
  out.netGain = out.confirmedGain - out.lostMonthly;
  out.keptShare = out.raised ? (out.raised - out.left) / out.raised : 1;
  return out;
}
