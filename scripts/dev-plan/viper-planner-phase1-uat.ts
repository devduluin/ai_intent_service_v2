import assert from 'node:assert/strict';
import { initializeInternalSkills } from '../../src/skills';
import { intentRegistry } from '../../src/services/intent-registry.service';
import { AgentLoader } from '../../src/services/cores/loaders/agent.loader';
import { PreProcessingStage } from '../../src/services/cores/stages/pre-processing.stage';
import { PerceptionStage } from '../../src/services/cores/stages/perception.stage';
import { FallbackMatchesStage } from '../../src/services/cores/stages/fallback-matches.stage';
import { PlannerStage } from '../../src/services/cores/stages/planner.stage';
import { skillSignalService } from '../../src/services/skill-signal.service';
import { perceptionDisambiguationService } from '../../src/services/perception-disambiguation.service';
import type { PlannerOutput } from '../../src/types/planner.types';
import type { PipelineInput } from '../../src/types';

type Resource = 'tool' | 'skill' | 'knowledge';

interface PlannerPhaseCase {
  id: string;
  text: string;
  expected?: {
    chat?: boolean;
    task?: {
      resource?: Resource;
      key?: string;
      oneOfKeys?: string[];
    };
    notTaskKey?: string;
    needsClarification?: boolean;
  };
}

const USER_ID = process.env.UAT_USER_ID || 'uat_planner_phase1';
const APP_NAME = process.env.UAT_APP_NAME || 'hris';

const CASES: PlannerPhaseCase[] = [
  {
    id: 'P1-GRT-IDENTITY',
    text: 'siapa kamu',
    expected: { chat: false, task: { resource: 'skill', key: 'greeting' } }
  },
  {
    id: 'P1-GRT-ARCHITECTURE',
    text: 'bagaimana arsitektur viper',
    expected: { chat: false, task: { resource: 'skill', key: 'greeting' } }
  },
  {
    id: 'P1-KNOW-WORKIN',
    text: 'jelaskan apa itu workin',
    expected: { chat: false, task: { oneOfKeys: ['knowledge_workin', 'attendance_faq'] }, notTaskKey: 'data_analyzer' }
  },
  {
    id: 'P1-KNOW-ATTENDANCE',
    text: 'bagaimana jika saya tidak bisa absen',
    expected: { chat: false, task: { oneOfKeys: ['attendance', 'attendance_faq', 'checkin_trouble'] }, notTaskKey: 'user_profile_recall' }
  },
  {
    id: 'P1-FEEDBACK',
    text: 'singkat sekali jawaban anda',
    expected: { notTaskKey: 'get_employee_detail' }
  },
  {
    id: 'P1-PROFILE-WHOAMI',
    text: 'siapa saya',
    expected: { chat: false, task: { resource: 'skill', key: 'user_profile_recall' } }
  },
  {
    id: 'P1-PROFILE-EMAIL',
    text: 'apa email saya',
    expected: { chat: false, task: { resource: 'skill', key: 'user_profile_recall' } }
  },
  {
    id: 'P1-MEM-TODAY',
    text: 'apa yang saya tanyakan hari ini',
    expected: { chat: false, task: { resource: 'skill', key: 'memory_recall' } }
  },
  {
    id: 'P1-MEM-YESTERDAY',
    text: 'apa yang saya tanyakan kemarin',
    expected: { chat: false, task: { resource: 'skill', key: 'memory_recall' } }
  },
  {
    id: 'P1-TIME-XLS',
    text: 'cek jam berapa sekarang di jakarta dan export ke excel',
    expected: { chat: false, task: { oneOfKeys: ['get_time', 'xls_generator'] } }
  },
  {
    id: 'P1-ANALYZE-BARE',
    text: 'coba analisa',
    expected: { task: { key: 'data_analyzer' } }
  },
  {
    id: 'P1-COMPARE',
    text: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
    expected: { chat: false, task: { oneOfKeys: ['get_vehicle_assignment', 'trend_analyzer'] } }
  },
  {
    id: 'P1-AUT-REMINDER',
    text: 'ingatkan saya besok jam 7 pagi meeting',
    expected: { chat: false, task: { resource: 'skill', key: 'automation_manager' } }
  },
  {
    id: 'P1-AUT-CONDITIONAL',
    text: 'buat conditional alert kalau kendaraan exit lebih dari 1 unit setiap hari jam 5 sore',
    expected: { chat: false, task: { resource: 'skill', key: 'automation_manager' } }
  },
  {
    id: 'P1-NOTIFICATION-NOW',
    text: 'kirim notifikasi sekarang bahwa laporan selesai',
    expected: { chat: false, task: { resource: 'skill', key: 'notification_manager' } }
  },
  {
    id: 'P1-SLOT-PAYSLIP',
    text: 'lihat slip gaji saya',
    expected: { chat: false, task: { oneOfKeys: ['get_payslip', 'payslip'] } }
  }
];

