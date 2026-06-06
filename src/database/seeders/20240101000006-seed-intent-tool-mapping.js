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
        {
          intentId: getId(intents, 'attendance'),
          toolId: getId(tools, 'checkin_trouble'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'leave'),
          toolId: getId(tools, 'leave_allocation_api'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'shift'),
          toolId: getId(tools, 'get_shift'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'payslip'),
          toolId: getId(tools, 'get_payslip'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'claim'),
          toolId: getId(tools, 'claim_expense_status'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'claim'),
          toolId: getId(tools, 'advance_claim'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'claim'),
          toolId: getId(tools, 'advance_claim_total'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'claim'),
          toolId: getId(tools, 'advance_claim_unreported'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'travel_request'),
          toolId: getId(tools, 'travel_request_status'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'travel_request'),
          toolId: getId(tools, 'travel_request_total'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'travel_request'),
          toolId: getId(tools, 'travel_request_unreported'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'employee'),
          toolId: getId(tools, 'get_employee_detail'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'attendance'),
          toolId: getId(tools, 'request_wfh'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'attendance'),
          toolId: getId(tools, 'request_tukar_shift'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'overtime'),
          toolId: getId(tools, 'request_overtime'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          intentId: getId(intents, 'leave'),
          toolId: getId(tools, 'get_leave_approval'),
          isPrimary: true,
          priority: 1,
          createdAt: now,
          updatedAt: now,
        },
        // {
        //   intentId: getId(intents, 'vehicles'),
        //   toolId: getId(tools, 'get_vehicle_assignment'),
        //   isPrimary: true,
        //   priority: 1,
        //   createdAt: now,
        //   updatedAt: now,
        // },
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