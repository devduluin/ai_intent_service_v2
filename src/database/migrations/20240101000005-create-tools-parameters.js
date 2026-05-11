'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Buat enum type dulu di PostgreSQL
    await queryInterface.sequelize.query(
      `CREATE TYPE "enum_tools_parameters_type" AS ENUM ('string', 'number', 'boolean')`
    )

    await queryInterface.createTable('tools_parameters', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      toolId: {
        type:       Sequelize.UUID,
        allowNull:  false,
        references: { model: 'tools', key: 'id' },
        onUpdate:   'CASCADE',
        onDelete:   'CASCADE',
      },
      name: {
        type:      Sequelize.STRING(100),
        allowNull: false,
      },
      type: {
        type:         Sequelize.ENUM('string', 'number', 'boolean'),
        allowNull:    false,
        defaultValue: 'string',
      },
      description: {
        type:      Sequelize.TEXT,
        allowNull: false,
      },
      isRequired: {
        type:         Sequelize.BOOLEAN,
        allowNull:    false,
        defaultValue: false,
      },
      extractPrompt: {
        type:      Sequelize.TEXT,
        allowNull: true,
      },
      defaultValue: {
        type:      Sequelize.STRING(255),
        allowNull: true,
      },
      createdAt: {
        type:         Sequelize.DATE,
        allowNull:    false,
        defaultValue: Sequelize.literal('NOW()'),
      },
      updatedAt: {
        type:         Sequelize.DATE,
        allowNull:    false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    })

    await queryInterface.addIndex('tools_parameters', ['toolId'], { name: 'tools_parameters_intent_id_idx' })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tools_parameters')
    await queryInterface.sequelize.query(
      `DROP TYPE IF EXISTS "enum_tools_parameters_type"`
    )
  },
}
