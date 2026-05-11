import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize'
import { sequelize } from '../connection'

export class IntentToolMappingModel extends Model<
  InferAttributes<IntentToolMappingModel>,
  InferCreationAttributes<IntentToolMappingModel>
> {
  declare id: CreationOptional<string>
  declare intentId: string
  declare toolId: string
  declare isPrimary: CreationOptional<boolean>
  declare priority: CreationOptional<number>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

IntentToolMappingModel.init(
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

    toolId: {
      type: DataTypes.UUID,
      allowNull: false,
    },

    isPrimary: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
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
    tableName: 'intent_tool_mappings',
    timestamps: true,
    underscored: false,
  }
)

export default IntentToolMappingModel