import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../connection';

export class UserProfileModel extends Model<
  InferAttributes<UserProfileModel>,
  InferCreationAttributes<UserProfileModel>
> {
  declare id: CreationOptional<string>;
  declare user_id: string;
  declare app_name: string;
  declare profile_key: string;
  declare value_label: CreationOptional<string>;
  declare profile_value: string;
  declare value_type: CreationOptional<string>;
  declare confidence: CreationOptional<number>;
  declare source: CreationOptional<string>;
  declare profile_class: CreationOptional<string>;
  declare status: CreationOptional<string>;
  declare evidence_hash: CreationOptional<string | null>;
  declare evidence_text: CreationOptional<string | null>;
  declare last_confirmed_at: CreationOptional<Date | null>;
  declare valid_from: CreationOptional<Date | null>;
  declare valid_to: CreationOptional<Date | null>;
  declare expires_at: CreationOptional<Date | null>;
  declare is_pii: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

UserProfileModel.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },
    user_id: { type: DataTypes.STRING(255), allowNull: false },
    app_name: { type: DataTypes.STRING(100), allowNull: false },
    profile_key: { type: DataTypes.STRING(150), allowNull: false },
    value_label: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'default' },
    profile_value: { type: DataTypes.TEXT, allowNull: false },
    value_type: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'string' },
    confidence: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0.5 },
    source: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'user' },
    profile_class: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'identity' },
    status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'active' },
    evidence_hash: { type: DataTypes.STRING(128), allowNull: true },
    evidence_text: { type: DataTypes.TEXT, allowNull: true },
    last_confirmed_at: { type: DataTypes.DATE, allowNull: true },
    valid_from: { type: DataTypes.DATE, allowNull: true },
    valid_to: { type: DataTypes.DATE, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: true },
    is_pii: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'user_profiles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['user_id', 'app_name'] },
      { fields: ['profile_key'] },
      { fields: ['user_id', 'app_name', 'profile_class'] },
      { fields: ['user_id', 'app_name', 'status'] },
      { unique: true, fields: ['user_id', 'app_name', 'profile_key', 'value_label'] },
    ],
  }
);

export default UserProfileModel;
