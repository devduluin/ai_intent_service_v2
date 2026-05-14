'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('knowledge_sources', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },

      knowledgeId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'knowledge',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },

      type: {
        type: Sequelize.ENUM('url', 'pdf', 'docx', 'text'),
        allowNull: false,
      },

      // jika type = url
      url: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      // jika type = manual text
      rawText: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      status: {
        type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },

      lastCrawledAt: {
        type: Sequelize.DATE,
        allowNull: true,
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
    await queryInterface.dropTable('knowledge_sources')
  },
}