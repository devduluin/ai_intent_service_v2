export interface ILlmModel {
  id: string

  name: string
  provider: string
  modelCode: string

  temperature?: number
  contextWindow?: number | null
  maxOutputTokens?: number | null

  costPer1kInput?: number | null
  costPer1kOutput?: number | null

  isActive: boolean

  metadata?: Record<string, any> | null

  createdAt?: Date
  updatedAt?: Date
}

export interface ILlmModelCreateInput {
  name: string
  provider: string
  modelCode: string

  contextWindow?: number
  maxOutputTokens?: number

  costPer1kInput?: number
  costPer1kOutput?: number

  metadata?: Record<string, any>
  isActive?: boolean
}

export interface ILlmModelUpdateInput {
  name?: string
  provider?: string
  modelCode?: string

  contextWindow?: number | null
  maxOutputTokens?: number | null

  costPer1kInput?: number | null
  costPer1kOutput?: number | null

  metadata?: Record<string, any> | null
  isActive?: boolean
}