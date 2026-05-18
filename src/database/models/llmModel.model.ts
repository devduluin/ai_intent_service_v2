import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize'
import { sequelize } from '../connection'

export class LlmModel extends Model<
  InferAttributes<LlmModel>,
  InferCreationAttributes<LlmModel>
> {
  declare id: CreationOptional<string>
  declare name: string
  declare provider: string
  declare modelCode: string
  declare contextWindow: number | null
  declare maxOutputTokens: number | null
  declare costPer1kInput: number | null
  declare costPer1kOutput: number | null
  declare isActive: CreationOptional<boolean>
  declare metadata: Record<string, any> | null
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

LlmModel.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },

    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    provider: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    modelCode: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    contextWindow: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    maxOutputTokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    costPer1kInput: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },

    costPer1kOutput: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
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
    tableName: 'llm_models',
    timestamps: true,
    underscored: false,
  }
)

export default LlmModel