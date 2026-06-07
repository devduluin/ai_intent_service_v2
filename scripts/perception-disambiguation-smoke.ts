import assert from 'node:assert/strict';
import { PlannerStage } from '../src/services/cores/stages/planner.stage';
import { perceptionDisambiguationService } from '../src/services/perception-disambiguation.service';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { memoryRecallSkill } from '../src/skills/memory_recall.skill';
import { userProfileRecallSkill } from '../src/skills/user_profile_recall.skill';
import type { Agent } from '../src/types/agent.types';
import type { PipelineInput } from '../src/types';
import type { PerceptionFrame } from '../src/types/perception.types';
import type { SkillSignal } from '../src/services/skill-signal.service';

skillsRegistry.registerSkill(memoryRecallSkill, async () => ({}));
skillsRegistry.registerSkill(userProfileRecallSkill, async () => ({}));

const input: PipelineInput = {
  user_id: 'perception_disambiguation_smoke',
  app_name: 'hris',
  text: 'apa yang saya tanyakan hari ini',
  language: 'id',
  attributes: {}
};

const agent = {
  id: 'agent-smoke',
  slug: 'hris',
  name: 'HRIS'
} as Agent;

const memoryFrame: PerceptionFrame = {
  type: 'memory_question',
  operations: ['recall'],
  confidence: 0.8,
  reasoning: ['Memory trigger matched'],
  target: { resource: 'memory', kind: 'previous_topic' }
};

async function testPlannerDoesNotLetProfileGateOverrideMemoryFrame() {
  const planner = new PlannerStage();
  const plan = await planner.execute(
    [],
    input,
    agent,
    { usePlan: true, perceptionFrame: memoryFrame },
    { episodic: null, working: null } as any
  );

  assert.equal(plan.chat, false);
  assert.equal(plan.tasks[0]?.resource, 'skill');
  assert.equal(plan.tasks[0]?.key, 'memory_recall');
}

async function testDeterministicMemoryWinsWhenNotAmbiguous() {
  const signal: SkillSignal = {
    hasStrongSignal: true,
    recommendedSkill: 'memory_recall',
    candidates: [
      {
        slug: 'memory_recall',
        name: 'Memory Recall',
        confidence: 0.9,
        matchedBy: ['trigger'],
        matchedText: ['apa yang saya tanyakan']
      },
      {
        slug: 'user_profile_recall',
        name: 'User Profile Recall',
        confidence: 0.5,
        matchedBy: ['tag'],
        matchedText: ['saya']
      }
    ]
  };

  const result = await perceptionDisambiguationService.refine({
    text: input.text,
    skillSignal: signal,
    perceptionFrame: memoryFrame
  });

  assert.equal(result.usedLlm, false);
  assert.equal(result.selectedSkill, 'memory_recall');
}

async function main() {
  await testPlannerDoesNotLetProfileGateOverrideMemoryFrame();
  await testDeterministicMemoryWinsWhenNotAmbiguous();
  console.log('[Perception Disambiguation Smoke] All checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error('[Perception Disambiguation Smoke] Failed');
  console.error(error);
  process.exit(1);
});
