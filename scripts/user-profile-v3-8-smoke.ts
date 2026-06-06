import assert from 'assert';
import { normalizeProfileKey } from '../src/utils/user-profile-key-normalizer.util';
import {
  isPotentialDynamicProfileStatementText,
  isUserProfileQuestionText,
  parseUserProfileStatement
} from '../src/utils/user-profile-statement.util';
import { userProfileRecallSkill } from '../src/skills/user_profile_recall.skill';

async function main() {
  assert.deepEqual(normalizeProfileKey('email kantor'), {
    key: 'contact.email',
    valueLabel: 'work',
  });

  assert.deepEqual(normalizeProfileKey('email pribadi'), {
    key: 'contact.email',
    valueLabel: 'personal',
  });

  assert.deepEqual(normalizeProfileKey('emal saya'), {
    key: 'contact.email',
    valueLabel: undefined,
  });

  assert.equal(normalizeProfileKey('pacar saya').key, 'relationship.partner');

  const workEmail = parseUserProfileStatement('email kantor saya ardi.mahendra@duluin.com');
  assert.equal(workEmail.isStatement, true);
  assert.equal(workEmail.facts[0].key, 'contact.email');
  assert.equal(workEmail.facts[0].valueLabel, 'work');

  const hobby = parseUserProfileStatement('hoby saya programming');
  assert.equal(hobby.isStatement, true);
  assert.equal(hobby.facts[0].key, 'preference.hobby');
  assert.equal(hobby.facts[0].value, 'programming');

  const companyId = parseUserProfileStatement('my company id is company_123');
  assert.equal(companyId.isStatement, true);
  assert.equal(companyId.facts[0].key, 'company_id');

  assert.equal(isUserProfileQuestionText('apa emal saya'), true);
  assert.equal(isUserProfileQuestionText('alamat surel saya apa'), true);
  assert.equal(isUserProfileQuestionText('mailku apa'), true);
  assert.equal(isPotentialDynamicProfileStatementText('warna favorit saya biru'), true);
  assert.equal(isPotentialDynamicProfileStatementText('cek kendaraan exit hari ini'), false);

  assert.equal(userProfileRecallSkill.slug, 'user_profile_recall');
  assert.equal(userProfileRecallSkill.capabilities?.requiresData, false);
  assert.ok(userProfileRecallSkill.capabilities?.triggers?.includes('email saya apa'));

  console.log('user-profile-v3-8-smoke: PASS');
}

main().catch(error => {
  console.error('user-profile-v3-8-smoke: FAIL', error);
  process.exit(1);
});
