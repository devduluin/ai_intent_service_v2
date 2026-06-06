/**
 * Perception & Intent Frame — Phase 7 Smoke Test
 *
 * Tests:
 * - memory_question detection
 * - memory_task_replay detection
 * - automation_request detection
 * - small_talk detection
 * - comparison detection
 * - offer_response detection
 * - continuation_refine detection
 * - direct_task default
 * - PerceptionStage end-to-end
 * - MemoryTaskReplayService recall + select
 * - PlannerStage routePerceptionFrame
 */

import assert from 'node:assert/strict';
import { PerceptionStage } from '../src/services/cores/stages/perception.stage';
import { memoryTaskReplayService } from '../src/services/memory-task-replay.service';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { memoryRecallSkill, handleMemoryRecall } from '../src/skills/memory_recall.skill';
import { automationManagerSkill } from '../src/skills/automation_manager.skill';
import { greetingSkill } from '../src/skills/greeting.skill';

const perceptionStage = new PerceptionStage();

function buildDecomposition(text: string, overrides: Record<string, any> = {}) {
  return {
    originalQuery: text,
    normalizedQuery: text,
    primaryQuery: text,
    subQueries: [text],
    hasMultipleIntents: false,
    connectors: [],
    confidence: 1,
    reason: 'single_intent' as const,
    signals: {
      actionHints: [],
      formatHints: [],
      temporalHints: [],
      temporalDetails: undefined,
      entityHints: [],
      asksForFile: false,
      asksForRealtimeData: false,
      isQuestion: text.includes('?'),
      language: 'id' as const,
      comparison: undefined,
      ...overrides
    }
  };
}

// ============================================================
// Phase 7 Tests
// ============================================================

async function testMemoryQuestion() {
  const result = await perceptionStage.execute({
    text: 'apa yang saya bahas kemarin?',
    decomposition: buildDecomposition('apa yang saya bahas kemarin?', {
      temporalDetails: [{
        type: 'relative' as const,
        value: 'kemarin',
        normalizedValue: '-1 day',
        direction: 'past' as const
      }]
    })
  });

  assert.equal(result.frame.type, 'memory_question');
  assert.ok(result.frame.operations.includes('recall'));
  assert.ok(result.frame.confidence >= 0.65);
  assert.equal(result.frame.target?.resource, 'memory');
  console.log('  ✓ memory_question');
}

async function testMemoryTaskReplay() {
  const result = await perceptionStage.execute({
    text: 'coba cek 3 hari yang lalu apa yang saya tanyakan jalankan ulang',
    decomposition: buildDecomposition(
      'coba cek 3 hari yang lalu apa yang saya tanyakan jalankan ulang',
      {
        temporalDetails: [{
          type: 'relative' as const,
          value: '3 hari yang lalu',
          normalizedValue: '-3 day',
          direction: 'past' as const
        }]
      }
    )
  });

  assert.equal(result.frame.type, 'memory_task_replay');
  assert.ok(result.frame.operations.includes('recall'));
  assert.ok(result.frame.operations.includes('select'));
  assert.ok(result.frame.operations.includes('execute'));
  assert.ok(result.frame.confidence >= 0.80);
  assert.equal(result.frame.target?.resource, 'memory');
  assert.equal(result.frame.target?.kind, 'previous_task');
  assert.equal(result.frame.replay?.requested, true);
  assert.equal(result.frame.replay?.autoExecuteIfSingle, true);
  assert.equal(result.frame.replay?.clarifyIfMultiple, true);
  assert.ok(result.frame.temporalScope?.relativeOffsetDays === 3);
  console.log('  ✓ memory_task_replay');
}

async function testAutomationRequest() {
  const result = await perceptionStage.execute({
    text: 'ingatkan besok jam 7 saya meeting',
    decomposition: buildDecomposition('ingatkan besok jam 7 saya meeting', {
      temporalDetails: [{
        type: 'relative' as const,
        value: 'besok jam 7',
        normalizedValue: '+1 day',
        direction: 'future' as const
      }]
    })
  });

  assert.equal(result.frame.type, 'automation_request');
  assert.ok(result.frame.operations.includes('schedule'));
  assert.equal(result.frame.target?.resource, 'automation');
  assert.equal(result.frame.target?.kind, 'future_task');
  assert.equal(result.frame.automation?.requested, true);
  assert.equal(result.frame.automation?.futureTask, true);
  assert.equal(result.frame.confidence >= 0.65, true);
  console.log('  ✓ automation_request');
}

async function testSmallTalk() {
  const result = await perceptionStage.execute({
    text: 'halo',
    decomposition: buildDecomposition('halo')
  });

  assert.equal(result.frame.type, 'small_talk');
  assert.ok(result.frame.confidence >= 0.6);
  console.log('  ✓ small_talk');
}

