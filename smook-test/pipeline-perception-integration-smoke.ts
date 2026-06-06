import assert from 'node:assert/strict';
import { OfferResolver } from '../src/services/cores/resolvers/offer.resolver';
import { PerceptionStage } from '../src/services/cores/stages/perception.stage';
import { PlannerStage } from '../src/services/cores/stages/planner.stage';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { memoryRecallSkill, handleMemoryRecall } from '../src/skills/memory_recall.skill';
import { automationManagerSkill } from '../src/skills/automation_manager.skill';
import { greetingSkill } from '../src/skills/greeting.skill';
import type { ActiveOffer } from '../src/types/active-offer.types';
import type { Agent } from '../src/types/agent.types';
import type { PerceptionFrame } from '../src/types/perception.types';

const perceptionStage = new PerceptionStage();
const plannerStage = new PlannerStage();
const offerResolver = new OfferResolver();

const agent: Agent = {
  id: 'smoke-agent',
  name: 'Smoke Agent',
  slug: 'hris',
  description: 'Smoke test agent',
  isActive: true,
  systemPrompt: null,
  customPrompt: null,
  modelId: null,
  llmModel: null,
  temperature: 0.2,
  maxTokens: null,
  memoryEnabled: true,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

const activeOffer: ActiveOffer = {
  id: 'offer-smoke',
  status: 'active',
  type: 'show_capabilities',
  label: 'Tampilkan kemampuan yang tersedia',
  reason: 'User baru menyapa dan ditawari melihat kemampuan.',
  source: {
    resource: 'skill',
    key: 'greeting'
  },
  target: {
    resource: 'skill',
    key: 'greeting',
    paramsPatch: {
      show_skills: true
    }
  },
  expectedAnswer: 'boolean',
  confidence: 0.9,
  safety: {
    requiresConfirmation: false,
    sideEffectLevel: 'none'
  },
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000
};

function registerSkills() {
  try {
    skillsRegistry.registerSkill(memoryRecallSkill, handleMemoryRecall);
  } catch {}

  try {
    skillsRegistry.registerSkill(automationManagerSkill, async () => ({}));
  } catch {}

  try {
    skillsRegistry.registerSkill(greetingSkill, async () => ({}));
  } catch {}
}

function input(text: string) {
  return {
    user_id: 'perception_smoke_user',
    app_name: 'hris',
    text,
    language: 'id' as const,
    attributes: {
      params: {
        company_id: 'company-smoke'
      }
    }
  };
}

function decomposition(text: string, overrides: Record<string, any> = {}) {
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
      temporalDetails: [],
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

async function planFromFrame(text: string, frame: PerceptionFrame) {
  return plannerStage.execute(
    [],
    input(text),
    agent,
    {
      usePlan: true,
      perceptionFrame: frame
    },
    {
      workingMemory: null,
      episodicMemory: null
    }
  );
}

async function testActiveOfferAcceptsExplicitResponse() {
  const result = await offerResolver.resolve(input('ya tampilkan'), {
    activeOffer
  } as any);

  assert.equal(result.isOfferResponse, true);
  assert.equal(result.accepted, true);
  assert.equal(result.shouldExecute, true);
  assert.equal(result.plan?.tasks[0]?.key, 'greeting');
  console.log('  ok active offer accepts explicit response');
}

async function testActiveOfferIgnoresNewIntent() {
  const result = await offerResolver.resolve(input('buat reminder saya meeting jam 3 sore'), {
    activeOffer
  } as any);

  assert.equal(result.isOfferResponse, false);
  console.log('  ok active offer ignores new intent');
}

async function testGreetingRoutesToGreetingSkill() {
  const perception = await perceptionStage.execute({
    text: 'halo',
    decomposition: decomposition('halo')
  });

  assert.equal(perception.frame.type, 'small_talk');
  assert.equal(perception.skipEmbedding, true);

  const plan = await planFromFrame('halo', perception.frame);
  assert.equal(plan.chat, false);
  assert.equal(plan.tasks[0]?.resource, 'skill');
  assert.equal(plan.tasks[0]?.key, 'greeting');
  console.log('  ok greeting routes to greeting skill');
}

async function testMixedGreetingActionDoesNotBecomeSmallTalk() {
  const perception = await perceptionStage.execute({
    text: 'halo cek kendaraan exit hari ini',
    decomposition: decomposition('halo cek kendaraan exit hari ini', {
      actionHints: ['cek'],
      temporalHints: ['hari ini'],
      temporalDetails: [
        {
          type: 'date',
          value: 'hari ini',
          normalizedValue: '2026-06-04',
          direction: 'current'
        }
      ]
    })
  });

  assert.notEqual(perception.frame.type, 'small_talk');
  assert.equal(perception.skipEmbedding, false);
  console.log('  ok mixed greeting action is not small_talk');
}

async function testAutomationRoutesToAutomationManager() {
  const perception = await perceptionStage.execute({
    text: 'ingatkan besok jam 7 saya meeting',
    decomposition: decomposition('ingatkan besok jam 7 saya meeting', {
      temporalDetails: [
        {
          type: 'relative',
          value: 'besok jam 7',
          normalizedValue: '+1 day',
          direction: 'future'
        }
      ]
    })
  });

  assert.equal(perception.frame.type, 'automation_request');

  const plan = await planFromFrame('ingatkan besok jam 7 saya meeting', perception.frame);
  assert.equal(plan.chat, false);
  assert.equal(plan.tasks[0]?.resource, 'skill');
  assert.equal(plan.tasks[0]?.key, 'automation_manager');
  console.log('  ok automation routes to automation_manager');
}

async function testMemoryQuestionRoutesToMemoryRecall() {
  const perception = await perceptionStage.execute({
    text: 'apa yang saya bahas kemarin?',
    decomposition: decomposition('apa yang saya bahas kemarin?', {
      temporalDetails: [
        {
          type: 'relative',
          value: 'kemarin',
          normalizedValue: '-1 day',
          direction: 'past'
        }
      ]
    })
  });

  assert.equal(perception.frame.type, 'memory_question');

  const plan = await planFromFrame('apa yang saya bahas kemarin?', perception.frame);
  assert.equal(plan.chat, false);
  assert.equal(plan.tasks[0]?.resource, 'skill');
  assert.equal(plan.tasks[0]?.key, 'memory_recall');
  console.log('  ok memory question routes to memory_recall');
}

async function testMemoryReplayFrameDetected() {
  const perception = await perceptionStage.execute({
    text: 'coba cek 3 hari yang lalu apa yang saya tanyakan jalankan ulang',
    decomposition: decomposition('coba cek 3 hari yang lalu apa yang saya tanyakan jalankan ulang', {
      temporalDetails: [
        {
          type: 'relative',
          value: '3 hari yang lalu',
          normalizedValue: '-3 day',
          direction: 'past'
        }
      ]
    })
  });

  assert.equal(perception.frame.type, 'memory_task_replay');
  assert.equal(perception.frame.replay?.requested, true);
  assert.equal(perception.frame.replay?.autoExecuteIfSingle, true);
  console.log('  ok memory replay frame detected');
}

async function testComparisonDoesNotSkipEmbedding() {
  const perception = await perceptionStage.execute({
    text: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
    decomposition: decomposition('cek kendaraan exit hari ini dan bandingkan dengan kemarin', {
      comparison: {
        isComparison: true,
        operator: 'compare',
        baseline: {
          source: 'current_query'
        }
      },
      temporalDetails: [
        {
          type: 'date',
          value: 'hari ini',
          normalizedValue: '2026-06-04',
          direction: 'current'
        },
        {
          type: 'date',
          value: 'kemarin',
          normalizedValue: '2026-06-03',
          direction: 'past'
        }
      ]
    })
  });

  assert.equal(perception.frame.type, 'comparison');
  assert.equal(perception.skipEmbedding, false);
  console.log('  ok comparison frame does not skip embedding');
}

async function testDirectTaskDoesNotRouteToOrchestrationSkill() {
  const perception = await perceptionStage.execute({
    text: 'cek kendaraan exit hari ini',
    decomposition: decomposition('cek kendaraan exit hari ini', {
      actionHints: ['cek'],
      temporalHints: ['hari ini']
    })
  });

  assert.equal(perception.frame.type, 'direct_task');
  assert.equal(perception.skipEmbedding, false);
  console.log('  ok direct task stays direct_task');
}

async function main() {
  console.log('\nPipeline Perception Integration Smoke\n');
  registerSkills();

  const tests: Array<() => Promise<void>> = [
    testActiveOfferAcceptsExplicitResponse,
    testActiveOfferIgnoresNewIntent,
    testGreetingRoutesToGreetingSkill,
    testMixedGreetingActionDoesNotBecomeSmallTalk,
    testAutomationRoutesToAutomationManager,
    testMemoryQuestionRoutesToMemoryRecall,
    testMemoryReplayFrameDetected,
    testComparisonDoesNotSkipEmbedding,
    testDirectTaskDoesNotRouteToOrchestrationSkill
  ];

  let passed = 0;
  for (const test of tests) {
    await withTestTimeout(test(), 8_000, test.name || 'anonymous');
    passed++;
  }

  console.log(`\n${passed} passed, 0 failed, ${tests.length} total`);
  process.exit(0);
}

async function withTestTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Test timed out: ${name}`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

main().catch(error => {
  console.error('\nPipeline Perception Integration Smoke failed');
  console.error(error);
  process.exit(1);
});
