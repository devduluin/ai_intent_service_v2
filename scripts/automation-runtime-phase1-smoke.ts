import assert from 'node:assert/strict';
import { automationManagerSkill, handleAutomationManager } from '../src/skills/automation_manager.skill';
import { AutomationJobModel } from '../src/database/models/automation-job.model';
import { automationJobRepository } from '../src/repositories/automation-job.repository';

async function testMetadata() {
  assert.equal(automationManagerSkill.slug, 'automation_manager');
  assert.equal(automationManagerSkill.handlerKey, 'handleAutomationManager');
  assert.equal(automationManagerSkill.capabilities?.actionTypes.includes('automation'), true);
  assert.equal(automationManagerSkill.capabilities?.actionTypes.includes('schedule'), true);
  assert.equal(automationManagerSkill.capabilities?.triggers.includes('ingatkan'), true);
  assert.equal(automationManagerSkill.capabilities?.triggers.includes('pantau'), true);
  assert.equal(automationManagerSkill.paramSchema.some(param => param.name === 'automation_type' && param.isRequired), true);
  assert.equal(automationManagerSkill.paramSchema.some(param => param.name === 'goal' && param.isRequired), true);
}

async function testReminderDraft() {
  const result = await handleAutomationManager(
    {
      automation_type: 'reminder',
      goal: 'meeting',
      schedule: 'besok jam 7',
      _persist: false
    },
    {
      user_id: 'automation_phase1_user',
      app_name: 'hris',
      text: 'ingatkan besok jam 7 saya meeting'
    }
  );

  assert.equal(result.kind, 'automation_job_draft');
  assert.equal(result.job.type, 'reminder');
  assert.equal(result.job.trigger.kind, 'once');
  assert.equal(result.job.trigger.runAt?.includes('T07:00:00+07:00'), true);
  assert.equal(result.job.action.key, 'notification_manager');
  assert.equal(result.job.status, 'draft');
}

async function testConditionalAlertDraft() {
  const result = await handleAutomationManager(
    {
      goal: 'kabari saya kalau profit turun lebih dari 20%',
      condition: 'profit turun lebih dari 20%',
      _persist: false
    },
    {
      user_id: 'automation_phase1_user',
      app_name: 'hris',
      text: 'kalau profit turun lebih dari 20% kabari saya'
    }
  );

  assert.equal(result.kind, 'automation_job_draft');
  assert.equal(result.job.type, 'conditional_alert');
  assert.equal(result.job.trigger.kind, 'condition');
  assert.equal(result.job.notification?.notifyOnlyOnCondition, true);
}

async function testMissingSchedule() {
  const result = await handleAutomationManager(
    {
      automation_type: 'reminder',
      goal: 'meeting',
      _persist: false
    },
    {
      user_id: 'automation_phase1_user',
      app_name: 'hris',
      text: 'ingatkan saya meeting'
    }
  );

  assert.equal(result.kind, 'automation_clarification_required');
  assert.equal(result.missing?.includes('schedule'), true);
}

async function testAutomationJobRepositoryShape() {
  assert.equal(AutomationJobModel.tableName, 'automation_jobs');
  assert.equal(typeof automationJobRepository.create, 'function');
  assert.equal(typeof automationJobRepository.findDueJobs, 'function');
  assert.equal(typeof automationJobRepository.updateStatus, 'function');
}

async function main() {
  await testMetadata();
  await testReminderDraft();
  await testConditionalAlertDraft();
  await testMissingSchedule();
  await testAutomationJobRepositoryShape();
  console.log('[AutomationRuntime Phase1 Smoke] All checks passed');
}

main().catch(error => {
  console.error('[AutomationRuntime Phase1 Smoke] Failed');
  console.error(error);
  process.exit(1);
});
