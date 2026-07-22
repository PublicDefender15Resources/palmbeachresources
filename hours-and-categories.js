/* ============================================================
   Category metadata (icon + CSS color variable per category)
   ============================================================ */
const CATS = {
  'Housing':                 { icon: '🏠', cssVar: '--cat-Housing',            label: 'Housing' },
  'Food':                    { icon: '🍎', cssVar: '--cat-Food',               label: 'Food' },
  'Substance Use':           { icon: '❤️', cssVar: '--cat-SubstanceUse',       label: 'Substance Use' },
  'Mental Health':           { icon: '🧠', cssVar: '--cat-MentalHealth',       label: 'Mental Health' },
  'Medical':                 { icon: '⚕️', cssVar: '--cat-Medical',            label: 'Medical' },
  'Family/Child Services':   { icon: '👨‍👩‍👧', cssVar: '--cat-FamilyChildServices', label: 'Family / Child Services' },
  'Employment':              { icon: '💼', cssVar: '--cat-Employment',         label: 'Employment' },
  'Education':               { icon: '🎓', cssVar: '--cat-Education',          label: 'Education' },
  'Reentry':                 { icon: '🔑', cssVar: '--cat-Reentry',            label: 'Reentry' },
  'Referrals':               { icon: '🔗', cssVar: '--cat-Referrals',          label: 'Referrals' },
  'Benefits':                { icon: '💳', cssVar: '--cat-Benefits',           label: 'Benefits' },
  'Transportation':          { icon: '🚌', cssVar: '--cat-Transportation',     label: 'Transportation' },
  'Court Requirements':      { icon: '⚖️', cssVar: '--cat-CourtRequirements',  label: 'Court Requirements' },
  'Other':                   { icon: '📌', cssVar: '--cat-Other',              label: 'Other' },
};

function catIcon(name) { return (CATS[name] && CATS[name].icon) || '📌'; }
function catColor(name) {
  const v = (CATS[name] && CATS[name].cssVar) || '--cat-Other';
  return `var(${v})`;
}

/* ============================================================
   Hours parsing
   Turns messy spreadsheet strings like:
     "Mon & Wed: 8 AM - 8 PM, Tues & Thurs: 8 AM - 6 PM, Fri: 8:30 AM - 4 PM"
   into a clean Monday->Sunday grid. Falls back to a cleaned
   line-by-line display for strings it can't confidently parse.
   ============================================================ */
const WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const DAY_ALIASES = {
  mon: 'Mon', monday: 'Mon',
  tue: 'Tue', tues: 'Tue', tuesday: 'Tue',
  wed: 'Wed', weds: 'Wed', wednesday: 'Wed',
  thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu',
  fri: 'Fri', friday: 'Fri',
  sat: 'Sat', saturday: 'Sat',
  sun: 'Sun', sunday: 'Sun',
};
const TIME_TOKEN_RE = /\d{1,2}(:\d{2})?\s*(AM|PM|am|pm)|24\s*\/?\s*7|24[\s-]?hours?/;

function extractDaysFromText(text) {
  const dayRegex = /\b(mon(?:day)?|tues?(?:day)?|weds?(?:nesday)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;
  const matches = [...text.matchAll(dayRegex)].map(m => DAY_ALIASES[m[1].toLowerCase()]);
  return matches;
}

function expandDayGroup(dayPartText) {
  if (/7\s*days|every ?day|daily/i.test(dayPartText)) return [...WEEK_ORDER];

  // Split on commas / ampersands / "and" first (list separators)
  const listTokens = dayPartText.split(/,|&|\band\b/i).map(t => t.trim()).filter(Boolean);
  const days = new Set();

  listTokens.forEach(tok => {
    const isRange = /-|–|—/.test(tok);
    const found = extractDaysFromText(tok);
    if (found.length === 0) return;
    if (isRange && found.length >= 2) {
      const start = WEEK_ORDER.indexOf(found[0]);
      const end = WEEK_ORDER.indexOf(found[found.length - 1]);
      if (start !== -1 && end !== -1 && start <= end) {
        for (let i = start; i <= end; i++) days.add(WEEK_ORDER[i]);
      } else {
        found.forEach(d => days.add(d));
      }
    } else {
      found.forEach(d => days.add(d));
    }
  });

  return [...days];
}

function formatClockPiece(piece, borrowedMeridiem) {
  const m = piece.trim().match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!m) return piece.trim();
  const hour = m[1];
  const minutes = m[2] || '00';
  const meridiem = (m[3] || borrowedMeridiem || '').toUpperCase();
  return `${hour}:${minutes}${meridiem ? ' ' + meridiem : ''}`;
}

