import assert from 'node:assert/strict';
import { OfferResolver } from '../src/services/cores/resolvers/offer.resolver';
import type { ActiveOffer } from '../src/types/active-offer.types';

const offer: ActiveOffer = {
  id: 'offer-smoke',
  status: 'active',
  type: 'show_capabilities',
  label: 'Tampilkan kemampuan yang tersedia',
  reason: 'User baru menyapa dan ditawari melihat kemampuan.',
  source: {
    resource: 'skill',
    key: 'greeting'
  },
  target: {
    resource: 'skill',
    key: 'greeting',
    paramsPatch: {
      show_skills: true
    }
  },
  expectedAnswer: 'boolean',
  confidence: 0.9,
  safety: {
    requiresConfirmation: false,
    sideEffectLevel: 'none'
  },
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000
};

async function main() {
  const resolver = new OfferResolver();

  const accepted = await resolver.resolve(
    {
      user_id: 'state_collision_user',
      app_name: 'hris',
      text: 'ya tampilkan'
    },
    {
      activeOffer: offer
    } as any
  );

  assert.equal(accepted.isOfferResponse, true);
  assert.equal(accepted.accepted, true);

  const newIntent = await resolver.resolve(
    {
      user_id: 'state_collision_user',
      app_name: 'hris',
      text: 'ya tampilkan memori kemarin'
    },
    {
      activeOffer: offer
    } as any
  );

  assert.equal(newIntent.isOfferResponse, false);

  console.log('[PipelineStateCollision Smoke] All checks passed');
}

main().catch(error => {
  console.error('[PipelineStateCollision Smoke] Failed');
  console.error(error);
  process.exit(1);
});
