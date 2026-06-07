import assert from 'node:assert/strict';
import { naturalizationService } from '../src/services/naturalization.service';
import type { Agent } from '../src/types/agent.types';
import type { PipelineInput } from '../src/types';

async function main() {
  const response = await naturalizationService.naturalize(
    {
      id: 'agent-smoke',
      slug: 'hris',
      name: 'HRIS',
      llmModel: {
        provider: 'ollama',
        modelCode: 'unused'
      }
    } as Agent,
    {
      user_profile_recall: {
        kind: 'user_profile_recall',
        success: true,
        answerable: true,
        summary: 'Name: Ardi Mahendra',
        facts: [
          {
            key: 'name',
            label: 'default',
            value: 'Ardi Mahendra',
            confidence: 0.95,
            source: 'user'
          }
        ]
      }
    },
    {
      user_id: 'user-smoke',
      app_name: 'hris',
      text: 'siapa saya',
      language: 'id',
      attributes: {}
    } as PipelineInput,
    'Ardi Mahendra',
    'id',
    { emotion: { emotion: 'neutral', confidence: 1, intensity: 0, signals: [], language: 'id' } }
  );

  assert.equal(response, 'Anda adalah Ardi Mahendra. Jika ada informasi lain yang ingin Anda cek, saya siap bantu.');
  assert.equal(response.includes('Name:'), false);

  console.log('[UserProfile Naturalization Smoke] All checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error('[UserProfile Naturalization Smoke] Failed');
  console.error(error);
  process.exit(1);
});
