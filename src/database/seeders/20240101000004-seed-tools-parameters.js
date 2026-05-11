'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date()

       // 🔥 Ambil tools yg sudah di-seed
    const tools = await queryInterface.sequelize.query(
      `SELECT id, slug FROM tools 
       WHERE slug IN ('get_weather','get_time')`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    const toolMap = {}
    for (const tool of tools) {
      toolMap[tool.slug] = tool.id
    }

    // ----------------------------------------------------------
    // Seed: Intent Parameters
    // ----------------------------------------------------------
    await queryInterface.bulkInsert('tools_parameters', [
      // ── Get Weather → butuh "city" ────────────────────────
      {
        toolId:     toolMap['get_weather'],
        name:          'city',
        type:          'string',
        description:   'Nama kota yang ingin dicek cuacanya',
        isRequired:   true,
        extractPrompt: 'nama kota atau provinsi (contoh: Jakarta, Surabaya, Bali). Jika tidak disebutkan, jawab "Jakarta"',
        defaultValue: '',
        createdAt:    now,
        updatedAt:    now,
      },
      {
        toolId:     toolMap['get_time'],
        name:          'timezone',
        type:          'string',
        description:   'Timezone contoh: Asia/Jakarta. Jika tidak disebutkan, gunakan default "Asia/Jakarta"',
        isRequired:   true,
        extractPrompt: 'timezone dalam format Area/Location (contoh: Asia/Jakarta, Europe/London). Jika tidak disebutkan, jawab "Asia/Jakarta"',
        defaultValue: 'Asia/Jakarta',
        createdAt:    now,
        updatedAt:    now,
      }
      // ── Get Time → tidak butuh parameter tambahan ─────────
      // (contoh intent tanpa parameter — tidak ada row di sini)
    ], {})
  },

  async down(queryInterface) {
    const intents = await queryInterface.sequelize.query(
      `SELECT id FROM intents WHERE slug IN ('get_weather', 'get_time')`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )
    const ids = intents.map((i) => i.id)
    if (ids.length > 0) {
      await queryInterface.bulkDelete('tools_parameters', { intentId: ids }, {})
    }
  },
}
