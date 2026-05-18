import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize'
import { sequelize } from '../connection'

export default class ToolModel extends Model<
  InferAttributes<ToolModel>,
  InferCreationAttributes<ToolModel>
> {
  declare id: CreationOptional<string>
  declare name: string
  declare slug: string
  declare description: string | null
  declare method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  declare url: string
  declare authType: 'none' | 'bearer' | 'api_key'  // ✅ Enum type, bukan string
  declare authConfig: JSON | null
  declare headers: object | null
  declare bodyTemplate: object | null

  declare responseMapping: Record<string, any> | null

  // 🧠 IMPORTANT FIX
  declare allowedAgentDelegates: string[] | null

  declare isActive: CreationOptional<boolean>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

ToolModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,  // ✅ Match dengan migration (allowNull: true)
    },
    method: {
      type: DataTypes.ENUM('GET', 'POST', 'PUT', 'PATCH', 'DELETE'),
      allowNull: false,
    },
    url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    authType: {
      type: DataTypes.ENUM('none', 'bearer', 'api_key'),  // ✅ Match dengan migration (ENUM)
      allowNull: false,  // Migration tidak ada allowNull, defaultnya false
      defaultValue: 'none',  // ✅ Match dengan migration
    },
    headers: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    authConfig: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    bodyTemplate: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    responseMapping: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    
    allowedAgentDelegates: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: true,
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,  // Gunakan DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'tools',
    timestamps: true,
    underscored: false,  // ✅ Pastikan false karena pakai camelCase
  }
)