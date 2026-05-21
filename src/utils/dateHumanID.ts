export function formatDateHumanID(date: Date = new Date()): string {
  const days = [
    "Minggu",
    "Senin",
    "Selasa",
    "Rabu",
    "Kamis",
    "Jumat",
    "Sabtu",
  ];

  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];

  const dayName = days[date.getDay()];
  const day = date.getDate();
  const monthName = months[date.getMonth()];
  const year = date.getFullYear();

  return `${dayName}, ${day} ${monthName} ${year}`;
}

// ============================================================
// TEMPORAL EXPRESSION RESOLVER
// Convert relative time expressions to exact dates/values
// ============================================================

export interface TemporalResolvedValue {
  type: 'day' | 'week' | 'month' | 'year' | 'quarter' | 'period' | 'date' | 'relative'
  value: string           // Original text (e.g., "bulan lalu")
  resolvedValue: string   // Exact value (e.g., "April 2026")
  startDate?: Date        // Start of period
  endDate?: Date          // End of period
  direction: 'current' | 'past' | 'future'
}

/**
 * Resolve temporal expression to exact date/value
 * @param expression - Temporal expression (e.g., "bulan lalu", "kemarin", "next week")
 * @param referenceDate - Reference date (defaults to now)
 * @returns Resolved temporal value with exact dates
 */