async function buildPlan(text: string): Promise<PlannerOutput> {
  const agent = await new AgentLoader().loadBySlug(APP_NAME);
  const input: PipelineInput = {
    user_id: USER_ID,
    app_name: APP_NAME,
    text,
    language: 'id',
    attributes: {
      params: {
        company_id: process.env.UAT_COMPANY_ID || '79483b71-25c2-11f0-8c42-d28e58827589'
      },
      name: 'UAT User',
      timezone: 'Asia/Jakarta'
    }
  } as any;

  const pre = await new PreProcessingStage().execute(text);
  pre.signals.skill = skillSignalService.detect(pre.text);

  let perceptionResult = await new PerceptionStage().execute({
    text: pre.text,
    decomposition: pre as any,
    workingMemory: null,
    episodicMemory: null
  });

  const disambiguation = await perceptionDisambiguationService.refine({
    text: pre.text,
    skillSignal: pre.signals.skill,
    perceptionFrame: perceptionResult.frame,
    signals: pre.signals
  });

  if (disambiguation.skillSignal) {
    pre.signals.skill = disambiguation.skillSignal;
  }
  if (disambiguation.perceptionFrame) {
    perceptionResult = {
      ...perceptionResult,
      frame: disambiguation.perceptionFrame
    };
  }

  const intents = intentRegistry.getAll({ agentId: agent.id });
  const matches = new FallbackMatchesStage().execute({
    intents,
    agent,
    userText: pre.text,
    signals: pre.signals,
    options: { maxMatches: 25, score: 0.76 }
  });

  return new PlannerStage().execute(
    matches,
    input,
    agent,
    {
      usePlan: true,
      skillSignal: pre.signals.skill,
      perceptionFrame: perceptionResult.frame,
      timeout: 20000
    },
    {
      workingMemory: null,
      episodicMemory: null
    }
  );
}

function taskKeys(plan: PlannerOutput): string[] {
  return (plan.tasks || []).map(task => task.key);
}

function assertPlan(testCase: PlannerPhaseCase, plan: PlannerOutput): void {
  const expected = testCase.expected;
  if (!expected) return;

  if (typeof expected.chat === 'boolean') {
    assert.equal(plan.chat, expected.chat, `expected chat=${expected.chat}, got ${plan.chat}`);
  }

  if (typeof expected.needsClarification === 'boolean') {
    assert.equal(plan.needsClarification, expected.needsClarification);
  }

  if (expected.notTaskKey) {
    assert.ok(!taskKeys(plan).includes(expected.notTaskKey), `unexpected task key ${expected.notTaskKey}`);
  }

  if (expected.task) {
    const tasks = plan.tasks || [];
    assert.ok(tasks.length > 0, 'expected at least one task');

    if (expected.task.key) {
      assert.ok(tasks.some(task => task.key === expected.task?.key), `expected task key ${expected.task.key}, got ${taskKeys(plan).join(', ')}`);
    }

    if (expected.task.oneOfKeys) {
      assert.ok(
        tasks.some(task => expected.task?.oneOfKeys?.includes(task.key)),
        `expected one of ${expected.task.oneOfKeys.join(', ')}, got ${taskKeys(plan).join(', ')}`
      );
    }

    if (expected.task.resource) {
      assert.ok(
        tasks.some(task => task.resource === expected.task?.resource && (!expected.task?.key || task.key === expected.task.key)),
        `expected resource ${expected.task.resource}, got ${tasks.map(task => `${task.resource}:${task.key}`).join(', ')}`
      );
    }
  }
}

async function main() {
  await initializeInternalSkills();
  await intentRegistry.syncFromDatabase();

  let failed = 0;
  for (const testCase of CASES) {
    try {
      const plan = await buildPlan(testCase.text);
      assertPlan(testCase, plan);
      console.log(`[PASS] ${testCase.id} ${testCase.text}`);
      console.log(`       plan=${JSON.stringify({ chat: plan.chat, mode: plan.mode, tasks: plan.tasks, confidence: plan.confidence, needsClarification: plan.needsClarification })}`);
    } catch (error) {
      failed += 1;
      console.error(`[FAIL] ${testCase.id} ${testCase.text}`);
      console.error(`       ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n[VIPER Planner Phase 1 UAT] total=${CASES.length} failed=${failed} passed=${CASES.length - failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('[VIPER Planner Phase 1 UAT] Fatal error');
  console.error(error);
  process.exit(1);
});
