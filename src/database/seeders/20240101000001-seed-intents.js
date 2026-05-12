'use strict'

module.exports = {
  async up(queryInterface) {
    const now = new Date()

    const agents = await queryInterface.sequelize.query(
      `SELECT id FROM agents WHERE slug = 'hris'`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    if (!agents || agents.length === 0) {
      throw new Error('Agent with slug "hris" not found. Please run seed-agents first.')
    }

    const hrisAgentId = agents[0].id

    await queryInterface.bulkInsert('intents', [
      {
        agentId: hrisAgentId,
        slug: 'greeting',
        name: 'Greeting',
        description: 'Sapaan dan perkenalan bot',
        executionType: 'handler',
        handlerKey: 'handleGreeting',
        isActive: true,
        metadata: JSON.stringify({ icon: '👋', category: 'general' }), // ← FIX
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'utilities',
        name: 'Utilities',
        description: 'Mendapatkan tools dan utilities',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '🕐', category: 'information' }), // ← FIX
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'attendance',
        name: 'Attendance',
        description: 'Mendapatkan informasi absensi',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '🕐', category: 'information' }), // ← FIX
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'knowledge_workin',
        name: 'Workin Knowledge',
        description: 'Menjawab pertanyaan tentang aplikasi workin',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '🏢', category: 'information' }), // ← FIX
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'shift',
        name: 'Shift',
        description: 'Mendapatkan informasi shift',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '🕐', category: 'information' }), // ← FIX
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'leave_allocation',
        name: 'Leave Allocation',
        description: 'Mendapatkan informasi leave allocation',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '🕐', category: 'information' }), // ← FIX
        createdAt: now,
        updatedAt: now,
      }
    ])
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('intents', {})
  },
}