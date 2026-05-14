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
import { KnowledgeSourceModel } from './Knowledge-source.model'

export class KnowledgeChunkModel extends Model<
  InferAttributes<KnowledgeChunkModel>,
  InferCreationAttributes<KnowledgeChunkModel>
> {
  declare id: CreationOptional<string>
  declare knowledgeId: ForeignKey<KnowledgeModel['id']>
  declare sourceId: ForeignKey<KnowledgeSourceModel['id']>

  declare content: string
  declare tokenCount: number
  declare metadata: object | null

  declare createdAt: CreationOptional<Date>
}

KnowledgeChunkModel.init(
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

    sourceId: {
      type: DataTypes.UUID,
      allowNull: false,
    },

    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    tokenCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'knowledge_chunks',
    timestamps: false,
    updatedAt: false,
    underscored: false,
  }
)

export default KnowledgeChunkModel