import assert from 'node:assert/strict';
import { confirmationStateService } from '../src/services/confirmation-state.service';
import { ConfirmationResolver } from '../src/services/cores/resolvers/confirmation.resolver';

const userId = `confirmation_smoke_${Date.now()}`;
const appName = 'hris';

function draft() {
  return {
    title: 'Reminder: meeting dengan client',
    goal: 'meeting dengan client',
    type: 'reminder',
    trigger: {
      kind: 'once',
      runAt: '2026-06-02T02:00:00+07:00',
      timezone: 'Asia/Jakarta',
      sourceText: '1 jam lagi'
    },
    workflow: {
      sourceText: 'ingatkan saya 1 jam lagi meeting dengan client',
      reusable: false
    },
    action: {
      resource: 'skill',
      key: 'notification_manager',
      params: {
        message: 'meeting dengan client'
      }
    },
    notification: {
      channel: 'chat',
      messageTemplate: 'meeting dengan client'
    },
    status: 'draft',
    safety: {
      requiresConfirmation: false,
      sideEffectLevel: 'none'
    },
    nextRunAt: '2026-06-02T02:00:00+07:00'
  };
}

async function testEditAndConfirm() {
  const resolver = new ConfirmationResolver();
  const saved = await confirmationStateService.set(userId, appName, {
    type: 'automation_job_create',
    draft: draft(),
    editableFields: ['trigger.runAt', 'notification.offsetMinutes'],
    commitAction: {
      resource: 'skill',
      key: 'automation_manager',
      params: { _confirmed: true }
    }
  });

  assert.equal(saved.status, 'pending');

  const edit = await resolver.resolve(
    {
      user_id: userId,
      app_name: appName,
      text: 'ya 15 menit sebelumnya'
    },
    saved
  );
  assert.equal(edit.isConfirmationResponse, true);
  assert.equal(edit.shouldAskAgain, true);
  assert.equal((edit.patch as any).notification.offsetMinutes, 15);
  assert.equal((edit.patch as any).trigger.runAt, '2026-06-02T01:45:00+07:00');
  assert.equal((edit.patch as any).nextRunAt, '2026-06-02T01:45:00+07:00');

  const patched = await confirmationStateService.patch(userId, appName, edit.patch!);
  assert.equal((patched?.draft.notification as any).offsetMinutes, 15);
  assert.equal(patched?.draft.trigger.runAt, '2026-06-02T01:45:00+07:00');

  const confirm = await resolver.resolve(
    {
      user_id: userId,
      app_name: appName,
      text: 'simpan'
    },
    patched
  );
  assert.equal(confirm.isConfirmationResponse, true);
  assert.equal(confirm.shouldCommit, true);
}

async function testTypoCancelFallback() {
  const resolver = new ConfirmationResolver();
  const saved = await confirmationStateService.set(`${userId}_typo`, appName, {
    type: 'automation_job_create',
    draft: draft(),
    editableFields: ['trigger.runAt'],
    commitAction: {
      resource: 'skill',
      key: 'automation_manager',
      params: { _confirmed: true }
    }
  });

  const cancel = await resolver.resolve(
    {
      user_id: `${userId}_typo`,
      app_name: appName,
      text: 'batlakan'
    },
    saved
  );

  assert.equal(cancel.isConfirmationResponse, true);
  assert.equal(cancel.shouldCancel, true);
}

async function testCancel() {
  const resolver = new ConfirmationResolver();
  const saved = await confirmationStateService.set(`${userId}_cancel`, appName, {
    type: 'automation_job_create',
    draft: draft(),
    editableFields: ['trigger.runAt'],
    commitAction: {
      resource: 'skill',
      key: 'automation_manager',
      params: { _confirmed: true }
    }
  });

  const cancel = await resolver.resolve(
    {
      user_id: `${userId}_cancel`,
      app_name: appName,
      text: 'batalkan'
    },
    saved
  );

  assert.equal(cancel.isConfirmationResponse, true);
  assert.equal(cancel.shouldCancel, true);
}

async function testDeleteConfirmation() {
  const resolver = new ConfirmationResolver();
  const saved = await confirmationStateService.set(`${userId}_delete`, appName, {
    type: 'automation_job_delete',
    draft: {
      jobId: 'job_delete_smoke',
      title: 'Conditional Alert: kendaraan exit',
      goal: 'conditional alert kalau kendaraan exit lebih dari 1 unit',
      type: 'conditional_alert',
      status: 'active'
    },
    editableFields: [],
    commitAction: {
      resource: 'skill',
      key: 'automation_manager',
      params: { _delete: true, jobId: 'job_delete_smoke' }
    }
  });

  const confirm = await resolver.resolve(
    {
      user_id: `${userId}_delete`,
      app_name: appName,
      text: 'hapus'
    },
    saved
  );

  assert.equal(confirm.isConfirmationResponse, true);
  assert.equal(confirm.shouldCommit, true);
  assert.equal(confirm.shouldCancel, undefined);
}

async function main() {
  await testEditAndConfirm();
  await testTypoCancelFallback();
  await testCancel();
  await testDeleteConfirmation();
  console.log('[Confirmation Runtime Smoke] All checks passed');
}

main().catch(error => {
  console.error('[Confirmation Runtime Smoke] Failed');
  console.error(error);
  process.exit(1);
}).then(() => process.exit(0));
