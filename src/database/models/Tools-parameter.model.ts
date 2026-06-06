import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize'
import { sequelize } from '../connection'

export type ToolParameterType = 
  | 'string' 
  | 'number' 
  | 'boolean' 
  | 'date' 
  | 'select' 
  | 'multiselect' 
  | 'text' 
  | 'email' 
  | 'phone'

export interface ToolParameterConfig {
  options?: Array<{ label: string; value: string }>
  format?: string
  allowRelative?: boolean
  minDate?: string
  maxDate?: string
  min?: number
  max?: number
  step?: number
  unit?: string
  pattern?: string
  minLength?: number
  maxLength?: number
  placeholder?: string
  [key: string]: any
}

export class ToolParameterModel extends Model<
  InferAttributes<ToolParameterModel>,
  InferCreationAttributes<ToolParameterModel>
> {
  declare id: CreationOptional<string>
  declare toolId: string
  declare name: string
  declare type: ToolParameterType
  declare description: string
  declare isRequired: CreationOptional<boolean>
  declare extractPrompt: string | null
  declare defaultValue: string | null
  declare label: string | null
  declare config: ToolParameterConfig | null
  declare order: CreationOptional<number>
  declare isHidden: CreationOptional<boolean>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

ToolParameterModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    toolId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'tools',
        key: 'id',
      },
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'string',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    isRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    extractPrompt: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    defaultValue: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    label: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    config: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    isHidden: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
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
    tableName: 'tools_parameters',
    timestamps: true,
    underscored: false,
  }
)

export default ToolParameterModel