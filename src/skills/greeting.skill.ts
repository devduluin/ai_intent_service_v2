// ============================================================
// GREETING SKILL
// ============================================================
// Context-aware greeting and capability listing.
// ============================================================

import type { PipelineInput } from '../types';
import type { ApiHandlerFn, InternalSkillMetadata, InternalSkillModule } from '../types/internal-skill.types';
import { agentRepository } from '../repositories/agent.repository';
import { intentRepository } from '../repositories/intent.repository';
import { skillsRegistry } from '../services/skills-registry.service';
import { readFileSync } from 'fs';
import { join } from 'path';

// ============================================================
// SKILL METADATA (for auto-discovery)
// ============================================================

export const greetingSkill: InternalSkillMetadata = {
  name: 'Greeting',
  slug: 'greeting',
  description: 'Sapaan, ucapan terimakasih, identitas diri, dan daftar kemampuan yang tersedia',
  handlerKey: 'handleGreeting',
  version: '1.0.0',
  tags: ['greeting', 'welcome', 'utilities', 'capability'],
  category: 'utilities',
  isHidden: false,
  capabilities: {
    actionTypes: ['greeting', 'capability'],
    outputFormats: ['message', 'capability_list'],
    triggers: [
      'siapa anda',
      'siapa kamu',
      'who are you',
      'perkenalkan',
      'introduce',
      'tampilkan',
      'kamu bisa apa',
      'lihat kemampuan',
      'kemampuan lengkap',
      'bantu apa saja',
      'apa saja yang bisa',
      'bisa bantu apa',
      'fitur yang tersedia',
      'layanan yang tersedia',
      'what can you do',
      'show capabilities'
    ],
    context: ['greeting', 'capability_discovery'],
    priority: 9,
    requiresData: false
  },

  paramSchema: [
    {
      name: 'name',
      type: 'string',
      description: 'Nama user untuk personalisasi',
      isRequired: false,
      label: 'Nama',
      order: 1
    },
    {
      name: 'language',
      type: 'select',
      description: 'Bahasa sapaan',
      isRequired: false,
      defaultValue: 'id',
      label: 'Bahasa',
      order: 2,
      config: {
        options: [
          { label: 'Indonesia', value: 'id' },
          { label: 'English', value: 'en' }
        ]
      }
    },
    {
      name: 'show_skills',
      type: 'boolean',
      description: 'Tampilkan daftar kemampuan',
      isRequired: false,
      defaultValue: false,
      label: 'Tampilkan Kemampuan',
      order: 3,
      config: {
        trueValues: ['ya', 'iya', 'boleh', 'lanjut', 'ok', 'oke', 'yes', 'show', 'tampilkan', 'lihat'],
        falseValues: ['tidak', 'nggak', 'gak', 'ga', 'no', 'jangan']
      }
    }
  ]
};

type GreetingInputType = 'greeting' | 'capability_request' | 'thanks' | 'farewell' | 'identity_request' | 'unknown';
type GreetingResponseKind = 'greeting' | 'capability_list' | 'thanks' | 'farewell' | 'identity' | 'fallback';

interface CapabilityOverview {
  agent: {
    name: string;
    description?: string | null;
  } | null;
  skills: Array<{
    slug: string;
    name: string;
    description: string;
    category?: string;
    requiresData?: boolean;
  }>;
  mappedResources: Array<{
    intent: string;
    description: string;
    tools: Array<{ name: string; description?: string | null }>;
    knowledge: Array<{ title: string; description?: string | null }>;
  }>;
}

interface GreetingSkillResponse {
  kind: GreetingResponseKind;
  language: string;
  introduce?: {
    agentName?: string;
    agentDescription?: string | null;
    greeting?: string;
    userName?: string;
  };
  skills?: CapabilityOverview['skills'];
  capabilities?: CapabilityOverview['mappedResources'];
  recommendation: {
    offerCapabilityList: boolean;
    suggestedUserText?: string;
    nextActions: string[];
    messageHints: string[];
  };
}

