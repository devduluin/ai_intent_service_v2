'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date()

    // 🔥 Ambil tools yg sudah di-seed
    const tools = await queryInterface.sequelize.query(
      `SELECT id, slug FROM tools
       WHERE slug IN ('get_weather','get_time', 'checkin_trouble', 'leave_allocation_api', 'get_shift', 'get_payslip', 'claim_expense_status', 'advance_claim', 'advance_claim_total', 'advance_claim_unreported', 'travel_request_status', 'travel_request_total', 'travel_request_unreported', 'get_employee_detail', 'request_wfh', 'request_tukar_shift', 'request_overtime', 'get_leave_approval')`,
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
        toolId: toolMap['get_weather'],
        name: 'city',
        type: 'string',
        label: 'Nama Kota',
        description: 'Nama kota yang ingin dicek cuacanya',
        isRequired: true,
        extractPrompt: 'nama kota atau provinsi (contoh: Jakarta, Surabaya, Bali). Jika tidak disebutkan, jawab "Jakarta"',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan nama kota',
          minLength: 2,
          maxLength: 50
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['get_time'],
        name: 'timezone',
        type: 'select',
        label: 'Zona Waktu',
        description: 'Timezone dalam format Area/Location',
        isRequired: true,
        extractPrompt: 'timezone dalam format Area/Location (contoh: Asia/Jakarta, Europe/London). Jika tidak disebutkan, jawab "Asia/Jakarta"',
        defaultValue: 'Asia/Jakarta',
        config: JSON.stringify({
          options: [
            { label: 'Jakarta (WIB)', value: 'Asia/Jakarta' },
            { label: 'Pontianak (WIB)', value: 'Asia/Pontianak' },
            { label: 'Makassar (WITA)', value: 'Asia/Makassar' },
            { label: 'Jayapura (WIT)', value: 'Asia/Jayapura' },
            { label: 'London', value: 'Europe/London' },
            { label: 'New York', value: 'America/New_York' },
            { label: 'Tokyo', value: 'Asia/Tokyo' }
          ]
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['checkin_trouble'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['leave_allocation_api'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['get_shift'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['get_payslip'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['claim_expense_status'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['advance_claim'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['advance_claim_total'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['advance_claim_unreported'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['travel_request_status'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['travel_request_total'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['travel_request_unreported'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['get_employee_detail'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['request_wfh'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['request_wfh'],
        name: 'date',
        type: 'date',
        label: 'Tanggal WFH',
        description: 'Tanggal rencana WFH',
        isRequired: true,
        extractPrompt: 'Tanggal rencana WFH (format: YYYY-MM-DD). Jika tidak disebutkan, gunakan tanggal hari ini',
        defaultValue: '[datenow]',
        config: JSON.stringify({
          format: 'YYYY-MM-DD',
          allowRelative: true,
          placeholder: 'YYYY-MM-DD'
        }),
        order: 2,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['request_tukar_shift'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['request_overtime'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        toolId: toolMap['get_leave_approval'],
        name: 'employee_id',
        type: 'string',
        label: 'Employee ID',
        description: 'Employee ID atau NIK',
        isRequired: true,
        extractPrompt: 'Employee ID atau ID Karyawan. Jika tidak disebutkan, gunakan dari passing data',
        defaultValue: '',
        config: JSON.stringify({
          placeholder: 'Masukkan Employee ID',
          pattern: '^[A-Z0-9]+$',
          minLength: 5,
          maxLength: 20
        }),
        order: 1,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      },
      // {
      //   toolId: toolMap['get_vehicle_assignment'],
      //   name: 'company_id',
      //   type: 'string',
      //   label: 'Company ID',
      //   description: 'Company ID',
      //   isRequired: true,
      //   extractPrompt: 'Company ID. Jika tidak disebutkan, gunakan dari passing data',
      //   defaultValue: '',
      //   config: JSON.stringify({
      //     placeholder: 'Masukkan Company ID',
      //     pattern: '^[A-Z0-9]+$',
      //     minLength: 3,
      //     maxLength: 10
      //   }),
      //   order: 1,
      //   isHidden: false,
      //   createdAt: now,
      //   updatedAt: now,
      // },
      // {
      //   toolId: toolMap['get_vehicle_assignment'],
      //   name: 'status',
      //   type: 'select',
      //   label: 'Status Kendaraan',
      //   description: 'Status kendaraan',
      //   isRequired: true,
      //   extractPrompt: 'Status kendaraan. Jika tidak disebutkan, Tanyakan status : active, leave, exit',
      //   defaultValue: 'exit',
      //   config: JSON.stringify({
      //     options: [
      //       { label: 'Aktif', value: 'active' },
      //       { label: 'Cuti/Izin', value: 'leave' },
      //       { label: 'Keluar', value: 'exit' }
      //     ]
      //   }),
      //   order: 2,
      //   isHidden: false,
      //   createdAt: now,
      //   updatedAt: now,
      // },
      // {
      //   toolId: toolMap['get_vehicle_assignment'],
      //   name: 'date',
      //   type: 'date',
      //   label: 'Tanggal',
      //   description: 'Tanggal pengecekan',
      //   isRequired: true,
      //   extractPrompt: 'Tanggal. Jika tidak disebutkan, gunakan dari date hari ini',
      //   defaultValue: '[datenow]',
      //   config: JSON.stringify({
      //     format: 'YYYY-MM-DD',
      //     allowRelative: true,
      //     placeholder: 'YYYY-MM-DD'
      //   }),
      //   order: 3,
      //   isHidden: false,
      //   createdAt: now,
      //   updatedAt: now,
      // },
      // {
      //   toolId: toolMap['get_vehicle_assignment'],
      //   name: 'search',
      //   type: 'string',
      //   label: 'Kata Kunci Pencarian',
      //   description: 'Nama Driver, Plat nomor atau nomor polisi',
      //   isRequired: false,
      //   extractPrompt: 'Nama Driver atau nomor polisi. Jika tidak disebutkan, gunakan dari passing data',
      //   defaultValue: '',
      //   config: JSON.stringify({
      //     placeholder: 'Cari berdasarkan nama driver atau nomor polisi',
      //     minLength: 2,
      //     maxLength: 50
      //   }),
      //   order: 4,
      //   isHidden: false,
      //   createdAt: now,
      //   updatedAt: now,
      // }
      // ── Get Time → tidak butuh parameter tambahan ─────────
      // (contoh intent tanpa parameter — tidak ada row di sini)
    ], {})
  },

  async down(queryInterface) {
    const tools = await queryInterface.sequelize.query(
      `SELECT id FROM tools WHERE slug IN ('get_weather', 'get_time', 'checkin_trouble', 'leave_allocation_api', 'get_shift', 'get_payslip', 'claim_expense_status', 'advance_claim', 'advance_claim_total', 'advance_claim_unreported', 'travel_request_status', 'travel_request_total', 'travel_request_unreported', 'get_employee_detail', 'request_wfh', 'request_tukar_shift', 'request_overtime', 'get_leave_approval')`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )
    const ids = tools.map((i) => i.id)
    if (ids.length > 0) {
      await queryInterface.bulkDelete('tools_parameters', { toolId: ids }, {})
    }
  },
}
