import assert from 'node:assert/strict';
import { godModeManagerService } from '../src/services/god-mode-manager.service';

const userId = `god_mode_smoke_${Date.now()}`;
const appName = 'hris';

async function main() {
  const startTotal = Date.now();

  assert.equal(await godModeManagerService.shouldHandle({
    user_id: userId,
    app_name: appName,
    text: '/user profile'
  }), true);

  const profile = await godModeManagerService.handle({
    user_id: userId,
    app_name: appName,
    text: '/user profile'
  }, startTotal);
  assert.equal(profile.intent, 'user_profile_mode');

  const activeProfile = await godModeManagerService.get(userId, appName);
  assert.equal(activeProfile?.mode, 'user_profile');

  const exitProfile = await godModeManagerService.handle({
    user_id: userId,
    app_name: appName,
    text: 'exit'
  }, startTotal);
  assert.equal(exitProfile.intent, 'user_profile_mode_exit');
  assert.equal(await godModeManagerService.get(userId, appName), null);

  assert.equal(await godModeManagerService.shouldHandle({
    user_id: userId,
    app_name: appName,
    text: 'tampilkan automation manager'
  }), false);

  assert.equal(await godModeManagerService.shouldHandle({
    user_id: userId,
    app_name: appName,
    text: 'lihat user profile'
  }), false);

  const automation = await godModeManagerService.shouldHandle({
    user_id: userId,
    app_name: appName,
    text: '/automation manager'
  });
  assert.equal(automation, true);

  console.log('[GodModeManager Smoke] All checks passed');
}

main().catch(error => {
  console.error('[GodModeManager Smoke] Failed');
  console.error(error);
  process.exit(1);
}).then(() => process.exit(0));