// ============================================================
// HANDLER IMPLEMENTATION
// ============================================================

export const handleGreeting: ApiHandlerFn = async (params, context: PipelineInput) => {
  const userName = (params?.name as string) || (context?.attributes?.name as string) || '';
  const language = (params?.language as string) || (context?.attributes?.language as string) || 'id';
  const showCapabilities =
    Boolean(params?.show_skills) ||
    Boolean(params?.show_capabilities) ||
    Boolean(context?.attributes?.show_skills) ||
    Boolean(context?.attributes?.show_capabilities);
  const inputType = detectGreetingInput(context?.text || '');

  const overview = await getCapabilityOverview(context);

  if (showCapabilities || inputType === 'capability_request') {
    return buildCapabilityResponse(overview, language);
  }

  if (inputType === 'thanks') {
    return buildSimpleResponse('thanks', language, overview, [
      language === 'id'
        ? 'Sama-sama.'
        : 'You are welcome.',
      language === 'id'
        ? 'Saya siap membantu jika ada kebutuhan lain.'
        : 'I am ready to help if you need anything else.'
    ]);
  }

  if (inputType === 'farewell') {
    return buildSimpleResponse('farewell', language, overview, [
      language === 'id'
        ? 'Baik, sampai jumpa.'
        : 'Goodbye.',
      language === 'id'
        ? 'Saya siap membantu lagi kapan saja.'
        : 'I am ready to help again anytime.'
    ]);
  }

  if (inputType === 'identity_request') {
    return buildIdentityResponse(overview, language, userName);
  }

  if (inputType === 'unknown') {
    return buildSimpleResponse('fallback', language, overview, [
      language === 'id'
        ? 'Saya belum menangkap kebutuhan spesifik Anda.'
        : 'I did not catch a specific request.',
      language === 'id'
        ? 'Saya bisa menjalankan tool, membaca knowledge, atau memakai skill internal.'
        : 'I can run tools, read knowledge, or use internal skills.'
    ]);
  }

  return buildGreetingResponse({
    greetingType: getGreetingType(new Date()),
    userName,
    language,
    isFirstInteraction: checkFirstInteraction(context),
    skillsCount: overview.skills.length,
    agent: overview.agent
  });
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getGreetingType(date: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 15) return 'afternoon';
  if (hour >= 15 && hour < 19) return 'evening';
  return 'night';
}

function checkFirstInteraction(context: any): boolean {
  if (context?.attributes?.isFirstInteraction === true) {
    return true;
  }

  const chatHistory = context?.chat_history || context?.attributes?.chat_history;
  if (Array.isArray(chatHistory) && chatHistory.length > 0) {
    return false;
  }

  return true;
}

async function getCapabilityOverview(context?: PipelineInput): Promise<CapabilityOverview> {
  const skills = skillsRegistry
    .getAllSkills({ includeHidden: false })
    .filter(skill => skill.slug !== 'greeting')
    .map(skill => ({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      requiresData: skill.capabilities?.requiresData
    }));

  const agent = context?.app_name
    ? await agentRepository.findBySlug(context.app_name)
    : null;
  const intents = await intentRepository.findAllActive({ agentId: agent?.id ?? null });

  const mappedResources = intents
    .filter(intent => !['greeting', 'utilities'].includes(intent.slug))
    .map(intent => ({
      intent: intent.slug,
      description: intent.description || intent.name || intent.slug,
      tools: (intent.tools || [])
        .map((mapping: any) => mapping.tool)
        .filter(Boolean)
        .map((tool: any) => ({
          name: tool.name || formatDisplayName(tool.slug),
          description: tool.description || null
        })),
      knowledge: (intent.knowledge || [])
        .map((mapping: any) => mapping.knowledge)
        .filter(Boolean)
        .map((knowledge: any) => ({
          title: knowledge.title || formatDisplayName(knowledge.slug),
          description: knowledge.description || null
        }))
    }))
    .filter(item => item.tools.length > 0 || item.knowledge.length > 0);

  return {
    agent: agent
      ? {
          name: agent.name,
          description: agent.description
        }
      : null,
    skills,
    mappedResources
  };
}

