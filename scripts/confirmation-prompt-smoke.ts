import assert from 'node:assert/strict';
import { confirmationPromptService } from '../src/services/confirmation-prompt.service';
import type { PendingConfirmation } from '../src/types/confirmation.types';

function baseConfirmation(patch: Partial<PendingConfirmation>): PendingConfirmation {
  return {
    id: 'confirmation-smoke',
    userId: 'user',
    appName: 'hris',
    type: 'automation_job_create',
    status: 'pending',
    draft: {},
    editableFields: [],
    commitAction: {
      resource: 'skill',
      key: 'automation_manager',
      params: {}
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    ...patch
  };
}

function testReminderPrompt() {
  const prompt = confirmationPromptService.buildPrompt(baseConfirmation({
    draft: {
      type: 'reminder',
      goal: 'meeting dengan client',
      trigger: {
        runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      },
      notification: {}
    }
  }));

  assert(prompt.includes('meeting dengan client'));
  assert(prompt.includes('15 menit sebelumnya'));
  assert(prompt.includes('Konfirmasi:'));
  assert(prompt.includes('Ketik "simpan" atau "ya"'));
  assert(!prompt.includes('Mau saya simpan?'));
}

function testNearReminderPromptDoesNotOfferOffset() {
  const prompt = confirmationPromptService.buildPrompt(baseConfirmation({
    draft: {
      type: 'reminder',
      goal: 'meeting',
      trigger: {
        runAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      },
      notification: {}
    }
  }));

  assert(!prompt.includes('15 menit sebelumnya'));
}

function testCreatedOneTimeReminderDoesNotDuplicateNextRun() {
  const runAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const message = confirmationPromptService.buildCreatedMessage({
    type: 'reminder',
    goal: 'meeting dengan client',
    trigger: {
      kind: 'once',
      runAt
    },
    nextRunAt: runAt
  });

  assert(message.includes('Jadwal:'));
  assert(!message.includes('Eksekusi berikutnya:'));
}

function testCreatedRecurringAutomationShowsNextRun() {
  const message = confirmationPromptService.buildCreatedMessage({
    type: 'scheduled_workflow',
    goal: 'cek laporan operasional',
    trigger: {
      kind: 'recurring',
      cron: '0 17 * * *'
    },
    nextRunAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });

  assert(message.includes('Jadwal:'));
  assert(message.includes('Eksekusi berikutnya:'));
}

function testGenericToolWritePrompt() {
  const prompt = confirmationPromptService.buildPrompt(baseConfirmation({
    type: 'tool_write',
    draft: {
      title: 'Update data karyawan'
    },
    commitAction: {
      resource: 'tool',
      key: 'update_employee',
      params: {}
    }
  }));

  assert(prompt.includes('Update data karyawan'));
  assert(prompt.includes('lanjutkan'));
}

testReminderPrompt();
testNearReminderPromptDoesNotOfferOffset();
testCreatedOneTimeReminderDoesNotDuplicateNextRun();
testCreatedRecurringAutomationShowsNextRun();
testGenericToolWritePrompt();
console.log('[Confirmation Prompt Smoke] All checks passed');
