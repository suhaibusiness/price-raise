// File outputs: CSV (with spreadsheet-formula guard), .ics calendar, downloads.

// A cell starting with = + - @ can run as a formula in a spreadsheet. Some spreadsheets also split a line on ; or tab and
// skip leading spaces, so every piece that could become a cell gets a ' in front when it starts (after spaces) with one
// of those signs, and a cell holding ; or tab is quoted. Phone numbers and plain numbers are left alone.
const risky = (t) => /^[ \t\r\n]*[=+\-@]/.test(t) && !/^[ \t]*[+-]?[\d\s().-]+$/.test(t);
function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  s = s.split(/([;\t\r\n])/).map((part) => (risky(part) ? "'" + part : part)).join('');
  if (/^[\t\r]/.test(s)) s = "'" + s;
  return /[",;\t\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCSV = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 75) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}
// events: [{ date: 'YYYY-MM-DD', title, description }] as all-day events.
export function toICS(events, stamp = new Date()) {
  const dt = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const next = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10).replace(/-/g, ''); };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Price Raise//Price Raise beta//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  events.forEach((e, i) => {
    lines.push('BEGIN:VEVENT', `UID:price-raise-${e.date}-${i}-${dt}@price-raise.local`, `DTSTAMP:${dt}`,
      `DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next(e.date)}`,
      fold('SUMMARY:' + icsEsc(e.title)), fold('DESCRIPTION:' + icsEsc(e.description || '')),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT9H', fold('DESCRIPTION:' + icsEsc(e.title)), 'END:VALARM', 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function download(name, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([type.startsWith('text/csv') ? '\ufeff' + text : text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
