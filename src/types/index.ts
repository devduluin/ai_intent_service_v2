import type { Agent } from './agent.types'
import type { PlannerOutput, RecentUsageHints } from './planner.types'  // ✅ ADDED RecentUsageHints
import type { EpisodicMemory } from './episodic-memory.types';
import type { SkillSignal } from '../services/skill-signal.service';
export * from './automation.types';
export * from './confirmation.types';
export * from './perception.types';
export * from './user-profile.types';
export * from './self-correction.types';
// ============================================================
// Core Types
// ============================================================
export type ExecutionType =
  | 'llm'

export interface Tool {
  id: string

  name: string
  slug: string
  description: string | null

  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string

  authType?: 'none' | 'bearer' | 'api_key'

  headers?: Record<string, any> | null
  bodyTemplate?: Record<string, any> | null
  tags?: string[] | null

  isActive: boolean

  // 🧠 NEW: response transformation layer
  responseMapping?: ToolResponseMapping | null

  // 🧠 NEW: agent access control
  allowedAgentDelegates?: string[]

  createdAt?: Date
  updatedAt?: Date

  parameters?: ToolParam[]
}

export interface ToolResponseMapping {
  successPath?: string
  messagePath?: string
  dataPath?: string
}

export interface Knowledge {
  id: string
  title: string
  slug: string
  description: string
  type: 'faq' | 'article' | 'policy'
  content: string
  tags?: string[] | null
  isActive: boolean
  ingestionStatus: 'idle' | 'processing' | 'completed' | 'failed'
  lastIngestedAt?: Date | null
}

export interface IntentExample {
  id: string
  intentId: string
  text: string
  language: string
}

export interface Intent {
  id: string
  name: string
  slug: string
  description: string
  agentId: string

  executionType: ExecutionType

  handlerKey?: string

  examples: string[]

  // FROM MAPPING TABLE (NOT DIRECT RELATION)
  tools?: IntentToolMapping[]
  knowledge?: IntentKnowledgeMapping[]

  agent?: Agent | null
}

export interface IntentToolMapping {
  id: string
  tool: Tool
  priority: number
  isPrimary: boolean
  parameters?: ToolParam[]
}

export interface IntentKnowledgeMapping {
  id: string
  knowledge: Knowledge
  priority: number
}

export interface ToolParamConfig {
  options?: Array<{ label: string; value: string }>
  format?: string
  allowRelative?: boolean
  minDate?: string
  maxDate?: string
  min?: number
  max?: number
  step?: number
  unit?: string
  pattern?: string
  minLength?: number
  maxLength?: number
  placeholder?: string
  [key: string]: any
}

export interface ToolParam {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect' | 'text' | 'email' | 'phone'
  description: string
  defaultValue?: any
  isRequired: boolean
  extractPrompt?: string    // prompt untuk extract value dari user input
  label?: string            // UI display name
  config?: ToolParamConfig  // validation rules and UI config
  order?: number            // display order
  isHidden?: boolean        // hide from user
}

export interface ToolMissingParams {
  tool: Tool
  missing: string[]
}

export type ParamResourceType = 'tool' | 'skill'

export interface ResourceParamOwner {
  resource: ParamResourceType
  key: string
  name: string
  description?: string | null
  params: ToolParam[]
}

export interface ResourceMissingParams {
  resource: ParamResourceType
  key: string
  name?: string
  missing: string[]
  params?: ToolParam[]
}

export interface IntentMatch {
  intent: Intent
  score: number             // cosine similarity score (0-1)
  extractedParams?: Record<string, unknown>
  metadata?: {
    fallbackReason?: string;
    originalQuery?: string;
    [key: string]: any;
  }
}

export interface PlannerInput {
  input: PipelineInput
  candidates: {
    skills?: string[]        // slug only (internal skills)
    tools: string[]           // slug only (backward compatibility)
    knowledge: string[]
    skillsDetails?: any[]      // internal skill metadata/candidates
    toolsDetails?: any[]      // full intent objects for tools
    knowledgeDetails?: any[]  // full intent objects for knowledge
  }

  episodicMemory?: EpisodicMemory | null
  skillSignal?: SkillSignal
  perceptionFrame?: import('./perception.types').PerceptionFrame | null
  // C-009 FIX: Optional resource recommendation from confidence decision
  recommendedResource?: 'tool' | 'skill' | 'knowledge'
}

export interface RecentPlannerInput {
  tools?: string[];
  knowledge?: string[];
  chat: boolean;
}

