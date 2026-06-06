import assert from 'node:assert/strict';
import { handleAutomationManager } from '../src/skills/automation_manager.skill';
import { handleNotificationManager } from '../src/skills/notification_manager.skill';
import { conditionEvaluatorService } from '../src/services/automation/condition-evaluator.service';
import { calculateNextRunFromCron } from '../src/services/automation/scheduler.service';
import { paramExtractorService } from '../src/services/paramExtractor.service';

async function testReminderCreationPath() {
  const result = await handleAutomationManager(
    {
      automation_type: 'reminder',
      goal: 'meeting',
      schedule: 'besok jam 7',
      _persist: false
    },
    {
      user_id: 'automation_full_user',
      app_name: 'hris',
      text: 'ingatkan besok jam 7 saya meeting'
    }
  );

  assert.equal(result.kind, 'automation_job_draft');
  assert.equal(result.job.action.key, 'notification_manager');
  assert.equal(result.job.trigger.kind, 'once');
  assert.equal(result.job.trigger.runAt?.includes('T07:00:00+07:00'), true);
}

async function testOneMinuteReminder() {
  const result = await handleAutomationManager(
    {
      automation_type: 'reminder',
      goal: 'meeting',
      schedule: '1 menit lagi',
      _persist: false
    },
    {
      user_id: 'automation_full_user',
      app_name: 'hris',
      text: 'ingatkan saya 1 menit lagi meeting'
    }
  );

  assert.equal(result.kind, 'automation_job_draft');
  assert.equal(result.job.trigger.kind, 'once');
  assert.match(result.job.trigger.runAt || '', /T\d{2}:\d{2}:00\+07:00$/);
  assert.equal(result.missing, undefined);
}

async function testGenericReminderStillNeedsGoalAfterSchedule() {
  const result = await handleAutomationManager(
    {
      automation_type: 'reminder',
      goal: 'ingin',
      schedule: 'hari ini jam 12:35',
      _persist: false
    },
    {
      user_id: 'automation_full_user',
      app_name: 'hris',
      text: 'hari ini jam 12:35'
    }
  );

  assert.equal(result.kind, 'automation_clarification_required');
  assert.equal(result.missing?.includes('goal'), true);
}

async function testAutomationSlotExtraction() {
  const schedule = await paramExtractorService.extractAll('1 menit lagi', [
    {
      name: 'schedule',
      type: 'string',
      description: 'Waktu atau pola jadwal',
      isRequired: true
    } as any
  ]);
  assert.equal(schedule.params.schedule, '1 menit lagi');
  assert.equal(schedule.confidences.schedule >= 0.9, true);

  const clock = await paramExtractorService.extractAll('12:21', [
    {
      name: 'schedule',
      type: 'string',
      description: 'Waktu atau pola jadwal',
      isRequired: true
    } as any
  ]);
  assert.equal(clock.params.schedule, '12:21');

  const goal = await paramExtractorService.extractAll('meeting', [
    {
      name: 'goal',
      type: 'text',
      description: 'Tujuan automation',
      isRequired: true
    } as any
  ]);
  assert.equal(goal.params.goal, 'meeting');
}

async function testMissingTimeClarification() {
  const result = await handleAutomationManager(
    {
      automation_type: 'reminder',
      goal: 'meeting',
      schedule: 'besok',
      _persist: false
    },
    {
      user_id: 'automation_full_user',
      app_name: 'hris',
      text: 'ingatkan besok saya meeting'
    }
  );

  assert.equal(result.kind, 'automation_clarification_required');
  assert.equal(result.missing?.includes('time'), true);
}

async function testConditionalAlertNeedsSchedule() {
  const result = await handleAutomationManager(
    {
      automation_type: 'conditional_alert',
      goal: 'kendaraan exit lebih dari 1 unit',
      condition: 'kendaraan exit lebih dari 1 unit',
      _persist: false
    },
    {
      user_id: 'automation_full_user',
      app_name: 'hris',
      text: 'buat conditional alert kalau kendaraan exit lebih dari 1 unit'
    }
  );

  assert.equal(result.kind, 'automation_clarification_required');
  assert.equal(result.missing?.includes('schedule'), true);
}

