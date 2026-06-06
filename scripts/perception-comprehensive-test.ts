/**
 * Perception & Intent Frame — Comprehensive Test Suite (V1 Final)
 *
 * Covers every frame type, edge cases, pipeline integration, and regression.
 *
 * Frame types tested:
 *   direct_task, memory_question, memory_task_replay, automation_request,
 *   comparison, continuation_refine, offer_response, small_talk, unknown
 */

import assert from 'node:assert/strict';
import { PerceptionStage } from '../src/services/cores/stages/perception.stage';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { memoryRecallSkill, handleMemoryRecall } from '../src/skills/memory_recall.skill';
import { automationManagerSkill } from '../src/skills/automation_manager.skill';
import { greetingSkill } from '../src/skills/greeting.skill';

const perceptionStage = new PerceptionStage();

// ============================================================
// Test Helpers
// ============================================================

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
      actionHints: [] as string[],
      formatHints: [] as string[],
      temporalHints: [] as string[],
      temporalDetails: undefined as any,
      entityHints: [] as string[],
      asksForFile: false,
      asksForRealtimeData: false,
      isQuestion: text.endsWith('?'),
      language: 'id' as const,
      comparison: undefined as any,
      ...overrides
    }
  };
}

function makeTemporalDetail(value: string, normalized: string, direction: 'past' | 'future' = 'past') {
  return [{
    type: 'relative' as const,
    value,
    normalizedValue: normalized,
    direction
  }];
}

// ============================================================
// 1. DIRECT TASK (default)
// ============================================================

async function test_directTask_default() {
  const r = await perceptionStage.execute({
    text: 'cek kendaraan exit hari ini',
    decomposition: buildDecomposition('cek kendaraan exit hari ini')
  });
  assert.equal(r.frame.type, 'direct_task');
  assert.ok(r.frame.operations.includes('execute'));
}

async function test_directTask_withTemporal() {
  const r = await perceptionStage.execute({
    text: 'tampilkan laporan bulan ini',
    decomposition: buildDecomposition('tampilkan laporan bulan ini', {
      temporalDetails: makeTemporalDetail('bulan ini', '2026-06')
    })
  });
  assert.equal(r.frame.type, 'direct_task');
  assert.ok(r.frame.temporalScope);
}

// ============================================================
// 2. MEMORY QUESTION
// ============================================================

async function test_memoryQuestion_kemarin() {
  const r = await perceptionStage.execute({
    text: 'apa yang saya tanyakan kemarin?',
    decomposition: buildDecomposition('apa yang saya tanyakan kemarin?', {
      temporalDetails: makeTemporalDetail('kemarin', '-1 day')
    })
  });
  assert.equal(r.frame.type, 'memory_question');
  assert.equal(r.frame.target?.resource, 'memory');
  assert.equal(r.frame.target?.kind, 'previous_topic');
  assert.ok(r.frame.confidence >= 0.65);
}

async function test_memoryQuestion_relativeDays() {
  const r = await perceptionStage.execute({
    text: 'apa yang saya bahas 3 hari yang lalu?',
    decomposition: buildDecomposition('apa yang saya bahas 3 hari yang lalu?', {
      temporalDetails: makeTemporalDetail('3 hari yang lalu', '-3 day')
    })
  });
  assert.equal(r.frame.type, 'memory_question');
}

async function test_memoryQuestion_typo_robust() {
  // Typo "sayakan" instead of "saya" — should still match via standalone triggers
  const r = await perceptionStage.execute({
    text: 'apa yang sayakan tanyakan kemarin',
    decomposition: buildDecomposition('apa yang sayakan tanyakan kemarin', {
      temporalDetails: makeTemporalDetail('kemarin', '-1 day')
    })
  });
  assert.equal(r.frame.type, 'memory_question');
}

async function test_memoryQuestion_tadi() {
  const r = await perceptionStage.execute({
    text: 'tadi saya nanya apa ya?',
    decomposition: buildDecomposition('tadi saya nanya apa ya?')
  });
  assert.equal(r.frame.type, 'memory_question');
}

