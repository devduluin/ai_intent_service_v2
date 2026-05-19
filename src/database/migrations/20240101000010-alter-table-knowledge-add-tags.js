'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('knowledge', 'tags', {
      type: Sequelize.ARRAY(Sequelize.STRING),
      allowNull: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('knowledge', 'tags')
  },
}
