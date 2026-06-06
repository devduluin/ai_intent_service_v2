import { isUserProfileQuestionText } from '../src/utils/user-profile-statement.util';
import { applyGeneralChatGuard } from '../src/utils/general-chat-guard.util';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(isUserProfileQuestionText('emang siapa saya'), 'Expected "emang siapa saya" to be a profile question');
assert(isUserProfileQuestionText('siapa nama saya'), 'Expected "siapa nama saya" to be a profile question');

const noPendingCancel = applyGeneralChatGuard('batalkan', {});
assert(
  noPendingCancel === 'Tidak ada yang perlu dibatalkan saat ini. Ada yang bisa saya bantu?',
  'Expected no-pending cancellation to be a noop response'
);

const pendingSlotCancel = applyGeneralChatGuard('batalkan', { hasPendingSlot: true });
assert(
  pendingSlotCancel === 'Ketik "batalkan" untuk membatalkan pengisian data yang sedang berlangsung.',
  'Expected pending-slot cancellation guidance only when pending slot is explicit'
);

console.log('[conversation-guard-regression-smoke] PASS');

