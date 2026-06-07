import assert from 'node:assert/strict';
import { ContinuationStage } from '../src/services/cores/stages/continuation.stage';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { dataAnalyzerSkill } from '../src/skills/data_analyzer.skill';
import { xlsGeneratorSkill } from '../src/skills/xls.skill';

async function main() {
  skillsRegistry.registerSkill(dataAnalyzerSkill, async () => ({}));
  skillsRegistry.registerSkill(xlsGeneratorSkill, async () => ({}));

  const stage = new ContinuationStage() as any;
  const cachedData = {
    get_time: {
      timezone: 'Asia/Jakarta',
      date_time: '2026-06-07T18:51:41+07:00'
    },
    xls_generator: {
      success: true,
      downloadUrl: '/uploads/xls/example.xlsx'
    }
  };

  const params = stage.buildDirectSkillParams(
    'data_analyzer',
    cachedData,
    {
      user_id: 'smoke',
      app_name: 'hris',
      text: 'coba analisa',
      attributes: { language: 'id' }
    }
  );

  assert.deepEqual(params.data, {
    get_time: cachedData.get_time
  });
  assert.equal(params.userQuery, 'coba analisa');
  assert.equal(params.language, 'id');
  assert.equal(params.get_time, undefined);

  console.log('[Continuation Direct Skill Params Smoke] All checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error('[Continuation Direct Skill Params Smoke] Failed');
  console.error(error);
  process.exit(1);
});
