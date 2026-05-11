import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize'
import { sequelize } from '../connection'

export class ToolParameterModel extends Model<
  InferAttributes<ToolParameterModel>,
  InferCreationAttributes<ToolParameterModel>
> {
  declare id: CreationOptional<string>
  declare toolId: string
  declare name: string
  declare type: 'string' | 'number' | 'boolean'
  declare description: string
  declare isRequired: CreationOptional<boolean>
  declare extractPrompt: string | null
  declare defaultValue: string | null
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
      type: DataTypes.ENUM('string', 'number', 'boolean'),
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
      type: DataTypes.STRING(255),
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
    tableName: 'tools_parameters',
    timestamps: true,
    underscored: false,
  }
)

export default ToolParameterModel