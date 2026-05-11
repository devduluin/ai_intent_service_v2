'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('intent_examples', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      intentId: {
        type:       Sequelize.UUID,
        allowNull:  false,
        references: { model: 'intents', key: 'id' },
        onUpdate:   'CASCADE',
        onDelete:   'CASCADE',
      },
      text: {
        type:      Sequelize.TEXT,
        allowNull: false,
      },
      language: {
        type:         Sequelize.STRING(10),
        allowNull:    false,
        defaultValue: 'id',
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

    await queryInterface.addIndex('intent_examples', ['intentId'], { name: 'intent_examples_intent_id_idx' })
    await queryInterface.addIndex('intent_examples', ['language'],  { name: 'intent_examples_language_idx' })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('intent_examples')
  },
}
