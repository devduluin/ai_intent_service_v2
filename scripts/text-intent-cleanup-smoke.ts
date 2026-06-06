import assert from 'node:assert/strict';
import {
  buildTemporalFollowUpResidue,
  isCancellationText,
  isConfirmDeleteText,
  isExitModeText,
  isGenericDesireText,
  normalizeIntentText,
  stripGenericDesireWords
} from '../src/utils/text-intent-cleanup.util';
import { cleanAutomationGoalText, isGenericAutomationGoal } from '../src/utils/automation-param.util';

function main() {
  assert.equal(normalizeIntentText('Saya mau lihat kemarin!'), 'saya mau lihat kemarin');
  assert.equal(buildTemporalFollowUpResidue('saya mau lihat kemarin'), '');
  assert.equal(buildTemporalFollowUpResidue('tanggal 29'), '');
  assert.equal(buildTemporalFollowUpResidue('show yesterday'), '');
  assert.equal(buildTemporalFollowUpResidue('absen tanggal 9'), 'absen');

  assert.equal(isGenericDesireText('saya ingin'), true);
  assert.equal(stripGenericDesireWords('saya ingin buat reminder meeting'), 'saya buat reminder meeting');
  assert.equal(isGenericAutomationGoal('saya ingin buat reminder'), true);
  assert.equal(isGenericAutomationGoal('buat reminder'), true);
  
  assert.equal(cleanAutomationGoalText('saya ingin buat reminder'), undefined);
  assert.equal(cleanAutomationGoalText('buat reminder'), undefined);
  assert.equal(cleanAutomationGoalText('saya ingin buat reminder meeting client'), 'meeting client');

  assert.equal(isCancellationText('batalkan'), true);
  assert.equal(isCancellationText('batal draft'), true);
  assert.equal(isCancellationText('hapus exit'), false);
  assert.equal(isConfirmDeleteText('ya hapus'), true);
  assert.equal(isExitModeText('kluar', ['automation manager']), true);
  assert.equal(isExitModeText('keluar automation manager', ['automation manager']), true);
  assert.equal(isExitModeText('keluar'), false);

  console.log('[TextIntentCleanup Smoke] All checks passed');
}

main();
