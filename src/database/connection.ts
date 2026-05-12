import { Sequelize } from 'sequelize'
import { config } from '../config'

// ============================================================
// Sequelize Instance — singleton connection ke PostgreSQL
// ============================================================

export const sequelize = new Sequelize({
  dialect:  'postgres',
  host:     config.db.host,
  port:     config.db.port,
  username: config.db.user,
  password: config.db.pass,
  database: config.db.name,
  logging:  config.server.env === 'development' ? console.log : false,
  dialectOptions: {
    ssl: config.db.ssl ? {
      require:            true,
      rejectUnauthorized: false,
    } : false,
  },
  pool: {
    max:     10,
    min:     2,
    acquire: 30000,
    idle:    10000,
  },
  define: {
    timestamps:  true,           // createdAt, updatedAt otomatis
    underscored: true,           // snake_case di kolom DB
    freezeTableName: false,      // pluralize nama tabel
  },
})

// ----------------------------------------------------------
// Test koneksi
// ----------------------------------------------------------
export async function connectDatabase(): Promise<void> {
  await sequelize.authenticate()
  console.log('✓ PostgreSQL connected')
}