export function resolveTemporalExpression(
  expression: string,
  referenceDate: Date = new Date()
): TemporalResolvedValue | null {
  const normalized = expression.toLowerCase().trim()
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ]

  // Helper to get start/end of day
  const getDayBounds = (date: Date) => {
    const start = new Date(date)
    start.setHours(0, 0, 0, 0)
    const end = new Date(date)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  // Helper to get start/end of week (Monday-Sunday)
  const getWeekBounds = (date: Date) => {
    const day = date.getDay()
    const diff = date.getDate() - day + (day === 0 ? -6 : 1) // Adjust for Sunday
    const start = new Date(date)
    start.setDate(diff)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  // Helper to get start/end of month
  const getMonthBounds = (date: Date) => {
    const start = new Date(date.getFullYear(), date.getMonth(), 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  // Helper to get start/end of year
  const getYearBounds = (date: Date) => {
    const start = new Date(date.getFullYear(), 0, 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(date.getFullYear(), 11, 31)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  // Helper to get start/end of quarter
  const getQuarterBounds = (date: Date) => {
    const quarter = Math.floor(date.getMonth() / 3)
    const start = new Date(date.getFullYear(), quarter * 3, 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(date.getFullYear(), (quarter + 1) * 3, 0)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  // ==================== INDONESIAN EXPRESSIONS ====================

  // Days - Indonesian
  if (normalized === 'hari ini') {
    const { start, end } = getDayBounds(referenceDate)
    return {
      type: 'day',
      value: expression,
      resolvedValue: formatDateHumanID(referenceDate),
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'besok') {
    const tomorrow = new Date(referenceDate)
    tomorrow.setDate(referenceDate.getDate() + 1)
    const { start, end } = getDayBounds(tomorrow)
    return {
      type: 'day',
      value: expression,
      resolvedValue: formatDateHumanID(tomorrow),
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'lusa') {
    const dayAfter = new Date(referenceDate)
    dayAfter.setDate(referenceDate.getDate() + 2)
    const { start, end } = getDayBounds(dayAfter)
    return {
      type: 'day',
      value: expression,
      resolvedValue: formatDateHumanID(dayAfter),
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'kemarin') {
    const yesterday = new Date(referenceDate)
    yesterday.setDate(referenceDate.getDate() - 1)
    const { start, end } = getDayBounds(yesterday)
    return {
      type: 'day',
      value: expression,
      resolvedValue: formatDateHumanID(yesterday),
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  if (normalized === 'kemarin lusa') {
    const dayBefore = new Date(referenceDate)
    dayBefore.setDate(referenceDate.getDate() - 2)
    const { start, end } = getDayBounds(dayBefore)
    return {
      type: 'day',
      value: expression,
      resolvedValue: formatDateHumanID(dayBefore),
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // Weeks - Indonesian
  if (normalized === 'minggu ini') {
    const { start, end } = getWeekBounds(referenceDate)
    return {
      type: 'week',
      value: expression,
      resolvedValue: `Minggu ini (${start.getDate()} ${months[start.getMonth()]} - ${end.getDate()} ${months[end.getMonth()]})`,
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'minggu depan') {
    const nextWeek = new Date(referenceDate)
    nextWeek.setDate(referenceDate.getDate() + 7)
    const { start, end } = getWeekBounds(nextWeek)
    return {
      type: 'week',
      value: expression,
      resolvedValue: `Minggu depan (${start.getDate()} ${months[start.getMonth()]} - ${end.getDate()} ${months[end.getMonth()]})`,
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'minggu lalu' || normalized === 'minggu kemarin') {
    const lastWeek = new Date(referenceDate)
    lastWeek.setDate(referenceDate.getDate() - 7)
    const { start, end } = getWeekBounds(lastWeek)
    return {
      type: 'week',
      value: expression,
      resolvedValue: `Minggu lalu (${start.getDate()} ${months[start.getMonth()]} - ${end.getDate()} ${months[end.getMonth()]})`,
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // Months - Indonesian
  if (normalized === 'bulan ini') {
    const { start, end } = getMonthBounds(referenceDate)
    return {
      type: 'month',
      value: expression,
      resolvedValue: months[referenceDate.getMonth()],
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'bulan depan') {
    const nextMonth = new Date(referenceDate)
    nextMonth.setMonth(referenceDate.getMonth() + 1)
    const { start, end } = getMonthBounds(nextMonth)
    return {
      type: 'month',
      value: expression,
      resolvedValue: months[nextMonth.getMonth()],
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'bulan lalu' || normalized === 'bulan kemarin') {
    const lastMonth = new Date(referenceDate)
    lastMonth.setMonth(referenceDate.getMonth() - 1)
    const { start, end } = getMonthBounds(lastMonth)
    return {
      type: 'month',
      value: expression,
      resolvedValue: months[lastMonth.getMonth()],
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // Years - Indonesian
  if (normalized === 'tahun ini') {
    const { start, end } = getYearBounds(referenceDate)
    return {
      type: 'year',
      value: expression,
      resolvedValue: `${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'tahun depan') {
    const nextYear = new Date(referenceDate)
    nextYear.setFullYear(referenceDate.getFullYear() + 1)
    const { start, end } = getYearBounds(nextYear)
    return {
      type: 'year',
      value: expression,
      resolvedValue: `${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'tahun lalu') {
    const lastYear = new Date(referenceDate)
    lastYear.setFullYear(referenceDate.getFullYear() - 1)
    const { start, end } = getYearBounds(lastYear)
    return {
      type: 'year',
      value: expression,
      resolvedValue: `${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // Quarters - Indonesian
  if (normalized === 'kuartal ini') {
    const { start, end } = getQuarterBounds(referenceDate)
    const quarter = Math.floor(start.getMonth() / 3) + 1
    return {
      type: 'quarter',
      value: expression,
      resolvedValue: `Q${quarter} ${start.getFullYear()} (${months[start.getMonth()]} - ${months[end.getMonth()]})`,
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'kuartal depan') {
    const nextQuarterDate = new Date(referenceDate)
    nextQuarterDate.setMonth(referenceDate.getMonth() + 3)
    const { start, end } = getQuarterBounds(nextQuarterDate)
    const quarter = Math.floor(start.getMonth() / 3) + 1
    return {
      type: 'quarter',
      value: expression,
      resolvedValue: `Q${quarter} ${start.getFullYear()} (${months[start.getMonth()]} - ${months[end.getMonth()]})`,
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'kuartal lalu') {
    const lastQuarterDate = new Date(referenceDate)
    lastQuarterDate.setMonth(referenceDate.getMonth() - 3)
    const { start, end } = getQuarterBounds(lastQuarterDate)
    const quarter = Math.floor(start.getMonth() / 3) + 1
    return {
      type: 'quarter',
      value: expression,
      resolvedValue: `Q${quarter} ${start.getFullYear()} (${months[start.getMonth()]} - ${months[end.getMonth()]})`,
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // Periods - Indonesian
  if (normalized === 'periode ini') {
    const { start, end } = getMonthBounds(referenceDate)
    return {
      type: 'period',
      value: expression,
      resolvedValue: `${months[start.getMonth()]} ${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'periode depan') {
    const nextPeriod = new Date(referenceDate)
    nextPeriod.setMonth(referenceDate.getMonth() + 1)
    const { start, end } = getMonthBounds(nextPeriod)
    return {
      type: 'period',
      value: expression,
      resolvedValue: `${months[start.getMonth()]} ${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'periode lalu') {
    const lastPeriod = new Date(referenceDate)
    lastPeriod.setMonth(referenceDate.getMonth() - 1)
    const { start, end } = getMonthBounds(lastPeriod)
    return {
      type: 'period',
      value: expression,
      resolvedValue: `${months[start.getMonth()]} ${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // ==================== ENGLISH EXPRESSIONS ====================

  // Days - English
  if (normalized === 'today') {
    const { start, end } = getDayBounds(referenceDate)
    return {
      type: 'day',
      value: expression,
      resolvedValue: formatDateHumanID(referenceDate),
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'tomorrow') {
    const tomorrow = new Date(referenceDate)
    tomorrow.setDate(referenceDate.getDate() + 1)
    const { start, end } = getDayBounds(tomorrow)
    return {
      type: 'day',
      value: expression,
      resolvedValue: formatDateHumanID(tomorrow),
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'yesterday') {
    const yesterday = new Date(referenceDate)
    yesterday.setDate(referenceDate.getDate() - 1)
    const { start, end } = getDayBounds(yesterday)
    return {
      type: 'day',
      value: expression,
      resolvedValue: formatDateHumanID(yesterday),
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // Weeks - English
  if (normalized === 'this week') {
    const { start, end } = getWeekBounds(referenceDate)
    return {
      type: 'week',
      value: expression,
      resolvedValue: `This week (${start.getDate()} ${months[start.getMonth()]} - ${end.getDate()} ${months[end.getMonth()]})`,
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'next week') {
    const nextWeek = new Date(referenceDate)
    nextWeek.setDate(referenceDate.getDate() + 7)
    const { start, end } = getWeekBounds(nextWeek)
    return {
      type: 'week',
      value: expression,
      resolvedValue: `Next week (${start.getDate()} ${months[start.getMonth()]} - ${end.getDate()} ${months[end.getMonth()]})`,
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'last week') {
    const lastWeek = new Date(referenceDate)
    lastWeek.setDate(referenceDate.getDate() - 7)
    const { start, end } = getWeekBounds(lastWeek)
    return {
      type: 'week',
      value: expression,
      resolvedValue: `Last week (${start.getDate()} ${months[start.getMonth()]} - ${end.getDate()} ${months[end.getMonth()]})`,
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // Months - English
  if (normalized === 'this month') {
    const { start, end } = getMonthBounds(referenceDate)
    return {
      type: 'month',
      value: expression,
      resolvedValue: months[referenceDate.getMonth()],
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'next month') {
    const nextMonth = new Date(referenceDate)
    nextMonth.setMonth(referenceDate.getMonth() + 1)
    const { start, end } = getMonthBounds(nextMonth)
    return {
      type: 'month',
      value: expression,
      resolvedValue: months[nextMonth.getMonth()],
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'last month') {
    const lastMonth = new Date(referenceDate)
    lastMonth.setMonth(referenceDate.getMonth() - 1)
    const { start, end } = getMonthBounds(lastMonth)
    return {
      type: 'month',
      value: expression,
      resolvedValue: months[lastMonth.getMonth()],
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // Years - English
  if (normalized === 'this year') {
    const { start, end } = getYearBounds(referenceDate)
    return {
      type: 'year',
      value: expression,
      resolvedValue: `${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'next year') {
    const nextYear = new Date(referenceDate)
    nextYear.setFullYear(referenceDate.getFullYear() + 1)
    const { start, end } = getYearBounds(nextYear)
    return {
      type: 'year',
      value: expression,
      resolvedValue: `${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'last year') {
    const lastYear = new Date(referenceDate)
    lastYear.setFullYear(referenceDate.getFullYear() - 1)
    const { start, end } = getYearBounds(lastYear)
    return {
      type: 'year',
      value: expression,
      resolvedValue: `${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // Quarters - English
  if (normalized === 'this quarter') {
    const { start, end } = getQuarterBounds(referenceDate)
    const quarter = Math.floor(start.getMonth() / 3) + 1
    return {
      type: 'quarter',
      value: expression,
      resolvedValue: `Q${quarter} ${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'current'
    }
  }

  if (normalized === 'next quarter') {
    const nextQuarterDate = new Date(referenceDate)
    nextQuarterDate.setMonth(referenceDate.getMonth() + 3)
    const { start, end } = getQuarterBounds(nextQuarterDate)
    const quarter = Math.floor(start.getMonth() / 3) + 1
    return {
      type: 'quarter',
      value: expression,
      resolvedValue: `Q${quarter} ${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'future'
    }
  }

  if (normalized === 'last quarter') {
    const lastQuarterDate = new Date(referenceDate)
    lastQuarterDate.setMonth(referenceDate.getMonth() - 3)
    const { start, end } = getQuarterBounds(lastQuarterDate)
    const quarter = Math.floor(start.getMonth() / 3) + 1
    return {
      type: 'quarter',
      value: expression,
      resolvedValue: `Q${quarter} ${start.getFullYear()}`,
      startDate: start,
      endDate: end,
      direction: 'past'
    }
  }

  // Relative time (e.g., "5 hari yang lalu", "2 weeks ago")
  const relativeMatch = normalized.match(/^(\d+)\s*(hari|week|weeks|month|months|year|years)\s*(yang lalu|ago|depan|from now)$/)
  if (relativeMatch) {
    const [, amountStr, unit, direction] = relativeMatch
    const amount = parseInt(amountStr)
    const targetDate = new Date(referenceDate)

    if (unit.startsWith('hari')) {
      targetDate.setDate(referenceDate.getDate() + (direction.includes('lalu') || direction.includes('ago') ? -amount : amount))
    } else if (unit.startsWith('week')) {
      targetDate.setDate(referenceDate.getDate() + (direction.includes('lalu') || direction.includes('ago') ? -amount * 7 : amount * 7))
    } else if (unit.startsWith('month')) {
      targetDate.setMonth(referenceDate.getMonth() + (direction.includes('lalu') || direction.includes('ago') ? -amount : amount))
    } else if (unit.startsWith('year')) {
      targetDate.setFullYear(referenceDate.getFullYear() + (direction.includes('lalu') || direction.includes('ago') ? -amount : amount))
    }

    return {
      type: 'relative',
      value: expression,
      resolvedValue: formatDateHumanID(targetDate),
      startDate: targetDate,
      endDate: targetDate,
      direction: direction.includes('lalu') || direction.includes('ago') ? 'past' : 'future'
    }
  }

  return null
}

/**
 * Resolve all temporal expressions in a query
 * @param query - User query
 * @returns Array of resolved temporal values
 */
export function resolveTemporalInQuery(query: string): TemporalResolvedValue[] {
  const expressions = [
    // Indonesian
    'hari ini', 'besok', 'lusa', 'kemarin', 'kemarin lusa',
    'minggu ini', 'minggu depan', 'minggu lalu', 'minggu kemarin',
    'bulan ini', 'bulan depan', 'bulan lalu', 'bulan kemarin',
    'tahun ini', 'tahun depan', 'tahun lalu',
    'kuartal ini', 'kuartal depan', 'kuartal lalu',
    'periode ini', 'periode depan', 'periode lalu',
    // English
    'today', 'tomorrow', 'yesterday', 'day after tomorrow', 'day before yesterday',
    'this week', 'next week', 'last week',
    'this month', 'next month', 'last month',
    'this year', 'next year', 'last year',
    'this quarter', 'next quarter', 'last quarter',
  ]

  const results: TemporalResolvedValue[] = []
  const normalizedQuery = query.toLowerCase()

  for (const expr of expressions) {
    if (normalizedQuery.includes(expr)) {
      const resolved = resolveTemporalExpression(expr)
      if (resolved) {
        results.push(resolved)
      }
    }
  }

  // Check for relative time patterns
  const relativePatterns = normalizedQuery.match(/\b(\d+)\s*(hari|week|weeks|month|months|year|years)\s*(yang lalu|ago|depan|from now)\b/g)
  if (relativePatterns) {
    for (const pattern of relativePatterns) {
      const resolved = resolveTemporalExpression(pattern)
      if (resolved) {
        results.push(resolved)
      }
    }
  }

  return results
}
