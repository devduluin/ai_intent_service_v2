import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
} from 'sequelize'
import { sequelize } from '../connection'
import { KnowledgeModel } from './knowledge.model'

export class KnowledgeSourceModel extends Model<
  InferAttributes<KnowledgeSourceModel>,
  InferCreationAttributes<KnowledgeSourceModel>
> {
  declare id: CreationOptional<string>
  declare knowledgeId: ForeignKey<KnowledgeModel['id']>

  declare type: 'url' | 'pdf' | 'docx' | 'text'
  declare url: string | null
  declare rawText: string | null

  declare status: CreationOptional<'pending' | 'processing' | 'completed' | 'failed'>
  declare lastCrawledAt: CreationOptional<Date | null>

  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

KnowledgeSourceModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    knowledgeId: {
      type: DataTypes.UUID,
      allowNull: false,
    },

    type: {
      type: DataTypes.ENUM('url', 'pdf', 'docx', 'text'),
      allowNull: false,
    },

    url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    rawText: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
      defaultValue: 'pending',
    },

    lastCrawledAt: {
      type: DataTypes.DATE,
      allowNull: true,
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
    tableName: 'knowledge_sources',
    timestamps: true,
    underscored: false,
  }
)

export default KnowledgeSourceModel