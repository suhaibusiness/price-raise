// Parsing: money, frequency, dates, column guessing, building clients from raw rows.

export const FIELDS = [
  { key: 'name', label: 'Client name', required: true },
  { key: 'firstName', label: 'First name (optional)' },
  { key: 'lastName', label: 'Last name (optional)' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'service', label: 'Service' },
  { key: 'price', label: 'Current price', required: true },
  { key: 'frequency', label: 'How often (frequency)' },
  { key: 'since', label: 'Client since' },
  { key: 'tags', label: 'Tags' },
  { key: 'jobNumber', label: 'Job number (optional)' },
];

// Header aliases. Jobber names come from its Recurring Jobs Report help page (see README).
const ALIASES = {
  name: ['client name', 'name', 'customer', 'customer name', 'client', 'full name', 'contact name', 'company name', 'display name'],
  firstName: ['first name', 'firstname', 'given name'],
  lastName: ['last name', 'lastname', 'surname', 'family name'],
  email: ['client email', 'email', 'email address', 'e-mail', 'customer email', 'emails'],
  phone: ['client phone number', 'phone', 'phone number', 'mobile', 'cell', 'mobile phone', 'customer phone', 'client phone', 'telephone', 'main phone'],
  service: ['job title', 'service', 'service type', 'line items', 'job', 'description', 'item', 'product', 'plan', 'service name'],
  price: ['total ($)', 'total', 'price', 'current price', 'amount', 'rate', 'unit price', 'total price', 'price per visit', 'monthly price', 'fee', 'charge', 'recurring amount'],
  frequency: ['frequency', 'repeating', 'how often', 'recurrence', 'schedule', 'interval', 'visit frequency', 'repeats'],
  since: ['client since', 'customer since', 'schedule start date', 'start date', 'created', 'created date', 'created at', 'date added', 'joined', 'since', 'first visit'],
  tags: ['tags', 'tag', 'labels', 'segment', 'group', 'category'],
  jobNumber: ['job #', 'job number', 'job no', 'job id', 'j-id', 'id', 'customer id', 'client id', 'account number'],
};

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Returns { fieldKey: headerIndex | -1 }. Exact alias match first, then "header contains alias".
export function guessMapping(headers) {
  const h = headers.map(norm);
  const used = new Set();
  const map = {};
  for (const pass of ['exact', 'contains']) {
    for (const f of FIELDS) {
      if (map[f.key] !== undefined && map[f.key] !== -1) continue;
      let found = -1;
      for (const alias of ALIASES[f.key]) {
        const i = h.findIndex((x, idx) => !used.has(idx) && (pass === 'exact' ? x === alias : alias.length > 3 && x.includes(alias)));
        if (i !== -1) { found = i; break; }
      }
      if (found !== -1) used.add(found);
      map[f.key] = found;
    }
  }
  return map;
}

// "$1,250.00" -> 1250, "45,50" -> 45.5, "1.250,00" -> 1250, "" -> null, "abc" -> null, negatives -> null.
export function parseMoney(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? round2(v) : null;
  let s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d.,-]/g, ''))) return null;
  s = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma !== -1) {
    const after = s.length - lastComma - 1;
    const commas = s.split(',').length - 1;
    s = commas === 1 && after > 0 && after <= 2 ? s.replace(',', '.') : s.split(',').join('');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.split('.').join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : null;
}

export const round2 = (n) => Math.round(n * 100) / 100;

const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, twelve: 12, other: 2 };

