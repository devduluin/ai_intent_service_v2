import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize'
import { sequelize } from '../connection'

export class KnowledgeModel extends Model<
  InferAttributes<KnowledgeModel>,
  InferCreationAttributes<KnowledgeModel>
> {
  declare id: CreationOptional<string>
  declare slug: string
  declare title: string
  declare description: string | null
  declare content: string | null
  declare type: 'faq' | 'article' | 'policy'
  declare isActive: CreationOptional<boolean>

  declare ingestionStatus: CreationOptional<'idle' | 'processing' | 'completed' | 'failed'>
  declare lastIngestedAt: CreationOptional<Date | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

KnowledgeModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    slug: {
      type: DataTypes.STRING(150),
      allowNull: false,
      unique: true,
    },

    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,  // ✅ Match dengan migration (allowNull: true)
    },

    content: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    type: {
      type: DataTypes.ENUM('faq', 'article', 'policy'),
      allowNull: false,
      defaultValue: 'faq',
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    ingestionStatus: {
      type: DataTypes.ENUM('idle', 'processing', 'completed', 'failed'),
      allowNull: false,
      defaultValue: 'idle',
    },
    
    lastIngestedAt: {
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
    tableName: 'knowledge',
    timestamps: true,
    underscored: false,
  }
)

export default KnowledgeModel