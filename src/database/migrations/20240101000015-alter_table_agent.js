'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {

    await queryInterface.addColumn('agents', 'customPrompt', {
      type: Sequelize.TEXT,
      allowNull: true,
    })

    await queryInterface.addColumn('agents', 'modelId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'llm_models',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    })

    await queryInterface.addColumn('agents', 'temperature', {
      type: Sequelize.FLOAT,
      allowNull: false,
      defaultValue: 0.7,
    })

    await queryInterface.addColumn('agents', 'maxTokens', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 2048,
    })

    await queryInterface.addColumn('agents', 'systemPrompt', {
      type: Sequelize.TEXT,
      allowNull: true,
    })

    await queryInterface.addColumn('agents', 'memoryEnabled', {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
    })
  },

  async down(queryInterface, Sequelize) {

    await queryInterface.removeColumn('agents', 'customPrompt')
    await queryInterface.removeColumn('agents', 'modelId')
    await queryInterface.removeColumn('agents', 'temperature')
    await queryInterface.removeColumn('agents', 'maxTokens')
    await queryInterface.removeColumn('agents', 'systemPrompt')
    await queryInterface.removeColumn('agents', 'memoryEnabled')
  },
}