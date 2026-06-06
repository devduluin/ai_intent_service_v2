import { SelfCorrectionStage } from '../src/services/cores/stages/self-correction.stage';
import type { PlannerOutput } from '../src/types/planner.types';
import type { PipelineInput } from '../src/types';
import type { ExecutionResult } from '../src/services/cores/stages/execution.stage';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const input: PipelineInput = {
  user_id: 'smoke-user',
  app_name: 'hris',
  text: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
  language: 'id'
};

const plan: PlannerOutput = {
  mode: 'multi_step',
  chat: false,
  tasks: [
    { id: '1', resource: 'tool', key: 'get_vehicle_assignment', depends_on: [] },
    { id: '2', resource: 'skill', key: 'trend_analyzer', depends_on: ['1'] }
  ]
};

const executionResult: ExecutionResult = {
  results: {
    get_vehicle_assignment: {
      date: '2026-06-03',
      summary: { exit: 3 }
    },
    trend_analyzer: {
      success: false,
      error: 'Data is required for trend analysis',
      message: 'Data tidak boleh kosong. Silakan provide data yang berisi baseline dan comparison.'
    }
  },
  metrics: {
    totalTasks: 2,
    executedTasks: 2,
    failedTasks: 1,
    executedTasksDetails: [
      { resource: 'tool', key: 'get_vehicle_assignment', toolSlug: 'get_vehicle_assignment' },
      { resource: 'skill', key: 'trend_analyzer' }
    ]
  }
};

async function main(): Promise<void> {
  const stage = new SelfCorrectionStage();
  const result = await stage.execute({
    input,
    perceptionFrame: {
      type: 'comparison',
      operations: ['execute', 'compare', 'analyze'],
      confidence: 0.9,
      reasoning: ['Smoke comparison request']
    },
    plan,
    params: { status: 'exit', date: '2026-06-03' },
    executionResult,
    decompositionResult: {
      text: input.text,
      originalText: input.text,
      hasMultipleIntents: false,
      subQueries: [],
      connectors: [],
      signals: {
        comparison: { isComparison: true },
        temporalDetails: [
          { type: 'date', value: 'hari ini', normalizedValue: '2026-06-03', direction: 'current' },
          { type: 'date', value: 'kemarin', normalizedValue: '2026-06-02', direction: 'past' }
        ]
      } as any
    } as any
  });

  assert(result.shouldRecover, 'Expected recovery to be detected');
  assert(result.recoveryType === 'temporal_mismatch', 'Expected temporal_mismatch recovery');
  assert(result.action === 'ask_clarification', 'Expected ask_clarification action');
  assert(!!result.clarificationQuestion, 'Expected clarification question');

  console.log('[self-correction-smoke] PASS', {
    recoveryType: result.recoveryType,
    action: result.action,
    confidence: result.confidence
  });
}

main().catch(error => {
  console.error('[self-correction-smoke] FAIL', error);
  process.exit(1);
});

