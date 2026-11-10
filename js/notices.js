// Notice templates (hand-written, three tones) and merge.
// Every email runs in the same five-part order: remind them of the value, address the change plainly,
// say what it pays for, soften it for loyal clients, and answer worries in a P.S.

export const MERGE_FIELDS = ['first_name', 'service', 'old_price', 'new_price', 'effective_date', 'business_name', 'owner_name',
  'client_years', 'client_since', 'wins', 'loyalty', 'lock_in', 'reassure', 'sms_reassure'];

export const TONES = {
  warm: { label: 'Warm thank-you', hint: 'Personal and grateful. Best for long-time clients you know by name.' },
  plain: { label: 'Plain and short', hint: 'Straight to the point. Respects a busy reader.' },
  premium: { label: 'Premium', hint: 'Polished and calm. Suits higher-end or commercial work.' },
};

export const DEFAULT_TEMPLATES = {
  warm: {
    subject: 'Your {service} from {effective_date}, and a thank-you',
    body: `Hi {first_name},

Thank you for trusting us with your {service}. It means a lot, and we don't take it for granted.

Here's what you've had from us so far:
{wins}

From {effective_date}, your {service} will be {new_price}, up from {old_price}. I'd rather tell you straight, and in good time, than have it turn up on an invoice.

The extra lets us keep paying good people properly, keep the same faces at your door and keep turning up when we said we would. Fuel, supplies and wages have all gone up, and I won't cut corners on your home to cover it.

{loyalty}

{lock_in}

Thanks for being with us,
{owner_name}
{business_name}

P.S. {reassure}`,
    sms: 'Hi {first_name}, thank you for being with {business_name}. From {effective_date} it\'s {new_price} (now {old_price}). {sms_reassure} Letter by email.',
  },
  plain: {
    subject: 'Price update from {effective_date}',
    body: `Hi {first_name},

Thanks for having us look after your {service}.

What you get from us:
{wins}

From {effective_date}, your {service} will be {new_price}. It's {old_price} now.

This keeps us paying good people properly and turning up when we say we will.

{loyalty}

{lock_in}

Thanks,
{owner_name}, {business_name}

P.S. {reassure}`,
    sms: "{business_name}: from {effective_date} it's {new_price} (now {old_price}). Thanks for staying with us. {sms_reassure} Letter by email.",
  },
  premium: {
    subject: 'Your {service} with {business_name}: a note about {effective_date}',
    body: `Dear {first_name},

Thank you for choosing {business_name}. Looking after your property is work we take real pride in.

What we hold ourselves to on every visit:
{wins}

From {effective_date}, your {service} will be {new_price}, up from {old_price}. We review our prices once a year, and I wanted you to hear it from me well ahead of time.

It lets us keep investing in good people, properly trained and properly paid, and in the reliable service you expect from us.

{loyalty}

{lock_in}

With thanks,
{owner_name}
{business_name}

P.S. {reassure}`,
    sms: 'Dear {first_name}, thank you for choosing {business_name}. From {effective_date}: {new_price} (from {old_price}). {sms_reassure} Letter by email.',
  },
};

// Starting wins per trade. The owner edits them; only what's true for their business should stay.
export const TRADES = {
  cleaning: { label: 'Cleaning', wins: ['The same small team every visit, so you never have to explain your home twice', 'Every visit on the day we promised', "If anything's missed, we come back and put it right for free"] },
  lawn: { label: 'Lawn care', wins: ['Your lawn cut on schedule all season, with rain days made up the same week', 'Edges trimmed and clippings cleared every visit', 'The same crew, who know your gate and where the dog stays'] },
  pool: { label: 'Pool care', wins: ['Water tested and balanced every visit', 'Filters and baskets cleaned so your pump lasts longer', 'A heads-up from us before small problems turn into repairs'] },
  pest: { label: 'Pest control', wins: ['Regular treatments that stop pests before you see them', 'Free call-backs between visits if anything turns up', 'Treatments chosen to be safe around your family and pets'] },
  window: { label: 'Window cleaning', wins: ['Streak-free glass, with frames and sills wiped every visit', 'A text the day before, so you always know when we are coming', 'Screens and tracks cleaned at no extra charge'] },
};
export const tradeWins = (trade) => (TRADES[trade] || TRADES.cleaning).wins.join('\n');

export const SMS_LIMIT = 160;

export function money(n, symbol = '$') {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '';
  const v = Math.abs(Number(n));
  const s = Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (Number(n) < 0 ? '-' : '') + symbol + s;
}