function buildCapabilityResponse(overview: CapabilityOverview, language: string): GreetingSkillResponse {
  return {
    kind: 'capability_list',
    language,
    skills: overview.skills,
    capabilities: overview.mappedResources,
    recommendation: {
      offerCapabilityList: false,
      nextActions: [
        language === 'id'
          ? 'User dapat langsung mengajukan kebutuhan operasional.'
          : 'User can directly ask an operational request.',
        language === 'id'
          ? 'Pilih tool, knowledge, atau skill yang relevan berdasarkan query berikutnya.'
          : 'Choose the relevant tool, knowledge, or skill for the next query.'
      ],
      messageHints: [
        language === 'id'
          ? 'Tampilkan kemampuan secara ringkas dan mudah dipahami.'
          : 'Present capabilities concisely and clearly.',
        language === 'id'
          ? 'Jangan tampilkan slug internal sebagai label utama.'
          : 'Do not use internal slugs as primary labels.'
      ]
    }
  };
}

function buildIdentityResponse(
  overview: CapabilityOverview,
  language: string,
  userName?: string
): GreetingSkillResponse {
  // Read VIPER identity document
  let identityDoc = '';
  try {
    identityDoc = readFileSync(join(__dirname, '..', '..', 'VIPER-IDENTITY.md'), 'utf-8');
  } catch {
    identityDoc = `Saya VIPER, asisten AI untuk ${overview.agent?.name || 'operasional perusahaan'}.`;
  }

  const greeting = userName
    ? (language === 'id' ? `Halo ${userName}!` : `Hello ${userName}!`)
    : '';

  return {
    kind: 'identity',
    language,
    introduce: {
      agentName: overview.agent?.name,
      agentDescription: overview.agent?.description,
      greeting,
      userName,
    },
    recommendation: {
      offerCapabilityList: true,
      suggestedUserText: language === 'id' ? 'apa yang bisa kamu bantu?' : 'what can you help with?',
      nextActions: [
        language === 'id'
          ? 'Jawab dengan ringkas berdasarkan dokumen identitas VIPER.'
          : 'Answer concisely based on the VIPER identity document.',
        language === 'id'
          ? 'Personalisasi dengan nama user jika tersedia.'
          : 'Personalize with user name if available.',
      ],
      messageHints: [
        language === 'id' ? identityDoc : identityDoc,
        `Nama agent: ${overview.agent?.name || 'VIPER'}`,
        `Skills tersedia: ${overview.skills.length}`,
        `Intents: ${overview.mappedResources.length}`,
        greeting,
      ],
    },
  };
}

function buildSimpleResponse(
  kind: GreetingResponseKind,
  language: string,
  overview: CapabilityOverview,
  messageHints: string[]
): GreetingSkillResponse {
  return {
    kind,
    language,
    introduce: {
      agentName: overview.agent?.name,
      agentDescription: overview.agent?.description
    },
    recommendation: {
      offerCapabilityList: kind === 'fallback',
      suggestedUserText: kind === 'fallback'
        ? (language === 'id' ? 'lihat kemampuan yang tersedia' : 'show available capabilities')
        : undefined,
      nextActions: [
        language === 'id'
          ? 'Beri respons singkat dan natural.'
          : 'Respond briefly and naturally.'
      ],
      messageHints
    }
  };
}

