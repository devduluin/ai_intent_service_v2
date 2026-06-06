import { buildProfilePromptSection } from '../src/utils/general-chat-guard.util';

const section = buildProfilePromptSection({
  identity: { name: 'Ardi Mahendra' },
  tenant: {
    company_id: '79483b71-25c2-11f0-8c42-d28e58827589',
    department: 'Engineering'
  },
  preferences: {}
} as any);

if (section.includes('79483b71-25c2-11f0-8c42-d28e58827589') || section.includes('company_id')) {
  throw new Error('General chat profile prompt leaked company_id');
}

if (!section.includes('Ardi Mahendra')) {
  throw new Error('General chat profile prompt should still include safe identity context');
}

console.log('[general-chat-profile-privacy-smoke] PASS');

