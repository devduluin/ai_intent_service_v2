import assert from 'node:assert/strict';
import { parseTemporalExpressions } from '../src/utils/temporal/temporal-expression-parser.util';
import { triggerNormalizerService } from '../src/services/automation/trigger-normalizer.service';
import { queryDecompositionService } from '../src/services/query-decomposition.service';

const now = new Date(2026, 5, 2, 10, 0, 0);

function testParser() {
  const tomorrow = parseTemporalExpressions('besok jam 7', { now });
  assert.equal(tomorrow[0]?.kind, 'datetime');
  assert.equal(tomorrow[0]?.date, '2026-06-03');
  assert.equal(tomorrow[0]?.time, '07:00');

  const later = parseTemporalExpressions('nanti jam 5 sore', { now });
  assert.equal(later[0]?.kind, 'datetime');
  assert.equal(later[0]?.date, '2026-06-02');
  assert.equal(later[0]?.time, '17:00');

  const clockMeridiemOnly = parseTemporalExpressions('jam 5 sore', { now });
  assert.equal(clockMeridiemOnly[0]?.kind, 'datetime');
  assert.equal(clockMeridiemOnly[0]?.date, '2026-06-02');
  assert.equal(clockMeridiemOnly[0]?.time, '17:00');

  const dayOfMonth = parseTemporalExpressions('tanggal 10 jam 08:00', { now });
  assert.equal(dayOfMonth[0]?.kind, 'datetime');
  assert.equal(dayOfMonth[0]?.date, '2026-05-10');
  assert.equal(dayOfMonth[0]?.time, '08:00');

  const oneMinuteLater = parseTemporalExpressions('1 menit lagi', { now });
  assert.equal(oneMinuteLater[0]?.kind, 'datetime');
  assert.equal(oneMinuteLater[0]?.date, '2026-06-02');
  assert.equal(oneMinuteLater[0]?.time, '10:01');

  const clockOnly = parseTemporalExpressions('12:21', { now });
  assert.equal(clockOnly[0]?.kind, 'datetime');
  assert.equal(clockOnly[0]?.date, '2026-06-02');
  assert.equal(clockOnly[0]?.time, '12:21');

  const daily = parseTemporalExpressions('setiap pagi', { now });
  assert.equal(daily[0]?.kind, 'recurrence');
  assert.equal(daily[0]?.frequency, 'daily');
  assert.equal(daily[0]?.time, '08:00');

  const dailyNoTime = parseTemporalExpressions('setiap hari', { now });
  assert.equal(dailyNoTime[0]?.kind, 'recurrence');
  assert.equal(dailyNoTime[0]?.frequency, 'daily');
  assert.equal(dailyNoTime[0]?.time, undefined);

  const dailyClock = parseTemporalExpressions('setiap jam 5:08 sore', { now });
  assert.equal(dailyClock[0]?.kind, 'recurrence');
  assert.equal(dailyClock[0]?.frequency, 'daily');
  assert.equal(dailyClock[0]?.time, '17:08');

  const weekly = parseTemporalExpressions('setiap Senin jam 9', { now });
  assert.equal(weekly[0]?.kind, 'recurrence');
  assert.equal(weekly[0]?.frequency, 'weekly');
  assert.equal(weekly[0]?.dayOfWeek, 1);
  assert.equal(weekly[0]?.time, '09:00');

  const monthly = parseTemporalExpressions('setiap tanggal 1', { now });
  assert.equal(monthly[0]?.kind, 'recurrence');
  assert.equal(monthly[0]?.frequency, 'monthly');
  assert.equal(monthly[0]?.dayOfMonth, 1);
}

function testTriggerNormalizer() {
  const once = triggerNormalizerService.normalize('besok jam 7', { now });
  assert.equal(once.trigger?.kind, 'once');
  assert.equal(once.trigger?.runAt, '2026-06-03T07:00:00+07:00');
  assert.deepEqual(once.missing, []);

  const minuteLater = triggerNormalizerService.normalize('1 menit lagi', { now });
  assert.equal(minuteLater.trigger?.kind, 'once');
  assert.equal(minuteLater.trigger?.runAt, '2026-06-02T10:01:00+07:00');
  assert.deepEqual(minuteLater.missing, []);

  const clock = triggerNormalizerService.normalize('12:21', { now });
  assert.equal(clock.trigger?.kind, 'once');
  assert.equal(clock.trigger?.runAt, '2026-06-02T12:21:00+07:00');

  const recurring = triggerNormalizerService.normalize('setiap Senin jam 9', { now });
  assert.equal(recurring.trigger?.kind, 'recurring');
  assert.equal(recurring.trigger?.cron, '0 9 * * 1');

  const recurringClock = triggerNormalizerService.normalize('setiap jam 5:08 sore', { now });
  assert.equal(recurringClock.trigger?.kind, 'recurring');
  assert.equal(recurringClock.trigger?.cron, '8 17 * * *');

  const recurringDailyClock = triggerNormalizerService.normalize('setiap hari jam 5 sore', { now });
  assert.equal(recurringDailyClock.trigger?.kind, 'recurring');
  assert.equal(recurringDailyClock.trigger?.cron, '0 17 * * *');

  const recurringDailyNoTime = triggerNormalizerService.normalize('setiap hari', { now });
  assert.equal(recurringDailyNoTime.trigger?.kind, 'recurring');
  assert.deepEqual(recurringDailyNoTime.missing, ['time']);
}

function testQueryDecompositionConsumesSharedParser() {
  const decomposed = queryDecompositionService.decompose('tanggal 29');
  const date = decomposed.signals.temporalDetails?.find(detail => detail.value === 'tanggal 29');
  assert.equal(date?.type, 'date');
  assert.equal(date?.normalizedValue, '2026-05-29');
}

function main() {
  testParser();
  testTriggerNormalizer();
  testQueryDecompositionConsumesSharedParser();
  console.log('[TemporalExpressionParser Smoke] All checks passed');
}

main();
