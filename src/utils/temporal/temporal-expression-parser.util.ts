import type { TemporalExpression, TemporalParseOptions } from './temporal-expression.types';
import { ID_DAY_NAMES, ID_TIME_OF_DAY, normalizeIndonesianMeridiem } from './temporal-locale-id.util';
import { EN_DAY_NAMES, EN_TIME_OF_DAY } from './temporal-locale-en.util';

const DEFAULT_TIMEZONE = 'Asia/Jakarta';

function getZonedNow(timezone: string): Date {
  // Use Intl.DateTimeFormat to get the current wall-clock time in the target
  // timezone, then create a Date with those LOCAL components. This ensures
  // setHours() / getDate() / formatDateToISO() work correctly regardless of
  // the server's actual timezone — all comparisons are relative to Jakarta
  // wall-clock time.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
  const date = new Date(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second'))
  );
  console.log('[TemporalParser] getZonedNow', {
    timezone,
    components: {
      year: get('year'), month: get('month'), day: get('day'),
      hour: get('hour'), minute: get('minute'), second: get('second')
    },
    isoOutput: formatDateToISO(date),
    localDate: date.toString()
  });
  return date;
}

export function parseTemporalExpressions(
  text: string,
  options: TemporalParseOptions = {}
): TemporalExpression[] {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  // Fix: when no explicit `now` is provided, create a Date adjusted to the target
  // timezone. `new Date()` on servers returns UTC, so at 03:00 Jakarta time (June 3),
  // UTC is still June 2 → all relative dates ("hari ini", "kemarin") are off by 1 day.
  const now = options.now || getZonedNow(timezone);
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const expressions: TemporalExpression[] = [];

  expressions.push(...parseRelativeDates(normalized, now, timezone));
  expressions.push(...parseRelativeDateTimes(normalized, now, timezone));
  expressions.push(...parseClockTimeExpressions(normalized, now, timezone));
  expressions.push(...parseDayOfMonth(normalized, now, timezone));
  expressions.push(...parseDatetimeExpressions(normalized, now, timezone));
  expressions.push(...parseRecurringExpressions(normalized, timezone));

  return sortExpressions(dedupeExpressions(expressions));
}

export function formatDateToISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveDayOfMonth(day: number, now = new Date()): string | null {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  let year = now.getFullYear();
  let monthIndex = now.getMonth();

  if (day > now.getDate()) {
    monthIndex -= 1;
    if (monthIndex < 0) {
      monthIndex = 11;
      year -= 1;
    }
  }

  const candidate = new Date(year, monthIndex, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== monthIndex ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return formatDateToISO(candidate);
}

export function toZonedIso(date: string, time: string, timezone = DEFAULT_TIMEZONE): string {
  const offset = timezone === 'Asia/Jakarta' ? '+07:00' : '';
  return `${date}T${time}:00${offset}`;
}

function parseRelativeDates(
  normalized: string,
  now: Date,
  timezone: string
): TemporalExpression[] {
  const expressions: TemporalExpression[] = [];
  const relativeMap: Array<{ raw: string; offset: number; direction: 'current' | 'past' | 'future' }> = [
    { raw: 'hari ini', offset: 0, direction: 'current' },
    { raw: 'today', offset: 0, direction: 'current' },
    { raw: 'besok', offset: 1, direction: 'future' },
    { raw: 'tomorrow', offset: 1, direction: 'future' },
    { raw: 'lusa', offset: 2, direction: 'future' },
    { raw: 'kemarin', offset: -1, direction: 'past' },
    { raw: 'yesterday', offset: -1, direction: 'past' }
  ];

  for (const item of relativeMap) {
    if (!containsPhrase(normalized, item.raw)) continue;
    const date = addDays(now, item.offset);
    expressions.push({
      kind: 'date',
      raw: item.raw,
      date: formatDateToISO(date),
      timezone,
      direction: item.direction,
      confidence: 0.95
    });
  }

  const relativeAgo = [...normalized.matchAll(/\b(\d+)\s*(hari|day|days)\s*(yang lalu|ago|depan|from now)\b/gi)];
  for (const match of relativeAgo) {
    const amount = Number(match[1]);
    const modifier = match[3].toLowerCase();
    const offset = modifier === 'yang lalu' || modifier === 'ago' ? -amount : amount;
    const date = addDays(now, offset);
    expressions.push({
      kind: 'date',
      raw: match[0],
      date: formatDateToISO(date),
      timezone,
      direction: offset < 0 ? 'past' : 'future',
      confidence: 0.9
    });
  }

  return expressions;
}

function parseRelativeDateTimes(
  normalized: string,
  now: Date,
  timezone: string
): TemporalExpression[] {
  const expressions: TemporalExpression[] = [];
  const idMatches = [...normalized.matchAll(/\b(\d+)\s*(menit|minute|minutes|jam|hour|hours)\s*(lagi|from now|later)\b/gi)];
  const enInMatches = [...normalized.matchAll(/\bin\s+(\d+)\s*(minute|minutes|hour|hours)\b/gi)];

  for (const match of [...idMatches, ...enInMatches]) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const date = new Date(now);
    if (unit === 'menit' || unit === 'minute' || unit === 'minutes') {
      date.setMinutes(date.getMinutes() + amount);
    } else {
      date.setHours(date.getHours() + amount);
    }

    expressions.push({
      kind: 'datetime',
      raw: match[0],
      date: formatDateToISO(date),
      time: normalizeTime(date.getHours(), date.getMinutes()),
      timezone,
      direction: 'future',
      confidence: 0.92
    });
  }

  return expressions;
}

