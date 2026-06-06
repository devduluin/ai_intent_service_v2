import { memoryRecallService } from '../src/services/memory-recall.service';

const resolved = memoryRecallService.resolveQuery({
  userId: 'smoke-user',
  appName: 'hris',
  query: 'coba memory recall',
  params: {}
});

if (resolved.mode !== 'date' || resolved.range?.label !== 'hari ini') {
  throw new Error(`Expected default memory recall to resolve to hari ini, got ${JSON.stringify(resolved)}`);
}

console.log('[memory-recall-default-smoke] PASS', {
  mode: resolved.mode,
  label: resolved.range?.label,
  start: resolved.range?.start,
  end: resolved.range?.end
});

