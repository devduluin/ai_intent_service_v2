'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('knowledge_chunks', {
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

      sourceId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'knowledge_sources',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },

      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },

      tokenCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },

      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    })

  },

  async down(queryInterface) {
    await queryInterface.dropTable('knowledge_chunks')
  },
}