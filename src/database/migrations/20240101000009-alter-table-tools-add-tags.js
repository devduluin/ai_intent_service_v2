'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tools', 'tags', {
      type: Sequelize.ARRAY(Sequelize.STRING),
      allowNull: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tools', 'tags')
  },
}
