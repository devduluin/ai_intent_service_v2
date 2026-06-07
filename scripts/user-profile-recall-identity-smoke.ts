import assert from 'node:assert/strict';
import { userProfileRecallService } from '../src/services/user-profile-recall.service';
import { userProfileRepository } from '../src/repositories/user-profile.repository';
import type { UserProfileEntry } from '../src/types/user-profile.types';

const originalFindByKeys = userProfileRepository.findByKeys.bind(userProfileRepository);
const originalSearchByPhrases = userProfileRepository.searchByPhrases.bind(userProfileRepository);

const nameFact: UserProfileEntry = {
  id: 'profile-name-1',
  userId: 'user-1',
  appName: 'hris',
  profileKey: 'name',
  valueLabel: 'default',
  profileValue: 'Ardi Mahendra',
  valueType: 'string',
  confidence: 0.95,
  source: 'user',
  profileClass: 'identity',
  status: 'active',
  evidenceHash: 'hash',
  evidenceText: 'nama saya Ardi Mahendra',
  lastConfirmedAt: null,
  validFrom: null,
  validTo: null,
  expiresAt: null,
  isPii: true,
  createdAt: new Date(),
  updatedAt: new Date()
};

async function main() {
  let requestedKeys: string[] = [];
  let phraseSearchCalled = false;

  (userProfileRepository as any).findByKeys = async (_userId: string, _appName: string, keys: string[]) => {
    requestedKeys = keys;
    return keys.includes('name') ? [nameFact] : [];
  };

  (userProfileRepository as any).searchByPhrases = async () => {
    phraseSearchCalled = true;
    return [];
  };

  try {
    const result = await userProfileRecallService.recall('user-1', 'hris', {
      userText: 'siapa saya'
    });

    assert.equal(result.found, true);
    assert.equal(result.answerable, true);
    assert.equal(result.facts[0]?.profileKey, 'name');
    assert.equal(result.facts[0]?.profileValue, 'Ardi Mahendra');
    assert.deepEqual(requestedKeys, ['name']);
    assert.equal(phraseSearchCalled, false);

    const formatted = userProfileRecallService.format(result);
    assert.equal(formatted, 'Name: Ardi Mahendra');

    console.log('[UserProfile Recall Identity Smoke] All checks passed');
    process.exit(0);
  } finally {
    (userProfileRepository as any).findByKeys = originalFindByKeys;
    (userProfileRepository as any).searchByPhrases = originalSearchByPhrases;
  }
}

main().catch(error => {
  console.error('[UserProfile Recall Identity Smoke] Failed');
  console.error(error);
  process.exit(1);
});
