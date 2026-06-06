import assert from 'node:assert/strict';
import { ExecutionStage } from '../src/services/cores/stages/execution.stage';
import { resourceParamSchemaService } from '../src/services/resource-param-schema.service';
import { skillsRegistry } from '../src/services/skills-registry.service';
import { paramExtractorService } from '../src/services/paramExtractor.service';
import { paramResolutionService } from '../src/services/param-resolution.service';
import { handleGreeting, greetingSkill } from '../src/skills/greeting.skill';
import { agentRepository } from '../src/repositories/agent.repository';
import { intentRepository } from '../src/repositories/intent.repository';
import { normalizeSkillParamToToolParam } from '../src/utils/resource-param-normalizer.util';
import type { PipelineInput } from '../src/types';
import type { PlannerOutput } from '../src/types/planner.types';
import type { InternalSkillMetadata } from '../src/types/internal-skill.types';

const input: PipelineInput = {
  user_id: 'phase7-user',
  app_name: 'hris',
  language: 'Indonesia',
  text: 'phase 7 smoke',
  attributes: {}
};

function registerPhase7Skills() {
  const requiredSkill: InternalSkillMetadata = {
    name: 'Phase 7 Required Skill',
    slug: 'phase7_required_skill',
    description: 'Smoke test skill with one required param',
    handlerKey: 'phase7RequiredHandler',
    category: 'test',
    paramSchema: [
      {
        name: 'required_value',
        type: 'string',
        description: 'Required value',
        isRequired: true,
        label: 'Required Value'
      }
    ]
  };

  const optionalSkill: InternalSkillMetadata = {
    name: 'Phase 7 Optional Skill',
    slug: 'phase7_optional_skill',
    description: 'Smoke test skill with optional param',
    handlerKey: 'phase7OptionalHandler',
    category: 'test',
    paramSchema: [
      {
        name: 'show_skills',
        type: 'boolean',
        description: 'Show skills',
        isRequired: false,
        defaultValue: false,
        label: 'Show Skills'
      }
    ]
  };

  const producerSkill: InternalSkillMetadata = {
    name: 'Phase 7 Producer Skill',
    slug: 'phase7_producer_skill',
    description: 'Produces data for dependency test',
    handlerKey: 'phase7ProducerHandler',
    category: 'test',
    paramSchema: []
  };

  const dataConsumerSkill: InternalSkillMetadata = {
    name: 'Phase 7 Data Consumer Skill',
    slug: 'phase7_data_consumer_skill',
    description: 'Requires data from a dependency',
    handlerKey: 'phase7DataConsumerHandler',
    category: 'test',
    paramSchema: [
      {
        name: 'data',
        type: 'text',
        description: 'Dependency data',
        isRequired: true,
        label: 'Data'
      }
    ]
  };

  skillsRegistry.registerSkill(requiredSkill, async params => ({
    ok: true,
    required_value: params.required_value
  }));

  skillsRegistry.registerSkill(optionalSkill, async params => ({
    ok: true,
    show_skills: params.show_skills ?? false
  }));

  skillsRegistry.registerSkill(producerSkill, async () => ({
    rows: [{ id: 1, status: 'ok' }]
  }));

  skillsRegistry.registerSkill(dataConsumerSkill, async (params, _context, data) => ({
    ok: true,
    dataReceived: (data as any)?.primary,
    paramsHadData: Object.prototype.hasOwnProperty.call(params, 'data')
  }));
}

