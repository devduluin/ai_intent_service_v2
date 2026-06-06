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
        slug: 'utilities',
        name: 'Utilities',
        description: 'Mendapatkan fitur tools dan utilities',
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
        name: 'Capability Attendance',
        description: 'Mendapatkan informasi absensi karyawan',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '🕐', category: 'information' }), // ← FIX
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'overtime',
        name: 'Capability Overtime',
        description: 'Mendapatkan informasi izin lembur',
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
        description: 'Menjawab pertanyaan tentang masalah aplikasi workin',
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
        name: 'Capability Shift',
        description: 'Mendapatkan informasi shift atau jadwal kerja karyawan',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '🕐', category: 'information' }), // ← FIX
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'leave',
        name: 'Capability Leave',
        description: 'Mendapatkan informasi cuti atau izin karyawan',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '🕐', category: 'information' }), // ← FIX
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'payslip',
        name: 'Capability Payslip',
        description: 'Mendapatkan informasi slip gaji',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '💰', category: 'payroll' }),
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'claim',
        name: 'Capability Claim',
        description: 'Mendapatkan informasi status klaim reimburse dan dana talangan',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '💰', category: 'claims' }),
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'travel_request',
        name: 'Capability Travel Request',
        description: 'Mendapatkan informasi status perjalanan dinas',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '💰', category: 'claims' }),
        createdAt: now,
        updatedAt: now,
      },
      {
        agentId: hrisAgentId,
        slug: 'employee',
        name: 'Capability Employee',
        description: 'Mendapatkan informasi tantang detail karyawan',
        executionType: 'llm',
        handlerKey: null,
        isActive: true,
        metadata: JSON.stringify({ icon: '👤', category: 'employee' }),
        createdAt: now,
        updatedAt: now,
      },
      // {
      //   agentId: hrisAgentId,
      //   slug: 'vehicles',
      //   name: 'Vehicles Domain',
      //   description: 'Mendapatkan informasi tentang detail kendaraan',
      //   executionType: 'llm',
      //   handlerKey: null,
      //   isActive: true,
      //   metadata: JSON.stringify({ icon: '🚗', category: 'vehicles' }),
      //   createdAt: now,
      //   updatedAt: now,
      // },
    ])
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('intents', {})
  },
}