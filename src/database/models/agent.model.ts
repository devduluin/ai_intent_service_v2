import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  NonAttribute,
} from 'sequelize'
import { sequelize } from '../connection'
import { LlmModel } from './llmModel.model'

export class AgentModel extends Model<
  InferAttributes<AgentModel>,
  InferCreationAttributes<AgentModel>
> {
  declare id: CreationOptional<string>
  declare name: string
  declare slug: string
  declare description: string | null
  declare isActive: CreationOptional<boolean>

  declare customPrompt: string | null
  declare systemPrompt: string | null
  declare temperature: number
  declare maxTokens: number | null
  declare memoryEnabled: CreationOptional<boolean>

  // 🔥 FK to LLM
  declare modelId: ForeignKey<LlmModel['id']> | null

  // optional relation field
  declare llmModel?: NonAttribute<LlmModel>

  declare metadata: CreationOptional<Record<string, any> | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

AgentModel.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },

    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },

    slug: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },

    // PROMPT SYSTEM
    customPrompt: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    systemPrompt: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    // LLM CONTROL
    modelId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'llm_models',
        key: 'id',
      },
    },

    temperature: {
      type: DataTypes.FLOAT,
      defaultValue: 0.7,
      allowNull: false,
    },

    maxTokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    memoryEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },

    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },

    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'agents',
    timestamps: true,
    underscored: false,
  }
)

export default AgentModel