'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {

    await queryInterface.addColumn('tools', 'responseMapping', {
      type: Sequelize.JSONB,
      allowNull: true,
    })

    await queryInterface.addColumn('tools', 'allowedAgentDelegates', {
      type: Sequelize.ARRAY(Sequelize.STRING), // ["analyst_agent", "finance_agent"] ini slug
      allowNull: true,
      defaultValue: [],
    })
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('tools', 'responseMapping')
    await queryInterface.removeColumn('tools', 'allowedAgentDelegates')
  },
}