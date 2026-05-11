'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tools', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },

      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      slug: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },

      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      method: {
        type: Sequelize.ENUM('GET', 'POST', 'PUT', 'PATCH', 'DELETE'),
        allowNull: false,
      },

      url: {
        type: Sequelize.TEXT,
        allowNull: false,
      },

      authType: {
        type: Sequelize.ENUM('none', 'bearer', 'api_key'),
        allowNull: false,
        defaultValue: 'none',
      },

      // ✅ INI YANG KAMU TAMBAH (SUDAH BENAR)
      authConfig: {
        type: Sequelize.JSON,
        allowNull: true,
      },

      headers: {
        type: Sequelize.JSON,
        allowNull: true,
      },

      bodyTemplate: {
        type: Sequelize.JSON,
        allowNull: true,
      },

      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    await queryInterface.addIndex('tools', ['slug'], { unique: true });
    await queryInterface.addIndex('tools', ['isActive']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tools');

    // cleanup ENUM (penting di Postgres)
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_tools_method"`);
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_tools_authType"`);
  },
};