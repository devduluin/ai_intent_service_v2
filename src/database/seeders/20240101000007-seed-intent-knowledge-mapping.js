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
      {
        intentId: getId(intents, 'knowledge_workin'),
        knowledgeId: getId(knowledge, 'leave_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'knowledge_workin'),
        knowledgeId: getId(knowledge, 'salary_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'knowledge_workin'),
        knowledgeId: getId(knowledge, 'advance_claim_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'knowledge_workin'),
        knowledgeId: getId(knowledge, 'claim_expense_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'knowledge_workin'),
        knowledgeId: getId(knowledge, 'travel_request_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'attendance'),
        knowledgeId: getId(knowledge, 'attendance_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'leave_allocation'),
        knowledgeId: getId(knowledge, 'leave_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'shift'),
        knowledgeId: getId(knowledge, 'attendance_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'get_payslip'),
        knowledgeId: getId(knowledge, 'salary_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'advance_claim_status'),
        knowledgeId: getId(knowledge, 'advance_claim_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'claim_expense_status'),
        knowledgeId: getId(knowledge, 'claim_expense_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        intentId: getId(intents, 'travel_request_status'),
        knowledgeId: getId(knowledge, 'travel_request_faq'),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      }
    ])
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('intent_knowledge_mappings', null, {})
  },
}