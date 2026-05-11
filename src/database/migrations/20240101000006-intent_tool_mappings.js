'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('intent_tool_mappings', {
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

      toolId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'tools',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },

      isPrimary: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      'intent_tool_mappings',
      ['intentId'],
      { name: 'intent_tool_mappings_intent_idx' }
    )

    await queryInterface.addIndex(
      'intent_tool_mappings',
      ['toolId'],
      { name: 'intent_tool_mappings_tool_idx' }
    )

    await queryInterface.addIndex(
      'intent_tool_mappings',
      ['intentId', 'toolId'],
      { unique: true, name: 'intent_tool_unique' }
    )
  },

  async down(queryInterface) {
    await queryInterface.dropTable('intent_tool_mappings')
  },
}