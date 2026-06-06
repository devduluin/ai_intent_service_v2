'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_profiles', {
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
      profile_key: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      value_label: {
        type: Sequelize.STRING(100),
        allowNull: false,
        defaultValue: 'default',
      },
      profile_value: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      value_type: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'string',
      },
      confidence: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 0.5,
      },
      source: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'user',
      },
      profile_class: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'identity',
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'active',
      },
      evidence_hash: {
        type: Sequelize.STRING(128),
        allowNull: true,
      },
      evidence_text: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      last_confirmed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      valid_from: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      valid_to: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      is_pii: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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

    await queryInterface.addIndex('user_profiles', ['user_id', 'app_name'], {
      name: 'idx_user_profiles_lookup',
    });
    await queryInterface.addIndex('user_profiles', ['profile_key'], {
      name: 'idx_user_profiles_key',
    });
    await queryInterface.addIndex('user_profiles', ['user_id', 'app_name', 'profile_class'], {
      name: 'idx_user_profiles_class',
    });
    await queryInterface.addIndex('user_profiles', ['user_id', 'app_name', 'status'], {
      name: 'idx_user_profiles_status',
    });
    await queryInterface.addConstraint('user_profiles', {
      fields: ['user_id', 'app_name', 'profile_key', 'value_label'],
      type: 'unique',
      name: 'uq_user_profiles_user_app_key_label',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_profiles');
  },
};
