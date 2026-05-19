'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('episodic_memories', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },

      user_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },

      app_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },

      level: {
        type: Sequelize.ENUM('daily', 'weekly', 'monthly', 'yearly', 'story'),
        allowNull: false,
        defaultValue: 'daily',
      },

      intent: {
        type: Sequelize.STRING(200),
        allowNull: false,
        comment: 'Intent slug for slot-based memory',
      },

      summary: {
        type: Sequelize.TEXT,
        allowNull: false,
      },

      toolsUsed: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'PlannerOutput snapshot for tool usage hints',
      },

      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },

      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    // Indexes for performance
    await queryInterface.addIndex('episodic_memories', ['user_id', 'app_name'], {
      name: 'idx_episodic_memories_user_app',
    });

    await queryInterface.addIndex('episodic_memories', ['user_id', 'app_name', 'created_at'], {
      name: 'idx_episodic_memories_user_app_created',
    });

    await queryInterface.addIndex('episodic_memories', ['user_id', 'app_name', 'intent'], {
      name: 'idx_episodic_memories_user_app_intent',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('episodic_memories');
  },
};
