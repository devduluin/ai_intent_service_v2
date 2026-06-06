import assert from 'node:assert/strict';
import { automationPretestService } from '../src/services/automation/automation-pretest.service';
import type { PipelineInput, PipelineResult } from '../src/types';

const baseInput: PipelineInput = {
  user_id: 'automation_pretest_smoke',
  app_name: 'hris',
  text: 'buat automation',
  attributes: {
    params: {
      company_id: 'company-smoke'
    }
  }
};

async function testScheduledWorkflowPretest() {
  const draft = {
    type: 'scheduled_workflow',
    goal: 'cek laporan operasional',
    workflow: {
      sourceText: 'cek laporan operasional',
      reusable: true
    }
  };

  assert.equal(automationPretestService.shouldPretest(draft), true);
  assert.equal(automationPretestService.buildEvaluationQuery(draft), 'cek laporan operasional');

  const withPretest = await automationPretestService.attachPretest(
    baseInput,
    draft,
    async input => ({
      intent: 'mock_tool',
      score: 1,
      apiResult: {
        rows: [{ id: 1, status: 'ok' }]
      },
      naturalResponse: `mock response for ${input.text}`
    } as PipelineResult)
  );

  assert.equal(withPretest.pretest.status, 'success');
  assert.equal(withPretest.pretest.query, 'cek laporan operasional');
}

async function testConditionalAlertPretest() {
  const draft = {
    type: 'conditional_alert',
    goal: 'expense lebih dari 10 juta',
    condition: {
      sourceText: 'expense lebih dari 10 juta'
    },
    workflow: {
      sourceText: 'expense lebih dari 10 juta',
      reusable: true
    }
  };

  assert.equal(automationPretestService.shouldPretest(draft), true);
  assert.equal(automationPretestService.buildEvaluationQuery(draft), 'cek expense');

  const withPretest = await automationPretestService.attachPretest(
    baseInput,
    draft,
    async input => ({
      intent: 'mock_tool',
      score: 1,
      apiResult: {
        expense: 12000000
      },
      naturalResponse: `mock response for ${input.text}`
    } as PipelineResult)
  );

  assert.equal(withPretest.pretest.status, 'success');
  assert.equal(withPretest.pretest.query, 'cek expense');
}

async function main() {
  await testScheduledWorkflowPretest();
  await testConditionalAlertPretest();
  console.log('[AutomationPretest Smoke] All checks passed');
}

main().catch(error => {
  console.error('[AutomationPretest Smoke] Failed');
  console.error(error);
  process.exit(1);
}).then(() => process.exit(0));
