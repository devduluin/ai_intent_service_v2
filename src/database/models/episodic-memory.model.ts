import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../connection';

export class EpisodicMemoryModel extends Model<
  InferAttributes<EpisodicMemoryModel>,
  InferCreationAttributes<EpisodicMemoryModel>
> {
  declare id: CreationOptional<string>;
  declare user_id: string;
  declare app_name: string;
  declare level: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'story';
  declare intent: string;
  declare summary: string;
  declare toolsUsed: CreationOptional<Record<string, any> | null>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

EpisodicMemoryModel.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },

    user_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    app_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    level: {
      type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'yearly', 'story'),
      allowNull: false,
      defaultValue: 'daily',
    },

    intent: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: 'Intent slug for slot-based memory',
    },

    summary: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    toolsUsed: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'PlannerOutput snapshot for tool usage hints',
    },

    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },

    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'episodic_memories',
    timestamps: false,
    underscored: false,
  }
);

// Indexes are created in migration file
export default EpisodicMemoryModel;
