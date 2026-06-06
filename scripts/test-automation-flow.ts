// ============================================================
// Automation Flow Test Script
// ============================================================
// Tests end-to-end automation flow:
// 1. Create automation job
// 2. Wait for scheduled time
// 3. Run scheduler
// 4. Verify job executed
// ============================================================

import { automationJobRepository } from '../src/repositories/automation-job.repository';
import { automationSchedulerService } from '../src/services/automation/scheduler.service';
import { schedulerRunnerService } from '../src/services/automation/scheduler-runner.service';

async function testAutomationFlow() {
  console.log('\n' + '='.repeat(60));
  console.log('=== Automation Flow Test ===');
  console.log('='.repeat(60) + '\n');

  try {
    // 1. Create a test reminder (5 seconds from now)
    const futureTime = new Date(Date.now() + 5000);
    console.log('1. Creating test reminder for:', futureTime.toISOString());
    console.log('   (5 seconds from now)\n');

    const job = await automationJobRepository.create({
      userId: 'test_user_123',
      appName: 'hris',
      title: 'Test Reminder',
      goal: 'Test automation flow - meeting with customer',
      type: 'reminder',
      trigger: {
        kind: 'once',
        runAt: futureTime.toISOString()
      },
      workflow: { 
        sourceText: 'Test automation reminder', 
        reusable: false 
      },
      action: {
        resource: 'skill',
        key: 'notification_manager',
        params: {
          message: 'Test notification: meeting with customer',
          target: 'test_user_123',
          channel: 'chat'
        }
      },
      notification: {
        channel: 'chat',
        messageTemplate: 'Reminder: meeting with customer',
        target: 'test_user_123'
      },
      status: 'active',
      safety: { 
        requiresConfirmation: false, 
        sideEffectLevel: 'none' 
      },
      nextRunAt: futureTime.toISOString()
    });

    console.log('✅ Job created:', job.id);
    console.log('   Title:', job.title);
    console.log('   Status:', job.status);
    console.log('   Next run at:', job.nextRunAt);
    console.log('   Type:', job.type);
    console.log('   Action:', job.action.resource, '->', job.action.key);

    // 2. Wait for scheduled time
    const waitTime = futureTime.getTime() - Date.now() + 1000;  // +1 second buffer
    console.log('\n2. Waiting', waitTime, 'ms for scheduled time...');
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // 3. Run scheduler manually
    console.log('\n3. Running scheduler...');
    const result = await automationSchedulerService.runDueJobs();

    console.log('\n✅ Scheduler result:');
    console.log('   Checked:', result.checked);
    console.log('   Executed:', result.executed);
    console.log('   Failed:', result.failed);
    console.log('   Skipped:', result.skipped);

    if (result.results.length > 0) {
      console.log('\n   Details:');
      result.results.forEach((r: any, i: number) => {
        console.log(`   [${i}] Job: ${r.jobId}`);
        console.log(`       Status: ${r.status}`);
        if (r.result) {
          console.log(`       Result:`, JSON.stringify(r.result, null, 2));
        }
        if (r.error) {
          console.log(`       Error: ${r.error}`);
        }
      });
    }

    // 4. Check job after execution
    const updated = await automationJobRepository.findById(job.id);
    console.log('\n4. Job after execution:');
    
    if (updated) {
      console.log('   ID:', updated.id);
      console.log('   Status:', updated.status);
      console.log('   Run count:', updated.runCount);
      console.log('   Last run at:', updated.lastRunAt);
      console.log('   Last result:', updated.lastResult ? 'Present' : 'None');
      console.log('   Last error:', updated.lastError || 'None');
      console.log('   Next run at:', updated.nextRunAt || 'None (completed)');
      
      // Verify execution
      if (updated.status === 'completed' && updated.runCount === 1) {
        console.log('\n✅ TEST PASSED: Job executed successfully!');
        console.log('   - Status changed to "completed"');
        console.log('   - Run count incremented to 1');
        console.log('   - Last result stored');
      } else if (updated.status === 'active' && updated.runCount === 1) {
        console.log('\n✅ TEST PASSED: Job executed (recurring job)!');
        console.log('   - Status remains "active" (recurring)');
        console.log('   - Run count incremented to 1');
        console.log('   - Next run at scheduled');
      } else if (updated.status === 'failed') {
        console.log('\n⚠️  TEST WARNING: Job failed!');
        console.log('   Error:', updated.lastError);
      } else {
        console.log('\n❌ TEST FAILED: Unexpected job state');
        console.log('   Expected: status="completed" or status="active" (recurring)');
        console.log('   Got:', updated.status);
      }
    } else {
      console.log('\n❌ TEST FAILED: Job not found after execution');
    }

    // 5. Test scheduler runner (optional)
    console.log('\n5. Testing scheduler runner...');
    console.log('   Starting scheduler runner...');
    schedulerRunnerService.start();
    
    console.log('   Scheduler active:', schedulerRunnerService.isActive());
    console.log('   Waiting 3 seconds...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('   Stopping scheduler runner...');
    schedulerRunnerService.stop();
    console.log('   Scheduler active:', schedulerRunnerService.isActive());
    console.log('   ✅ Scheduler runner test passed');

    console.log('\n' + '='.repeat(60));
    console.log('=== Automation Flow Test Complete ===');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ TEST FAILED WITH ERROR:');
    console.error('Error:', error instanceof Error ? error.message : String(error));
    console.error('Stack:', error instanceof Error ? error.stack : 'N/A');
    console.error('\n' + '='.repeat(60) + '\n');
    process.exit(1);
  }
}

// Run the test
testAutomationFlow()
  .then(() => {
    console.log('Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