export function longDate(iso, style = 'us') {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(style === 'uk' ? 'en-GB' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// "Weekly clean" reads better mid-sentence as "weekly clean"; names like "Pool Pro Plan" or "VIP clean" stay as they are.
export function sentenceService(s) {
  const w = String(s ?? '').trim().split(/\s+/);
  if (!w[0]) return '';
  if (/^[A-Z][a-z]+$/.test(w[0]) && w.slice(1).every((x) => !/[A-Z]/.test(x))) w[0] = w[0].toLowerCase();
  return w.join(' ');
}

// Whole months from one date to another, counting a month only once its day has come round.
export function monthsBetween(from, to) {
  const a = new Date(from + 'T00:00:00Z'), b = new Date(to + 'T00:00:00Z');
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) m--;
  return m;
}
// "3 years", "1 year", "8 months". Empty when the start date is unknown.
export function clientYears(since, asOf) {
  if (!since || !asOf) return '';
  const m = monthsBetween(since, asOf);
  if (m < 1) return '';
  if (m < 12) return `${m} month${m === 1 ? '' : 's'}`;
  const y = Math.floor(m / 12);
  return `${y} year${y === 1 ? '' : 's'}`;
}

// Businesses get a different P.S. from households.
export function isBusiness(c) {
  return (c.tags || []).some((t) => /commercial|business|office/i.test(t)) || /\b(office|commercial)\b/i.test(c.service || '')
    || /\b(llc|inc|ltd|corp|co|company|group)\.?$/i.test(String(c.name || '').trim());
}

// The owner's wins for a client's service (falling back to the ones for every service), as bullet lines.
// Empty lines and lone bullet marks are dropped, and at most 5 are used.
export function winLines(text) {
  return String(text ?? '').split(/\r?\n/).map((l) => l.replace(/^\s*[-*•·]+\s*/, '').trim()).filter(Boolean).slice(0, 5).map((l) => '• ' + l);
}
export function winsFor(service, wins = {}) {
  const own = winLines(wins[service]);
  return own.length ? own : winLines(wins['*']);
}

export function mergeData(result, settings) {
  const c = result.client;
  const cur = settings.currency;
  const ds = settings.dateStyle;
  const years = clientYears(c.since, result.notice || result.effective);
  const biz = isBusiness(c);
  let loyalty = 'Until then, every visit stays at your current price. Nothing else changes: same people, same schedule, same care.';
  if (result.grace) {
    loyalty = `${years ? `You've been with us for ${years}, so as` : 'As'} a thank-you, you keep your current price ${result.grace} month${result.grace === 1 ? '' : 's'} longer than everyone else. Until then, nothing changes.`;
  }
  return {
    first_name: c.firstName || 'there',
    service: sentenceService(c.service) || 'regular service',
    old_price: money(result.old, cur),
    new_price: money(result.price, cur),
    effective_date: longDate(result.effective, ds),
    business_name: settings.business || 'your business name',
    owner_name: settings.owner || 'your name',
    client_years: years,
    client_since: c.since ? new Date(c.since + 'T00:00:00Z').toLocaleDateString(ds === 'uk' ? 'en-GB' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '',
    wins: winsFor(c.service, settings.wins).join('\n'),
    loyalty,
    lock_in: result.lockBy ? `If you'd like to keep ${money(result.old, cur)} for longer, just reply by ${longDate(result.lockBy, ds)} to say you're staying with us, and we'll keep you at ${money(result.old, cur)} until ${longDate(result.lockUntil, ds)}.` : '',
    reassure: biz ? "If this genuinely hurts your business, tell me. I'd much rather find a way through together." : "If this makes things hard for you, just reply and we'll work something out.",
    sms_reassure: biz ? 'If it hurts your business, tell me.' : "Hard on you? Reply, we'll work it out.",
  };
}

export const merge = (tpl, data) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in data ? data[k] : m));

// A paragraph that uses a field which is empty for this client (no wins, no start date, no lock-in) is left out,
// so a letter never shows an empty bullet, a dangling heading or a gap.
export function mergeBody(tpl, data) {
  return String(tpl).replace(/\r\n/g, '\n').split(/\n{2,}/)
    .filter((p) => ![...p.matchAll(/\{(\w+)\}/g)].some((m) => m[1] in data && !String(data[m[1]]).trim()))
    .map((p) => merge(p, data).trim()).filter(Boolean).join('\n\n');
}
const tidy = (s) => s.replace(/ {2,}/g, ' ').replace(/ ([.,:)])/g, '$1').trim();

// Unknown {tags} in a template (typos like {frist_name}).
export const unknownTags = (tpl) => [...String(tpl).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !MERGE_FIELDS.includes(k));

export function renderNotice(result, tpl, settings) {
  const data = mergeData(result, settings);
  const sms = tidy(merge(tpl.sms, data));
  return { subject: tidy(merge(tpl.subject, data)), body: mergeBody(tpl.body, data), sms, smsLength: sms.length, smsTooLong: sms.length > SMS_LIMIT };
}
