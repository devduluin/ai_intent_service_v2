// sequelize-cli butuh CommonJS, bukan ESM/TS
// Config ini dibaca saat menjalankan db:migrate / db:seed

require('dotenv').config()

module.exports = {
  development: {
    username: process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASS     || 'postgres',
    database: process.env.DB_NAME     || 'ai_intent',
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '5432'),
    dialect:  'postgres',
    logging:  console.log,
    pool: {
      max:     5,
      min:     0,
      acquire: 30000,
      idle:    10000,
    },
  },
  test: {
    username: process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASS     || 'postgres',
    database: process.env.DB_NAME_TEST || 'ai_intent_test',
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '5432'),
    dialect:  'postgres',
    logging:  false,
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    dialect:  'postgres',
    logging:  false,
    dialectOptions: {
      ssl: {
        require:            true,
        rejectUnauthorized: false,
      },
    },
    pool: {
      max:     10,
      min:     2,
      acquire: 30000,
      idle:    10000,
    },
  },
}
