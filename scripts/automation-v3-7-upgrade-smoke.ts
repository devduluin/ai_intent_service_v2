import assert from 'node:assert/strict';
import { conditionEvaluatorService } from '../src/services/automation/condition-evaluator.service';
import { automationPretestService } from '../src/services/automation/automation-pretest.service';
import { automationDraftEditService } from '../src/services/automation/automation-draft-edit.service';
import { handleTrendAnalysis } from '../src/skills/trend_analyzer.skill';
import { handleAutomationManager } from '../src/skills/automation_manager.skill';
import { comparisonTemporalSplitterService } from '../src/services/comparison-temporal-splitter.service';
import { PreProcessingStage } from '../src/services/cores/stages/pre-processing.stage';
import type { PendingConfirmation } from '../src/types/confirmation.types';

async function testComparisonDecreaseCondition() {
  const result = conditionEvaluatorService.evaluate({
    kind: 'comparison',
    sourceText: 'revenue turun 20 persen',
    metric: 'revenue',
    operator: 'decrease_percent',
    value: 20
  }, {
    comparison: {
      baseline: { result: { revenue: 100 } },
      target: { result: { revenue: 70 } }
    }
  });

  assert.equal(result.shouldRun, true);
  assert.equal(Math.round(Number(result.observedValue)), -30);
}

async function testComparisonIncreaseCondition() {
  const result = conditionEvaluatorService.evaluate({
    kind: 'comparison',
    sourceText: 'expense naik 10 persen',
    metric: 'expense',
    operator: 'increase_percent',
    value: 10
  }, {
    analysis: {
      baseline: { expense: 100 },
      comparison: { expense: 115 }
    }
  });

  assert.equal(result.shouldRun, true);
  assert.equal(Math.round(Number(result.observedValue)), 15);
}

function testComparisonPretestQueryKeepsOriginalQuery() {
  const query = automationPretestService.buildEvaluationQuery({
    type: 'conditional_alert',
    goal: 'bandingkan revenue hari ini vs kemarin kalau turun 20 persen',
    condition: {
      kind: 'comparison',
      sourceText: 'revenue turun 20 persen',
      metric: 'revenue',
      operator: 'decrease_percent',
      value: 20
    },
    workflow: {
      sourceText: 'bandingkan revenue hari ini vs kemarin kalau turun 20 persen',
      reusable: true
    }
  });

  assert.equal(query, 'bandingkan revenue hari ini vs kemarin kalau turun 20 persen');
}

