import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../connection';

export class AutomationJobModel extends Model<
  InferAttributes<AutomationJobModel>,
  InferCreationAttributes<AutomationJobModel>
> {
  declare id: CreationOptional<string>;
  declare user_id: string;
  declare app_name: string;
  declare agent_id: CreationOptional<string | null>;
  declare title: string;
  declare goal: string;
  declare type: 'reminder' | 'scheduled_workflow' | 'conditional_alert';
  declare trigger: Record<string, any>;
  declare condition: CreationOptional<Record<string, any> | null>;
  declare workflow: Record<string, any>;
  declare action: Record<string, any>;
  declare notification: CreationOptional<Record<string, any> | null>;
  declare status: 'draft' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  declare safety: Record<string, any>;
  declare next_run_at: CreationOptional<Date | null>;
  declare last_run_at: CreationOptional<Date | null>;
  declare last_result: CreationOptional<Record<string, any> | null>;
  declare last_error: CreationOptional<string | null>;
  declare run_count: CreationOptional<number>;
  declare max_runs: CreationOptional<number | null>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

AutomationJobModel.init(
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

    agent_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },

    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    goal: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    type: {
      type: DataTypes.ENUM('reminder', 'scheduled_workflow', 'conditional_alert'),
      allowNull: false,
    },

    trigger: {
      type: DataTypes.JSONB,
      allowNull: false,
    },

    condition: {
      type: DataTypes.JSONB,
      allowNull: true,
    },

    workflow: {
      type: DataTypes.JSONB,
      allowNull: false,
    },

    action: {
      type: DataTypes.JSONB,
      allowNull: false,
    },

    notification: {
      type: DataTypes.JSONB,
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM('draft', 'active', 'paused', 'completed', 'failed', 'cancelled'),
      allowNull: false,
      defaultValue: 'draft',
    },

    safety: {
      type: DataTypes.JSONB,
      allowNull: false,
    },

    next_run_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    last_run_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    last_result: {
      type: DataTypes.JSONB,
      allowNull: true,
    },

    last_error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    run_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    max_runs: {
      type: DataTypes.INTEGER,
      allowNull: true,
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
    tableName: 'automation_jobs',
    timestamps: false,
    underscored: false,
  }
);

export default AutomationJobModel;
