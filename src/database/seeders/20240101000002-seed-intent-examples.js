'use strict'

module.exports = {
  async up(queryInterface) {
    const now = new Date()

    // Ambil ID intent yg sudah di-seed
    const intents = await queryInterface.sequelize.query(
      `SELECT id, slug FROM intents 
       WHERE slug IN ('greeting','utilities','attendance','knowledge_workin','shift','leave_allocation', 'get_employee_detail', 'request_wfh', 'request_tukar_shift', 'request_overtime', 'get_leave_approval', 'get_payslip', 'claim_expense_status', 'advance_claim_status', 'advance_claim_total', 'advance_claim_unreported', 'travel_request_status', 'travel_request_total', 'travel_request_unreported')`,
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
      { intent: 'attendance', text: 'Kenapa saya tidak bisa absen?', language: 'id' },
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

      // ======================================================
      // GET SHIFT
      // ======================================================
      { intent: 'shift', text: 'Cek jadwal absensi hari ini', language: 'id' },
      { intent: 'shift', text: 'Cek jadwal masuk hari ini', language: 'id' },
      { intent: 'shift', text: 'Cek jadwal pulang hari ini', language: 'id' },
      { intent: 'shift', text: 'Cek jadwal saya', language: 'id' },
      { intent: 'shift', text: 'Cek jadwal absensi minggu ini', language: 'id' },
      { intent: 'shift', text: 'Cek jadwal absensi minggu depan', language: 'id' },
      { intent: 'shift', text: 'Apakah saya punya jadwal kerja besok?', language: 'id' },

      { intent: 'shift', text: 'Check my schedule today', language: 'en' },
      { intent: 'shift', text: 'Check my schedule', language: 'en' },
      { intent: 'shift', text: 'Check my schedule', language: 'en' },
      { intent: 'shift', text: 'Check my work schedule for this week', language: 'en' },
      { intent: 'shift', text: 'Check my work schedule for next week', language: 'en' },
      { intent: 'shift', text: 'Do I have a work schedule tomorrow?', language: 'en' },

      // ======================================================
      // GET LEAVE ALLOCATION
      // ======================================================
      { intent: 'leave_allocation', text: 'Sisa cuti tahunan saya berapa?', language: 'id' },
      { intent: 'leave_allocation', text: 'Berapa sisa cuti saya tahun ini?', language: 'id' },
      { intent: 'leave_allocation', text: 'Berapa sisa cuti saya tahun ini?', language: 'id' },
      { intent: 'leave_allocation', text: 'Berapa jatah cuti tahunan saya?', language: 'id' },
      { intent: 'leave_allocation', text: 'Cuti tahunan saya sisa berapa hari?', language: 'id' },
      { intent: 'leave_allocation', text: 'Cuti tahunan saya sisa berapa hari?', language: 'id' },

      { intent: 'leave_allocation', text: 'How many annual leave days do I have left?', language: 'en' },
      { intent: 'leave_allocation', text: 'How many leave days do I have left this year?', language: 'en' },
      { intent: 'leave_allocation', text: 'How many leave days do I have left this year?', language: 'en' },
      { intent: 'leave_allocation', text: 'What is my annual leave entitlement?', language: 'en' },
      { intent: 'leave_allocation', text: 'How many days of annual leave do I have remaining?', language: 'en' },
      { intent: 'leave_allocation', text: 'How many days of annual leave do I have remaining?', language: 'en' },

      // ======================================================
      // GET PAYSLIP
      // ======================================================
      { intent: 'get_payslip', text: 'Cek slip gaji', language: 'id' },
      { intent: 'get_payslip', text: 'slip gaji saya', language: 'id' },
      { intent: 'get_payslip', text: 'slip gaji bulan ini', language: 'id' },
      { intent: 'get_payslip', text: 'slip gaji bulan lalu', language: 'id' },

      { intent: 'get_payslip', text: 'Check payslip', language: 'en' },
      { intent: 'get_payslip', text: 'My payslip', language: 'en' },
      { intent: 'get_payslip', text: 'Payslip this month', language: 'en' },
      { intent: 'get_payslip', text: 'Payslip last month', language: 'en' },

      // ======================================================
      // GET CLAIM EXPENSE STATUS
      // ======================================================
      { intent: 'claim_expense_status', text: 'Cek status klaim reimburse', language: 'id' },
      { intent: 'claim_expense_status', text: 'status klaim reimburse saya', language: 'id' },
      { intent: 'claim_expense_status', text: 'status klaim reimburse bulan ini', language: 'id' },
      { intent: 'claim_expense_status', text: 'status klaim reimburse bulan lalu', language: 'id' },

      { intent: 'claim_expense_status', text: 'Check claim expense status', language: 'en' },
      { intent: 'claim_expense_status', text: 'My claim expense status', language: 'en' },
      { intent: 'claim_expense_status', text: 'Claim expense status this month', language: 'en' },
      { intent: 'claim_expense_status', text: 'Claim expense status last month', language: 'en' },

      // ======================================================
      // GET ADVANCE CLAIM STATUS
      // ======================================================
      { intent: 'advance_claim_status', text: 'Cek status dana talangan', language: 'id' },
      { intent: 'advance_claim_status', text: 'status dana talangan saya', language: 'id' },
      { intent: 'advance_claim_status', text: 'status dana talangan bulan ini', language: 'id' },
      { intent: 'advance_claim_status', text: 'status dana talangan bulan lalu', language: 'id' },

      { intent: 'advance_claim_status', text: 'Check advance claim status', language: 'en' },
      { intent: 'advance_claim_status', text: 'My advance claim status', language: 'en' },
      { intent: 'advance_claim_status', text: 'Advance claim status this month', language: 'en' },
      { intent: 'advance_claim_status', text: 'Advance claim status last month', language: 'en' },

      // ======================================================
      // GET ADVANCE CLAIM TOTAL
      // ======================================================
      { intent: 'advance_claim_total', text: 'Berapa total dana talangan?', language: 'id' },
      { intent: 'advance_claim_total', text: 'total dana talangan saya', language: 'id' },
      { intent: 'advance_claim_total', text: 'total dana talangan bulan ini', language: 'id' },
      { intent: 'advance_claim_total', text: 'total dana talangan bulan lalu', language: 'id' },

      { intent: 'advance_claim_total', text: 'Check advance claim total', language: 'en' },
      { intent: 'advance_claim_total', text: 'My advance claim total', language: 'en' },
      { intent: 'advance_claim_total', text: 'Advance claim total this month', language: 'en' },
      { intent: 'advance_claim_total', text: 'Advance claim total last month', language: 'en' },

      // ======================================================
      // GET ADVANCE CLAIM UNSUCCESS
      // ======================================================
      { intent: 'advance_claim_unreported', text: 'Cek status dana talangan', language: 'id' },
      { intent: 'advance_claim_unreported', text: 'status dana talangan saya', language: 'id' },
      { intent: 'advance_claim_unreported', text: 'status dana talangan bulan ini', language: 'id' },
      { intent: 'advance_claim_unreported', text: 'status dana talangan bulan lalu', language: 'id' },

      { intent: 'advance_claim_unreported', text: 'Check advance claim unreported', language: 'en' },
      { intent: 'advance_claim_unreported', text: 'My advance claim unreported', language: 'en' },
      { intent: 'advance_claim_unreported', text: 'Advance claim unreported this month', language: 'en' },
      { intent: 'advance_claim_unreported', text: 'Advance claim unreported last month', language: 'en' },

      // ======================================================
      // GET TRAVEL REQUEST STATUS
      // ======================================================
      { intent: 'travel_request_status', text: 'Cek status perjalanan dinas', language: 'id' },
      { intent: 'travel_request_status', text: 'status perjalanan dinas saya', language: 'id' },
      { intent: 'travel_request_status', text: 'status perjalanan dinas bulan ini', language: 'id' },
      { intent: 'travel_request_status', text: 'status perjalanan dinas bulan lalu', language: 'id' },

      { intent: 'travel_request_status', text: 'Check travel request status', language: 'en' },
      { intent: 'travel_request_status', text: 'My travel request status', language: 'en' },
      { intent: 'travel_request_status', text: 'Travel request status this month', language: 'en' },
      { intent: 'travel_request_status', text: 'Travel request status last month', language: 'en' },

      // ======================================================
      // GET TRAVEL REQUEST TOTAL
      // ======================================================
      { intent: 'travel_request_total', text: 'Berapa total perjalanan dinas?', language: 'id' },
      { intent: 'travel_request_total', text: 'total perjalanan dinas saya', language: 'id' },
      { intent: 'travel_request_total', text: 'total perjalanan dinas bulan ini', language: 'id' },
      { intent: 'travel_request_total', text: 'total perjalanan dinas bulan lalu', language: 'id' },

      { intent: 'travel_request_total', text: 'Check travel request total', language: 'en' },
      { intent: 'travel_request_total', text: 'My travel request total', language: 'en' },
      { intent: 'travel_request_total', text: 'Travel request total this month', language: 'en' },
      { intent: 'travel_request_total', text: 'Travel request total last month', language: 'en' },

      // ======================================================
      // GET TRAVEL REQUEST UNSUCCESS
      // ======================================================
      { intent: 'travel_request_unreported', text: 'Cek status perjalanan dinas', language: 'id' },
      { intent: 'travel_request_unreported', text: 'status perjalanan dinas saya', language: 'id' },
      { intent: 'travel_request_unreported', text: 'status perjalanan dinas bulan ini', language: 'id' },
      { intent: 'travel_request_unreported', text: 'status perjalanan dinas bulan lalu', language: 'id' },

      { intent: 'travel_request_unreported', text: 'Check travel request unreported', language: 'en' },
      { intent: 'travel_request_unreported', text: 'My travel request unreported', language: 'en' },
      { intent: 'travel_request_unreported', text: 'Travel request unreported this month', language: 'en' },
      { intent: 'travel_request_unreported', text: 'Travel request unreported last month', language: 'en' },

      // ======================================================
      // GET EMPLOYEE DETAIL
      // ======================================================
      { intent: 'get_employee_detail', text: 'Tampilkan detail karyawan saya', language: 'id' },
      { intent: 'get_employee_detail', text: 'tampilkan detail karyawan', language: 'id' },
      { intent: 'get_employee_detail', text: 'detail karyawan', language: 'id' },

      { intent: 'get_employee_detail', text: 'Show my employee detail', language: 'en' },
      { intent: 'get_employee_detail', text: 'Show employee detail', language: 'en' },
      { intent: 'get_employee_detail', text: 'Employee detail', language: 'en' },

      // ======================================================
      // GET REQUEST WFH
      // ======================================================
      { intent: 'request_wfh', text: 'Cek status WFH', language: 'id' },
      { intent: 'request_wfh', text: 'status WFH saya', language: 'id' },
      { intent: 'request_wfh', text: 'status WFH bulan ini', language: 'id' },
      { intent: 'request_wfh', text: 'status WFH bulan lalu', language: 'id' },

      { intent: 'request_wfh', text: 'Check WFH status', language: 'en' },
      { intent: 'request_wfh', text: 'My WFH status', language: 'en' },
      { intent: 'request_wfh', text: 'WFH status this month', language: 'en' },
      { intent: 'request_wfh', text: 'WFH status last month', language: 'en' },

      // ======================================================
      // GET REQUEST TUKAR SHIFT
      // ======================================================
      { intent: 'request_tukar_shift', text: 'Cek status tukar shift', language: 'id' },
      { intent: 'request_tukar_shift', text: 'status tukar shift saya', language: 'id' },
      { intent: 'request_tukar_shift', text: 'status tukar shift bulan ini', language: 'id' },
      { intent: 'request_tukar_shift', text: 'status tukar shift bulan lalu', language: 'id' },

      { intent: 'request_tukar_shift', text: 'Check tukar shift status', language: 'en' },
      { intent: 'request_tukar_shift', text: 'My tukar shift status', language: 'en' },
      { intent: 'request_tukar_shift', text: 'Tukar shift status this month', language: 'en' },
      { intent: 'request_tukar_shift', text: 'Tukar shift status last month', language: 'en' },

      // ======================================================
      // GET REQUEST LEMBUR
      // ======================================================
      { intent: 'request_overtime', text: 'Cek status izin lembur', language: 'id' },
      { intent: 'request_overtime', text: 'status izin lembur saya', language: 'id' },
      { intent: 'request_overtime', text: 'status izin lembur bulan ini', language: 'id' },
      { intent: 'request_overtime', text: 'status izin lembur bulan lalu', language: 'id' },

      { intent: 'request_overtime', text: 'Check overtime status', language: 'en' },
      { intent: 'request_overtime', text: 'My overtime status', language: 'en' },
      { intent: 'request_overtime', text: 'Overtime status this month', language: 'en' },
      { intent: 'request_overtime', text: 'Overtime status last month', language: 'en' },

      // ======================================================
      // GET REQUEST CUTI
      // ======================================================
      { intent: 'get_leave_approval', text: 'Cek status cuti', language: 'id' },
      { intent: 'get_leave_approval', text: 'status cuti saya', language: 'id' },
      { intent: 'get_leave_approval', text: 'status cuti bulan ini', language: 'id' },
      { intent: 'get_leave_approval', text: 'status cuti bulan lalu', language: 'id' },

      { intent: 'get_leave_approval', text: 'Check cuti status', language: 'en' },
      { intent: 'get_leave_approval', text: 'My cuti status', language: 'en' },
      { intent: 'get_leave_approval', text: 'Cuti status this month', language: 'en' },
      { intent: 'get_leave_approval', text: 'Cuti status last month', language: 'en' },
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
       WHERE slug IN ('greeting','utilities','attendance','knowledge_workin','shift','leave_allocation', 'get_employee_detail', 'request_wfh', 'request_tukar_shift', 'request_overtime', 'get_leave_approval', 'get_payslip', 'claim_expense_status', 'advance_claim_status', 'advance_claim_total', 'advance_claim_unreported', 'travel_request_status', 'travel_request_total', 'travel_request_unreported')`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    const ids = intents.map((i) => i.id)
    if (ids.length > 0) {
      await queryInterface.bulkDelete('intent_examples', { intentId: ids })
    }
  },
}