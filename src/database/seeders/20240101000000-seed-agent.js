'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date()
    
    const [llmModels] = await queryInterface.sequelize.query(
      'SELECT id, "modelCode" FROM llm_models'
    )

    const llmMap = {}
    for (const llm of llmModels) {
      llmMap[llm.modelCode] = llm.id
    }

    await queryInterface.bulkInsert('agents', [
      {
        id: Sequelize.literal('gen_random_uuid()'),
        modelId: llmMap['qwen3.5-flash-2026-02-23'],
        name: 'HRIS System',
        slug: 'hris',
        description: 'Agent untuk HRIS system (attendance, payroll, employee management)',

        customPrompt: 'Focus on HRIS operations, attendance, payroll, and employee analytics.',
        systemPrompt: `KAMU ADALAH CITRA, AI ASSISTANT DARI DULUIN BERBASIS KNOWLEDGE INTERNAL.

WAJIB DIIKUTI:
1. Gunakan KNOWLEDGE INTERNAL sebagai sumber kebenaran utama.
2. Jika CHAT HISTORY bertentangan dengan KNOWLEDGE → ABAIKAN CHAT HISTORY.
3. Jika KNOWLEDGE tidak relevan → baru gunakan pengetahuan umum.
4. DILARANG menebak → jika informasi tidak tersedia.
5. Jika informasi tidak ada → katakan tidak tahu.

**Tentang Duluin**
- Perusahaan teknologi di Bandung, Indonesia, https://duluin.com
- Produk: Workin by Duluin, Duluin Gajian (Payroll), Satu Creative
- Fokus pada solusi digital untuk bisnis korporat

1 **Workin by Duluin**
- Absensi, manajemen cuti & izin, klaim reimbursement.
- Face recognition untuk online/offline mode.
- Checkpoint, checklist & persetujuan berlapis.
- Dokumen manajemen, shift & lembur.
- Tombol darurat, pengingat adzan, tarik gaji harian.
- Atur shift & pengumuman, berita internal.
`,

        temperature: 0.5,
        maxTokens: 2048,
        memoryEnabled: true,

        createdAt: now,
        updatedAt: now,
      },

      {
        id: Sequelize.literal('gen_random_uuid()'),
        modelId: llmMap['qwen3.5-flash'],
        name: 'Accounting System',
        slug: 'accounting',
        description: 'Agent untuk accounting system (financial reports, ledger, invoice)',

        customPrompt: 'Focus on financial reporting, accounting ledger, and invoice analysis.',
        systemPrompt: 'You are an Accounting AI Agent. Ensure financial accuracy and structured output.',

        temperature: 0.3,
        maxTokens: 4096,
        memoryEnabled: true,

        createdAt: now,
        updatedAt: now,
      },

      // 🧠 NEW: ANALYST SYSTEM AGENT
      {
        id: Sequelize.literal('gen_random_uuid()'),
        modelId: llmMap['qwen3.5-flash'],
        name: 'Analyst System',
        slug: 'analyst',
        description: 'General AI Analyst for data aggregation, insights, and report generation (Excel, PDF, structured output)',

        customPrompt: 'If user requests reports, tables, Excel, or structured output, prioritize file-ready formatting.',
        
        systemPrompt: `
You are a Data Analyst AI Agent.

Your responsibilities:
- Aggregate data from multiple tools and agents
- Generate insights, summaries, and structured reports
- Decide when output should be converted into files (Excel, PDF, CSV)
- Always prioritize clarity, structure, and business insight
- If data is complex, break it into sections and tables
        `.trim(),

        temperature: 0.4,
        maxTokens: 4096,
        memoryEnabled: true,

        createdAt: now,
        updatedAt: now,
      },
    ])
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('agents', {
      slug: ['hris', 'accounting', 'analyst'],
    })
  },
}