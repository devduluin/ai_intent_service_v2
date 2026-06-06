import assert from 'node:assert/strict';
import { offerGenerationService } from '../src/services/offer-generation.service';
import { OfferResolver } from '../src/services/cores/resolvers/offer.resolver';
import { workingMemoryService } from '../src/services/workingMemory.service';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { toolService } from '../src/services/tools.service';
import type { ActiveOffer } from '../src/types/active-offer.types';
import type { PipelineInput } from '../src/types';
import type { InternalSkillMetadata } from '../src/types/internal-skill.types';

const input: PipelineInput = {
  user_id: `active_offer_${Date.now()}`,
  app_name: 'hris',
  text: 'tampilkan data kendaraan hari ini',
  language: 'Indonesia',
  attributes: {}
};

function registerSkills() {
  const dataAnalyzer: InternalSkillMetadata = {
    name: 'Data Analyzer',
    slug: 'data_analyzer',
    description: 'Analyze data',
    handlerKey: 'activeOfferDataAnalyzer',
    category: 'test',
    capabilities: {
      actionTypes: ['analyze'],
      outputFormats: ['analysis'],
      triggers: ['analisa'],
      requiresData: true
    },
    paramSchema: []
  };

  const xls: InternalSkillMetadata = {
    name: 'XLS Generator',
    slug: 'xls_generator',
    description: 'Export data',
    handlerKey: 'activeOfferXls',
    category: 'test',
    capabilities: {
      actionTypes: ['export'],
      outputFormats: ['xlsx'],
      triggers: ['excel'],
      requiresData: true
    },
    paramSchema: []
  };

  const greeting: InternalSkillMetadata = {
    name: 'Greeting',
    slug: 'greeting',
    description: 'Greeting and capabilities',
    handlerKey: 'activeOfferGreeting',
    category: 'utilities',
    capabilities: {
      actionTypes: ['greeting', 'capability'],
      outputFormats: ['message', 'capability_list'],
      triggers: ['halo', 'kemampuan'],
      requiresData: false
    },
    paramSchema: [
      {
        name: 'show_skills',
        type: 'boolean',
        description: 'Show skills',
        isRequired: false,
        defaultValue: false
      }
    ]
  };

  const dataSource: InternalSkillMetadata = {
    name: 'Phase 7 Data Source',
    slug: 'phase7_data_source',
    description: 'Produces data for active offer smoke',
    handlerKey: 'activeOfferDataSource',
    category: 'test',
    capabilities: {
      actionTypes: ['query'],
      outputFormats: ['json'],
      triggers: ['data'],
      requiresData: true
    },
    paramSchema: []
  };

  skillsRegistry.registerSkill(dataAnalyzer, async params => ({ ok: true, data: params.data }));
  skillsRegistry.registerSkill(xls, async params => ({ ok: true, data: params.data }));
  skillsRegistry.registerSkill(greeting, async params => ({ ok: true, show_skills: params.show_skills }));
  skillsRegistry.registerSkill(dataSource, async () => ({ rows: [{ id: 1 }] }));
}

function buildOffer(overrides: Partial<ActiveOffer> = {}): ActiveOffer {
  const now = Date.now();
  return {
    id: `offer_test_${now}`,
    status: 'active',
    type: 'analyze_result',
    label: 'Analisis ringkas data ini',
    reason: 'Test offer',
    source: {
      resource: 'tool',
      key: 'get_vehicle_assignment'
    },
    target: {
      resource: 'skill',
      key: 'data_analyzer',
      paramsPatch: { data: { rows: [{ id: 1 }] } },
      inheritParams: true,
      dependsOnLastResult: true
    },
    expectedAnswer: 'boolean',
    confidence: 0.8,
    safety: {
      requiresConfirmation: true,
      sideEffectLevel: 'none'
    },
    expiresAt: now + 60_000,
    createdAt: now,
    ...overrides
  };
}

