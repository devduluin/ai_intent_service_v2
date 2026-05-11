'use strict'

module.exports = {
  async up(queryInterface) {
    const now = new Date()

    await queryInterface.bulkInsert('agents', [
      {
        name: 'HRIS System',
        slug: 'hris',
        description: 'Agent untuk HRIS system',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Accounting System',
        slug: 'accounting',
        description: 'Agent untuk accounting system',
        createdAt: now,
        updatedAt: now,
      }
    ])
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('agents', {
      slug: ['hris', 'accounting'],
    })
  },
}