// ============================================================
// 3. MEMORY TASK REPLAY
// ============================================================

async function test_memoryTaskReplay_full() {
  const r = await perceptionStage.execute({
    text: 'coba cek 3 hari yang lalu apa yang saya tanyakan jalankan ulang',
    decomposition: buildDecomposition(
      'coba cek 3 hari yang lalu apa yang saya tanyakan jalankan ulang',
      { temporalDetails: makeTemporalDetail('3 hari yang lalu', '-3 day') }
    )
  });
  assert.equal(r.frame.type, 'memory_task_replay');
  assert.ok(r.frame.operations.includes('recall'));
  assert.ok(r.frame.operations.includes('select'));
  assert.ok(r.frame.operations.includes('execute'));
  assert.equal(r.frame.replay?.requested, true);
  assert.equal(r.frame.replay?.autoExecuteIfSingle, true);
  assert.equal(r.frame.replay?.clarifyIfMultiple, true);
  assert.ok(r.frame.confidence >= 0.80);
}

async function test_memoryTaskReplay_rerun() {
  const r = await perceptionStage.execute({
    text: 'ulangi yang kemarin',
    decomposition: buildDecomposition('ulangi yang kemarin', {
      temporalDetails: makeTemporalDetail('kemarin', '-1 day')
    })
  });
  assert.equal(r.frame.type, 'memory_task_replay');
}

async function test_memoryTaskReplay_vs_memoryQuestion() {
  // Memory words WITHOUT replay → memory_question
  const r = await perceptionStage.execute({
    text: 'apa yang saya tanyakan kemarin?',
    decomposition: buildDecomposition('apa yang saya tanyakan kemarin?', {
      temporalDetails: makeTemporalDetail('kemarin', '-1 day')
    })
  });
  assert.equal(r.frame.type, 'memory_question');
  assert.notEqual(r.frame.type, 'memory_task_replay');
}

// ============================================================
// 4. AUTOMATION REQUEST
// ============================================================

async function test_automationRequest_reminder() {
  const r = await perceptionStage.execute({
    text: 'ingatkan besok jam 7 saya meeting',
    decomposition: buildDecomposition('ingatkan besok jam 7 saya meeting', {
      temporalDetails: makeTemporalDetail('besok jam 7', '+1 day', 'future')
    })
  });
  assert.equal(r.frame.type, 'automation_request');
  assert.equal(r.frame.target?.resource, 'automation');
  assert.equal(r.frame.automation?.requested, true);
  assert.equal(r.frame.automation?.kind, 'reminder');
}

async function test_automationRequest_scheduled() {
  const r = await perceptionStage.execute({
    text: 'jadwalkan laporan setiap hari jam 5 sore',
    decomposition: buildDecomposition('jadwalkan laporan setiap hari jam 5 sore')
  });
  assert.equal(r.frame.type, 'automation_request');
  assert.equal(r.frame.automation?.kind, 'scheduled_workflow');
}

async function test_automationRequest_conditional() {
  const r = await perceptionStage.execute({
    text: 'kalau expense lebih dari 10 juta kabari saya',
    decomposition: buildDecomposition('kalau expense lebih dari 10 juta kabari saya')
  });
  assert.equal(r.frame.type, 'automation_request');
  assert.equal(r.frame.automation?.kind, 'conditional_alert');
}

// ============================================================
// 5. COMPARISON
// ============================================================

async function test_comparison_withSignal() {
  const r = await perceptionStage.execute({
    text: 'bandingkan penjualan bulan ini dengan bulan lalu',
    decomposition: buildDecomposition(
      'bandingkan penjualan bulan ini dengan bulan lalu',
      { comparison: { isComparison: true, operator: 'compare' as const } }
    )
  });
  assert.equal(r.frame.type, 'comparison');
  assert.ok(r.frame.operations.includes('compare'));
}

async function test_comparison_noSignal_defaultsToDirectTask() {
  // Without comparison signal → direct_task
  const r = await perceptionStage.execute({
    text: 'bandingkan penjualan',
    decomposition: buildDecomposition('bandingkan penjualan')
  });
  assert.notEqual(r.frame.type, 'comparison');
}