function mockGreetingRepositories() {
  (agentRepository as any).findBySlug = async () => ({
    id: 'agent-phase7',
    name: 'HRIS System',
    slug: 'hris',
    description: 'Asisten HRIS untuk operasional karyawan',
    isActive: true,
    systemPrompt: null,
    customPrompt: null,
    modelId: null,
    llmModel: null,
    temperature: 0.1,
    maxTokens: null,
    memoryEnabled: false,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  (intentRepository as any).findAllActive = async () => [
    {
      id: 'intent-phase7',
      name: 'Payslip',
      slug: 'payslip',
      description: 'Informasi slip gaji',
      agentId: 'agent-phase7',
      executionType: 'llm',
      examples: [],
      tools: [
        {
          id: 'mapping-tool',
          priority: 1,
          isPrimary: true,
          tool: {
            id: 'tool-phase7',
            name: 'Ambil Slip Gaji',
            slug: 'get_payslip',
            description: 'Mengambil data slip gaji karyawan',
            method: 'GET',
            url: 'https://example.test',
            isActive: true
          }
        }
      ],
      knowledge: [
        {
          id: 'mapping-knowledge',
          priority: 1,
          knowledge: {
            id: 'knowledge-phase7',
            title: 'FAQ Gaji',
            slug: 'salary_faq',
            description: 'Pertanyaan umum tentang gaji',
            type: 'faq',
            content: '',
            isActive: true,
            ingestionStatus: 'completed'
          }
        }
      ]
    }
  ];
}

async function testGreetingOffersCapability() {
  mockGreetingRepositories();
  const result = await handleGreeting({}, { ...input, text: 'halo' }) as any;

  assert.equal(result.kind, 'greeting');
  assert.equal(result.recommendation.offerCapabilityList, true);
  assert.match(result.recommendation.suggestedUserText || '', /kemampuan/);
  assert.equal(result.introduce.agentName, 'HRIS System');
}

async function testDirectCapabilityRequest() {
  mockGreetingRepositories();
  const result = await handleGreeting({}, { ...input, text: 'apa kemampuan lengkapmu' }) as any;

  assert.equal(result.kind, 'capability_list');
  assert.equal(result.recommendation.offerCapabilityList, false);
  assert.ok(Array.isArray(result.capabilities));
}

async function testShowSkillsBooleanSlotAnswer() {
  const showSkillsParam = greetingSkill.paramSchema.find(param => param.name === 'show_skills');
  assert.ok(showSkillsParam);

  const toolParam = normalizeSkillParamToToolParam(showSkillsParam);
  const yesResult = await paramExtractorService.extractAll('ya', [toolParam]);
  const continueResult = await paramExtractorService.extractAll('boleh lanjut', [toolParam]);
  const noResult = await paramExtractorService.extractAll('tidak', [toolParam]);

  assert.equal(yesResult.params.show_skills, true);
  assert.equal(continueResult.params.show_skills, true);
  assert.equal(noResult.params.show_skills, false);
}

async function testSkillMissingParamResolution() {
  const owners = await resourceParamSchemaService.collectOwners([
    {
      id: '1',
      resource: 'skill',
      key: 'phase7_required_skill',
      depends_on: []
    }
  ]);
  const owner = owners[0];
  const missing = owner.params
    .filter(param => param.isRequired)
    .map(param => param.name);

  assert.equal(owner.resource, 'skill');
  assert.equal(owner.key, 'phase7_required_skill');
  assert.deepEqual(missing, ['required_value']);
}

async function testOptionalSkillParamDoesNotAsk() {
  const owners = await resourceParamSchemaService.collectOwners([
    {
      id: '1',
      resource: 'skill',
      key: 'phase7_optional_skill',
      depends_on: []
    }
  ]);
  const missing = owners[0].params
    .filter(param => param.isRequired)
    .map(param => param.name);

  assert.deepEqual(missing, []);
}

async function testSkillExecutionGuardMissing() {
  const stage = new ExecutionStage();
  const plan: PlannerOutput = {
    mode: 'single_step',
    chat: false,
    tasks: [
      {
        id: '1',
        resource: 'skill',
        key: 'phase7_required_skill',
        depends_on: []
      }
    ]
  };

  const result = await stage.execute(plan, input, {}, { cacheResults: false });
  const payload = result.results.phase7_required_skill as { error?: string };

  assert.match(payload.error || '', /Missing required parameters for skill phase7_required_skill/);
}

async function testSkillExecutionGuardComplete() {
  const stage = new ExecutionStage();
  const plan: PlannerOutput = {
    mode: 'single_step',
    chat: false,
    tasks: [
      {
        id: '1',
        resource: 'skill',
        key: 'phase7_required_skill',
        depends_on: []
      }
    ]
  };

  const result = await stage.execute(
    plan,
    input,
    { required_value: 'filled' },
    { cacheResults: false }
  );

  assert.deepEqual(result.results.phase7_required_skill, {
    ok: true,
    required_value: 'filled'
  });
}

async function testDependencyResultMapsToSkillDataParam() {
  const stage = new ExecutionStage();
  const plan: PlannerOutput = {
    mode: 'multi_step',
    chat: false,
    tasks: [
      {
        id: '1',
        resource: 'skill',
        key: 'phase7_producer_skill',
        depends_on: []
      },
      {
        id: '2',
        resource: 'skill',
        key: 'phase7_data_consumer_skill',
        depends_on: ['1']
      }
    ]
  };

  const result = await stage.execute(plan, input, {}, { cacheResults: false });
  const consumerResult = result.results.phase7_data_consumer_skill as {
    ok: boolean;
    dataReceived: unknown;
    paramsHadData: boolean;
  };

  assert.equal(consumerResult.ok, true);
  assert.equal(consumerResult.paramsHadData, false);
  assert.deepEqual(consumerResult.dataReceived, {
    rows: [{ id: 1, status: 'ok' }]
  });
}

async function testDependencyDataDoesNotTriggerSlotFilling() {
  const plan: PlannerOutput = {
    mode: 'multi_step',
    chat: false,
    tasks: [
      {
        id: '1',
        resource: 'skill',
        key: 'phase7_producer_skill',
        depends_on: []
      },
      {
        id: '2',
        resource: 'skill',
        key: 'phase7_data_consumer_skill',
        depends_on: ['1']
      }
    ]
  };

  const resolution = await paramResolutionService.resolve(
    input,
    plan,
    {
      text: input.text,
      hasMultipleIntents: false,
      subQueries: [],
      connectors: [],
      signals: {
        actionHints: [],
        formatHints: [],
        temporalHints: [],
        temporalDetails: [],
        entityHints: [],
        asksForFile: false,
        asksForRealtimeData: false,
        isQuestion: false,
        language: 'id'
      }
    } as any
  );

  assert.deepEqual(resolution.missingResourceParams, []);
  assert.deepEqual(resolution.missingToolsParams, []);
}

async function main() {
  registerPhase7Skills();

  await testGreetingOffersCapability();
  await testDirectCapabilityRequest();
  await testShowSkillsBooleanSlotAnswer();
  await testSkillMissingParamResolution();
  await testOptionalSkillParamDoesNotAsk();
  await testSkillExecutionGuardMissing();
  await testSkillExecutionGuardComplete();
  await testDependencyResultMapsToSkillDataParam();
  await testDependencyDataDoesNotTriggerSlotFilling();

  console.log('[Phase7 Smoke] All skill paramSchema slot filling checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error('[Phase7 Smoke] Failed');
  console.error(error);
  process.exit(1);
});
