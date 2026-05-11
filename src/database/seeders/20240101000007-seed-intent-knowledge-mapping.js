'use strict'

module.exports = {
  async up(queryInterface) {
    const now = new Date()

    const intents = await queryInterface.sequelize.query(
      `SELECT id, slug FROM intents`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    const knowledge = await queryInterface.sequelize.query(
      `SELECT id, slug FROM knowledge`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    const getId = (arr, slug) => arr.find(i => i.slug === slug)?.id

    await queryInterface.bulkInsert('intent_knowledge_mappings', [
      {
        intentId: getId(intents, 'knowledge_workin'),
        knowledgeId: getId(knowledge, 'attendance_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
    ])
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('intent_knowledge_mappings', null, {})
  },
}