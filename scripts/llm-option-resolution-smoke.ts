import assert from 'node:assert/strict';
import { llmOptionResolutionService } from '../src/services/llm-option-resolution.service';
import { paramExtractorService } from '../src/services/paramExtractor.service';
import type { ToolParam } from '../src/types';

async function testFuzzyEnum() {
  const result = await llmOptionResolutionService.resolve({
    text: 'remnder',
    mode: 'enum',
    options: [
      { key: 'reminder', label: 'Reminder' },
      { key: 'scheduled_workflow', label: 'Scheduled Workflow' },
      { key: 'conditional_alert', label: 'Conditional Alert' }
    ]
  });

  assert.equal(result.matched, true);
  assert.equal(result.value, 'reminder');
  assert.equal(result.source, 'fuzzy');
}

async function testFuzzyBoolean() {
  const result = await llmOptionResolutionService.resolve({
    text: 'iy tampilkan',
    mode: 'boolean'
  });

  assert.equal(result.matched, true);
  assert.equal(result.value, true);
}

async function testParamExtractorAutomationSlotAnswers() {
  const params: ToolParam[] = [
    {
      name: 'automation_type',
      type: 'select',
      description: 'Jenis automation.',
      isRequired: true,
      config: {
        options: [
          { label: 'Reminder', value: 'reminder' },
          { label: 'Scheduled Workflow', value: 'scheduled_workflow' },
          { label: 'Conditional Alert', value: 'conditional_alert' }
        ]
      }
    },
    {
      name: 'schedule',
      type: 'string',
      description: 'Waktu atau jadwal.',
      isRequired: false
    },
    {
      name: 'goal',
      type: 'text',
      description: 'Tujuan automation.',
      isRequired: true
    }
  ];

  const typeResult = await paramExtractorService.extractAll('remnder', [params[0]]);
  assert.equal(typeResult.params.automation_type, 'reminder');

  const scheduleResult = await paramExtractorService.extractAll('jam 12 55', [params[1]]);
  assert.equal(scheduleResult.params.schedule, '12:55');

  const genericGoalResult = await paramExtractorService.extractAll('buat automation', [params[2]]);
  assert.equal(genericGoalResult.params.goal, undefined);
}

async function testExactAction() {
  const result = await llmOptionResolutionService.resolve({
    text: 'batalkan',
    mode: 'action',
    options: [
      { key: 'confirm', aliases: ['simpan', 'buat'] },
      { key: 'cancel', aliases: ['batal', 'batalkan'] }
    ]
  });

  assert.equal(result.matched, true);
  assert.equal(result.action, 'cancel');
  assert.equal(result.source, 'rule');
}

async function main() {
  await testFuzzyEnum();
  await testFuzzyBoolean();
  await testExactAction();
  await testParamExtractorAutomationSlotAnswers();
  console.log('[LLM Option Resolution Smoke] All checks passed');
}

main().catch(error => {
  console.error('[LLM Option Resolution Smoke] Failed');
  console.error(error);
  process.exit(1);
}).then(() => process.exit(0));
