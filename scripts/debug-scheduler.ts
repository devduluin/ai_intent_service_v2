#!/usr/bin/env node

/**
 * Debug Automation Scheduler
 * Test script untuk cek job creation dan execution flow
 */

import 'dotenv/config';
import { automationJobRepository } from '../src/repositories/automation-job.repository';
import { automationSchedulerService } from '../src/services/automation/scheduler.service';
import { triggerNormalizerService } from '../src/services/automation/trigger-normalizer.service';
import { connectDatabase } from '../src/database/connection';
import { appLogger } from '../src/utils/logger.util';

async function debugScheduler() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 AUTOMATION SCHEDULER DEBUG');
  console.log('='.repeat(80) + '\n');

  try {
    // 1. Connect to database
    console.log('[1] Connecting to database...');
    await connectDatabase();
    console.log('✅ Database connected\n');

    // 2. Check existing jobs
    console.log('[2] Checking existing jobs in database...');
    const allJobs = await automationJobRepository.findByUserAndApp('user123', 'hris', {
      limit: 100
    });
    console.log(`Found ${allJobs.length} jobs:\n`);
    
    allJobs.forEach((job, idx) => {
      console.log(`[${idx}] ${job.title}`);
      console.log(`    ID: ${job.id}`);
      console.log(`    Type: ${job.type}`);
      console.log(`    Status: ${job.status}`);
      console.log(`    Next Run At: ${job.nextRunAt}`);
      console.log(`    Action: ${job.action?.key}`);
      console.log(`    Trigger: ${JSON.stringify(job.trigger)}`);
      console.log('');
    });

    // 3. Test trigger normalization
    console.log('[3] Testing trigger normalization...');
    const testSchedules = [
      'jam 12:55',
      '12:55 hari ini',
      'besok jam 12:55',
      '2026-06-02 12:55'
    ];

    testSchedules.forEach((schedule) => {
      const now = new Date();
      const result = triggerNormalizerService.normalize(schedule, {
        timezone: 'Asia/Jakarta',
        now
      });
      
      console.log(`\nSchedule: "${schedule}"`);
      console.log(`  Confidence: ${result.confidence}`);
      console.log(`  Missing: ${result.missing.length > 0 ? result.missing.join(', ') : 'none'}`);
      console.log(`  Trigger Kind: ${result.trigger?.kind}`);
      console.log(`  Run At: ${result.trigger?.runAt}`);
      
      if (result.trigger?.runAt) {
        const runTime = new Date(result.trigger.runAt);
        const nowTime = new Date();
        const diffMs = runTime.getTime() - nowTime.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        
        console.log(`  Scheduled for: ${runTime.toISOString()}`);
        console.log(`  Current time: ${nowTime.toISOString()}`);
        console.log(`  Difference: ${diffMin} minutes`);
        
        if (diffMin < 0) {
          console.log(`  ⚠️  TIME IS IN THE PAST! Job will be overdue immediately.`);
        } else {
          console.log(`  ✅ Time is in future`);
        }
      }
    });

    // 4. Find due jobs
    console.log('\n[4] Checking for due jobs...');
    const now = new Date();
    console.log(`Current time: ${now.toISOString()} (${now.getTime()})`);
    
    const dueJobs = await automationJobRepository.findDueJobs(now, 100);
    console.log(`\nFound ${dueJobs.length} due jobs:\n`);
    
    dueJobs.forEach((job, idx) => {
      console.log(`[${idx}] ${job.title}`);
      console.log(`    ID: ${job.id}`);
      console.log(`    Next Run At: ${job.nextRunAt}`);
      console.log(`    Status: ${job.status}`);
      const nextRunTime = new Date(job.nextRunAt as Date);
      console.log(`    Time diff from now: ${(nextRunTime.getTime() - now.getTime()) / 1000}s`);
      console.log('');
    });

    if (dueJobs.length === 0) {
      console.log('⚠️  No due jobs found!');
      console.log('This could mean:');
      console.log('  1. next_run_at is in the future (job scheduled later)');
      console.log('  2. next_run_at is NULL (not set properly)');
      console.log('  3. Status is not "active"');
      console.log('  4. Timezone mismatch (time stored as UTC, compared in local time)');
    }

    // 5. Run scheduler manually
    console.log('\n[5] Running scheduler manually...');
    const result = await automationSchedulerService.runDueJobs(now, 50);
    
    console.log('\nScheduler Result:');
    console.log(`  Checked: ${result.checked}`);
    console.log(`  Executed: ${result.executed}`);
    console.log(`  Failed: ${result.failed}`);
    console.log(`  Skipped: ${result.skipped}`);
    
    if (result.results.length > 0) {
      console.log('\nJob Results:');
      result.results.forEach((r, idx) => {
        console.log(`[${idx}] ${r.jobId}`);
        console.log(`     Status: ${r.status}`);
        if (r.error) console.log(`     Error: ${r.error}`);
        if (r.result) console.log(`     Result: ${JSON.stringify(r.result)}`);
      });
    }

    // 6. Check job after execution
    if (result.executed > 0) {
      console.log('\n[6] Verifying jobs after execution...');
      const executedJob = dueJobs[0];
      const updated = await automationJobRepository.findById(executedJob.id);
      
      if (updated) {
        console.log(`\nJob: ${updated.title}`);
        console.log(`  Status: ${updated.status}`);
        console.log(`  Run Count: ${updated.runCount}`);
        console.log(`  Last Run At: ${updated.lastRunAt}`);
        console.log(`  Last Result: ${JSON.stringify(updated.lastResult)}`);
        console.log(`  Last Error: ${updated.lastError}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Debug completed');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Error during debug:');
    console.error(error instanceof Error ? error.message : error);
    console.error('\nStack:');
    console.error(error instanceof Error ? error.stack : error);
  } finally {
    process.exit(0);
  }
}

debugScheduler().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
