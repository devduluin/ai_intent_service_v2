'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('llm_models', {

      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },

      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      provider: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      modelCode: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      contextWindow: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },

      maxOutputTokens: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },

      costPer1kInput: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },

      costPer1kOutput: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },

      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },

      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },

      createdAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()'),
      },

      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()'),
      },
    })

    await queryInterface.addIndex('llm_models', ['provider'])
    await queryInterface.addIndex('llm_models', ['modelCode'], { unique: true })
    await queryInterface.addIndex('llm_models', ['isActive'])
  },

  async down(queryInterface) {
    await queryInterface.dropTable('llm_models')
  },
}