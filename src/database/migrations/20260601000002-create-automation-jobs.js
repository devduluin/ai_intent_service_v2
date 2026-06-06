'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('automation_jobs', {
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

      agent_id: {
        type: Sequelize.UUID,
        allowNull: true,
      },

      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },

      goal: {
        type: Sequelize.TEXT,
        allowNull: false,
      },

      type: {
        type: Sequelize.ENUM('reminder', 'scheduled_workflow', 'conditional_alert'),
        allowNull: false,
      },

      trigger: {
        type: Sequelize.JSONB,
        allowNull: false,
      },

      condition: {
        type: Sequelize.JSONB,
        allowNull: true,
      },

      workflow: {
        type: Sequelize.JSONB,
        allowNull: false,
      },

      action: {
        type: Sequelize.JSONB,
        allowNull: false,
      },

      notification: {
        type: Sequelize.JSONB,
        allowNull: true,
      },

      status: {
        type: Sequelize.ENUM('draft', 'active', 'paused', 'completed', 'failed', 'cancelled'),
        allowNull: false,
        defaultValue: 'draft',
      },

      safety: {
        type: Sequelize.JSONB,
        allowNull: false,
      },

      next_run_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      last_run_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      last_result: {
        type: Sequelize.JSONB,
        allowNull: true,
      },

      last_error: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      run_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      max_runs: {
        type: Sequelize.INTEGER,
        allowNull: true,
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

    await queryInterface.addIndex('automation_jobs', ['app_name', 'user_id', 'status'], {
      name: 'idx_automation_jobs_app_user_status',
    });

    await queryInterface.addIndex('automation_jobs', ['status', 'next_run_at'], {
      name: 'idx_automation_jobs_status_next_run',
    });

    await queryInterface.addIndex('automation_jobs', ['agent_id'], {
      name: 'idx_automation_jobs_agent_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('automation_jobs', 'idx_automation_jobs_agent_id');
    await queryInterface.removeIndex('automation_jobs', 'idx_automation_jobs_status_next_run');
    await queryInterface.removeIndex('automation_jobs', 'idx_automation_jobs_app_user_status');
    await queryInterface.dropTable('automation_jobs');

    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_automation_jobs_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_automation_jobs_type";');
  },
};
