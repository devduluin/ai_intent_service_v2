'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('intents', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },

      agentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'agents',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },

      slug: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },

      name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },

      description: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
 
      executionType: {
        type: Sequelize.ENUM('handler', 'llm'),
        allowNull: false,
      },

      handlerKey: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },

      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    })

    // Indexes
    await queryInterface.addIndex('intents', ['agentId', 'slug'], {
      unique: true,
      name: 'intents_agent_slug_unique'
    })
    await queryInterface.addIndex('intents', ['isActive'], { name: 'intents_is_active_idx' })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('intents')
  },
}
