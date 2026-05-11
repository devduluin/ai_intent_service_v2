'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('intent_knowledge_mappings', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },

      intentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'intents',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },

      knowledgeId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'knowledge',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },

      priority: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
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

    // Indexes
    await queryInterface.addIndex(
      'intent_knowledge_mappings',
      ['intentId'],
      { name: 'intent_knowledge_mappings_intent_idx' }
    )

    await queryInterface.addIndex(
      'intent_knowledge_mappings',
      ['knowledgeId'],
      { name: 'intent_knowledge_mappings_knowledge_idx' }
    )

    await queryInterface.addIndex(
      'intent_knowledge_mappings',
      ['intentId', 'knowledgeId'],
      { unique: true, name: 'intent_knowledge_unique' }
    )
  },

  async down(queryInterface) {
    await queryInterface.dropTable('intent_knowledge_mappings')
  },
}