// Visits per month for a frequency label, or null if not understood.
export function parseFrequency(v) {
  let s = norm(v).replace(/-/g, ' ');
  if (!s) return null;
  if (/^(as needed|on call|one off|once|one time)$/.test(s)) return null;
  if (/twice (a|per|every) week|2x (a |per )?week|2 times (a|per) week|semi ?weekly/.test(s)) return 104 / 12;
  if (/twice (a|per|every) month|2x (a |per )?month|semi ?monthly/.test(s)) return 2;
  if (/twice (a|per) year|semi ?annual|bi ?annual/.test(s)) return 2 / 12;
  if (/fortnight|bi ?weekly|every other week/.test(s)) return 26 / 12;
  if (/bi ?monthly|every other month/.test(s)) return 0.5;
  if (/quarter/.test(s)) return 1 / 3;
  const m = s.match(/every (\d+|one|two|three|four|five|six|eight|twelve) (day|week|month|year)s?/) || s.match(/^(\d+) ?(day|week|month|year)s?(ly)?$/);
  if (m) {
    const n = Number(m[1]) || WORDNUM[m[1]];
    if (!n) return null;
    return { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[m[2]] / n;
  }
  if (/(^|\s)(daily|every day)/.test(s)) return 365 / 12;
  if (/(^|\s)(weekly|every week|once a week|per week)/.test(s)) return 52 / 12;
  if (/(^|\s)(monthly|every month|once a month|per month)/.test(s)) return 1;
  if (/(^|\s)(yearly|annual|annually|every year|once a year|per year)/.test(s)) return 1 / 12;
  return null;
}

export const FREQ_OPTIONS = [
  ['weekly', 'Weekly', 52 / 12],
  ['fortnightly', 'Every 2 weeks', 26 / 12],
  ['every3weeks', 'Every 3 weeks', 52 / 36],
  ['every4weeks', 'Every 4 weeks', 13 / 12],
  ['monthly', 'Monthly', 1],
  ['every2months', 'Every 2 months', 0.5],
  ['quarterly', 'Every 3 months', 1 / 3],
  ['yearly', 'Once a year', 1 / 12],
];

// Dates: ISO, US (m/d/y) or day-first (d/m/y), "Jan 5, 2021", Excel serials, Date objects. Returns "YYYY-MM-DD" or null.
// Dates outside 1900-2100 are left blank: they are typos, and the date maths can't handle the far ones.
export function parseDate(v, order = 'auto') {
  const d = readDate(v, order);
  return d && /^\d{4}-/.test(d) && +d.slice(0, 4) >= 1900 && +d.slice(0, 4) <= 2100 ? d : null;
}
function readDate(v, order) {
  if (v instanceof Date) return isNaN(v) ? null : ymd(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) return ymd(new Date(Date.UTC(1899, 11, 30) + v * 864e5), true);
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += y > 50 ? 1900 : 2000;
    let dayFirst = order === 'dmy';
    if (order === 'auto') dayFirst = a > 12;
    return dayFirst ? mk(y, b, a) : mk(y, a, b);
  }
  if (/[a-z]/i.test(s)) {
    const t = Date.parse(s);
    if (!isNaN(t)) return ymd(new Date(t));
  }
  return null;
}
function mk(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 ? dt.toISOString().slice(0, 10) : null;
}
function ymd(d, utc) {
  return utc ? d.toISOString().slice(0, 10)
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Detect whether a column of dates is day-first: any first part > 12 means d/m/y.
export function detectDateOrder(values) {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = String(v ?? '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/);
    if (!m) continue;
    if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++;
  }
  return dmy > mdy ? 'dmy' : 'mdy';
}

export function firstNameOf(name) {
  const s = String(name ?? '').trim();
  if (!s) return '';
  if (s.includes(',')) return s.split(',')[1].trim().split(/\s+/)[0] || s; // "Smith, Jane"
  const first = s.split(/\s+/)[0];
  return /^(mr|mrs|ms|miss|dr)\.?$/i.test(first) ? s : first;
}

// Build clients from raw rows. opts: { basis: 'visit'|'month'|'year', defaultFreq: key, dateOrder }
export function buildClients(headers, rows, mapping, opts = {}) {
  const basis = opts.basis || 'month';
  const defVpm = (FREQ_OPTIONS.find((f) => f[0] === opts.defaultFreq) || FREQ_OPTIONS[4])[2];
  const get = (row, key) => (mapping[key] >= 0 ? row[mapping[key]] : '');
  const dateOrder = opts.dateOrder && opts.dateOrder !== 'auto' ? opts.dateOrder
    : mapping.since >= 0 ? detectDateOrder(rows.map((r) => r[mapping.since])) : 'mdy';
  const clients = [];
  const issues = { blank: 0, duplicates: 0, noPrice: 0, noName: 0, freqUnknown: 0, dupNames: [] };
  const seen = new Set();
  rows.forEach((row, i) => {
    if (!row || row.every((c) => String(c ?? '').trim() === '')) { issues.blank++; return; }
    const first = String(get(row, 'firstName') ?? '').trim();
    const last = String(get(row, 'lastName') ?? '').trim();
    const name = String(get(row, 'name') ?? '').trim() || [first, last].filter(Boolean).join(' ');
    const price = parseMoney(get(row, 'price'));
    const email = String(get(row, 'email') ?? '').trim();
    const service = String(get(row, 'service') ?? '').trim();
    const key = [norm(name), norm(email), norm(service), price].join('|');
    if (seen.has(key)) { issues.duplicates++; return; }
    seen.add(key);
    const freqRaw = String(get(row, 'frequency') ?? '').trim();
    let vpm = defVpm;
    if (basis === 'visit' && mapping.frequency >= 0) {
      const f = parseFrequency(freqRaw);
      if (f) vpm = f; else if (freqRaw) issues.freqUnknown++;
    }
    const factor = basis === 'visit' ? vpm : basis === 'year' ? 1 / 12 : 1;
    if (!name) issues.noName++;
    if (price === null) issues.noPrice++;
    clients.push({
      id: 'r' + i,
      row: i,
      name: name || '(no name)',
      firstName: first || firstNameOf(name) || 'there',
      email,
      phone: String(get(row, 'phone') ?? '').trim(),
      service,
      price,
      factor,              // multiply a price by this to get its monthly value
      freqLabel: freqRaw,
      since: parseDate(get(row, 'since'), dateOrder),
      tags: String(get(row, 'tags') ?? '').split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
      jobNumber: String(get(row, 'jobNumber') ?? '').trim(),
    });
  });
  const byName = {};
  for (const c of clients) byName[norm(c.name)] = (byName[norm(c.name)] || 0) + 1;
  issues.dupNames = Object.keys(byName).filter((k) => byName[k] > 1 && k !== '(no name)');
  return { clients, issues, dateOrder };
}

// CSV text -> array of rows. RFC 4180 quotes, CRLF/LF, BOM, and comma / semicolon / tab sniffed from the first line.
export function parseCSV(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const delim = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Split a sheet (array of rows) into headers + data rows: the header is the first row with 2+ filled cells.
export function splitHeader(rows) {
  const h = rows.findIndex((r) => r.filter((c) => String(c ?? '').trim() !== '').length >= 2);
  if (h === -1) return { headers: [], rows: [] };
  const headers = rows[h].map((c, i) => String(c ?? '').trim() || `Column ${i + 1}`);
  return { headers, rows: rows.slice(h + 1).map((r) => headers.map((_, i) => (r[i] === undefined ? '' : r[i]))) };
}