async function testConditionalAlertConditionNormalization() {
  const result = await handleAutomationManager(
    {
      automation_type: 'conditional_alert',
      goal: 'kendaraan exit lebih dari 1 unit',
      condition: 'kendaraan exit lebih dari 1 unit',
      schedule: 'setiap senin jam 9',
      _persist: false
    },
    {
      user_id: 'automation_full_user',
      app_name: 'hris',
      text: 'buat conditional alert kalau kendaraan exit lebih dari 1 unit setiap senin jam 9',
      attributes: {
        params: {
          company_id: 'company_123'
        }
      }
    }
  );

  assert.equal(result.kind, 'automation_job_draft');
  assert.equal(result.job.condition?.operator, 'gt');
  assert.equal(result.job.condition?.value, 1);
  assert.equal(result.job.condition?.metric, 'exit');
  assert.equal(typeof result.job.nextRunAt, 'string');
  assert.match(result.job.nextRunAt || '', /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((result.job.workflow.params as any).company_id, 'company_123');
}

async function testScheduledWorkflowDraft() {
  const result = await handleAutomationManager(
    {
      automation_type: 'scheduled_workflow',
      goal: 'cek laporan operasional',
      schedule: 'setiap hari jam 5 sore',
      _persist: false
    },
    {
      user_id: 'automation_full_user',
      app_name: 'hris',
      text: 'cek laporan operasional setiap hari jam 5 sore',
      attributes: {
        params: {
          company_id: 'company_123'
        }
      }
    }
  );

  assert.equal(result.kind, 'automation_job_draft');
  assert.equal(result.job.type, 'scheduled_workflow');
  assert.equal(result.job.trigger.kind, 'recurring');
  assert.equal(result.job.trigger.cron, '0 17 * * *');
  assert.equal(result.job.workflow.reusable, true);
  assert.equal((result.job.workflow.params as any).company_id, 'company_123');
}

async function testNotificationManager() {
  const result: any = await handleNotificationManager(
    {
      message: 'meeting',
      target: 'automation_full_user'
    },
    {
      user_id: 'automation_full_user',
      app_name: 'hris',
      text: 'kirim notifikasi sekarang'
    }
  );

  assert.equal(result.kind, 'notification_sent');
  assert.equal(result.channel, 'chat');
  assert.equal(result.message, 'meeting');
}

async function testSchedulerCronCalculation() {
  const from = new Date('2026-06-02T08:00:00+07:00');
  const daily = calculateNextRunFromCron('0 7 * * *', from);
  const weekly = calculateNextRunFromCron('0 9 * * 1', from);
  const monthly = calculateNextRunFromCron('0 8 1 * *', from);

  assert.equal(daily?.getHours(), 7);
  assert.equal(daily?.getDate(), 3);
  assert.equal(weekly?.getDay(), 1);
  assert.equal(monthly?.getDate(), 1);
}

async function testConditionEvaluator() {
  const result = conditionEvaluatorService.evaluate(
    {
      metric: 'profit',
      operator: 'lt',
      value: 0
    },
    {
      profit: -100
    }
  );

  assert.equal(result.shouldRun, true);
  assert.equal(result.observedValue, -100);

  const summaryResult = conditionEvaluatorService.evaluate(
    {
      metric: 'exit',
      operator: 'gt',
      value: 1
    },
    {
      apiResults: {
        get_vehicle_assignment: {
          summary: {
            leave: 20,
            exit: 2
          }
        }
      }
    }
  );

  assert.equal(summaryResult.shouldRun, true);
  assert.equal(summaryResult.observedValue, 2);
}

async function main() {
  await testReminderCreationPath();
  await testOneMinuteReminder();
  await testGenericReminderStillNeedsGoalAfterSchedule();
  await testAutomationSlotExtraction();
  await testMissingTimeClarification();
  await testConditionalAlertNeedsSchedule();
  await testConditionalAlertConditionNormalization();
  await testScheduledWorkflowDraft();
  await testNotificationManager();
  await testSchedulerCronCalculation();
  await testConditionEvaluator();
  console.log('[AutomationRuntime Full Smoke] All checks passed');
}

main().catch(error => {
  console.error('[AutomationRuntime Full Smoke] Failed');
  console.error(error);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
