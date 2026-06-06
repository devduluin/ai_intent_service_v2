import assert from 'node:assert/strict';
import { memoryRecallService } from '../src/services/memory-recall.service';
import { episodicMemoryRepository } from '../src/repositories/episodic-memory.repository';
import { handleMemoryRecall, memoryRecallSkill } from '../src/skills/memory_recall.skill';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { toolPlannerService } from '../src/services/toolPlanner.service';
import { offerGenerationService } from '../src/services/offer-generation.service';

async function testDateRecall() {
  const yesterday = '2026-05-31';
  const calls: any[] = [];

  (episodicMemoryRepository as any).findByDateRange = async (
    userId: string,
    appName: string,
    start: Date,
    end: Date,
    limit: number
  ) => {
    calls.push({ userId, appName, start, end, limit });
    return [
      {
        intent: 'get_vehicle_assignment',
        summary: 'User menanyakan kendaraan exit dan comparison dengan kemarin.',
        created_at: new Date(`${yesterday}T10:00:00+07:00`)
      }
    ];
  };

  const result = await memoryRecallService.recall({
    userId: 'memory-user',
    appName: 'hris',
    query: 'Apa yang saya tanyakan kemarin?',
    params: {
      date: yesterday,
      limit: 3
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, 'memory-user');
  assert.equal(calls[0].appName, 'hris');
  assert.equal(result.isEmpty, false);
  assert.equal(result.metadata.mode, 'date');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].intent, 'get_vehicle_assignment');
}

async function testRecentFallback() {
  (episodicMemoryRepository as any).findByUserAndApp = async () => [
    {
      intent: 'general_chat',
      summary: 'User bertanya tentang kemampuan sistem.',
      created_at: new Date('2026-06-01T09:00:00+07:00')
    }
  ];

  const result = await memoryRecallService.recall({
    userId: 'memory-user',
    appName: 'hris',
    query: 'Tadi saya tanya apa?',
    params: {}
  });

  assert.equal(result.metadata.mode, 'recent');
  assert.equal(result.items.length, 1);
}

async function testSkillHandler() {
  skillsRegistry.registerSkill(memoryRecallSkill, handleMemoryRecall);

  (episodicMemoryRepository as any).findByUserAndApp = async () => [];

  const result = await handleMemoryRecall(
    {},
    {
      user_id: 'memory-user',
      app_name: 'hris',
      text: 'apa yang saya tanyakan?',
      attributes: {}
    }
  );

  assert.equal(result.kind, 'memory_recall');
  assert.equal(result.isEmpty, true);
  assert.equal(skillsRegistry.hasSkill('memory_recall'), true);
}

function testPlannerPromptContainsMemoryRules() {
  const prompt = (toolPlannerService as any).buildPrompt({
    input: {
      text: 'apa yang saya tanyakan kemarin?',
      chat_history: []
    },
    candidates: {
      skillsDetails: [memoryRecallSkill],
      toolsDetails: [
        {
          slug: 'get_vehicle_assignment',
          description: 'Cek data kendaraan operasional'
        }
      ],
      knowledgeDetails: []
    }
  });

  assert.match(prompt, /memory_recall/);
  assert.match(prompt, /apa yang saya tanyakan kemarin/);
  assert.match(prompt, /cek kendaraan kemarin/);
}

async function testMemoryRecallGeneratesExecutableOffer() {
  const result = await offerGenerationService.generate({
    input: {
      user_id: 'memory-user',
      app_name: 'hris',
      text: 'Apa yang saya bahas kemarin?',
      attributes: {}
    },
    plan: {
      mode: 'single_step',
      chat: false,
      tasks: [
        { id: '1', resource: 'skill', key: 'memory_recall', depends_on: [] }
      ]
    },
    params: {},
    results: {
      memory_recall: {
        kind: 'memory_recall',
        isEmpty: false,
        items: [
          {
            topicKey: 'vehicles',
            flowStage: 'main_pipeline',
            summary: 'User membahas kendaraan exit.',
            taskPlan: {
              mode: 'single_step',
              chat: false,
              tasks: [
                { id: '1', resource: 'tool', key: 'get_vehicle_assignment', depends_on: [] }
              ]
            },
            flowTrace: [
              {
                stage: 'main_pipeline',
                resource: 'tool',
                key: 'get_vehicle_assignment',
                timestamp: Date.now(),
                params: {
                  company_id: 'company-1',
                  status: 'exit',
                  date: '2026-06-01'
                }
              }
            ]
          }
        ]
      }
    },
    executedTasks: [
      { key: 'memory_recall', resource: 'skill' }
    ],
    workingMemory: null
  });

  assert.equal(result.selectedOffer?.type, 'rerun_memory_task');
  assert.equal(result.selectedOffer?.target.resource, 'tool');
  assert.equal(result.selectedOffer?.target.key, 'get_vehicle_assignment');
  assert.equal(result.selectedOffer?.target.paramsPatch?.status, 'exit');
}

async function main() {
  await testDateRecall();
  await testRecentFallback();
  await testSkillHandler();
  testPlannerPromptContainsMemoryRules();
  await testMemoryRecallGeneratesExecutableOffer();
  console.log('[Memory Recall Smoke] All checks passed');
}

main().catch(error => {
  console.error('[Memory Recall Smoke] Failed');
  console.error(error);
  process.exit(1);
});
