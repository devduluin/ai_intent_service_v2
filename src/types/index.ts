// ============================================================
// Core Types
// ============================================================
export type ExecutionType =
  | 'handler'
  | 'llm'

export type Agent = {
  id: string
  name: string
  slug: string
  description?: string | null
  isActive: boolean
  metadata?: Record<string, any> | null
  createdAt?: Date
  updatedAt?: Date
}

export interface Tool {
  id: string
  name: string
  slug: string
  description: string | null
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  authType?: 'none' | 'bearer' | 'api_key'
  headers?: object | null
  bodyTemplate?: object | null
  isActive: boolean
  createdAt?: Date
  updatedAt?: Date
  parameters?: ToolParam[]
}

export interface Knowledge {
  id: string
  title: string
  slug: string
  description: string
  type: 'faq' | 'article' | 'policy'
  content: string
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

export interface ToolParam {
  name: string
  type: 'string' | 'number' | 'boolean'
  description: string
  defaultValue?: any
  isRequired: boolean
  extractPrompt?: string    // prompt untuk extract value dari user input
}

export interface ToolMissingParams {
  tool: Tool
  missing: string[]
}

export interface IntentMatch {
  intent: Intent
  score: number             // cosine similarity score (0-1)
  extractedParams?: Record<string, unknown>
}

export interface PlannerInput {
  userText: string
  candidates: {
    tools: string[]           // slug only (backward compatibility)
    knowledge: string[]       // slug only (backward compatibility)
    toolsDetails?: any[]      // full intent objects for tools
    knowledgeDetails?: any[]  // full intent objects for knowledge
  }
  language?: string
}

export interface PlannerOutput {
  handlers?: string[];
  tools: string[];
  knowledge: string[];
  chat: boolean;
}

// ============================================================
// Chat message history
// ============================================================

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

// ============================================================
// INPUT dari Chat Service → AI Intent Service
// ============================================================

export type PipelineInput = {
  user_id: string
  app_name: string
  language?: string
  text: string
  chat_history?: ChatMessage[],
  attributes?: Record<string, unknown>
}

// ============================================================
// OUTPUT ke Chat Service
// ============================================================

export type PipelineResult = {
  intent: string
  score: number
  apiResult: unknown
  naturalResponse: string
  metadata: Record<string, number>
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
  embedModel: string
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
