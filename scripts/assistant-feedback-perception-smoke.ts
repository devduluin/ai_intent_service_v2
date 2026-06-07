import assert from 'node:assert/strict';
import { PerceptionStage } from '../src/services/cores/stages/perception.stage';
import { PlannerStage } from '../src/services/cores/stages/planner.stage';
import type { Agent } from '../src/types/agent.types';
import type { PipelineInput } from '../src/types';

const input: PipelineInput = {
  user_id: 'assistant_feedback_smoke',
  app_name: 'hris',
  text: 'singkat sekali jawaban anda',
  language: 'id',
  attributes: {}
};

const agent = {
  id: 'agent-smoke',
  slug: 'hris',
  name: 'HRIS'
} as Agent;

async function main() {
  const perception = new PerceptionStage();
  const result = await perception.execute({
    text: input.text,
    decomposition: {
      text: input.text,
      hasMultipleIntents: false,
      subQueries: [],
      connectors: [],
      signals: {
        actionHints: [],
        formatHints: [],
        temporalHints: [],
        temporalDetails: [],
        entityHints: [],
        asksForFile: false,
        asksForRealtimeData: false,
        isQuestion: false,
        language: 'id'
      }
    } as any,
    workingMemory: null,
    episodicMemory: null
  });

  assert.equal(result.frame.type, 'assistant_feedback');
  assert.equal(result.skipEmbedding, true);

  const planner = new PlannerStage();
  const plan = await planner.execute(
    [],
    input,
    agent,
    { usePlan: true, perceptionFrame: result.frame },
    { episodic: null, working: null } as any
  );

  assert.equal(plan.chat, true);
  assert.equal(plan.tasks.length, 0);

  console.log('[Assistant Feedback Perception Smoke] All checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error('[Assistant Feedback Perception Smoke] Failed');
  console.error(error);
  process.exit(1);
});
