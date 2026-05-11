'use strict'

module.exports = {
  async up(queryInterface) {
    const now = new Date()

    // Ambil ID intent yg sudah di-seed
    const intents = await queryInterface.sequelize.query(
      `SELECT id, slug FROM intents 
       WHERE slug IN ('greeting','utilities','attendance','knowledge_workin')`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    const intentMap = {}
    for (const intent of intents) {
      intentMap[intent.slug] = intent.id
    }

    // ======================================================
    // INTENT EXAMPLES (SUPER IMPORTANT FOR INTENT MATCHING)
    // ======================================================
    const examples = [

      // ======================================================
      // GREETING INTENT
      // ======================================================
      { intent: 'greeting', text: 'Halo', language: 'id' },
      { intent: 'greeting', text: 'Hai', language: 'id' },
      { intent: 'greeting', text: 'Selamat pagi', language: 'id' },
      { intent: 'greeting', text: 'Selamat siang', language: 'id' },
      { intent: 'greeting', text: 'Selamat sore', language: 'id' },
      { intent: 'greeting', text: 'Selamat malam', language: 'id' },
      { intent: 'greeting', text: 'Halo kamu siapa?', language: 'id' },
      { intent: 'greeting', text: 'Perkenalkan dirimu', language: 'id' },
      { intent: 'greeting', text: 'Bot ini apa?', language: 'id' },

      { intent: 'greeting', text: 'Hello', language: 'en' },
      { intent: 'greeting', text: 'Hi', language: 'en' },
      { intent: 'greeting', text: 'Good morning', language: 'en' },
      { intent: 'greeting', text: 'Who are you?', language: 'en' },
      { intent: 'greeting', text: 'Introduce yourself', language: 'en' },


      // ======================================================
      // UTILITIES INTENT (time/date/tools)
      // ======================================================
      { intent: 'utilities', text: 'Jam berapa sekarang?', language: 'id' },
      { intent: 'utilities', text: 'Sekarang tanggal berapa?', language: 'id' },
      { intent: 'utilities', text: 'Hari ini hari apa?', language: 'id' },
      { intent: 'utilities', text: 'Waktu sekarang berapa?', language: 'id' },
      { intent: 'utilities', text: 'Kasih tau jam sekarang', language: 'id' },
      { intent: 'utilities', text: 'Tanggal hari ini berapa?', language: 'id' },

      { intent: 'utilities', text: 'What time is it?', language: 'en' },
      { intent: 'utilities', text: 'Current time please', language: 'en' },
      { intent: 'utilities', text: "What's today's date?", language: 'en' },
      { intent: 'utilities', text: 'Tell me the current date', language: 'en' },


      // ======================================================
      // ATTENDANCE INTENT (HRIS Core)
      // ======================================================
      { intent: 'attendance', text: 'Saya sudah absen belum?', language: 'id' },
      { intent: 'attendance', text: 'Cek absensi saya hari ini', language: 'id' },
      { intent: 'attendance', text: 'Riwayat absensi saya', language: 'id' },
      { intent: 'attendance', text: 'Saya telat berapa kali bulan ini?', language: 'id' },
      { intent: 'attendance', text: 'Jam masuk saya hari ini', language: 'id' },
      { intent: 'attendance', text: 'Jam pulang saya hari ini', language: 'id' },
      { intent: 'attendance', text: 'Apakah saya sudah check in?', language: 'id' },
      { intent: 'attendance', text: 'Apakah saya sudah check out?', language: 'id' },

      { intent: 'attendance', text: 'Check my attendance today', language: 'en' },
      { intent: 'attendance', text: 'Did I check in today?', language: 'en' },
      { intent: 'attendance', text: 'My attendance history', language: 'en' },
      { intent: 'attendance', text: 'Am I late today?', language: 'en' },


      // ======================================================
      // KNOWLEDGE WORKIN (RAG KNOWLEDGE)
      // ======================================================
      { intent: 'knowledge_workin', text: 'Bagaimana cara absen di Workin?', language: 'id' },
      { intent: 'knowledge_workin', text: 'Apa itu aplikasi Workin?', language: 'id' },
      { intent: 'knowledge_workin', text: 'Fitur apa saja di Workin?', language: 'id' },
      { intent: 'knowledge_workin', text: 'Bagaimana jika lupa absen?', language: 'id' },
      { intent: 'knowledge_workin', text: 'Bagaimana cara izin di Workin?', language: 'id' },
      { intent: 'knowledge_workin', text: 'Cara mengajukan cuti di Workin', language: 'id' },

      { intent: 'knowledge_workin', text: 'How to use Workin app?', language: 'en' },
      { intent: 'knowledge_workin', text: 'What is Workin?', language: 'en' },
      { intent: 'knowledge_workin', text: 'How to request leave in Workin?', language: 'en' },
      { intent: 'knowledge_workin', text: 'How to check attendance in Workin?', language: 'en' },
    ]

    const rows = examples.map((e) => ({
      intentId: intentMap[e.intent],
      text: e.text,
      language: e.language,
      createdAt: now,
      updatedAt: now,
    }))

    await queryInterface.bulkInsert('intent_examples', rows)
  },

  async down(queryInterface) {
    const intents = await queryInterface.sequelize.query(
      `SELECT id FROM intents 
       WHERE slug IN ('greeting','utilities','attendance','knowledge_workin')`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    const ids = intents.map((i) => i.id)
    if (ids.length > 0) {
      await queryInterface.bulkDelete('intent_examples', { intentId: ids })
    }
  },
}