async function testOfferMemoryLifecycle() {
  const offer = buildOffer();
  await workingMemoryService.update(input.user_id, input.app_name, {
    activeIntent: 'vehicles',
    activeTool: 'get_vehicle_assignment'
  });

  await workingMemoryService.setActiveOffer(input.user_id, input.app_name, offer);
  let memory = await workingMemoryService.get(input.user_id, input.app_name);
  assert.equal(memory?.activeOffer?.status, 'active');

  await workingMemoryService.updateActiveOfferStatus(input.user_id, input.app_name, 'accepted');
  memory = await workingMemoryService.get(input.user_id, input.app_name);
  assert.equal(memory?.activeOffer, null);
  assert.equal(memory?.offerHistory?.[0]?.status, 'accepted');
}

async function testOfferResolverAcceptRejectExpired() {
  const resolver = new OfferResolver();
  const offer = buildOffer();

  const accepted = await resolver.resolve({ ...input, text: 'ya' }, {
    activeOffer: offer,
    activeEntities: { company_id: 'company-1' }
  });

  assert.equal(accepted.isOfferResponse, true);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.plan?.tasks[0].resource, 'skill');
  assert.equal(accepted.params?.company_id, 'company-1');

  const acceptedPhrase = await resolver.resolve({ ...input, text: 'ya tampilkan' }, {
    activeOffer: offer,
    activeEntities: { company_id: 'company-1' }
  });

  assert.equal(acceptedPhrase.isOfferResponse, true);
  assert.equal(acceptedPhrase.accepted, true);

  const acceptedTypoPhrase = await resolver.resolve({ ...input, text: 'iy tampilkan' }, {
    activeOffer: offer,
    activeEntities: { company_id: 'company-1' }
  });

  assert.equal(acceptedTypoPhrase.isOfferResponse, true);
  assert.equal(acceptedTypoPhrase.accepted, true);

  const rejected = await resolver.resolve({ ...input, text: 'tidak' }, { activeOffer: offer });
  assert.equal(rejected.isOfferResponse, true);
  assert.equal(rejected.accepted, false);

  const expired = await resolver.resolve({ ...input, text: 'ya' }, {
    activeOffer: buildOffer({ expiresAt: Date.now() - 1 })
  });
  assert.equal(expired.isOfferResponse, false);
  assert.equal(expired.expired, true);
  assert.equal(expired.shouldExecute, false);

  const unrelated = await resolver.resolve({ ...input, text: 'tampilkan data kendaraan hari ini' }, {
    activeOffer: offer
  });
  assert.equal(unrelated.isOfferResponse, false);

  const unrelatedReminder = await resolver.resolve({
    ...input,
    text: 'buat reminder saya harus meeting dengan bapak rusdi jam 3:50 sore ini'
  }, {
    activeOffer: buildOffer({
      type: 'show_capabilities',
      label: 'Tampilkan hal-hal yang bisa saya bantu',
      target: {
        resource: 'skill',
        key: 'greeting',
        paramsPatch: { show_skills: true }
      }
    })
  });
  assert.equal(unrelatedReminder.isOfferResponse, false);

  const clearSearchOffer = buildOffer({
    target: {
      ...offer.target,
      paramsPatch: { status: 'leave' },
      clearParams: ['search']
    }
  });
  const acceptedWithoutSearch = await resolver.resolve({ ...input, text: 'ya' }, {
    activeOffer: clearSearchOffer,
    activeEntities: {
      company_id: 'company-1',
      date: '2026-05-31',
      status: 'exit',
      search: 'kendaan yang'
    }
  });
  assert.equal(acceptedWithoutSearch.params?.search, undefined);
  assert.equal(acceptedWithoutSearch.params?.status, 'leave');
}

