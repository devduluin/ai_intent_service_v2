import assert from 'node:assert/strict';
import { PlannerStage } from '../src/services/cores/stages/planner.stage';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { automationManagerSkill, handleAutomationManager } from '../src/skills/automation_manager.skill';
import { skillSignalService } from '../src/services/skill-signal.service';

async function main() {
  skillsRegistry.registerSkill(automationManagerSkill, handleAutomationManager);
  const text = 'buat conditional alert kalau kendaraan exit lebih dari 1 unit';
  const skillSignal = skillSignalService.detect(text);

  assert.equal(skillSignal.hasStrongSignal, true);
  assert.equal(skillSignal.recommendedSkill, 'automation_manager');

  const planner = new PlannerStage();
  const plan = await planner.execute(
    [],
    {
      user_id: 'automation_gate_user',
      app_name: 'hris',
      text
    },
    {} as any,
    { usePlan: true, skillSignal },
    null as any
  );

  assert.equal(plan.chat, false);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].resource, 'skill');
  assert.equal(plan.tasks[0].key, 'automation_manager');

  const planWithToolCandidate = await planner.execute(
    [
      {
        intent: {
          id: 'vehicle_intent',
          slug: 'vehicle',
          name: 'Vehicle',
          description: 'Vehicle data',
          agentId: 'agent',
          executionType: 'llm',
          examples: [],
          tools: [
            {
              id: 'map1',
              priority: 1,
              isPrimary: true,
              tool: {
                id: 'tool1',
                slug: 'get_vehicle_assignment',
                name: 'Get Vehicle Assignment',
                description: 'Get vehicle assignment data',
                method: 'GET',
                url: 'https://example.test',
                isActive: true,
                parameters: []
              }
            } as any
          ],
          knowledge: []
        },
        score: 0.76,
        metadata: { source: 'planner_candidate_fallback' }
      } as any
    ],
    {
      user_id: 'automation_gate_user',
      app_name: 'hris',
      text
    },
    {} as any,
    { usePlan: true, skillSignal },
    null as any
  );

  assert.equal(planWithToolCandidate.chat, false);
  assert.equal(planWithToolCandidate.tasks.length, 1);
  assert.equal(planWithToolCandidate.tasks[0].resource, 'skill');
  assert.equal(planWithToolCandidate.tasks[0].key, 'automation_manager');

  console.log('[Automation Planner Gate Smoke] All checks passed');
}

main().catch(error => {
  console.error('[Automation Planner Gate Smoke] Failed');
  console.error(error);
  process.exit(1);
}).then(() => process.exit(0));
