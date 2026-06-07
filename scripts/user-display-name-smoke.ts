import { getDisplayNameFromInput } from '../src/utils/user-display-name.util';

const name = getDisplayNameFromInput({
  user_id: 'smoke-user',
  app_name: 'hris',
  text: 'ya',
  attributes: {
    name: 'John',
    params: { name: 'John Param' },
    userProfileContext: {
      identity: {
        name: 'Ardi Mahendra'
      }
    }
  }
} as any);

if (name !== 'Ardi Mahendra') {
  throw new Error(`Expected profile name to win over attributes, got ${name}`);
}

console.log('[user-display-name-smoke] PASS', { name });