async function testOfferGenerationAnalyzeOnly() {
  const result = await offerGenerationService.generate({
    input,
    plan: {
      mode: 'single_step',
      chat: false,
      tasks: [
        {
          id: '1',
          resource: 'skill',
          key: 'phase7_data_source',
          depends_on: []
        }
      ]
    },
    params: {},
    results: {
      phase7_data_source: {
        rows: [{ id: 1 }]
      }
    },
    executedTasks: [
      {
        key: 'phase7_data_source',
        resource: 'skill'
      }
    ]
  });

  assert.equal(result.selectedOffer?.status, 'active');
  assert.equal(result.selectedOffer?.type, 'analyze_result');
  assert.equal(result.selectedOffer?.target.key, 'data_analyzer');
}

async function testGreetingOfferUsesCapabilitiesNotAnalyze() {
  const result = await offerGenerationService.generate({
    input: { ...input, text: 'halo' },
    plan: {
      mode: 'single_step',
      chat: false,
      tasks: [
        {
          id: '1',
          resource: 'skill',
          key: 'greeting',
          depends_on: []
        }
      ]
    },
    params: {},
    results: {
      greeting: {
        kind: 'greeting',
        recommendation: {
          offerCapabilityList: true,
          suggestedUserText: 'lihat kemampuan yang tersedia'
        }
      }
    },
    executedTasks: [
      {
        key: 'greeting',
        resource: 'skill'
      }
    ]
  });

  assert.equal(result.selectedOffer?.type, 'show_capabilities');
  assert.equal(result.selectedOffer?.target.key, 'greeting');
  assert.equal(result.selectedOffer?.target.paramsPatch?.show_skills, true);
}

async function testOfferGenerationFromEmptyRowsWithSummary() {
  const originalGetToolsBySlugs = toolService.getToolsBySlugs.bind(toolService);
  (toolService as any).getToolsBySlugs = async () => [
    {
      id: 'tool-vehicle',
      name: 'Vehicle Assignment',
      slug: 'get_vehicle_assignment',
      description: 'Vehicle assignment',
      method: 'GET',
      url: 'https://example.test',
      isActive: true,
      parameters: [
        {
          name: 'status',
          type: 'select',
          description: 'Status',
          isRequired: true,
          config: {
            options: [
              { label: 'Active', value: 'active' },
              { label: 'Leave', value: 'leave' },
              { label: 'Exit', value: 'exit' },
              { label: 'Suspend', value: 'suspend' }
            ]
          }
        }
      ]
    }
  ];

  try {
    const result = await offerGenerationService.generate({
      input,
      plan: {
        mode: 'single_step',
        chat: false,
        tasks: [
          {
            id: '1',
            resource: 'tool',
            key: 'get_vehicle_assignment',
            depends_on: []
          }
        ]
      },
      params: {
        status: 'exit',
        date: '2026-05-31'
      },
      results: {
        get_vehicle_assignment: {
          date: '2026-05-31',
          filter: { status: 'exit' },
          summary: {
            active: 0,
            exit: 0,
            leave: 28,
            suspend: 0
          },
          vehicle_assignment: []
        }
      },
      executedTasks: [
        {
          key: 'get_vehicle_assignment',
          resource: 'tool',
          toolSlug: 'get_vehicle_assignment'
        }
      ]
    });

    assert.equal(result.selectedOffer?.type, 'refine_param');
    assert.equal(result.selectedOffer?.target.key, 'get_vehicle_assignment');
    assert.equal(result.selectedOffer?.target.paramsPatch?.status, 'leave');
    assert.deepEqual(result.selectedOffer?.target.clearParams, ['search']);
    assert.equal(result.selectedOffer?.suggestedText, 'Mau saya tampilkan data dengan status leave?');
  } finally {
    (toolService as any).getToolsBySlugs = originalGetToolsBySlugs;
  }
}

async function main() {
  registerSkills();
  await testOfferMemoryLifecycle();
  await testOfferResolverAcceptRejectExpired();
  await testOfferGenerationAnalyzeOnly();
  await testGreetingOfferUsesCapabilitiesNotAnalyze();
  await testOfferGenerationFromEmptyRowsWithSummary();
  console.log('[ActiveOffer Smoke] All checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error('[ActiveOffer Smoke] Failed');
  console.error(error);
  process.exit(1);
});
