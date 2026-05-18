'use strict'

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('llm_models', [
      {
        id: Sequelize.literal('gen_random_uuid()'),
        name: 'Qwen 3.5 Flash',
        provider: 'qwen',
        modelCode: 'qwen3.5-flash',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        costPer1kInput: 0.0001,
        costPer1kOutput: 0.0002,
        isActive: true,
        metadata: JSON.stringify({
          tier: 'fast',
          latency: 'low',
          reasoning: 'medium',
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: Sequelize.literal('gen_random_uuid()'),
        name: 'Qwen Flash 2025-07-28',
        provider: 'qwen',
        modelCode: 'qwen-flash-2025-07-28',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        costPer1kInput: 0.00008,
        costPer1kOutput: 0.00018,
        isActive: true,
        metadata: JSON.stringify({
          tier: 'ultra-fast',
          latency: 'very-low',
          reasoning: 'medium-low',
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('llm_models', {
      modelCode: [
        'qwen3.5-flash',
        'qwen-flash-2025-07-28',
      ],
    })
  },
}