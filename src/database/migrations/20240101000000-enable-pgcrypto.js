'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Aktifkan pgcrypto extension
    await queryInterface.sequelize.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);
  },

  async down(queryInterface, Sequelize) {
    // Hapus extension (hati-hati karena bisa dipakai tabel lain)
    await queryInterface.sequelize.query(`
      DROP EXTENSION IF EXISTS "pgcrypto";
    `);
  },
};