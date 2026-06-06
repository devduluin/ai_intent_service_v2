export function calculateNextRunFromCron(cron: string, from = new Date()): Date | null {
  const parts = String(cron || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteRaw, hourRaw, dayOfMonthRaw, , dayOfWeekRaw] = parts;
  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null;

  const base = new Date(from);
  base.setSeconds(0, 0);

  if (dayOfMonthRaw !== '*') {
    const day = Number(dayOfMonthRaw);
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    const next = new Date(base);
    next.setHours(hour, minute, 0, 0);
    next.setDate(day);
    if (next <= base) next.setMonth(next.getMonth() + 1);
    return next;
  }

  if (dayOfWeekRaw !== '*') {
    const targetDay = Number(dayOfWeekRaw);
    if (!Number.isInteger(targetDay) || targetDay < 0 || targetDay > 6) return null;
    const next = new Date(base);
    next.setHours(hour, minute, 0, 0);
    const delta = (targetDay - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + delta);
    if (next <= base) next.setDate(next.getDate() + 7);
    return next;
  }

  const next = new Date(base);
  next.setHours(hour, minute, 0, 0);
  if (next <= base) next.setDate(next.getDate() + 1);
  return next;
}