function testDraftEditConditionPatch() {
  const confirmation: PendingConfirmation = {
    id: 'confirmation_smoke',
    userId: 'user',
    appName: 'hris',
    type: 'automation_job_create',
    status: 'pending',
    draft: {
      type: 'conditional_alert',
      goal: 'cek revenue',
      title: 'Conditional Alert: cek revenue',
      workflow: { sourceText: 'cek revenue', reusable: true },
      action: { resource: 'skill', key: 'notification_manager', params: {} },
      notification: { channel: 'chat' },
      trigger: { kind: 'condition', cron: '0 7 * * *' },
      condition: { kind: 'threshold', sourceText: 'revenue lebih dari 10', metric: 'revenue', operator: 'gt', value: 10 },
      safety: { requiresConfirmation: true, sideEffectLevel: 'none' }
    },
    editableFields: ['goal', 'schedule', 'trigger', 'condition', 'notification'],
    commitAction: { resource: 'skill', key: 'automation_manager', params: {} },
    expiresAt: Date.now() + 60000,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const result = automationDraftEditService.detectPatch('ubah kondisi jadi revenue turun 20 persen', confirmation);
  assert.equal(result.patch?.condition?.['kind'], 'comparison');
  assert.equal(result.patch?.condition?.['operator'], 'decrease_percent');
  assert.equal(result.needsPretest, true);
}

function testSingleTargetTemporalComparisonUsesCurrentBaseline() {
  const result = comparisonTemporalSplitterService.split(
    'cek kendaraan exit hari ini dan bandingkan dengan kemarin',
    [
      {
        type: 'date',
        value: 'kemarin',
        normalizedValue: '2026-06-02',
        direction: 'past'
      }
    ],
    {
      isComparison: true,
      operator: 'compare',
      baseline: { source: 'current_query' },
      target: {
        temporalDetails: [
          {
            type: 'date',
            value: 'kemarin',
            normalizedValue: '2026-06-02',
            direction: 'past'
          }
        ]
      },
      textSpan: 'cek kendaraan exit hari ini dan bandingkan dengan kemarin'
    }
  );

  assert.equal(result.isAmbiguous, false);
  assert.equal(result.baselineTemporalDetails[0]?.direction, 'current');
  assert.equal(result.targetTemporalDetails[0]?.normalizedValue, '2026-06-02');
}

async function testPreProcessingKeepsComparisonSignal() {
  const stage = new PreProcessingStage();
  const result = await stage.execute('cek kendaraan exit hari ini dan bandingkan dengan kemarin');
  assert.equal(result.signals.comparison?.isComparison, true);
  assert.equal(result.signals.temporalDetails?.length, 2);
}


async function testTrendAnalyzerAcceptsDependencyData() {
  const result = await handleTrendAnalysis(
    {
      baselineLabel: 'Kemarin',
      comparisonLabel: 'Hari ini',
      language: 'id'
    },
    {
      user_id: 'trend_dependency_smoke',
      app_name: 'hris',
      text: 'bandingkan kendaraan exit hari ini dengan kemarin'
    },
    {
      comparison: {
        baseline: {
          label: 'Kemarin',
          result: {
            summary: { exit: 10 },
            vehicle_assignment: new Array(10).fill(null).map((_, index) => ({ id: `y-${index}` }))
          }
        },
        target: {
          label: 'Hari ini',
          result: {
            summary: { exit: 5 },
            vehicle_assignment: new Array(5).fill(null).map((_, index) => ({ id: `t-${index}` }))
          }
        }
      }
    }
  );

  assert.notEqual((result as any).error, 'Data is required for trend analysis');
  assert.equal((result as any).success, true);
}

async function testAutomationReferenceUsesWorkingMemoryLastExecution() {
  const result = await handleAutomationManager(
    {
      automation_type: 'scheduled_workflow',
      goal: 'laporkan ini',
      schedule: 'tiap hari'
    },
    {
      user_id: 'automation_reference_smoke',
      app_name: 'hris',
      text: 'oke laporkan ini tiap hari ke saya jam 7 sore',
      attributes: {
        workingMemory: {
          activeTool: 'get_vehicle_assignment',
          activeEntities: {
            company_id: 'company-1',
            status: 'exit',
            date: '2026-06-03'
          },
          metadata: {
            lastExecution: {
              timestamp: Date.now(),
              sourceText: 'cek kendaraan exit hari ini',
              params: {
                company_id: 'company-1',
                status: 'exit',
                date: '2026-06-03'
              },
              results: {
                get_vehicle_assignment: { summary: { exit: 3 } }
              }
            }
          }
        }
      }
    }
  );

  assert.equal(result.kind, 'confirmation_required');
  assert.equal(result.job?.goal, 'cek kendaraan exit hari ini');
  assert.equal(result.job?.workflow.sourceText, 'cek kendaraan exit hari ini');
  assert.equal(result.job?.workflow.referencedTool, 'get_vehicle_assignment');
  assert.equal(result.job?.workflow.referencedParams?.status, 'exit');
  assert.equal(result.job?.trigger.cron, '0 19 * * *');
}

async function main() {
  await testComparisonDecreaseCondition();
  await testComparisonIncreaseCondition();
  testComparisonPretestQueryKeepsOriginalQuery();
  testDraftEditConditionPatch();
  testSingleTargetTemporalComparisonUsesCurrentBaseline();
  await testPreProcessingKeepsComparisonSignal();
  await testTrendAnalyzerAcceptsDependencyData();
  await testAutomationReferenceUsesWorkingMemoryLastExecution();
  console.log('[Automation V3.7 Upgrade Smoke] All checks passed');
}

main().catch(error => {
  console.error('[Automation V3.7 Upgrade Smoke] Failed');
  console.error(error);
  process.exit(1);
});