function buildGreetingResponse(options: {
  greetingType: 'morning' | 'afternoon' | 'evening' | 'night';
  userName: string;
  language: string;
  isFirstInteraction: boolean;
  skillsCount: number;
  agent: CapabilityOverview['agent'];
}): GreetingSkillResponse {
  const { greetingType, userName, language, skillsCount, agent } = options;
  const templates = getGreetingTemplates(language);
  const greetingText = templates[greetingType][Math.floor(Math.random() * templates[greetingType].length)];
  const prompt = getHelpfulPrompts(language)[Math.floor(Math.random() * getHelpfulPrompts(language).length)];

  return {
    kind: 'greeting',
    language,
    introduce: {
      agentName: agent?.name,
      agentDescription: agent?.description,
      greeting: greetingText,
      userName: userName && !['anonymous', 'guest'].includes(userName) ? userName : undefined
    },
    recommendation: {
      offerCapabilityList: skillsCount > 0,
      suggestedUserText: language === 'id' ? 'lihat kemampuan yang tersedia' : 'show available capabilities',
      nextActions: [
        language === 'id'
          ? 'Tawarkan user untuk melihat daftar kemampuan dengan bahasa natural.'
          : 'Offer the user to view available capabilities.',
        language === 'id'
          ? 'User juga boleh langsung menulis kebutuhan spesifik.'
          : 'User may also write a specific request directly.'
      ],
      messageHints: [
        greetingText,
        prompt,
        language === 'id'
          ? 'Perkenalkan agent jika agentName tersedia.'
          : 'Introduce the agent if agentName is available.',
        language === 'id'
          ? 'Gunakan ajakan natural seperti: "Mau saya tampilkan hal-hal yang bisa saya bantu?"'
          : 'Use a natural offer such as: "Would you like me to show what I can help with?"'
      ]
    }
  };
}

function getGreetingTemplates(language: string): Record<string, string[]> {
  if (language === 'id') {
    return {
      morning: ['Selamat pagi!', 'Pagi yang cerah!', 'Halo, selamat pagi!'],
      afternoon: ['Selamat siang!', 'Halo, selamat siang!'],
      evening: ['Selamat sore!', 'Halo, selamat sore!'],
      night: ['Selamat malam!', 'Halo, selamat malam!']
    };
  }

  return {
    morning: ['Good morning!', 'Hello, good morning!'],
    afternoon: ['Good afternoon!', 'Hello, good afternoon!'],
    evening: ['Good evening!', 'Hello, good evening!'],
    night: ['Good evening!', 'Hello, good evening!']
  };
}

function getHelpfulPrompts(language: string): string[] {
  if (language === 'id') {
    return [
      'Anda juga bisa langsung menulis kebutuhan Anda.',
      'Silakan sampaikan kebutuhan Anda.',
      'Mau lanjut dengan kebutuhan tertentu?'
    ];
  }

  return [
    'You can also write your request directly.',
    'Please let me know what you need.',
    'Would you like to continue with a specific request?'
  ];
}

function getFollowUpPrompts(language: string): string[] {
  if (language === 'id') {
    return [
      'Ada yang bisa saya bantu lagi?',
      'Silakan lanjutkan.',
      'Apa yang ingin Anda tanyakan?'
    ];
  }

  return [
    'How can I help you further?',
    'Please go ahead.',
    'What would you like to ask?'
  ];
}

