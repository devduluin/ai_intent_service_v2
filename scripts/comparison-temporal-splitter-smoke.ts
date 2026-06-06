import assert from 'node:assert/strict';
import { comparisonOrchestratorService } from '../src/services/comparison-orchestrator.service';
import { comparisonTemporalSplitterService } from '../src/services/comparison-temporal-splitter.service';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { toolService } from '../src/services/tools.service';
import type { UserMessageSignals } from '../src/services/query-decomposition.service';
import type { PlannerOutput } from '../src/types/planner.types';

function isoDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

const TODAY_ISO = isoDate(0);
const YESTERDAY_ISO = isoDate(-1);

const today = {
  type: 'date' as const,
  value: 'hari ini',
  normalizedValue: TODAY_ISO,
  direction: 'current' as const
};

const yesterday = {
  type: 'date' as const,
  value: 'kemarin',
  normalizedValue: YESTERDAY_ISO,
  direction: 'past' as const
};

function comparison(source: 'current_query' | 'working_memory'): UserMessageSignals['comparison'] {
  return {
    isComparison: true,
    operator: 'compare',
    baseline: {
      source
    },
    target: {
      temporalDetails: [yesterday]
    },
    textSpan: ''
  };
}

function testBaselineThenTarget() {
  const result = comparisonTemporalSplitterService.split(
    'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
    [today, yesterday],
    comparison('current_query')
  );

  assert.equal(result.isAmbiguous, false);
  assert.equal(result.strategy, 'position');
  assert.deepEqual(result.baselineTemporalDetails.map(detail => detail.value), ['hari ini']);
  assert.deepEqual(result.targetTemporalDetails.map(detail => detail.value), ['kemarin']);
}

function testComparePrefixFallback() {
  const result = comparisonTemporalSplitterService.split(
    'bandingkan hari ini dengan kemarin',
    [today, yesterday],
    comparison('current_query')
  );

  assert.equal(result.isAmbiguous, false);
  assert.deepEqual(result.baselineTemporalDetails.map(detail => detail.value), ['hari ini']);
  assert.deepEqual(result.targetTemporalDetails.map(detail => detail.value), ['kemarin']);
}

function testWorkingMemoryComparisonUsesTargetOnly() {
  const result = comparisonTemporalSplitterService.split(
    'bandingkan dengan kemarin',
    [yesterday],
    comparison('working_memory')
  );

  assert.equal(result.isAmbiguous, false);
  assert.equal(result.strategy, 'working_memory_target');
  assert.deepEqual(result.baselineTemporalDetails, []);
  assert.deepEqual(result.targetTemporalDetails.map(detail => detail.value), ['kemarin']);
}

function testAmbiguousSingleTemporalStandalone() {
  const result = comparisonTemporalSplitterService.split(
    'bandingkan kendaraan dengan kemarin',
    [yesterday],
    comparison('current_query')
  );

  assert.equal(result.isAmbiguous, true);
  assert.equal(result.strategy, 'ambiguous');
}