function formatTimeRange(rawTime) {
  if (/24\s*\/?\s*7|24[\s-]?hours?/i.test(rawTime)) return 'Open 24 hours';
  const parts = rawTime.split(/-|–|—/);
  if (parts.length !== 2) return rawTime.trim();
  const endMeridiemMatch = parts[1].match(/[AaPp][Mm]/);
  const endMeridiem = endMeridiemMatch ? endMeridiemMatch[0] : '';
  const start = formatClockPiece(parts[0], endMeridiem);
  const end = formatClockPiece(parts[1], '');
  return `${start} – ${end}`;
}

function splitDayAndTime(segment) {
  const m = segment.match(/^(.*?)[:]?\s*((?:\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm).*)|24\s*\/?\s*7|24[\s-]?hours?)\s*$/);
  if (!m) return null;
  return { dayPart: m[1].trim(), timePart: m[2].trim() };
}

function parseHours(raw) {
  if (!raw || !raw.trim()) return { type: 'empty' };
  const trimmed = raw.trim();

  if (/^24\s*\/?\s*7$/i.test(trimmed)) {
    const rows = WEEK_ORDER.map(d => ({ day: WEEK_FULL[d], time: 'Open 24 hours' }));
    return { type: 'grid', rows };
  }

  // Trailing day-count pattern, e.g. "7AM - 7PM, 7 days a week"
  const trailingDaysMatch = trimmed.match(/^(.*?),?\s*7\s*days?(?:\s*(?:a|\/)\s*week)?\s*$/i);
  if (trailingDaysMatch && TIME_TOKEN_RE.test(trailingDaysMatch[1])) {
    const timeStr = formatTimeRange(trailingDaysMatch[1].trim());
    const rows = WEEK_ORDER.map(d => ({ day: WEEK_FULL[d], time: timeStr }));
    return { type: 'grid', rows };
  }

  // Step 1: group comma-separated segments — a group ends once we hit
  // a segment that actually contains a time value.
  const rawSegments = trimmed.split(',').map(s => s.trim()).filter(Boolean);
  const groups = [];
  let buffer = [];
  rawSegments.forEach(seg => {
    buffer.push(seg);
    if (TIME_TOKEN_RE.test(seg)) {
      groups.push(buffer.join(', '));
      buffer = [];
    }
  });
  if (buffer.length) groups.push(buffer.join(', '));

  // Step 2: split each group into day-part / time-part
  const parsedGroups = [];
  groups.forEach(g => {
    const split = splitDayAndTime(g);
    if (!split) return;
    const days = expandDayGroup(split.dayPart);
    if (days.length === 0 && parsedGroups.length > 0) {
      // Continuation: another time range for the previous day set (e.g. lunch-break split)
      const prev = parsedGroups[parsedGroups.length - 1];
      prev.timeParts.push(split.timePart);
    } else if (days.length > 0) {
      parsedGroups.push({ days, timeParts: [split.timePart] });
    }
  });

  if (parsedGroups.length === 0) {
    // Couldn't confidently parse — return a cleaned line-by-line fallback
    return { type: 'raw', lines: rawSegments };
  }

  const dayTimeMap = {};
  parsedGroups.forEach(g => {
    const timeStr = g.timeParts.map(formatTimeRange).join(' & ');
    g.days.forEach(d => { dayTimeMap[d] = timeStr; });
  });

  const rows = WEEK_ORDER.map(d => ({
    day: WEEK_FULL[d],
    time: dayTimeMap[d] || null,
  }));

  return { type: 'grid', rows };
}
