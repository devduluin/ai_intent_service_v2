import assert from 'node:assert/strict';
import { ComparisonStage } from '../src/services/cores/stages/comparison.stage';
import { NaturalizationStage } from '../src/services/cores/stages/naturalization.stage';
import { toolResultCache } from '../src/services/memories/toolResultCache.service';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { toolExecutorService } from '../src/services/toolExecutor.service';
import { toolService } from '../src/services/tools.service';
import { workingMemoryService } from '../src/services/workingMemory.service';
import type { PlannerOutput } from '../src/types/planner.types';
import type { DecomposedQuery } from '../src/services/query-decomposition.service';

const executedToolParams: Record<string, unknown>[] = [];
let analyzerData: unknown;

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

function registerMocks() {
  skillsRegistry.registerSkill(
    {
      name: 'Data Analyzer',
      slug: 'data_analyzer',
      description: 'Analyze comparison data',
      handlerKey: 'comparisonStageSmokeAnalyzer',
      paramSchema: [
        {
          name: 'data',
          type: 'text',
          description: 'Comparison payload',
          isRequired: true
        }
      ]
    },
    async params => {
      analyzerData = params.data;
      return {
        success: true,
        analysis: {
          summary: 'comparison ok'
        }
      };
    }
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
  (toolService as any).getMissingParamsFromTool = (tool: any, params: Record<string, unknown>) =>
    tool.parameters
      .filter((param: any) => param.isRequired)
      .filter((param: any) => params[param.name] === undefined || params[param.name] === null || params[param.name] === '')
      .map((param: any) => param.name);

  (toolExecutorService as any).execute = async (_tool: any, params: Record<string, unknown>) => {
    executedToolParams.push({ ...params });
    return {
      success: true,
      status: 200,
      data: {
        filter: {
          status: params.status,
          date: params.date
        },
        vehicle_assignment: [`row-${params.date}`]
      }
    };
  };

  (NaturalizationStage.prototype as any).execute = async () => 'comparison naturalized';

  (workingMemoryService as any).update = async () => undefined;
  (toolResultCache as any).store = async () => undefined;
}

function buildPlan(): PlannerOutput {
  return {
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
}

function buildDecomposition(temporalDetails: any[]): DecomposedQuery {
  return {
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
      temporalHints: temporalDetails.map(detail => detail.value),
      temporalDetails,
      comparison: {
        isComparison: true,
        operator: 'compare',
        baseline: {
          source: 'current_query'
        },
        target: {
          temporalDetails
        },
        textSpan: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin'
      },
      entityHints: [],
      asksForFile: false,
      asksForRealtimeData: false,
      isQuestion: false,
      language: 'id'
    }
  };
}

async function testStandaloneComparisonExecutesBothSides() {
  console.log('[Comparison Stage Smoke] Running standalone comparison execution');
  const stage = new ComparisonStage();
  const result = await stage.tryExecuteStandalone({
    input: {
      user_id: 'comparison-stage-smoke',
      app_name: 'hris',
      text: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
      language: 'id',
      attributes: {
        params: {
          company_id: 'company-1'
        }
      }
    },
    agent: {
      id: 'agent-1',
      slug: 'hris',
      name: 'HRIS',
      description: 'HRIS',
      isActive: true
    } as any,
    plan: buildPlan(),
    decompositionResult: buildDecomposition([
      {
        type: 'date',
        value: 'hari ini',
        normalizedValue: TODAY_ISO,
        direction: 'current'
      },
      {
        type: 'date',
        value: 'kemarin',
        normalizedValue: YESTERDAY_ISO,
        direction: 'past'
      }
    ]),
    startTotal: Date.now(),
    score: 1
  });

  assert.equal(result.handled, true);
  assert.equal(result.result?.intent, 'comparison');
  assert.equal(executedToolParams.length, 2);
  assert.equal(executedToolParams[0].date, TODAY_ISO);
  assert.equal(executedToolParams[1].date, YESTERDAY_ISO);
  assert.notEqual(executedToolParams[0].date, executedToolParams[1].date);

  const comparison = (analyzerData as any)?.comparison;
  assert.equal(comparison.baseline.params.date, TODAY_ISO);
  assert.equal(comparison.target.params.date, YESTERDAY_ISO);
  assert.equal(comparison.baseline.result.filter.date, TODAY_ISO);
  assert.equal(comparison.target.result.filter.date, YESTERDAY_ISO);
}

async function testAmbiguousTargetFallsBackToNormalPipeline() {
  console.log('[Comparison Stage Smoke] Running ambiguous target fallback');
  const stage = new ComparisonStage();
  const result = await stage.tryExecuteStandalone({
    input: {
      user_id: 'comparison-stage-smoke',
      app_name: 'hris',
      text: 'bandingkan kendaraan dengan kemarin',
      language: 'id',
      attributes: {
        params: {
          company_id: 'company-1'
        }
      }
    },
    agent: {
      id: 'agent-1',
      slug: 'hris',
      name: 'HRIS',
      description: 'HRIS',
      isActive: true
    } as any,
    plan: buildPlan(),
    decompositionResult: buildDecomposition([
      {
        type: 'date',
        value: 'kemarin',
        normalizedValue: YESTERDAY_ISO,
        direction: 'past'
      }
    ]),
    startTotal: Date.now(),
    score: 1
  });

  assert.equal(result.handled, false);
}

async function main() {
  console.log('[Comparison Stage Smoke] Registering mocks');
  registerMocks();
  await testStandaloneComparisonExecutesBothSides();
  await testAmbiguousTargetFallsBackToNormalPipeline();
  console.log('[Comparison Stage Smoke] All checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error('[Comparison Stage Smoke] Failed');
  console.error(error);
  process.exit(1);
});
