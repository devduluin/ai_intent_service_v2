'use strict'

const { json } = require("node:stream/consumers")

module.exports = {
  async up(queryInterface) {
    const now = new Date()
    const attendanceBaseUrl = process.env.ATTENDANCE_API_URL;

    await queryInterface.bulkInsert('tools', [
      {
        name: 'Weather API',
        slug: 'get_weather',
        description: 'Gunakan API ini untuk mendapatkan cuaca',
        method: 'GET',
        url: 'https://api.openweathermap.org/data/2.5/weather?q={city}&appid=a4a3c3f31f794e6c47a505350f5ad847&units=metric',
        authType: 'none',

        authConfig: JSON.stringify({
          in: 'query',
          key: 'appid',
          value: '${OPENWEATHER_API_KEY}'
        }),

        headers: null,

        bodyTemplate: null,

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'World Time API',
        slug: 'get_time',
        description: 'Gunakan API ini untuk mendapatkan cuaca',
        method: 'GET',
        url: 'https://timeapi.io/api/v1/time/current/zone?timezone={timezone}',
        authType: 'none',

        headers: null,

        bodyTemplate: null,

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Checkin Trouble API',
        slug: 'checkin_trouble',
        description: 'Gunakan API ini untuk mendapatkan informasi checkin trouble',
        method: 'GET',
        url: `${attendanceBaseUrl}/ai/attendance/checkin-troubleshooting?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Leave Allocation API',
        slug: 'leave_allocation_api',
        description: 'Gunakan API ini untuk mendapatkan informasi leave allocation',
        method: 'GET',
        url: `${attendanceBaseUrl}/ai/attendance/leave-allocation?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Get Shift API',
        slug: 'get_shift',
        description: 'Gunakan API ini untuk mendapatkan informasi shift',
        method: 'GET',
        url: `${attendanceBaseUrl}/ai/attendance/get-shift?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        isActive: true,
        createdAt: now,
        updatedAt: now,
      }
    ])
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('tools', {
      slug: ['get_weather', 'get_time', 'checkin_trouble', 'leave_allocation_api', 'get_shift'],
    })
  },
}