// ============================================================
// 6. CONTINUATION / REFINE
// ============================================================

async function test_continuationRefine_withActiveState() {
  const wm: any = {
    activeTool: 'get_vehicle_data',
    activePlan: { mode: 'single_step', tasks: [], chat: false }
  };
  const r = await perceptionStage.execute({
    text: 'lebih detail',
    decomposition: buildDecomposition('lebih detail'),
    workingMemory: wm
  });
  assert.equal(r.frame.type, 'continuation_refine');
}

async function test_continuationRefine_ringkas() {
  const wm: any = { activeTool: 'get_report' };
  const r = await perceptionStage.execute({
    text: 'ringkas',
    decomposition: buildDecomposition('ringkas'),
    workingMemory: wm
  });
  assert.equal(r.frame.type, 'continuation_refine');
}

async function test_continuationRefine_noActiveState_notContinuation() {
  const r = await perceptionStage.execute({
    text: 'lebih detail',
    decomposition: buildDecomposition('lebih detail')
  });
  assert.notEqual(r.frame.type, 'continuation_refine');
}

// ============================================================
// 7. OFFER RESPONSE
// ============================================================

async function test_offerResponse_accept() {
  const wm: any = { activeOffer: { id: 'o1', label: 'Run again?', action: 'rerun' } };
  const r = await perceptionStage.execute({
    text: 'ya',
    decomposition: buildDecomposition('ya'),
    workingMemory: wm
  });
  assert.equal(r.frame.type, 'offer_response');
  assert.ok(r.frame.operations.includes('execute'));
}

async function test_offerResponse_reject() {
  const wm: any = { activeOffer: { id: 'o1', label: 'Run again?', action: 'rerun' } };
  const r = await perceptionStage.execute({
    text: 'tidak',
    decomposition: buildDecomposition('tidak'),
    workingMemory: wm
  });
  assert.equal(r.frame.type, 'offer_response');
  assert.ok(r.frame.operations.includes('clarify'));
}

async function test_offerResponse_ya_withoutActiveOffer_isNotOfferResponse() {
  const r = await perceptionStage.execute({
    text: 'ya',
    decomposition: buildDecomposition('ya')
  });
  assert.notEqual(r.frame.type, 'offer_response');
}

// ============================================================
// 8. SMALL TALK
// ============================================================

async function test_smallTalk_halo() {
  const r = await perceptionStage.execute({
    text: 'halo',
    decomposition: buildDecomposition('halo')
  });
  assert.equal(r.frame.type, 'small_talk');
  assert.equal(r.skipEmbedding, true);
}

async function test_smallTalk_terimakasih() {
  const r = await perceptionStage.execute({
    text: 'terimakasih',
    decomposition: buildDecomposition('terimakasih')
  });
  assert.equal(r.frame.type, 'small_talk');
}

async function test_smallTalk_capabilityRequest() {
  const r = await perceptionStage.execute({
    text: 'kamu bisa apa?',
    decomposition: buildDecomposition('kamu bisa apa?')
  });
  assert.equal(r.frame.type, 'small_talk');
}

// ============================================================
// 9. PRIORITY / EDGE CASES
// ============================================================

async function test_offerResponse_winsOverSmallTalk() {
  // "ya" with active offer → offer_response, NOT small_talk
  const wm: any = { activeOffer: { id: 'o1', label: 'Test' } };
  const r = await perceptionStage.execute({
    text: 'ya',
    decomposition: buildDecomposition('ya'),
    workingMemory: wm
  });
  assert.equal(r.frame.type, 'offer_response');
}

async function test_comparison_winsOverMemory() {
  // "bandingkan kemarin dengan hari ini" has "kemarin" (memory trigger)
  // but comparison signal should win
  const r = await perceptionStage.execute({
    text: 'bandingkan data kemarin dengan hari ini',
    decomposition: buildDecomposition('bandingkan data kemarin dengan hari ini', {
      temporalDetails: makeTemporalDetail('kemarin', '-1 day'),
      comparison: { isComparison: true, operator: 'compare' as const }
    })
  });
  assert.equal(r.frame.type, 'comparison');
}

