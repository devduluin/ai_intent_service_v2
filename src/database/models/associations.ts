import IntentModel from './Intent.model'
import IntentExampleModel from './intent-example.model'
import ToolsParameterModel from './Tools-parameter.model'
import ToolModel from './Tools.model'
import KnowledgeModel from './knowledge.model'
import IntentToolMappingModel from './Intent-tool-mapping.model'
import IntentKnowledgeMappingModel from './Intent-knowledge-mapping.model'

import LlmModel from './llmModel.model'
import AgentModel from './agent.model'

import KnowledgeSourceModel from './Knowledge-source.model'
import KnowledgeChunkModel from './Knowledge-chunk.model';

export function setupAssociations() {

  // =========================
  // AGENT → LLM MODEL
  // =========================
  AgentModel.belongsTo(LlmModel, {
    foreignKey: 'modelId',
    as: 'llmModel',
  })

  LlmModel.hasMany(AgentModel, {
    foreignKey: 'modelId',
    as: 'agents',
  })

  // =========================
  // AGENT → INTENT
  // =========================
  AgentModel.hasMany(IntentModel, {
    foreignKey: 'agentId',
    as: 'intents',
    onDelete: 'CASCADE',
  })

  IntentModel.belongsTo(AgentModel, {
    foreignKey: 'agentId',
    as: 'agent',
  })

  // =========================
  // INTENT CORE CHILDREN
  // =========================
  IntentModel.hasMany(IntentExampleModel, {
    foreignKey: 'intentId',
    as: 'examples',
    onDelete: 'CASCADE',
  })

  IntentExampleModel.belongsTo(IntentModel, {
    foreignKey: 'intentId',
    as: 'intent',
  })

  // =========================
  // TOOLS
  // =========================
  ToolModel.hasMany(ToolsParameterModel, {
    foreignKey: 'toolId',
    as: 'parameters',
    onDelete: 'CASCADE',
  })

  ToolsParameterModel.belongsTo(ToolModel, {
    foreignKey: 'toolId',
    as: 'tool',
  })

  // =========================
  // INTENT → TOOLS
  // =========================

  IntentModel.hasMany(IntentToolMappingModel, {
    foreignKey: 'intentId',
    as: 'toolMappings',
    onDelete: 'CASCADE',
  })

  ToolModel.hasMany(IntentToolMappingModel, {
    foreignKey: 'toolId',
    as: 'intentMappings',
    onDelete: 'CASCADE',
  })

  IntentToolMappingModel.belongsTo(IntentModel, {
    foreignKey: 'intentId',
    as: 'intent',
  })

  IntentToolMappingModel.belongsTo(ToolModel, {
    foreignKey: 'toolId',
    as: 'tool',
  })

  // =========================
  // MANY TO MANY 
  // =========================
  IntentModel.belongsToMany(ToolModel, {
    through: IntentToolMappingModel,
    foreignKey: 'intentId',
    otherKey: 'toolId',
    as: 'tools',
  })

  ToolModel.belongsToMany(IntentModel, {
    through: IntentToolMappingModel,
    foreignKey: 'toolId',
    otherKey: 'intentId',
    as: 'intents',
  })

  // =========================
  // INTENT → KNOWLEDGE
  // =========================
  IntentModel.hasMany(IntentKnowledgeMappingModel, {
    foreignKey: 'intentId',
    as: 'knowledgeMappings',
    onDelete: 'CASCADE',
  })

  KnowledgeModel.hasMany(IntentKnowledgeMappingModel, {
    foreignKey: 'knowledgeId',
    as: 'intentMappings',
    onDelete: 'CASCADE',
  })

  IntentKnowledgeMappingModel.belongsTo(IntentModel, {
    foreignKey: 'intentId',
    as: 'intent',
  })

  IntentKnowledgeMappingModel.belongsTo(KnowledgeModel, {
    foreignKey: 'knowledgeId',
    as: 'knowledge',
  })
}


// =========================
  // KNOWLEDGE → SOURCE
  // =========================

  KnowledgeModel.hasMany(KnowledgeSourceModel, {
    foreignKey: 'knowledgeId',
    as: 'sources',
    onDelete: 'CASCADE',
  })

  KnowledgeSourceModel.belongsTo(KnowledgeModel, {
    foreignKey: 'knowledgeId',
    as: 'knowledge',
  })

  // =========================
  // KNOWLEDGE → CHUNKS
  // =========================

  KnowledgeModel.hasMany(KnowledgeChunkModel, {
    foreignKey: 'knowledgeId',
    as: 'chunks',
    onDelete: 'CASCADE',
  })

  KnowledgeChunkModel.belongsTo(KnowledgeModel, {
    foreignKey: 'knowledgeId',
    as: 'knowledge',
  })

  // =========================
  // SOURCE → CHUNKS
  // =========================

  KnowledgeSourceModel.hasMany(KnowledgeChunkModel, {
    foreignKey: 'sourceId',
    as: 'chunks',
    onDelete: 'CASCADE',
  })

  KnowledgeChunkModel.belongsTo(KnowledgeSourceModel, {
    foreignKey: 'sourceId',
    as: 'source',
  })