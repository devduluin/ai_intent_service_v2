import assert from 'node:assert/strict';
import { isPotentialDynamicProfileStatementText } from '../src/utils/user-profile-statement.util';
import { PerceptionStage } from '../src/services/cores/stages/perception.stage';
import { skillSignalService } from '../src/services/skill-signal.service';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { dataAnalyzerSkill } from '../src/skills/data_analyzer.skill';
import { buildIdentityPromptSection } from '../src/utils/general-chat-guard.util';

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
    /IDENTITAS KAMU \(VIPER\)/,
    'explicit assistant identity question should inject VIPER identity prompt'
  );

  console.log('[Profile and Knowledge Routing Smoke] All checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error('[Profile and Knowledge Routing Smoke] Failed');
  console.error(error);
  process.exit(1);
});