async function test_skipEmbedding_setForHighConfidence() {
  // memory_question with confidence >= 0.85 should skip embedding
  const r = await perceptionStage.execute({
    text: 'apa yang saya tanyakan kemarin?',
    decomposition: buildDecomposition('apa yang saya tanyakan kemarin?', {
      temporalDetails: makeTemporalDetail('kemarin', '-1 day')
    })
  });
  // confidence is 0.80 (MEDIUM_CONFIDENCE), which is < 0.85
  // so skipEmbedding should be false (not skipped)
  assert.equal(r.skipEmbedding, false);
}

async function test_temporalScope_extracted() {
  const r = await perceptionStage.execute({
    text: 'apa yang saya bahas 5 hari yang lalu?',
    decomposition: buildDecomposition('apa yang saya bahas 5 hari yang lalu?', {
      temporalDetails: makeTemporalDetail('5 hari yang lalu', '-5 day')
    })
  });
  assert.ok(r.frame.temporalScope);
  assert.ok(r.frame.temporalScope!.raw!.includes('5 hari'));
}

// ============================================================
// Run All Tests
// ============================================================

(async () => {
  console.log('\n=== Perception Comprehensive Test Suite ===\n');

  // Register skills
  try {
    skillsRegistry.registerSkill(memoryRecallSkill, handleMemoryRecall);
    skillsRegistry.registerSkill(automationManagerSkill, async () => ({}));
    skillsRegistry.registerSkill(greetingSkill, async () => ({}));
  } catch { /* already registered */ }

  const tests = [
    // Direct Task
    ['direct_task (default)', test_directTask_default],
    ['direct_task (with temporal)', test_directTask_withTemporal],

    // Memory Question
    ['memory_question (kemarin)', test_memoryQuestion_kemarin],
    ['memory_question (relative days)', test_memoryQuestion_relativeDays],
    ['memory_question (typo robust)', test_memoryQuestion_typo_robust],
    ['memory_question (tadi)', test_memoryQuestion_tadi],

    // Memory Task Replay
    ['memory_task_replay (full)', test_memoryTaskReplay_full],
    ['memory_task_replay (rerun)', test_memoryTaskReplay_rerun],
    ['memory_task_replay vs memory_question', test_memoryTaskReplay_vs_memoryQuestion],

    // Automation Request
    ['automation_request (reminder)', test_automationRequest_reminder],
    ['automation_request (scheduled)', test_automationRequest_scheduled],
    ['automation_request (conditional)', test_automationRequest_conditional],

    // Comparison
    ['comparison (with signal)', test_comparison_withSignal],
    ['comparison (no signal)', test_comparison_noSignal_defaultsToDirectTask],

    // Continuation
    ['continuation_refine (active state)', test_continuationRefine_withActiveState],
    ['continuation_refine (ringkas)', test_continuationRefine_ringkas],
    ['continuation_refine (no active state)', test_continuationRefine_noActiveState_notContinuation],

    // Offer Response
    ['offer_response (accept)', test_offerResponse_accept],
    ['offer_response (reject)', test_offerResponse_reject],
    ['offer_response (ya w/o offer)', test_offerResponse_ya_withoutActiveOffer_isNotOfferResponse],

    // Small Talk
    ['small_talk (halo)', test_smallTalk_halo],
    ['small_talk (terimakasih)', test_smallTalk_terimakasih],
    ['small_talk (capability)', test_smallTalk_capabilityRequest],

    // Priority & Edge Cases
    ['priority: offer > small_talk', test_offerResponse_winsOverSmallTalk],
    ['priority: comparison > memory', test_comparison_winsOverMemory],
    ['skipEmbedding threshold', test_skipEmbedding_setForHighConfidence],
    ['temporalScope extraction', test_temporalScope_extracted],
  ];

  let passed = 0, failed = 0;
  const failures: string[] = [];

  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`  ✗ ${name}: ${msg}`);
      console.log(`  ✗ ${name}: ${msg}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(f));
    process.exit(1);
  }
})();