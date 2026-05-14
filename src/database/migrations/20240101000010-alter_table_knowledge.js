'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('knowledge', 'ingestionStatus', {
      type: Sequelize.ENUM('idle', 'processing', 'completed', 'failed'),
      allowNull: false,
      defaultValue: 'idle',
    })

    await queryInterface.addColumn('knowledge', 'lastIngestedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    })
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('knowledge', 'ingestionStatus')
    await queryInterface.removeColumn('knowledge', 'lastIngestedAt')
  },
}