function detectGreetingInput(query: string): GreetingInputType {
  const normalized = normalizeText(query);
  if (!normalized) return 'greeting';

  if (matchesCapabilityTrigger(normalized)) {
    return 'capability_request';
  }

  if (/(kamu|anda|you).{0,20}(bisa apa|bisa ngapain|kemampuan|capabilit|skill|fitur)/.test(normalized)) {
    return 'capability_request';
  }

  if (/(lihat|tampilkan|show|daftar).{0,20}(kemampuan|capabilit|skill|fitur)/.test(normalized)) {
    return 'capability_request';
  }

  if (/^(bisa apa|kemampuanmu|capabilities|what can you do)$/.test(normalized)) {
    return 'capability_request';
  }

  if (/(apa|lihat|tampilkan|daftar)?.{0,20}(kemampuan lengkap|kemampuanmu|kemampuan kamu|kemampuan anda|fitur lengkap)/.test(normalized)) {
    return 'capability_request';
  }

  if (/(bantu apa saja|apa saja yang bisa|bisa bantu apa|hal apa saja|fitur yang tersedia|layanan yang tersedia)/.test(normalized)) {
    return 'capability_request';
  }

  if (/^(?:(?:ok|oke|okay|baik|alright)\s+)?(terima kasih|terimakasih|makasih|makasi|thanks|thank you|thankyou|tq|thx)$/.test(normalized)) {
    return 'thanks';
  }

  if (/^(bye|goodbye|sampai jumpa|sampai nanti|see you|see ya)$/.test(normalized)) {
    return 'farewell';
  }

  // Identity questions — who are you, how do you work, what's your architecture
  if (/\b(siapa\s+(anda|kamu|ini|lo|elu|gue|saya)|who\s+(are|is)\s+(you|this)|what\s+are\s+you|kamu\s+(itu|siapa|ini)|anda\s+(itu|siapa|ini))\b/i.test(normalized)) {
    return 'identity_request';
  }
  if (/\b(bagaimana|gimana|how)\s+(anda|kamu|lo|elu|you)\s+(didesain|dibangun|dibuat|bekerja|kerja|designed|built|made|work|function|arsitektur|architecture)\b/i.test(normalized)) {
    return 'identity_request';
  }
  if (/\b(bagaimana|gimana|how)\s+.+\s+(anda|kamu|you)\b/i.test(normalized)) {
    return 'identity_request';
  }
  if (/\b(jelaskan|jelasin|explain|describe|tell me about)\s+(dirimu|dirinya|tentang kamu|tentang anda|tentang dirimu|arsitekturmu|arsitektur anda|yourself|your architecture|how you)\b/i.test(normalized)) {
    return 'identity_request';
  }
  if (/\b(apakah\s+(anda|kamu|lo|elu)\s+(manusia|robot|ai|bot|asli|nyata|program)|are\s+you\s+(human|real|a robot|ai|a bot))\b/i.test(normalized)) {
    return 'identity_request';
  }
  if (/^(siapa kamu|siapa anda|who are you|what are you|kenalan dong|introduce yourself|perkenalkan dirimu|ceritakan tentang dirimu|tell me about yourself)$/i.test(normalized)) {
    return 'identity_request';
  }
  // Self-capability: "apa anda punya memory?", "apa isi memory anda?", "kamu bisa ingat?"
  if (/\b(apa|apakah)\s+(anda|kamu|lo|elu)\s+(punya|bisa|memiliki|mempunyai|have|has|can)\s+(memory|ingatan|konteks|riwayat|sejarah|context|history|kemampuan|capabilit)/i.test(normalized)) {
    return 'identity_request';
  }
  if (/\b(kamu|anda|you)\s+(punya|bisa|memiliki|mempunyai|have|has|can)\s+(memory|ingatan|konteks|riwayat|sejarah|context|history)\b/i.test(normalized)) {
    return 'identity_request';
  }
  // "apa isi memory anda?", "apa wujud kemampuanmu?", "apa ingatanmu?"
  if (/\b(apa|apakah|what)\s+(wujud|bentuk|kemampuan|kapabilitas|contents?|capabilit)\s+(anda|kamu|mu|lo|elu|you|your)\b/i.test(normalized)) {
    return 'identity_request';
  }

  if (/^(halo|hai|hei|hello|hi|pagi|siang|sore|malam|selamat pagi|selamat siang|selamat sore|selamat malam|apa kabar)$/.test(normalized)) {
    return 'greeting';
  }

  return 'unknown';
}

function matchesCapabilityTrigger(normalizedQuery: string): boolean {
  const triggers = greetingSkill.capabilities?.triggers || [];

  return triggers
    .map(trigger => normalizeText(trigger))
    .filter(Boolean)
    .some(trigger => normalizedQuery.includes(trigger));
}

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function formatDisplayName(slug: string): string {
  return slug
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ============================================================
// DEFAULT EXPORT (for auto-discovery)
// ============================================================

export default {
  metadata: greetingSkill,
  handler: handleGreeting
} as InternalSkillModule;
