import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize'
import { sequelize } from '../connection'

export class IntentKnowledgeMappingModel extends Model<
  InferAttributes<IntentKnowledgeMappingModel>,
  InferCreationAttributes<IntentKnowledgeMappingModel>
> {
  declare id: CreationOptional<string>
  declare intentId: string
  declare knowledgeId: string
  declare priority: CreationOptional<number>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

IntentKnowledgeMappingModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    intentId: {
      type: DataTypes.UUID,
      allowNull: false,
    },

    knowledgeId: {
      type: DataTypes.UUID,
      allowNull: false,
    },

    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },

    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'intent_knowledge_mappings',
    timestamps: true,
    underscored: false,
  }
)

export default IntentKnowledgeMappingModel