async function testStandaloneOrchestratorContext() {
  skillsRegistry.registerSkill(
    {
      name: 'Data Analyzer',
      slug: 'data_analyzer',
      description: 'Analyze data',
      handlerKey: 'comparisonSmokeAnalyzer',
      paramSchema: []
    },
    async () => ({ ok: true })
  );

  (toolService as any).getToolsBySlugs = async () => [
    {
      id: 'tool-vehicle',
      slug: 'get_vehicle_assignment',
      name: 'Vehicle Assignment',
      description: 'Vehicle assignment',
      method: 'GET',
      url: 'https://example.test',
      parameters: [
        {
          name: 'company_id',
          type: 'string',
          isRequired: true,
          defaultValue: ''
        },
        {
          name: 'status',
          type: 'select',
          isRequired: true,
          defaultValue: 'exit',
          config: {
            options: [
              { label: 'Exit', value: 'exit' },
              { label: 'Leave', value: 'leave' }
            ]
          }
        },
        {
          name: 'date',
          type: 'string',
          isRequired: true,
          defaultValue: '[datenow]'
        }
      ]
    }
  ];

  (toolService as any).getToolParams = (tool: any) => tool.parameters;

  const plan: PlannerOutput = {
    mode: 'single_step',
    chat: false,
    tasks: [
      {
        id: '1',
        resource: 'tool',
        key: 'get_vehicle_assignment',
        depends_on: []
      }
    ]
  };

  const context = await comparisonOrchestratorService.buildStandaloneContext({
    input: {
      user_id: 'comparison-smoke',
      app_name: 'hris',
      text: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
      attributes: {
        params: {
          company_id: 'company-1'
        }
      }
    },
    plan,
    decompositionResult: {
      originalQuery: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
      normalizedQuery: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
      primaryQuery: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
      subQueries: [],
      hasMultipleIntents: false,
      connectors: [],
      confidence: 1,
      reason: 'single_intent',
      signals: {
        actionHints: ['cek'],
        formatHints: [],
        temporalHints: ['hari ini', 'kemarin'],
        temporalDetails: [today, yesterday],
        comparison: comparison('current_query'),
        entityHints: [],
        asksForFile: false,
        asksForRealtimeData: false,
        isQuestion: false,
        language: 'id'
      }
    }
  });

  assert.ok(context);
  assert.equal(context?.mode, 'standalone');
  assert.equal(context?.toolTask.key, 'get_vehicle_assignment');
  assert.equal(context?.baseline.params.company_id, 'company-1');
  assert.equal(context?.baseline.params.status, 'exit');
  assert.equal(context?.baseline.params.date, TODAY_ISO);
  assert.equal(context?.target.params.date, YESTERDAY_ISO);
  assert.deepEqual(context?.missingParams.baseline, []);
  assert.deepEqual(context?.missingParams.target, []);
}

async function testStandaloneOrchestratorIgnoresWorkingMemorySourceWhenTwoTemporalsExist() {
  const plan: PlannerOutput = {
    mode: 'single_step',
    chat: false,
    tasks: [
      {
        id: '1',
        resource: 'tool',
        key: 'get_vehicle_assignment',
        depends_on: []
      }
    ]
  };

  const context = await comparisonOrchestratorService.buildStandaloneContext({
    input: {
      user_id: 'comparison-smoke',
      app_name: 'hris',
      text: 'bandingkan kendaraan exit hari ini dengan kemarin',
      attributes: {
        params: {
          company_id: 'company-1'
        }
      }
    },
    plan,
    decompositionResult: {
      originalQuery: 'bandingkan kendaraan exit hari ini dengan kemarin',
      normalizedQuery: 'bandingkan kendaraan exit hari ini dengan kemarin',
      primaryQuery: 'bandingkan kendaraan exit hari ini dengan kemarin',
      subQueries: [],
      hasMultipleIntents: false,
      connectors: [],
      confidence: 1,
      reason: 'single_intent',
      signals: {
        actionHints: ['bandingkan'],
        formatHints: [],
        temporalHints: ['hari ini', 'kemarin'],
        temporalDetails: [today, yesterday],
        comparison: comparison('working_memory'),
        entityHints: [],
        asksForFile: false,
        asksForRealtimeData: false,
        isQuestion: false,
        language: 'id'
      }
    }
  });

  assert.ok(context);
  assert.equal(context?.baseline.params.date, TODAY_ISO);
  assert.equal(context?.target.params.date, YESTERDAY_ISO);
}

async function main() {
  testBaselineThenTarget();
  testComparePrefixFallback();
  testWorkingMemoryComparisonUsesTargetOnly();
  testAmbiguousSingleTemporalStandalone();
  await testStandaloneOrchestratorContext();
  await testStandaloneOrchestratorIgnoresWorkingMemorySourceWhenTwoTemporalsExist();

  console.log('[Comparison Temporal Splitter Smoke] All checks passed');
}

main().catch(error => {
  console.error('[Comparison Temporal Splitter Smoke] Failed');
  console.error(error);
  process.exit(1);
});