function parseClockTimeExpressions(
  normalized: string,
  now: Date,
  timezone: string
): TemporalExpression[] {
  const expressions: TemporalExpression[] = [];
  const matches = [...normalized.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)];

  for (const match of matches) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    
    // ✅ STEP 1: Try original hour first
    let finalHour = hour;
    const candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);
    
    // ✅ STEP 2: For time-only without meridiem (pagi/siang/sore/malam)
    // If hour is 1-11, NO leading zero, and time is past → assume PM
    // Leading zero (e.g. "03:14") = 24h format, never convert to PM
    const hasLeadingZero = match[0].startsWith('0');
    if (!hasLeadingZero && hour >= 1 && hour <= 11 && candidate <= now) {
      // User said "jam 1:50" at 2:00 PM → they likely mean 1:50 PM (13:50), not 1:50 AM
      finalHour = hour + 12;
      candidate.setHours(finalHour, minute, 0, 0);
      
      console.log('[TemporalParser] Ambiguous time detected, assuming PM', {
        originalHour: hour,
        adjustedHour: finalHour,
        time: `${String(finalHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        reason: 'time-only without meridiem and AM already passed'
      });
    }
    
    // ✅ STEP 3: If adjusted time is still past, user means tomorrow
    const isPast = candidate <= now;
    if (isPast) {
      candidate.setDate(candidate.getDate() + 1);
      
      console.log('[TemporalParser] Time already passed, using tomorrow', {
        time: `${String(finalHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        newDate: formatDateToISO(candidate),
        reason: 'scheduled time already passed today'
      });
    }
    
    // For time-only, use calculated date
    const dateToUse = formatDateToISO(candidate);
    const newIsPast = candidate <= now;

    expressions.push({
      kind: 'datetime',
      raw: match[0].replace('.', ':'),
      date: dateToUse,
      time: normalizeTime(finalHour, minute),
      timezone,
      direction: newIsPast ? 'past' : 'future',
      confidence: 0.88
    });
  }

  const meridiemMatches = [...normalized.matchAll(/\b(?:jam|pukul)\s+(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam|am|pm)\b/gi)];
  for (const match of meridiemMatches) {
    const hourRaw = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    const meridiem = match[3];
    const hour = /am|pm/i.test(meridiem)
      ? normalizeEnglishMeridiem(hourRaw, meridiem)
      : normalizeIndonesianMeridiem(hourRaw, meridiem);

    const candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);
    
    // ✅ FIX: Don't auto-increment, track direction instead
    const isPast = candidate <= now;

    expressions.push({
      kind: 'datetime',
      raw: match[0],
      date: formatDateToISO(candidate),
      time: normalizeTime(hour, minute),
      timezone,
      direction: isPast ? 'past' : 'future',
      confidence: 0.9
    });
  }

  return expressions;
}

