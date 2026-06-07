import assert from 'node:assert/strict';
import { isPotentialDynamicProfileStatementText } from '../src/utils/user-profile-statement.util';
import { PerceptionStage } from '../src/services/cores/stages/perception.stage';
import { skillSignalService } from '../src/services/skill-signal.service';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { dataAnalyzerSkill } from '../src/skills/data_analyzer.skill';
import { greetingSkill } from '../src/skills/greeting.skill';
import { buildIdentityPromptSection } from '../src/utils/general-chat-guard.util';
import { PlannerStage } from '../src/services/cores/stages/planner.stage';

function buildDecomposition(text: string) {
  const actionHints = /\b(jelaskan|jelasin|explain)\b/i.test(text) ? ['jelaskan'] : [];
  return {
    text,
    hasMultipleIntents: false,
    subQueries: [],
    connectors: [],
    signals: {
      actionHints,
      formatHints: [],
      temporalHints: [],
      temporalDetails: [],
      entityHints: [],
      asksForFile: false,
      asksForRealtimeData: false,
      isQuestion: true,
      language: 'id'
    }
  } as any;
}

async function main() {
  skillsRegistry.registerSkill(dataAnalyzerSkill, async () => ({}));
  skillsRegistry.registerSkill(greetingSkill, async () => ({}));

  assert.equal(
    isPotentialDynamicProfileStatementText('saya tidak bisa absen'),
    false,
    'operational problem statement must not be treated as profile statement'
  );

  const perception = new PerceptionStage();
  const result = await perception.execute({
    text: 'jelaskan apa itu workin',
    decomposition: buildDecomposition('jelaskan apa itu workin'),
    workingMemory: null,
    episodicMemory: null
  });

  assert.notEqual(result.frame.type, 'small_talk');
  assert.notEqual(result.frame.type, 'assistant_feedback');
  assert.equal(result.skipEmbedding, false);

  const signal = skillSignalService.detect('jelaskan apa itu workin');
  assert.equal(signal.recommendedSkill, undefined);
  assert.equal(signal.hasStrongSignal, false);

  const identitySignal = skillSignalService.detect('siapa anda');
  assert.equal(identitySignal.hasStrongSignal, true);
  assert.equal(identitySignal.recommendedSkill, 'greeting');

  const genericDisplaySignal = skillSignalService.detect('tampilkan');
  assert.equal(
    genericDisplaySignal.hasStrongSignal,
    false,
    'generic display trigger must not become a strong greeting route'
  );

  assert.equal(
    buildIdentityPromptSection('jelaskan apa itu workin'),
    '',
    'generic knowledge question must not inject VIPER identity prompt'
  );

  const identityResult = await perception.execute({
    text: 'siapa kamu',
    decomposition: buildDecomposition('siapa kamu'),
    workingMemory: null,
    episodicMemory: null
  });

  assert.equal(identityResult.frame.type, 'small_talk');
  assert.equal(identityResult.skipEmbedding, true);
  assert.match(
    buildIdentityPromptSection('siapa kamu'),
    /IDENTITAS KAMU/,
    'explicit assistant identity question should inject VIPER identity prompt'
  );

  const viperIdentityResult = await perception.execute({
    text: 'identitas viper',
    decomposition: buildDecomposition('identitas viper'),
    workingMemory: null,
    episodicMemory: null
  });

  assert.equal(viperIdentityResult.frame.type, 'small_talk');
  assert.equal(viperIdentityResult.skipEmbedding, true);
  assert.match(
    buildIdentityPromptSection('identitas viper'),
    /IDENTITAS KAMU/,
    'metadata identity phrase should inject VIPER identity prompt'
  );

  const noisyIdentityDecomposition = buildDecomposition('Siapa kamu');
  noisyIdentityDecomposition.signals.actionHints = ['siapa'];
  const noisyIdentityResult = await perception.execute({
    text: 'Siapa kamu',
    decomposition: noisyIdentityDecomposition,
    workingMemory: null,
    episodicMemory: null
  });

  assert.equal(
    noisyIdentityResult.frame.type,
    'small_talk',
    'identity question must survive noisy decomposition actionHints'
  );
  assert.equal(noisyIdentityResult.skipEmbedding, true);

  const planner = new PlannerStage();
  const greetingPlan = await planner.execute(
    [],
    {
      user_id: 'identity_smoke_user',
      app_name: 'hris',
      text: 'Siapa anda',
      attributes: {}
    } as any,
    { id: 'agent_smoke', slug: 'hris', name: 'HRIS' } as any,
    {
      usePlan: true,
      perceptionFrame: {
        type: 'small_talk',
        operations: ['clarify'],
        confidence: 0.92,
        reasoning: ['identity metadata matched']
      }
    },
    null as any
  );

  assert.equal(greetingPlan.chat, false);
  assert.equal(greetingPlan.tasks[0]?.resource, 'skill');
  assert.equal(greetingPlan.tasks[0]?.key, 'greeting');
  assert.equal(greetingPlan.needsClarification, undefined);

  console.log('[Profile and Knowledge Routing Smoke] All checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error('[Profile and Knowledge Routing Smoke] Failed');
  console.error(error);
  process.exit(1);
});
