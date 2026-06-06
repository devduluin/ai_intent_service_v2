'use strict'

const { json } = require("node:stream/consumers")

module.exports = {
  async up(queryInterface) {
    const now = new Date()
    const attendanceBaseUrl = process.env.ATTENDANCE_API_URL;
    const payrollBaseUrl = process.env.PAYROLL_API_URL;
    const employeeBaseUrl = process.env.EMPLOYEE_API_URL;

    await queryInterface.bulkInsert('tools', [
      {
        name: 'Weather API',
        slug: 'get_weather',
        description: 'Gunakan Tools ini untuk mendapatkan informasi cuaca',
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

        tags: ['weather', 'cuaca', 'hujan', 'angin'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'World Time API',
        slug: 'get_time',
        description: 'Gunakan Tools ini untuk mendapatkan informasi waktu',
        method: 'GET',
        url: 'https://timeapi.io/api/v1/time/current/zone?timezone={timezone}',
        authType: 'none',

        headers: null,

        bodyTemplate: null,

        tags: ['time', 'jam', 'waktu'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Checkin Trouble API',
        slug: 'checkin_trouble',
        description: 'Gunakan Tools ini untuk kendala absensi atau checkin/checkout trouble',
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

        tags: ['attendance', 'checkin', 'checkout', ],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Leave Allocation API',
        slug: 'leave_allocation_api',
        description: 'Gunakan Tools ini untuk mendapatkan informasi leave allocation',
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

        tags: ['izin', 'cuti', 'sakit'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Get Shift API',
        slug: 'get_shift',
        description: 'Gunakan Tools ini untuk mendapatkan informasi jadwal atau shift kerja',
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

        tags: ['jadwal', 'shift', 'checkin', 'checkout'],

        allowedAgentDelegates: ['analyst'],

        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Get Payslip API',
        slug: 'get_payslip',
        description: 'Gunakan Tools ini untuk mendapatkan informasi gaji atau payslip',
        method: 'GET',
        url: `${payrollBaseUrl}/ai/payroll/payslip?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['payroll', 'slip', 'gaji'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Claim expense status API',
        slug: 'claim_expense_status',
        description: 'Gunakan Tools ini untuk mendapatkan status claim expense status',
        method: 'GET',
        url: `${payrollBaseUrl}/ai/claims/claim-expense-status?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['klaim', 'reimburse', 'expense'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Advance claim API',
        slug: 'advance_claim',
        description: 'Gunakan Tools ini untuk mendapatkan status dana talangan atau advance claim',
        method: 'GET',
        url: `${payrollBaseUrl}/ai/claims/advance-claim-status?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['payroll', 'claims', 'advance'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Advance claim API total',
        slug: 'advance_claim_total',
        description: 'Gunakan Tools ini untuk mendapatkan total dana talangan atau advance claim',
        method: 'GET',
        url: `${payrollBaseUrl}/ai/claims/advance-claim-total?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['claim', 'advance', 'total'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Advance claim API unreported',
        slug: 'advance_claim_unreported',
        description: 'Gunakan Tools ini untuk mendapatkan informasi advance claim unreported',
        method: 'GET',
        url: `${payrollBaseUrl}/ai/claims/advance-claim-unreported?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['claim', 'advance', 'unreported'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Travel request API status',
        slug: 'travel_request_status',
        description: 'Gunakan Tools ini untuk mendapatkan status travel request',
        method: 'GET',
        url: `${payrollBaseUrl}/ai/claims/travel-request-status?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['perjalanan', 'dinas', 'travel'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Travel request API total',
        slug: 'travel_request_total',
        description: 'Gunakan Tools ini untuk mendapatkan total travel request',
        method: 'GET',
        url: `${payrollBaseUrl}/ai/claims/travel-request-total?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['payroll', 'claims', 'travel', 'total'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Travel request API unreported',
        slug: 'travel_request_unreported',
        description: 'Gunakan Tools ini untuk mendapatkan informasi travel request unreported',
        method: 'GET',
        url: `${payrollBaseUrl}/ai/claims/travel-request-unreported?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['payroll', 'claims', 'travel', 'unreported'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Get employee detail',
        slug: 'get_employee_detail',
        description: 'Gunakan Tools ini untuk mendapatkan informasi detail karyawan',
        method: 'GET',
        url: `${employeeBaseUrl}/ai/employee-detail?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['employee', 'profile'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Get WFH request status',
        slug: 'request_wfh',
        description: 'Gunakan Tools ini untuk mendapatkan status pengajuan WFH',
        method: 'GET',
        url: `${attendanceBaseUrl}/ai/attendance/attendance-request-wfh?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['attendance', 'wfh', 'request'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Get tukar shift status',
        slug: 'request_tukar_shift',
        description: 'Gunakan Tools ini untuk mendapatkan informasi tukar shift status',
        method: 'GET',
        url: `${attendanceBaseUrl}/ai/attendance/attendance-request-tukar-shift?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['attendance', 'shift', 'request', 'tukar-shift'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Get overtime request status',
        slug: 'request_overtime',
        description: 'Gunakan Tools ini untuk mendapatkan status pengajuan lembur atau overtime',
        method: 'GET',
        url: `${attendanceBaseUrl}/ai/attendance/attendance-request-overtime?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['attendance', 'overtime', 'request'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        name: 'Get leave approval status',
        slug: 'get_leave_approval',
        description: 'Gunakan Tools ini untuk mendapatkan status pengajuan leave',
        method: 'GET',
        url: `${attendanceBaseUrl}/ai/attendance/leave-approval?employee_id={employee_id}`,
        authType: 'none',

        headers: null,

        authConfig: JSON.stringify({
          in: 'header',
          key: 'Authorization',
          value: '${BEARER_TOKEN}'
        }),

        bodyTemplate: null,

        tags: ['attendance', 'leave', 'approval'],

        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      // {
      //   name: 'Get Vehicle Rental Assignment',
      //   slug: 'get_vehicle_assignment',
      //   description: 'Gunakan Tools ini untuk mengetahui data rental kendaraan yang sedang disewa, setatus kendaraan.',
      //   method: 'GET',
      //   url: `https://api.sevaqu.com/api/v2/service_vehicle/vehicle-assignments/ai-summary`,
      //   authType: 'none',

      //   headers: null,

      //   authConfig: JSON.stringify({
      //     in: 'header',
      //     key: 'Authorization',
      //     value: '${BEARER_TOKEN}'
      //   }),

      //   bodyTemplate: null,

      //   tags: ['kendaraan', 'vehicle', 'rental'],

      //   isActive: true,
      //   createdAt: now,
      //   updatedAt: now,
      // }
    ])
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('tools', {
      slug: ['get_weather', 'get_time', 'checkin_trouble', 'leave_allocation_api', 'get_shift', 'get_payslip', 'claim_expense_status', 'advance_claim', 'advance_claim_total', 'advance_claim_unreported', 'travel_request_status', 'travel_request_total', 'travel_request_unreported', 'get_employee_detail', 'request_wfh', 'request_tukar_shift', 'request_overtime', 'get_leave_approval', 'get_vehicle_assignment'],
    })
  },
}