import assert from 'node:assert/strict';
import { pipelineService } from '../../src/services/pipeline.service';

type ExpectedIntentMode = 'exact' | 'one_of' | 'not_one_of' | 'any';

interface UatStep {
  text: string;
  expectedIntent?: string | string[];
  expectedIntentMode?: ExpectedIntentMode;
  mustInclude?: string[];
  mustNotInclude?: string[];
}

interface UatCase {
  id: string;
  area: string;
  description: string;
  appName?: string;
  steps: UatStep[];
  notes?: string;
}

const DEFAULT_USER_ID = process.env.UAT_USER_ID || 'uat_viper_user';
const DEFAULT_APP_NAME = process.env.UAT_APP_NAME || 'hris';
const DEFAULT_COMPANY_ID = process.env.UAT_COMPANY_ID || '79483b71-25c2-11f0-8c42-d28e58827589';
const DEFAULT_EMPLOYEE_ID = process.env.UAT_EMPLOYEE_ID || '';

export const UAT_CASES: UatCase[] = [
  {
    id: 'GRT-01',
    area: 'greeting',
    description: 'Self identity should route to greeting, not clarification',
    steps: [
      { text: 'siapa kamu', expectedIntent: 'greeting' }
    ]
  },
  {
    id: 'GRT-02',
    area: 'greeting',
    description: 'VIPER architecture should be handled by greeting/about identity',
    steps: [
      { text: 'bagaimana arsitektur viper', expectedIntent: 'greeting', mustNotInclude: ['Go programming', 'framework konfigurasi'] }
    ]
  },
  {
    id: 'GRT-03',
    area: 'active_offer',
    description: 'Greeting capability offer can be accepted by bare yes',
    steps: [
      { text: 'halo', expectedIntent: 'greeting' },
      { text: 'ya', expectedIntent: 'greeting', expectedIntentMode: 'one_of', mustNotInclude: ['Tidak ada draft'] }
    ]
  },
  {
    id: 'KNO-01',
    area: 'knowledge',
    description: 'Workin explanation must not be swallowed by data analyzer or greeting',
    steps: [
      { text: 'jelaskan apa itu workin', expectedIntent: ['knowledge_workin', 'attendance', 'general_chat'], expectedIntentMode: 'one_of', mustNotInclude: ['Apakah Anda ingin saya Lakukan analisa data'] }
    ]
  },
  {
    id: 'KNO-02',
    area: 'knowledge',
    description: 'Attendance problem should not be stored as user profile',
    steps: [
      { text: 'bagaimana jika saya tidak bisa absen', expectedIntent: ['attendance', 'knowledge_workin', 'general_chat'], expectedIntentMode: 'one_of', mustNotInclude: ['belum menemukan informasi profil yang bisa disimpan'] }
    ]
  },
  {
    id: 'FBK-01',
    area: 'assistant_feedback',
    description: 'Assistant feedback must not select employee detail tool',
    steps: [
      { text: 'singkat sekali jawaban anda', expectedIntent: ['assistant_feedback', 'general_chat', 'greeting'], expectedIntentMode: 'one_of', mustNotInclude: ['get_employee_detail'] }
    ]
  },
  {
    id: 'PRF-01',
    area: 'user_profile',
    description: 'Profile statement then recall',
    steps: [
      { text: 'email kantor saya qa@example.com', expectedIntent: ['user_profile', 'general_chat', 'user_profile_recall'], expectedIntentMode: 'one_of' },
      { text: 'apa email kantor saya', expectedIntent: 'user_profile_recall', mustInclude: ['qa@example.com'] }
    ]
  },
  {
    id: 'PRF-02',
    area: 'user_profile',
    description: 'Who am I should use profile recall',
    steps: [
      { text: 'siapa saya', expectedIntent: 'user_profile_recall' }
    ]
  },
  {
    id: 'MEM-01',
    area: 'memory',
    description: 'Ambiguous memory recall should default to today/recent',
    steps: [
      { text: 'apa yang saya tanyakan hari ini', expectedIntent: 'memory_recall' }
    ]
  },
  {
    id: 'MEM-02',
    area: 'memory',
    description: 'Yesterday memory recall',
    steps: [
      { text: 'apa yang saya tanyakan kemarin', expectedIntent: 'memory_recall' }
    ]
  },
  {
    id: 'CNT-01',
    area: 'continuation',
    description: 'Tool + XLS then analysis should analyze tool result only',
    steps: [
      { text: 'cek jam berapa sekarang di jakarta dan export ke excel', expectedIntent: ['utilities', 'get_time'], expectedIntentMode: 'one_of' },
      { text: 'coba analisa', expectedIntent: ['utilities', 'data_analyzer', 'continuation:detail'], expectedIntentMode: 'one_of', mustNotInclude: ['Python pandas', 'Google Sheets API'] }
    ]
  },
  {
    id: 'CNT-02',
    area: 'continuation',
    description: 'Temporal follow-up should refine active tool',
    steps: [
      { text: 'cek kendaraan exit hari ini', expectedIntent: ['vehicles', 'get_vehicle_assignment', 'utilities'], expectedIntentMode: 'one_of' },
      { text: 'coba lihat kemarin', expectedIntent: ['vehicles', 'get_vehicle_assignment', 'utilities'], expectedIntentMode: 'one_of' }
    ]
  },
  {
    id: 'CMP-01',
    area: 'comparison',
    description: 'Standalone comparison query',
    steps: [
      { text: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin', expectedIntent: ['comparison', 'vehicles', 'get_vehicle_assignment', 'utilities'], expectedIntentMode: 'one_of' }
    ]
  },
  {
    id: 'AUT-01',
    area: 'automation',
    description: 'Reminder should create confirmation draft',
    steps: [
      { text: 'ingatkan saya besok jam 7 pagi meeting', expectedIntent: ['automation_manager', 'confirmation_required', 'slot_filling'], expectedIntentMode: 'one_of', mustInclude: ['simpan'] }
    ]
  },
  {
    id: 'AUT-02',
    area: 'automation',
    description: 'Conditional alert should pretest and ask confirmation',
    steps: [
      { text: 'buat conditional alert kalau kendaraan exit lebih dari 1 unit setiap hari jam 5 sore', expectedIntent: ['automation_manager', 'confirmation_required', 'slot_filling'], expectedIntentMode: 'one_of' }
    ]
  },
  {
    id: 'NTF-01',
    area: 'notification',
    description: 'Immediate notification should use notification manager',
    steps: [
      { text: 'kirim notifikasi sekarang bahwa laporan selesai', expectedIntent: 'notification_manager' }
    ]
  },
  {
    id: 'XLS-01',
    area: 'export',
    description: 'Export after tool should use XLS generator',
    steps: [
      { text: 'cek jam sekarang di jakarta lalu export ke excel', expectedIntent: ['utilities', 'get_time'], expectedIntentMode: 'one_of', mustInclude: ['Excel'] }
    ]
  },
  {
    id: 'SLT-01',
    area: 'slot_filling',
    description: 'Missing employee_id should trigger slot filling when not available',
    steps: [
      { text: 'lihat slip gaji saya', expectedIntent: ['slot_filling', 'payslip'], expectedIntentMode: 'one_of' }
    ],
    notes: 'If UAT_EMPLOYEE_ID is supplied, this may execute instead of slot filling.'
  }
];

function getExpectedMode(step: UatStep): ExpectedIntentMode {
  return step.expectedIntentMode || (Array.isArray(step.expectedIntent) ? 'one_of' : 'exact');
}

function assertIntent(actual: string, step: UatStep): void {
  if (!step.expectedIntent || getExpectedMode(step) === 'any') return;

  const expected = Array.isArray(step.expectedIntent) ? step.expectedIntent : [step.expectedIntent];
  const mode = getExpectedMode(step);

  if (mode === 'exact') {
    assert.equal(actual, expected[0]);
  } else if (mode === 'one_of') {
    assert.ok(expected.includes(actual), `expected intent one of ${expected.join(', ')}, got ${actual}`);
  } else if (mode === 'not_one_of') {
    assert.ok(!expected.includes(actual), `expected intent not in ${expected.join(', ')}, got ${actual}`);
  }
}

function assertText(response: string, step: UatStep): void {
  for (const text of step.mustInclude || []) {
    assert.ok(response.includes(text), `expected response to include "${text}"`);
  }

  for (const text of step.mustNotInclude || []) {
    assert.ok(!response.includes(text), `expected response not to include "${text}"`);
  }
}

async function runCase(testCase: UatCase): Promise<{ id: string; passed: boolean; error?: string }> {
  const userId = `${DEFAULT_USER_ID}_${testCase.id.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const appName = testCase.appName || DEFAULT_APP_NAME;

  for (const step of testCase.steps) {
    const result = await pipelineService.run({
      user_id: userId,
      app_name: appName,
      text: step.text,
      language: 'id',
      attributes: {
        params: {
          company_id: DEFAULT_COMPANY_ID,
          ...(DEFAULT_EMPLOYEE_ID ? { employee_id: DEFAULT_EMPLOYEE_ID } : {})
        },
        name: 'UAT User',
        timezone: 'Asia/Jakarta'
      }
    } as any);

    assertIntent(result.intent, step);
    assertText(result.naturalResponse || '', step);
  }

  return { id: testCase.id, passed: true };
}

async function main() {
  if (process.env.RUN_PIPELINE !== 'true') {
    console.log('[VIPER Stability UAT] Cases prepared:');
    for (const testCase of UAT_CASES) {
      console.log(`- ${testCase.id} [${testCase.area}] ${testCase.description}`);
      for (const step of testCase.steps) {
        console.log(`  > ${step.text}`);
      }
    }
    console.log('\nRun with RUN_PIPELINE=true to execute against pipelineService.');
    process.exit(0);
  }

  const results = [];
  for (const testCase of UAT_CASES) {
    try {
      const result = await runCase(testCase);
      results.push(result);
      console.log(`[PASS] ${testCase.id} ${testCase.description}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id: testCase.id, passed: false, error: message });
      console.error(`[FAIL] ${testCase.id} ${testCase.description}`);
      console.error(`       ${message}`);
    }
  }

  const passed = results.filter(result => result.passed).length;
  const failed = results.length - passed;
  console.log(`\n[VIPER Stability UAT] passed=${passed} failed=${failed} total=${results.length}`);

  if (failed > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main().catch(error => {
  console.error('[VIPER Stability UAT] Fatal error');
  console.error(error);
  process.exit(1);
});
