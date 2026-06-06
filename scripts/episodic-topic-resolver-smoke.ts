import assert from 'node:assert/strict';
import { episodicTopicResolverService } from '../src/services/episodic-topic-resolver.service';
import { intentRepository } from '../src/repositories/intent.repository';
import { skillsRegistry } from '../src/services/skills-registry.service';
import type { PipelineResult } from '../src/types';

function result(overrides: Partial<PipelineResult>): PipelineResult {
  return {
    intent: 'vehicles',
    score: 1,
    apiResult: {},
    naturalResponse: 'ok',
    metadata: {},
    ...overrides
  };
}

async function testToolTopic() {
  (intentRepository as any).findByToolSlug = async (toolSlug: string) => ({
    slug: toolSlug === 'get_vehicle_assignment' ? 'vehicles' : 'utilities',
    name: toolSlug === 'get_vehicle_assignment' ? 'Vehicles' : 'Utilities'
  });

  const writeContext = await episodicTopicResolverService.resolve({
    result: result({
      intent: 'vehicles',
      metadata: {
        activePlan: {
          mode: 'single_step',
          chat: false,
          tasks: [{ id: '1', resource: 'tool', key: 'get_vehicle_assignment', depends_on: [] }]
        }
      }
    })
  });

  assert.equal(writeContext.topicKey, 'vehicles');
  assert.equal(writeContext.flowStage, 'main_pipeline');
  assert.equal(writeContext.taskPlan?.tasks[0].key, 'get_vehicle_assignment');
}

async function testOfferDoesNotBecomeTopic() {
  (intentRepository as any).findByToolSlug = async () => ({
    slug: 'vehicles',
    name: 'Vehicles'
  });

  const writeContext = await episodicTopicResolverService.resolve({
    result: result({
      intent: 'offer:refine_param',
      metadata: {
        acceptedOffer: {
          id: 'offer-1',
          status: 'accepted',
          type: 'refine_param',
          label: 'Lihat status leave',
          reason: 'summary has leave',
          source: { resource: 'tool', key: 'get_vehicle_assignment' },
          target: {
            resource: 'tool',
            key: 'get_vehicle_assignment',
            paramsPatch: { status: 'leave' },
            inheritParams: true
          },
          expectedAnswer: 'boolean',
          confidence: 0.9,
          safety: { requiresConfirmation: false, sideEffectLevel: 'none' },
          expiresAt: Date.now() + 60_000,
          createdAt: Date.now()
        },
        activePlan: {
          mode: 'single_step',
          chat: false,
          tasks: [{ id: '1', resource: 'tool', key: 'get_vehicle_assignment', depends_on: [] }]
        }
      }
    })
  });

  assert.equal(writeContext.topicKey, 'vehicles');
  assert.equal(writeContext.flowStage, 'offer_accepted');
  assert.notEqual(writeContext.topicKey, 'offer:refine_param');
}

async function testMemoryRecallSkillTopic() {
  skillsRegistry.registerSkill(
    {
      name: 'Memory Recall',
      slug: 'memory_recall',
      description: 'Recall memory',
      handlerKey: 'memoryRecallSmoke',
      paramSchema: []
    },
    async () => ({ ok: true })
  );

  const writeContext = await episodicTopicResolverService.resolve({
    result: result({
      intent: 'memory_recall',
      metadata: {
        activePlan: {
          mode: 'single_step',
          chat: false,
          tasks: [{ id: '1', resource: 'skill', key: 'memory_recall', depends_on: [] }]
        }
      }
    })
  });

  assert.equal(writeContext.topicKey, 'internal_skill:memory_recall');
  assert.equal(writeContext.topicLabel, 'Memory Recall');
}

async function main() {
  await testToolTopic();
  await testOfferDoesNotBecomeTopic();
  await testMemoryRecallSkillTopic();
  console.log('[Episodic Topic Resolver Smoke] All checks passed');
}

main().catch(error => {
  console.error('[Episodic Topic Resolver Smoke] Failed');
  console.error(error);
  process.exit(1);
});
