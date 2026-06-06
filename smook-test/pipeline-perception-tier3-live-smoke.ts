import { pipelineService } from '../src/services/pipeline.service';
import { initializeInternalSkills } from '../src/skills';

type LiveCase = {
  name: string;
  text: string;
  setup?: (userId: string) => Promise<void>;
  expect: (result: any) => void;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function buildInput(text: string, userId: string) {
  const companyId = process.env.SMOKE_COMPANY_ID || process.env.COMPANY_ID || '79483b71-25c2-11f0-8c42-d28e58827589';
  return {
    user_id: userId,
    app_name: process.env.SMOKE_APP_NAME || 'hris',
    text,
    language: 'id' as const,
    attributes: {
      params: {
        company_id: companyId
      },
      timezone: process.env.TZ || 'Asia/Jakarta'
    }
  };
}

const cases: LiveCase[] = [
  {
    name: 'halo',
    text: 'halo',
    expect: result => {
      assert(result.intent !== 'general_chat' || String(result.naturalResponse || '').length > 0, 'halo should return a usable response');
    }
  },
  {
    name: 'mixed greeting action',
    text: 'halo cek kendaraan exit hari ini',
    expect: result => {
      assert(result.intent !== 'greeting', 'mixed greeting action must not be handled as pure greeting');
    }
  },
  {
    name: 'automation request after greeting offer context',
    text: 'buat reminder saya meeting jam 3 sore',
    setup: async userId => {
      await pipelineService.run(buildInput('halo', userId));
    },
    expect: result => {
      assert(!String(result.intent || '').includes('offer:show_capabilities'), 'new automation intent must not execute greeting offer');
    }
  },
  {
    name: 'standalone comparison',
    text: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
    expect: result => {
      assert(
        result.intent === 'comparison' ||
        result.metadata?.comparison ||
        String(result.naturalResponse || '').toLowerCase().includes('banding'),
        'comparison query should be handled as comparison or produce comparison response'
      );
    }
  },
  {
    name: 'automation from previous context reference',
    text: 'laporkan ini setiap hari jam 7 sore',
    setup: async userId => {
      await pipelineService.run(buildInput('cek kendaraan exit hari ini dan bandingkan dengan kemarin', userId));
    },
    expect: result => {
      assert(
        ['slot_filling', 'confirmation_required'].includes(result.intent) ||
        String(result.naturalResponse || '').toLowerCase().includes('automation') ||
        String(result.naturalResponse || '').toLowerCase().includes('jadwal'),
        'context automation reference should enter automation clarification/confirmation path'
      );
    }
  },
  {
    name: 'memory replay request',
    text: 'coba cek 3 hari yang lalu apa yang saya tanyakan jalankan ulang',
    expect: result => {
      assert(
        String(result.intent || '').includes('memory_replay') ||
        String(result.intent || '').includes('memory') ||
        String(result.naturalResponse || '').toLowerCase().includes('riwayat'),
        'memory replay request should be handled through memory flow'
      );
    }
  }
];

async function main() {
  console.log('\nPipeline Perception Tier 3 Live Smoke\n');

  if (process.env.RUN_LIVE_PIPELINE_SMOKE !== '1') {
    console.log('  skipped: set RUN_LIVE_PIPELINE_SMOKE=1 to run live DB/LLM/tool smoke');
    process.exit(0);
    return;
  }

  await initializeInternalSkills();

  let passed = 0;

  for (const testCase of cases) {
    const userId = `perception_live_${Date.now()}_${passed}`;
    if (testCase.setup) {
      await withTimeout(
        testCase.setup(userId),
        Number(process.env.LIVE_PIPELINE_SMOKE_TIMEOUT_MS || 90_000),
        `${testCase.name}:setup`
      );
    }

    const result = await withTimeout(
      pipelineService.run(buildInput(testCase.text, userId)),
      Number(process.env.LIVE_PIPELINE_SMOKE_TIMEOUT_MS || 90_000),
      testCase.name
    );
    testCase.expect(result);
    passed++;
    console.log(`  ok ${testCase.name}: intent=${result.intent}`);
  }

  console.log(`\n${passed} passed, 0 failed, ${cases.length} total`);
  process.exit(0);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Live case timed out: ${name}`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

main().catch(error => {
  console.error('\nPipeline Perception Tier 3 Live Smoke failed');
  console.error(error);
  process.exit(1);
});