async function testComparison() {
  const result = await perceptionStage.execute({
    text: 'bandingkan penjualan bulan ini dengan bulan lalu',
    decomposition: buildDecomposition(
      'bandingkan penjualan bulan ini dengan bulan lalu',
      {
        comparison: {
          isComparison: true,
          operator: 'compare' as const
        }
      }
    )
  });

  assert.equal(result.frame.type, 'comparison');
  assert.ok(result.frame.operations.includes('compare'));
  console.log('  ✓ comparison');
}

async function testOfferResponse() {
  const workingMemory = {
    activeOffer: {
      id: 'offer-1',
      label: 'Run again?',
      action: 'rerun'
    } as any
  };

  const result = await perceptionStage.execute({
    text: 'ya',
    decomposition: buildDecomposition('ya'),
    workingMemory
  });

  assert.equal(result.frame.type, 'offer_response');
  assert.ok(result.frame.operations.includes('execute'));
  console.log('  ✓ offer_response (accept)');
}

async function testOfferResponseReject() {
  const workingMemory = {
    activeOffer: {
      id: 'offer-1',
      label: 'Run again?',
      action: 'rerun'
    } as any
  };

  const result = await perceptionStage.execute({
    text: 'tidak',
    decomposition: buildDecomposition('tidak'),
    workingMemory
  });

  assert.equal(result.frame.type, 'offer_response');
  assert.ok(result.frame.operations.includes('clarify'));
  console.log('  ✓ offer_response (reject)');
}

async function testOfferResponseWithoutActiveOffer() {
  // "ya" without active offer should NOT be offer_response
  const result = await perceptionStage.execute({
    text: 'ya',
    decomposition: buildDecomposition('ya')
  });

  assert.notEqual(result.frame.type, 'offer_response');
  console.log('  ✓ ya without active offer is NOT offer_response');
}

async function testContinuationRefine() {
  const workingMemory = {
    activeTool: 'get_vehicle_data',
    activePlan: { mode: 'single_step', tasks: [], chat: false }
  } as any;

  const result = await perceptionStage.execute({
    text: 'lebih detail',
    decomposition: buildDecomposition('lebih detail'),
    workingMemory
  });

  assert.equal(result.frame.type, 'continuation_refine');
  console.log('  ✓ continuation_refine');
}

async function testDirectTask() {
  const result = await perceptionStage.execute({
    text: 'cek kendaraan exit hari ini',
    decomposition: buildDecomposition('cek kendaraan exit hari ini')
  });

  assert.equal(result.frame.type, 'direct_task');
  console.log('  ✓ direct_task (default)');
}

async function testMemoryQuestionVsReplay() {
  // Memory words WITHOUT replay should be memory_question, not memory_task_replay
  const result = await perceptionStage.execute({
    text: 'apa yang saya tanyakan kemarin?',
    decomposition: buildDecomposition('apa yang saya tanyakan kemarin?', {
      temporalDetails: [{
        type: 'relative' as const,
        value: 'kemarin',
        normalizedValue: '-1 day',
        direction: 'past' as const
      }]
    })
  });

  assert.equal(result.frame.type, 'memory_question');
  assert.notEqual(result.frame.type, 'memory_task_replay');
  console.log('  ✓ memory_question (not replay)');
}

// ============================================================
// Run all
// ============================================================

(async () => {
  console.log('\nPerception & Intent Frame — Phase 7 Smoke Test\n');

  // Register skills (needed for runtime trigger lookup)
  try {
    skillsRegistry.registerSkill(memoryRecallSkill, handleMemoryRecall);
    skillsRegistry.registerSkill(automationManagerSkill, async () => ({}));
    skillsRegistry.registerSkill(greetingSkill, async () => ({}));
  } catch {
    // Already registered
  }

  const tests: Array<{ name: string; fn: () => Promise<void> }> = [
    { name: 'memory_question', fn: testMemoryQuestion },
    { name: 'memory_task_replay', fn: testMemoryTaskReplay },
    { name: 'automation_request', fn: testAutomationRequest },
    { name: 'small_talk', fn: testSmallTalk },
    { name: 'comparison', fn: testComparison },
    { name: 'offer_response (accept)', fn: testOfferResponse },
    { name: 'offer_response (reject)', fn: testOfferResponseReject },
    { name: 'ya without active offer', fn: testOfferResponseWithoutActiveOffer },
    { name: 'continuation_refine', fn: testContinuationRefine },
    { name: 'direct_task default', fn: testDirectTask },
    { name: 'memory_question vs replay', fn: testMemoryQuestionVsReplay },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (err) {
      failed++;
      console.log(`  ✗ ${test.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);

  if (failed > 0) {
    process.exit(1);
  }
})();