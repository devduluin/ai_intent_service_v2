'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('knowledge', {
    id: {
      type: Sequelize.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    },

    slug: {
      type: Sequelize.STRING(150),
      allowNull: false,
    },

    title: {
      type: Sequelize.STRING(255),
      allowNull: false,
    },

    description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

    content: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    type: {
      type: Sequelize.ENUM('faq', 'article', 'policy'),
      allowNull: false,
      defaultValue: 'faq',
    },

    isActive: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
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
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('knowledge')
  },
}