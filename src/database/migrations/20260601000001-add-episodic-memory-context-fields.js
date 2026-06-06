'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('episodic_memories', 'topicKey', {
      type: Sequelize.STRING(200),
      allowNull: true,
    });

    await queryInterface.addColumn('episodic_memories', 'topicLabel', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.addColumn('episodic_memories', 'flowStage', {
      type: Sequelize.STRING(80),
      allowNull: true,
    });

    await queryInterface.addColumn('episodic_memories', 'taskPlan', {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    await queryInterface.addColumn('episodic_memories', 'flowTrace', {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    await queryInterface.addColumn('episodic_memories', 'memoryMeta', {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    await queryInterface.addIndex('episodic_memories', ['user_id', 'app_name', 'topicKey'], {
      name: 'idx_episodic_memories_user_app_topic',
    });

    await queryInterface.addIndex('episodic_memories', ['user_id', 'app_name', 'flowStage'], {
      name: 'idx_episodic_memories_user_app_flow_stage',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('episodic_memories', 'idx_episodic_memories_user_app_flow_stage');
    await queryInterface.removeIndex('episodic_memories', 'idx_episodic_memories_user_app_topic');
    await queryInterface.removeColumn('episodic_memories', 'memoryMeta');
    await queryInterface.removeColumn('episodic_memories', 'flowTrace');
    await queryInterface.removeColumn('episodic_memories', 'taskPlan');
    await queryInterface.removeColumn('episodic_memories', 'flowStage');
    await queryInterface.removeColumn('episodic_memories', 'topicLabel');
    await queryInterface.removeColumn('episodic_memories', 'topicKey');
  },
};
