import assert from 'node:assert/strict';
import { PlannerStage } from '../src/services/cores/stages/planner.stage';
import { skillsRegistry } from '../src/services/skills-registry.service';
import type { InternalSkillMetadata } from '../src/types/internal-skill.types';
import type { SkillSignal } from '../src/services/skill-signal.service';

function registerSkill(slug: string, overrides: Partial<InternalSkillMetadata> = {}) {
  const metadata: InternalSkillMetadata = {
    name: slug,
    slug,
    description: `${slug} test skill`,
    handlerKey: `handle_${slug}`,
    category: 'test',
    capabilities: {
      actionTypes: ['test'],
      outputFormats: ['json'],
      triggers: [slug],
      requiresData: false,
      priority: 5
    },
    paramSchema: [],
    ...overrides
  };

  skillsRegistry.registerSkill(metadata, async () => ({}));
}

function main() {
  registerSkill('memory_recall', {
    category: 'memory',
    capabilities: {
      actionTypes: ['recall'],
      outputFormats: ['summary'],
      triggers: ['apa yang saya tanyakan'],
      context: ['memory_retrieval'],
      requiresData: false,
      priority: 9
    }
  });
  registerSkill('user_profile_recall', {
    category: 'memory',
    capabilities: {
      actionTypes: ['profile_recall'],
      outputFormats: ['facts'],
      triggers: ['email saya apa'],
      context: ['user_profile'],
      requiresData: false,
      priority: 9
    }
  });
  registerSkill('automation_manager', {
    category: 'automation',
    capabilities: {
      actionTypes: ['schedule'],
      outputFormats: ['draft'],
      triggers: ['ingatkan'],
      context: ['future_task'],
      requiresData: false,
      priority: 9
    }
  });
  registerSkill('data_analyzer', {
    capabilities: {
      actionTypes: ['analyze'],
      outputFormats: ['analysis'],
      triggers: ['analisa'],
      requiresData: true,
      priority: 5
    }
  });

  const planner = new PlannerStage() as any;
  const signal: SkillSignal = {
    hasStrongSignal: true,
    recommendedSkill: 'memory_recall',
    candidates: [
      {
        slug: 'memory_recall',
        name: 'Memory Recall',
        confidence: 0.92,
        matchedBy: ['trigger'],
        matchedText: ['apa yang saya tanyakan']
      },
      {
        slug: 'user_profile_recall',
        name: 'User Profile Recall',
        confidence: 0.71,
        matchedBy: ['tag'],
        matchedText: ['saya']
      },
      {
        slug: 'automation_manager',
        name: 'Automation Manager',
        confidence: 0.36,
        matchedBy: ['tag'],
        matchedText: ['manager']
      },
      {
        slug: 'data_analyzer',
        name: 'Data Analyzer',
        confidence: 0.35,
        matchedBy: ['tag'],
        matchedText: ['data']
      }
    ]
  };

  const selected = planner.selectSkillCandidates(signal, {
    type: 'memory_question',
    operations: ['recall'],
    confidence: 0.8,
    reasoning: ['memory test']
  });

  assert.ok(selected.length <= 3, 'planner must pass max 3 skill candidates');
  assert.equal(selected[0].slug, 'memory_recall');
  assert.ok(selected.some((skill: any) => skill.slug === 'user_profile_recall'));
  assert.equal(selected.some((skill: any) => skill.slug === 'data_analyzer'), false);

  const empty = planner.selectSkillCandidates(undefined, {
    type: 'direct_task',
    operations: ['execute'],
    confidence: 0.65,
    reasoning: ['direct task']
  });
  assert.equal(empty.length, 0, 'direct task without skill signal should not send all skills');

  console.log('[Planner Skill Candidate Filter Smoke] All checks passed');
  process.exit(0);
}

main();
