import type { OllamaConfig } from '../types'
import 'dotenv/config'
// ============================================================
// App Config — baca dari env, fallback ke default
// ============================================================

export const config = {
  // Default provider: 'openai' atau 'ollama'
  default: {
    provider: process.env.DEFAULT_PROVIDER || 'ollama', // atau 'openai'
    numPredict: parseInt(process.env.DEFAULT_NUM_PREDICTIONS ?? '256'),
    temperature: parseFloat(process.env.DEFAULT_TEMPERATURE ?? '0.6'),
    systemPrompt: process.env.DEFAULT_SYSTEM_PROMPT ?? 'Kamu adalah asisten profesional milik pengguna',
  },
  
  server: {
    port: parseInt(process.env.PORT ?? '3000'),
    host: process.env.HOST ?? '0.0.0.0',
    env:  process.env.NODE_ENV ?? 'development',
  },

  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '5432'),
    user: process.env.DB_USER ?? 'postgres',
    pass: process.env.DB_PASS ?? 'postgres',
    name: process.env.DB_NAME ?? 'ai_intent',
    ssl:  process.env.DB_SSL === 'true',
  },

  ollama: {
    baseUrl:    process.env.OLLAMA_BASE_URL    ?? 'http://localhost:11434',
    baseUrlRaw:    process.env.OLLAMA_BASE_URL_RAW    ?? 'http://localhost:11434',
    embedModel: process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text',
    llmModel:   process.env.OLLAMA_LLM_MODEL   ?? 'qwen2.5:1.5b',
    toolCallingModel: process.env.OLLAMA_TOOL_CALLING_MODEL ?? 'functiongemma:latest',
    naturalModel: process.env.OLLAMA_NATURAL_MODEL ?? 'qwen2.5:1.5b',
  } satisfies OllamaConfig,

  alibaba: {
    apiKey: process.env.DASHSCOPE_API_KEY ?? "",
    baseUrl: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    llmModel: process.env.DASHSCOPE_LLM_MODEL ?? "qwen3-8b",  // atau qwen-plus, qwen-max, qwen3-8b
    naturalModel: process.env.DASHSCOPE_NATURAL_MODEL || "qwen3-8b",
    embedModel: process.env.DASHSCOPE_EMBED_MODEL ?? "text-embedding-v3",  // atau text-embedding-v2
  },

  vectorDb: {
    url:        process.env.CHROMA_URL        ?? 'http://localhost:8000',
    collection: process.env.CHROMA_COLLECTION ?? 'intents',
  },

  intent: {
    similarityThreshold: parseFloat(process.env.INTENT_SIMILARITY_THRESHOLD ?? '0.75'),
    topK:                parseInt(process.env.INTENT_TOP_K ?? '3'),
  },
  
  intentDecision: {
    confidentThreshold: parseFloat(process.env.INTENT_CONFIDENT_THRESHOLD ?? '0.75'),
    clarifyThreshold:   parseFloat(process.env.INTENT_CLARIFY_THRESHOLD   ?? '0.55'),
  },

  externalApis: {
    weather: {
      key: process.env.WEATHER_API_KEY ?? '',
      url: process.env.WEATHER_API_URL ?? 'https://api.openweathermap.org/data/2.5',
    },
  },
  
  cache: {
    disableRedis: false,
    enableEmbeddingCache: true,  // Bisa dimatikan untuk development
    embeddingTTL: 3600,          // 1 hour
    maxCacheSize: 1000           // Maximum entries
  },

  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? 'amqp://localhost',
  }

} as const

export type AppConfig = typeof config
