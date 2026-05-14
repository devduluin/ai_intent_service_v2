import { sequelize } from '../connection'
import IntentModel from './Intent.model'
import IntentExampleModel from './intent-example.model'
import ToolParameterModel from './Tools-parameter.model'
import ToolModel from './Tools.model'
import IntentToolMappingModel from './Intent-tool-mapping.model'
import IntentKnowledgeMappingModel from './Intent-knowledge-mapping.model'
import KnowledgeModel from './knowledge.model'
import KnowledgeSourceModel from './Knowledge-source.model'
import KnowledgeChunkModel from './Knowledge-chunk.model'
import { setupAssociations } from './associations'
import AgentModel from './agent.model'

// Panggil sekali saja
setupAssociations()

// ============================
// Exports
// ============================
export {
  sequelize,
  IntentModel,
  IntentExampleModel,
  ToolParameterModel,
  ToolModel,
  IntentToolMappingModel,
  IntentKnowledgeMappingModel,
  KnowledgeModel,
  AgentModel,
  KnowledgeSourceModel,
  KnowledgeChunkModel
}

export default {
  sequelize,
  IntentModel,
  IntentExampleModel,
  ToolParameterModel,
  ToolModel,
  IntentToolMappingModel,
  IntentKnowledgeMappingModel,
  KnowledgeModel,
  AgentModel,
  KnowledgeSourceModel,
  KnowledgeChunkModel
}