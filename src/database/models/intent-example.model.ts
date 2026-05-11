import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize'
import { sequelize } from '../connection'
import IntentModel from './Intent.model'

export class IntentExampleModel extends Model<
  InferAttributes<IntentExampleModel>,
  InferCreationAttributes<IntentExampleModel>
> {
  declare id: CreationOptional<string>
  declare intentId: string
  declare text: string
  declare language: CreationOptional<string>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

IntentExampleModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    intentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'intents',
        key: 'id',
      },
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    language: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'id',
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
    tableName: 'intent_examples',
    timestamps: true,
    underscored: false,
  }
)

export default IntentExampleModel