function parseDayOfMonth(
  normalized: string,
  now: Date,
  timezone: string
): TemporalExpression[] {
  const expressions: TemporalExpression[] = [];
  const matches = [...normalized.matchAll(/\b(?:tanggal|tgl)\s+(\d{1,2})(?:\s+jam\s+(\d{1,2})(?::(\d{2}))?)?\b/gi)];

  for (const match of matches) {
    const day = Number(match[1]);
    const date = resolveDayOfMonth(day, now);
    if (!date) continue;

    const time = match[2]
      ? normalizeTime(Number(match[2]), match[3] ? Number(match[3]) : 0)
      : undefined;

    expressions.push({
      kind: time ? 'datetime' : 'date',
      raw: match[0],
      date,
      time,
      timezone,
      direction: date > formatDateToISO(now) ? 'future' : 'past',
      confidence: 0.9
    });
  }

  return expressions;
}

function parseDatetimeExpressions(
  normalized: string,
  now: Date,
  timezone: string
): TemporalExpression[] {
  const expressions: TemporalExpression[] = [];
  const relativeDate = 'besok|hari ini|today|tomorrow|kemarin|yesterday';
  const matches = [...normalized.matchAll(new RegExp(`\\b(${relativeDate})\\s+(?:jam|at)\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(pagi|siang|sore|malam|am|pm)?\\b`, 'gi'))];

  for (const match of matches) {
    const rawDate = match[1].toLowerCase();
    const hour = Number(match[2]);
    const minute = match[3] ? Number(match[3]) : 0;
    const meridiem = match[4]?.toLowerCase();
    const base = rawDate === 'besok' || rawDate === 'tomorrow'
      ? addDays(now, 1)
      : rawDate === 'kemarin' || rawDate === 'yesterday'
        ? addDays(now, -1)
        : now;
    const normalizedHour = meridiem === 'pm'
      ? (hour < 12 ? hour + 12 : hour)
      : meridiem === 'am'
        ? (hour === 12 ? 0 : hour)
        : normalizeIndonesianMeridiem(hour, meridiem);

    expressions.push({
      kind: 'datetime',
      raw: match[0],
      date: formatDateToISO(base),
      time: normalizeTime(normalizedHour, minute),
      timezone,
      direction: base > now ? 'future' : base < now ? 'past' : 'current',
      confidence: 0.95
    });
  }

  const laterMatches = [...normalized.matchAll(/\bnanti\s+jam\s+(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?\b/gi)];
  for (const match of laterMatches) {
    const hour = normalizeIndonesianMeridiem(Number(match[1]), match[3]);
    const minute = match[2] ? Number(match[2]) : 0;
    // "nanti" = future. If the time has passed today, use tomorrow.
    const candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);
    const isPast = candidate <= now;
    const dateStr = isPast
      ? formatDateToISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
      : formatDateToISO(now);
    console.log('[TemporalParser] "nanti jam" matched', {
      raw: match[0],
      hour: Number(match[1]),
      meridiem: match[3],
      normalizedHour: hour,
      minute,
      nowIso: formatDateToISO(now),
      dateUsed: dateStr,
      isPast
    });
    expressions.push({
      kind: 'datetime',
      raw: match[0],
      date: dateStr,
      time: normalizeTime(hour, minute),
      timezone,
      direction: 'future',
      confidence: 0.88
    });
  }

  return expressions;
}

