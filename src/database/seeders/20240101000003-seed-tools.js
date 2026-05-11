'use strict'

const { json } = require("node:stream/consumers")

module.exports = {
  async up(queryInterface) {
    const now = new Date()

    await queryInterface.bulkInsert('tools', [
      {
        name: 'Weather API',
        slug: 'get_weather',
        description: 'Ambil data cuaca dari OpenWeather',
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
        description: 'Ambil waktu dunia berdasarkan timezone',
        method: 'GET',
        url: 'https://timeapi.io/api/v1/time/current/zone?timezone={timezone}',
        authType: 'none',

        headers: null,

        bodyTemplate: null,

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ])
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('tools', {
      slug: ['weather_api', 'world_time_api'],
    })
  },
}