// ============================================================
// Chat message history
// ============================================================

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// ============================================================
// INPUT dari Chat Service → AI Intent Service
// ============================================================

export interface TemporalContext {
  type: 'day' | 'week' | 'month' | 'year' | 'quarter' | 'period' | 'date' | 'relative'
  value: string           // Original text (e.g., "bulan lalu")
  resolvedValue: string   // Exact value (e.g., "April 2026")
  startDate?: string      // ISO date string
  endDate?: string        // ISO date string
  direction: 'current' | 'past' | 'future'
}

export type PipelineInput = {
  user_id: string
  app_name: string
  language?: string
  text: string
  chat_history?: ChatMessage[],
  attributes?: Record<string, unknown>
  temporalContext?: TemporalContext[]  // Extracted temporal expressions with resolved dates
  entityContext?: string[]              // Extracted entities (locations, names, etc.)
}

// ============================================================
// OUTPUT ke Chat Service
// ============================================================

export interface PipelineExecutedTaskDetail {
  key: string
  resource: 'tool' | 'skill' | 'knowledge'
  toolSlug?: string
}

export interface PipelineMetadata {
  durationMs?: number
  totalTime?: number
  executedTasks?: number
  totalTasks?: number
  executedTasksDetails?: PipelineExecutedTaskDetail[]
  activePlan?: PlannerOutput | null
  resolvedParams?: Record<string, unknown>
  missingParams?: ToolMissingParams[]
  missingResourceParams?: ResourceMissingParams[]
  resourceParams?: ResourceParamOwner[]
  collectedParams?: Record<string, unknown>
  intentSlugs?: string[]
  originalPlan?: PlannerOutput
  fallbackToChat?: number
  hasCachedContext?: boolean
  memoryUpdateOwner?: string
  [key: string]: unknown
}

export type PipelineResult = {
  intent: string
  score: number
  apiResult: unknown
  naturalResponse: string
  metadata: PipelineMetadata
}

export interface PipelineError {
  stage: 'embed' | 'match' | 'api' | 'naturalize' | 'unknown'
  message: string
  details?: unknown
}

// ============================================================
// API Handler Types
// ============================================================

export type ApiHandlerFn = (
  params: Record<string, unknown>,
  ctx: IntentRequest
) => Promise<unknown>

// ============================================================
// Ollama Types
// ============================================================

export interface EmbedResponse {
  embedding: number[]
  model: string
}

export interface OllamaConfig {
  baseUrl: string
  baseUrlRaw: string
  embedModel: string
  toolCallingModel: string
  llmModel: string
  naturalModel?: string
}

// ============================================================
// Request / Response Schemas
// ============================================================

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error'
  services: {
    ollama: boolean
    vectorDb: boolean
  }
  uptime: number
  timestamp: string
}


// ============================================================
// HTTP REQUEST dari Chat Service → Intent Service
// ============================================================

export interface IntentRequest {
  user_id: string
  app_name: string
  text: string
  chat_history?: ChatMessage[]
  attributes?: Record<string, unknown>
}

// ============================================================
// HTTP RESPONSE ke Chat Service
// ============================================================

export interface IntentResponse {
  success: boolean
  response: string
  intent?: string
  confidence?: number
  metadata?: PipelineResult['metadata']
}

export type ConversationStatus =
  | 'collecting_params'
  | 'ready_to_execute'

// types/index.ts

// types/index.ts - Update PendingIntentState

export interface PendingIntentState {
  userId: string
  appName: string
  
  isMultiIntent: boolean
  version?: number
  
  // Intent tracking
  intentSlug?: string
  intentSlugs?: string[]
  
  // Parameter collection
  collectedParams: Record<string, unknown>
  
  // Old format (deprecated, keep for backward compatibility)
  missingParams?: string[]
  missingParamsMap?: Array<{ intentSlug: string; toolName?: string; missing: string[] }>
  
  // NEW: Tool-based missing params (primary format)
  missingToolsParams?: Array<{ 
    toolSlug: string
    toolName?: string
    missing: string[]
  }>

  missingResourceParams?: ResourceMissingParams[]

  originalPlan?: PlannerOutput;
  
  // Retry tracking
  retryCount: number
  maxRetry: number
  
  // Timestamps
  createdAt: number
  updatedAt: number
  expiresAt: number
  
  // User context
  lastUserMessage?: string
}


export type bodyKnowledgeSource = {
  knowledgeId: string
  type: 'url' | 'pdf' | 'docx' | 'text'
  content?: string | null
  url?: string | null
  filePath?: string | null
}

