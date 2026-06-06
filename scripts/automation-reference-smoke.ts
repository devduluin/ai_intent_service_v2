import assert from 'node:assert/strict';
import { triggerNormalizerService } from '../src/services/automation/trigger-normalizer.service';
import { handleAutomationManager } from '../src/skills/automation_manager.skill';

async function testRecurringTimeMerge() {
  const result = triggerNormalizerService.normalize('oke laporkan ini tiap hari ke saya jam 7 sore');
  assert.equal(result.missing.includes('time'), false);
  assert.equal(result.trigger?.kind, 'recurring');
  assert.equal(result.trigger?.cron, '0 19 * * *');
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
  await testRecurringTimeMerge();
  await testAutomationReferenceUsesWorkingMemoryLastExecution();
  console.log('[AutomationReference Smoke] All checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error('[AutomationReference Smoke] Failed');
  console.error(error);
  process.exit(1);
});
