import assert from 'assert';
import { sequelize } from '../src/database/models';
import { userProfileService } from '../src/services/user-profile.service';
import { userProfileRecallService } from '../src/services/user-profile-recall.service';

async function main() {
  const userId = `profile_smoke_${Date.now()}`;
  const appName = 'hris';

  await userProfileService.upsert(userId, appName, {
    key: 'contact.email',
    valueLabel: 'work',
    value: 'ardi@corp.com',
    confidence: 0.95,
    source: 'user',
    profileClass: 'identity',
    isPii: true,
  });

  await userProfileService.upsert(userId, appName, {
    key: 'contact.email',
    valueLabel: 'personal',
    value: 'ardi@gmail.com',
    confidence: 0.95,
    source: 'user',
    profileClass: 'identity',
    isPii: true,
  });

  await userProfileService.upsert(userId, appName, {
    key: 'relationship.partner',
    value: 'Sinta',
    confidence: 0.92,
    source: 'user',
    profileClass: 'identity',
    isPii: true,
    validFrom: new Date('2026-06-01T00:00:00.000Z'),
  });

  const all = await userProfileService.getAll(userId, appName);
  assert.equal(all.length, 3);

  const context = await userProfileService.getContext(userId, appName);
  assert.equal(context.identity['contact.email.work'], '[redacted]');

  const recall = await userProfileRecallService.recall(userId, appName, {
    userText: 'siapa pacar saya?'
  });
  assert.equal(recall.found, true);
  assert.equal(recall.answerable, true);
  assert.equal(recall.facts[0].profileValue, 'Sinta');

  await userProfileService.extractAndUpsert({
    user_id: userId,
    app_name: appName,
    text: 'email kantor saya ardi.mahendra@duluin.com',
    attributes: {}
  });

  await userProfileService.extractAndUpsert({
    user_id: userId,
    app_name: appName,
    text: 'hoby saya programming',
    attributes: {}
  });

  await userProfileService.extractAndUpsert({
    user_id: userId,
    app_name: appName,
    text: 'company_id saya company_123',
    attributes: {}
  });

  await userProfileService.upsert(userId, appName, {
    key: 'preferred_channel',
    value: 'chat',
    confidence: 0.9,
    source: 'user',
    profileClass: 'preference',
  });

  await userProfileService.upsert(userId, appName, {
    key: 'department',
    value: 'finance',
    confidence: 0.9,
    source: 'user',
    profileClass: 'tenant',
  });

  const profileParams = await userProfileService.collectForParams(userId, appName, [
    { name: 'company_id', type: 'string', isRequired: true },
    { name: 'preferred_channel', type: 'string', isRequired: false },
    { name: 'department', type: 'string', isRequired: false },
  ] as any);

  assert.equal(profileParams.company_id, 'company_123');
  assert.equal(profileParams.preferred_channel, 'chat');
  assert.equal(profileParams.department, 'finance');

  const companyRecall = await userProfileRecallService.recall(userId, appName, {
    userText: 'apakah anda tahu company_id saya?'
  });
  assert.equal(companyRecall.found, true);
  assert.equal(companyRecall.facts[0].profileValue, 'company_123');

  const hobbyRecall = await userProfileRecallService.recall(userId, appName, {
    userText: 'hobi saya apa?'
  });
  assert.equal(hobbyRecall.found, true);
  assert.equal(hobbyRecall.facts[0].profileValue, 'programming');

  const deleted = await userProfileService.forgetMe(userId, appName);
  assert.equal(deleted, 7);

  await sequelize.close();
  console.log('user-profile-db-smoke: PASS');
}

main().catch(async error => {
  console.error('user-profile-db-smoke: FAIL', error);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