function parseRecurringExpressions(normalized: string, timezone: string): TemporalExpression[] {
  const expressions: TemporalExpression[] = [];

  const dailyClockMatches = [...normalized.matchAll(/\bsetiap\s+(?:hari\s+)?(?:jam|pukul)\s+(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?\b/gi)];
  for (const match of dailyClockMatches) {
    const hour = normalizeIndonesianMeridiem(Number(match[1]), match[3]);
    const minute = match[2] ? Number(match[2]) : 0;
    expressions.push({
      kind: 'recurrence',
      raw: match[0],
      frequency: 'daily',
      time: normalizeTime(hour, minute),
      timezone,
      confidence: 0.96
    });
  }

  if (/\b(setiap|tiap)\s+hari\b/i.test(normalized) && !dailyClockMatches.length) {
    expressions.push({
      kind: 'recurrence',
      raw: normalized.match(/\b(setiap|tiap)\s+hari\b/i)?.[0] || 'setiap hari',
      frequency: 'daily',
      timezone,
      confidence: 0.88
    });
  }

  for (const [label, time] of Object.entries(ID_TIME_OF_DAY)) {
    const pattern = new RegExp(`\\bsetiap\\s+${label}\\b`, 'i');
    if (pattern.test(normalized)) {
      expressions.push({
        kind: 'recurrence',
        raw: `setiap ${label}`,
        frequency: 'daily',
        time,
        timezone,
        confidence: 0.9
      });
    }
  }

  for (const [label, time] of Object.entries(EN_TIME_OF_DAY)) {
    const pattern = new RegExp(`\\bevery\\s+${label}\\b`, 'i');
    if (pattern.test(normalized)) {
      expressions.push({
        kind: 'recurrence',
        raw: `every ${label}`,
        frequency: 'daily',
        time,
        timezone,
        confidence: 0.85
      });
    }
  }

  const weeklyMatches = [...normalized.matchAll(/\bsetiap\s+(senin|selasa|rabu|kamis|jumat|jumaat|sabtu|minggu)(?:\s+jam\s+(\d{1,2})(?::(\d{2}))?)?\b/gi)];
  for (const match of weeklyMatches) {
    const dayName = match[1].toLowerCase();
    expressions.push({
      kind: 'recurrence',
      raw: match[0],
      frequency: 'weekly',
      dayOfWeek: ID_DAY_NAMES[dayName],
      time: match[2] ? normalizeTime(Number(match[2]), match[3] ? Number(match[3]) : 0) : undefined,
      timezone,
      confidence: 0.95
    });
  }

  const englishWeeklyMatches = [...normalized.matchAll(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\b/gi)];
  for (const match of englishWeeklyMatches) {
    const dayName = match[1].toLowerCase();
    const hour = match[2] ? Number(match[2]) : undefined;
    const minute = match[3] ? Number(match[3]) : 0;
    const meridiem = match[4]?.toLowerCase();
    const normalizedHour = hour === undefined
      ? undefined
      : meridiem === 'pm'
        ? (hour < 12 ? hour + 12 : hour)
        : meridiem === 'am'
          ? (hour === 12 ? 0 : hour)
          : hour;

    expressions.push({
      kind: 'recurrence',
      raw: match[0],
      frequency: 'weekly',
      dayOfWeek: EN_DAY_NAMES[dayName],
      time: normalizedHour !== undefined ? normalizeTime(normalizedHour, minute) : undefined,
      timezone,
      confidence: 0.9
    });
  }

  const monthlyMatches = [...normalized.matchAll(/\bsetiap\s+tanggal\s+(\d{1,2})(?:\s+jam\s+(\d{1,2})(?::(\d{2}))?)?\b/gi)];
  for (const match of monthlyMatches) {
    const day = Number(match[1]);
    if (day < 1 || day > 31) continue;
    expressions.push({
      kind: 'recurrence',
      raw: match[0],
      frequency: 'monthly',
      dayOfMonth: day,
      time: match[2] ? normalizeTime(Number(match[2]), match[3] ? Number(match[3]) : 0) : undefined,
      timezone,
      confidence: 0.95
    });
  }

  return expressions;
}

function normalizeText(value: string): string {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i').test(text);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeTime(hour: number, minute: number): string {
  const safeHour = Math.max(0, Math.min(23, hour));
  const safeMinute = Math.max(0, Math.min(59, minute));
  return `${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}`;
}

function normalizeEnglishMeridiem(hour: number, meridiem?: string): number {
  const normalized = String(meridiem || '').toLowerCase();
  if (normalized === 'pm' && hour < 12) return hour + 12;
  if (normalized === 'am' && hour === 12) return 0;
  return hour;
}

function dedupeExpressions(expressions: TemporalExpression[]): TemporalExpression[] {
  const seen = new Set<string>();
  const result: TemporalExpression[] = [];

  for (const expression of expressions) {
    const key = [
      expression.kind,
      expression.raw,
      expression.date,
      expression.time,
      expression.frequency,
      expression.dayOfWeek,
      expression.dayOfMonth
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(expression);
  }

  return result;
}

function sortExpressions(expressions: TemporalExpression[]): TemporalExpression[] {
  const priority: Record<TemporalExpression['kind'], number> = {
    recurrence: 6,
    datetime: 5,
    date: 3,
    period: 2,
    time: 1
  };

  return [...expressions].sort((a, b) => {
    const kindDelta = priority[b.kind] - priority[a.kind];
    if (kindDelta !== 0) return kindDelta;
    return b.confidence - a.confidence;
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
