import assert from 'node:assert/strict';
import { detectCudAction } from '../src/utils/cud-action-detector.util';
import { applyGeneralChatGuard } from '../src/utils/general-chat-guard.util';

function main() {
  const bareYes = detectCudAction('ya');
  assert.equal(bareYes.isCudAction, false, 'bare "ya" must not become generic save action');

  const bareOke = detectCudAction('oke');
  assert.equal(bareOke.isCudAction, false, 'bare "oke" must not become generic save action');

  const pendingYes = detectCudAction('ya', { hasPendingConfirmation: true });
  assert.equal(pendingYes.isCudAction, true, 'pending confirmation should still accept "ya"');
  assert.equal(pendingYes.category, 'create');
  assert.equal(pendingYes.verb, 'simpan');

  assert.equal(applyGeneralChatGuard('ya'), null, 'general chat should not block bare "ya"');

  const guardedPending = applyGeneralChatGuard('ya', { hasPendingConfirmation: true });
  assert.ok(guardedPending?.includes('simpan'), 'pending confirmation should guide save confirmation');

  const save = detectCudAction('simpan');
  assert.equal(save.isCudAction, true, '"simpan" remains a create/save action');

  console.log('[CUD Yes Guard Smoke] All checks passed');
}

main();
