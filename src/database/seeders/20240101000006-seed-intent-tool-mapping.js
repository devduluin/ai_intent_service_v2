'use strict'

module.exports = {
  async up(queryInterface) {
    const now = new Date()

    const intents = await queryInterface.sequelize.query(
      `SELECT id, slug FROM intents`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    const tools = await queryInterface.sequelize.query(
      `SELECT id, slug FROM tools`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    const getId = (arr, slug) => arr.find(i => i.slug === slug)?.id

    await queryInterface.bulkInsert(
      'intent_tool_mappings',
      [
        {
          intentId: getId(intents, 'utilities'),
          toolId: getId(tools, 'get_weather'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'utilities'),
          toolId: getId(tools, 'get_time'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
      {
        ignoreDuplicates: true,
      }
    )
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('intent_tool_mappings', null, {})
  },
}