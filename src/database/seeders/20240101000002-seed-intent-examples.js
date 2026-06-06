'use strict'

module.exports = {
  async up(queryInterface) {
    const now = new Date()

    // Ambil ID intent yg sudah di-seed
    const intents = await queryInterface.sequelize.query(
      `SELECT id, slug FROM intents
       WHERE slug IN ('greeting','utilities','attendance', 'overtime', 'knowledge_workin','shift','leave', 'employee', 'payslip', 'claim', 'travel_request', 'xls_generator', 'data_analyzer', 'vehicles')`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    const intentMap = {}
    for (const intent of intents) {
      intentMap[intent.slug] = intent.id
    }

    // ======================================================
    // INTENT EXAMPLES (SUPER IMPORTANT FOR INTENT MATCHING)
    // Production-ready with diverse variations, synonyms, and natural language patterns
    // ======================================================
    const examples = [

      // ======================================================
      // GREETING INTENT - Simple greetings and bot introduction
      // ======================================================
      { intent:'greeting', text:'Halo', language:'id'},
      { intent:'greeting', text:'Hai', language:'id'},
      { intent:'greeting', text:'Selamat pagi', language:'id'},
      { intent:'greeting', text:'Selamat siang', language:'id'},
      { intent:'greeting', text:'Selamat sore', language:'id'},
      { intent:'greeting', text:'Selamat malam', language:'id'},
      { intent:'greeting', text:'Hai bot', language:'id'},
      { intent:'greeting', text:'Halo bot', language:'id'},
      { intent:'greeting', text:'Assalamualaikum', language:'id'},
      { intent:'greeting', text:'Pagi', language:'id'},
      { intent:'greeting', text:'Siang', language:'id'},
      { intent:'greeting', text:'Sore', language:'id'},
      { intent:'greeting', text:'Malam', language:'id'},
      { intent:'greeting', text:'Kamu siapa?', language:'id'},
      { intent:'greeting', text:'Anda bot apa manusia?', language:'id'},
      { intent:'greeting', text:'Saya butuh bantuan', language:'id'},
      { intent:'greeting', text:'Saya mau tanya sesuatu', language:'id'},
      { intent:'greeting', text:'Bisa bantu saya?', language:'id'},
      { intent:'greeting', text:'Tolong bantu saya', language:'id'},
      { intent:'greeting', text:'Permisi', language:'id'},
      { intent:'greeting', text:'Tes', language:'id'},
      { intent:'greeting', text:'Test', language:'id'},

      { intent: 'greeting', text: 'Hello', language: 'en' },
      { intent: 'greeting', text: 'Hi', language: 'en' },
      { intent: 'greeting', text: 'Hey', language: 'en' },
      { intent: 'greeting', text: 'Good morning', language: 'en' },
      { intent: 'greeting', text: 'Good afternoon', language: 'en' },
      { intent: 'greeting', text: 'Good evening', language: 'en' },
      { intent: 'greeting', text: 'Good night', language: 'en' },
      { intent: 'greeting', text: 'Who are you?', language: 'en' },
      { intent: 'greeting', text: 'What are you?', language: 'en' },
      { intent: 'greeting', text: 'Introduce yourself', language: 'en' },
      { intent: 'greeting', text: 'Can you help me?', language: 'en' },
      { intent: 'greeting', text: 'I need help', language: 'en' },
      { intent: 'greeting', text: 'Help me please', language: 'en' },


      // ======================================================
      // UTILITIES INTENT - Time, date, current info, weather
      // ======================================================
      { intent: 'utilities', text: 'Jam berapa sekarang?', language: 'id' },
      { intent: 'utilities', text: 'Sekarang jam berapa?', language: 'id' },
      { intent: 'utilities', text: 'Pukul berapa?', language: 'id' },
      { intent: 'utilities', text: 'Sekarang tanggal berapa?', language: 'id' },
      { intent: 'utilities', text: 'Hari ini tanggal berapa?', language: 'id' },
      { intent: 'utilities', text: 'Hari ini hari apa?', language: 'id' },
      { intent: 'utilities', text: 'Waktu sekarang berapa?', language: 'id' },
      { intent: 'utilities', text: 'Kasih tau jam sekarang', language: 'id' },
      { intent: 'utilities', text: 'Jam berapa di bandung?', language: 'id' },
      { intent: 'utilities', text: 'Jam berapa di jakarta?', language: 'id' },
      { intent: 'utilities', text: 'Tanggal berapa hari ini?', language: 'id' },
      { intent: 'utilities', text: 'Bulan apa sekarang?', language: 'id' },
      { intent: 'utilities', text: 'Tahun berapa sekarang?', language: 'id' },
      { intent: 'utilities', text: 'Hari apa hari ini?', language: 'id' },
      { intent: 'utilities', text: 'Informasi waktu', language: 'id' },

      // Weather - Cuaca
      { intent: 'utilities', text: 'Cuaca sekarang bagaimana?', language: 'id' },
      { intent: 'utilities', text: 'Cuaca hari ini bagaimana?', language: 'id' },
      { intent: 'utilities', text: 'Cuaca di lokasi saya bagaimana?', language: 'id' },
      { intent: 'utilities', text: 'Bagaimana cuaca sekarang?', language: 'id' },
      { intent: 'utilities', text: 'Informasi cuaca', language: 'id' },
      { intent: 'utilities', text: 'Cek cuaca', language: 'id' },
      { intent: 'utilities', text: 'Cuaca apa hari ini?', language: 'id' },
      { intent: 'utilities', text: 'Akan hujan tidak hari ini?', language: 'id' },
      { intent: 'utilities', text: 'Apa ada hujan hari ini?', language: 'id' },
      { intent: 'utilities', text: 'Prediksi cuaca hari ini', language: 'id' },
      { intent: 'utilities', text: 'Suhu sekarang berapa?', language: 'id' },
      { intent: 'utilities', text: 'Berapa derajat cuaca sekarang?', language: 'id' },
      { intent: 'utilities', text: 'Prakiraan cuaca minggu ini', language: 'id' },
      { intent: 'utilities', text: 'Status cuaca Jakarta', language: 'id' },
      { intent: 'utilities', text: 'Cuaca panas atau dingin?', language: 'id' },

      { intent: 'utilities', text: 'What is the weather?', language: 'en' },
      { intent: 'utilities', text: 'What time is it?', language: 'en' },
      { intent: 'utilities', text: 'What is the weather today?', language: 'en' },
      // { intent: 'utilities', text: 'How is the weather?', language: 'en' },
      // { intent: 'utilities', text: 'What is the weather like?', language: 'en' },
      // { intent: 'utilities', text: 'Weather forecast', language: 'en' },
      // { intent: 'utilities', text: 'Weather in Jakarta', language: 'en' },
      // { intent: 'utilities', text: 'Weather in Bandung', language: 'en' },
      // { intent: 'utilities', text: 'Current weather', language: 'en' },
      // { intent: 'utilities', text: 'Today weather condition', language: 'en' },
      // { intent: 'utilities', text: 'Will it rain today?', language: 'en' },
      // { intent: 'utilities', text: 'Is it going to rain?', language: 'en' },
      // { intent: 'utilities', text: 'What is the temperature?', language: 'en' },
      // { intent: 'utilities', text: 'How hot is it today?', language: 'en' },
      // { intent: 'utilities', text: 'Current temperature', language: 'en' },
      // { intent: 'utilities', text: 'Weather forecast tomorrow', language: 'en' },
      // { intent: 'utilities', text: 'Tomorrow weather', language: 'en' },
      // { intent: 'utilities', text: 'Weekly forecast', language: 'en' },
      // { intent: 'utilities', text: 'Humidity level', language: 'en' },
      // { intent: 'utilities', text: 'Wind speed', language: 'en' },
      // { intent: 'utilities', text: 'Weather alert', language: 'en' },
      // { intent: 'utilities', text: 'Local weather', language: 'en' },
      // { intent: 'utilities', text: 'Real time weather update', language: 'en' },
      // { intent: 'utilities', text: 'Current time please', language: 'en' },
      // { intent: 'utilities', text: "What's today's date?", language: 'en' },
      // { intent: 'utilities', text: 'Tell me the current date', language: 'en' },
      // { intent: 'utilities', text: 'What day is it today?', language: 'en' },
      // { intent: 'utilities', text: 'What month is it?', language: 'en' },
      // { intent: 'utilities', text: 'What year is it?', language: 'en' },
      // { intent: 'utilities', text: 'Is today a holiday?', language: 'en' },
      // { intent: 'utilities', text: 'Current date and time', language: 'en' },
      // { intent: 'utilities', text: 'Local time', language: 'en' },


      // ======================================================
      // ATTENDANCE INTENT - Check attendance, presency, WFH, shift swap
      // ======================================================
      { intent:'attendance', text:'Saya ingin cek absensi', language:'id'},
      { intent:'attendance', text:'Saya ingin lihat kehadiran saya', language:'id'},
      { intent:'attendance', text:'Ada masalah dengan absensi saya', language:'id'},
      { intent:'attendance', text:'Saya mau lihat riwayat kehadiran', language:'id'},
      { intent:'attendance', text:'Informasi kehadiran saya', language:'id'},
      { intent:'attendance', text:'Data absensi saya bagaimana?', language:'id'},
      { intent:'attendance', text:'Saya ingin tahu status kehadiran saya', language:'id'},
      { intent:'attendance', text:'Saya ingin cek presensi', language:'id'},
      { intent:'attendance', text:'Tentang absensi saya', language:'id'},
      { intent:'attendance', text:'Masalah presensi kerja', language:'id'},
      { intent:'attendance', text:'Cek absen hari ini', language:'id'},
      { intent:'attendance', text:'Cek absen bulan ini', language:'id'},
      { intent:'attendance', text:'Riwayat absen saya', language:'id'},
      { intent:'attendance', text:'Status absensi', language:'id'},
      { intent:'attendance', text:'Apakah saya sudah absen?', language:'id'},
      { intent:'attendance', text:'Saya belum absen', language:'id'},
      { intent:'attendance', text:'Lupa absen', language:'id'},
      { intent:'attendance', text:'Absen pagi', language:'id'},
      { intent:'attendance', text:'Absen pulang', language:'id'},
      { intent:'attendance', text:'Cek status WFH', language:'id'},
      { intent:'attendance', text:'Status WFH saya', language:'id'},
      { intent:'attendance', text:'WFH bulan ini', language:'id'},
      { intent:'attendance', text:'Cek status tukar shift', language:'id'},
      { intent:'attendance', text:'Tukar shift saya', language:'id'},
      { intent:'attendance', text:'Status tukar shift bulan ini', language:'id'},
      { intent:'attendance', text:'Saya mau tukar shift', language:'id'},
      { intent:'attendance', text:'Cara tukar shift', language:'id'},
      { intent:'attendance', text:'Permintaan tukar shift', language:'id'},
      { intent:'attendance', text:'Saya WFH hari ini', language:'id'},
      { intent:'attendance', text:'Izin WFH', language:'id'},

      { intent: 'attendance', text: 'Check my attendance today', language: 'en' },
      { intent: 'attendance', text: 'Did I check in today?', language: 'en' },
      { intent: 'attendance', text: 'My attendance history', language: 'en' },
      { intent: 'attendance', text: 'Am I late today?', language: 'en' },
      { intent: 'attendance', text: 'Check my attendance record', language: 'en' },
      { intent: 'attendance', text: 'Attendance status', language: 'en' },
      { intent: 'attendance', text: 'Check WFH status', language: 'en' },
      { intent: 'attendance', text: 'My WFH status', language: 'en' },
      { intent: 'attendance', text: 'Check shift swap status', language: 'en' },
      { intent: 'attendance', text: 'My shift swap request', language: 'en' },


      // ======================================================
      // KNOWLEDGE WORKIN - RAG knowledge base, app usage, FAQ
      // ======================================================
      { intent:'knowledge_workin', text: 'Bagaimana cara absen di Workin?', language: 'id' },
      { intent:'knowledge_workin', text:'Cara pakai aplikasi Workin', language:'id'},
      { intent:'knowledge_workin', text:'Butuh bantuan aplikasi', language:'id'},
      { intent:'knowledge_workin', text:'Panduan penggunaan Workin', language:'id'},
      { intent:'knowledge_workin', text:'Help Workin', language:'id'},
      { intent:'knowledge_workin', text:'Tutorial aplikasi', language:'id'},
      { intent:'knowledge_workin', text:'FAQ Workin', language:'id'},
      { intent:'knowledge_workin', text:'Cara menggunakan Workin', language:'id'},
      { intent:'knowledge_workin', text:'Fitur Workin apa saja?', language:'id'},
      { intent:'knowledge_workin', text:'Apa itu Workin?', language:'id'},
      { intent:'knowledge_workin', text:'Workin itu apa?', language:'id'},
      { intent:'knowledge_workin', text:'Cara request cuti di Workin', language:'id'},
      { intent:'knowledge_workin', text:'Cara cek absen di Workin', language:'id'},
      { intent:'knowledge_workin', text:'Cara lihat gaji di Workin', language:'id'},
      { intent:'knowledge_workin', text:'Panduan lengkap Workin', language:'id'},
      { intent:'knowledge_workin', text:'Dokumentasi Workin', language:'id'},
      { intent:'knowledge_workin', text:'Cara kerja Workin', language:'id'},
      { intent:'knowledge_workin', text:'Informasi aplikasi Workin', language:'id'},
      { intent:'knowledge_workin', text:'Bantuan teknis Workin', language:'id'},
      { intent:'knowledge_workin', text:'Troubleshooting Workin', language:'id'},

      { intent: 'knowledge_workin', text: 'How to use Workin app?', language: 'en' },
      { intent: 'knowledge_workin', text: 'What is Workin?', language: 'en' },
      { intent: 'knowledge_workin', text: 'How to request leave in Workin?', language: 'en' },
      { intent: 'knowledge_workin', text: 'How to check attendance in Workin?', language: 'en' },
      { intent: 'knowledge_workin', text: 'Workin app features', language: 'en' },
      { intent: 'knowledge_workin', text: 'Workin user guide', language: 'en' },
      { intent: 'knowledge_workin', text: 'Workin tutorial', language: 'en' },
      { intent: 'knowledge_workin', text: 'Workin FAQ', language: 'en' },
      { intent: 'knowledge_workin', text: 'Workin help', language: 'en' },
      { intent: 'knowledge_workin', text: 'Workin documentation', language: 'en' },


      // ======================================================
      // SHIFT - Work schedule, shift schedule, roster
      // ======================================================
      { intent:'shift', text:'Saya ingin cek jadwal kerja', language:'id'},
      { intent:'shift', text:'Saya ingin lihat jadwal kerja saya', language:'id'},
      { intent:'shift', text:'Informasi jadwal kerja', language:'id'},
      { intent:'shift', text:'Tentang jadwal shift saya', language:'id'},
      { intent:'shift', text:'Saya ingin tahu jadwal masuk kerja', language:'id'},
      { intent:'shift', text:'Masalah jadwal kerja', language:'id'},
      { intent:'shift', text:'Cek schedule kerja', language:'id'},
      { intent:'shift', text:'Jadwal kerja saya bagaimana?', language:'id'},
      { intent:'shift', text:'Saya ingin info schedule', language:'id'},
      { intent:'shift', text:'Jadwal shift minggu ini', language:'id'},
      { intent:'shift', text:'Jadwal shift bulan ini', language:'id'},
      { intent:'shift', text:'Jadwal shift minggu depan', language:'id'},
      { intent:'shift', text:'Kapan saya kerja?', language:'id'},
      { intent:'shift', text:'Shift saya kapan?', language:'id'},
      { intent:'shift', text:'Roster kerja', language:'id'},
      { intent:'shift', text:'Jadwal roster', language:'id'},
      { intent:'shift', text:'Shift pagi atau sore?', language:'id'},
      { intent:'shift', text:'Jam masuk kerja', language:'id'},
      { intent:'shift', text:'Jam pulang kerja', language:'id'},
      { intent:'shift', text:'Libur saya kapan?', language:'id'},
      { intent:'shift', text:'Hari kerja saya', language:'id'},

      { intent: 'shift', text: 'Check my schedule today', language: 'en' },
      { intent: 'shift', text: 'Check my work schedule', language: 'en' },
      { intent: 'shift', text: 'Check my work schedule for this week', language: 'en' },
      { intent: 'shift', text: 'Check my work schedule for next week', language: 'en' },
      { intent: 'shift', text: 'Do I have a work schedule tomorrow?', language: 'en' },
      { intent: 'shift', text: 'My shift schedule', language: 'en' },
      { intent: 'shift', text: 'Work roster', language: 'en' },
      { intent: 'shift', text: 'Shift roster', language: 'en' },
      { intent: 'shift', text: 'When is my next shift?', language: 'en' },
      { intent: 'shift', text: 'What is my work schedule?', language: 'en' },


      // ======================================================
      // LEAVE - Annual leave, leave balance, leave request
      // ======================================================
      { intent: 'leave', text: 'Sisa cuti tahunan saya berapa?', language: 'id' },
      { intent: 'leave', text: 'Berapa sisa cuti saya tahun ini?', language: 'id' },
      { intent: 'leave', text: 'Berapa jatah cuti tahunan saya?', language: 'id' },
      { intent: 'leave', text: 'Cuti tahunan saya sisa berapa hari?', language: 'id' },
      { intent: 'leave', text:'Saya ingin cek cuti', language:'id'},
      { intent:'leave', text:'Tentang cuti saya', language:'id'},
      { intent: 'leave', text:'Informasi cuti', language:'id'},
      { intent: 'leave', text:'Saya mau urusan cuti', language:'id'},
      { intent: 'leave', text:'Masalah cuti saya', language:'id'},
      { intent: 'leave', text:'Saya ingin tahu jatah cuti', language:'id'},
      { intent: 'leave', text:'Saya ingin lihat data cuti', language:'id'},
      { intent: 'leave', text:'Pengajuan cuti', language:'id'},
      { intent: 'leave', text:'Tentang izin kerja', language:'id'},
      { intent: 'leave', text:'Cuti saya masih ada berapa?', language:'id'},
      { intent: 'leave', text:'Kuota cuti tahunan', language:'id'},
      { intent: 'leave', text:'Cara request cuti', language:'id'},
      { intent: 'leave', text:'Ajukan cuti', language:'id'},
      { intent: 'leave', text:'Cuti tahunan', language:'id'},
      { intent: 'leave', text:'Cuti sakit', language:'id'},
      { intent: 'leave', text:'Cuti melahirkan', language:'id'},
      { intent: 'leave', text:'Cuti haid', language:'id'},
      { intent: 'leave', text:'Cuti alasan penting', language:'id'},
      { intent: 'leave', text:'Izin tidak masuk kerja', language:'id'},

      { intent: 'leave', text: 'How many annual leave days do I have left?', language: 'en' },
      { intent: 'leave', text: 'How many leave days do I have left this year?', language: 'en' },
      { intent: 'leave', text: 'What is my annual leave entitlement?', language: 'en' },
      { intent: 'leave', text: 'How many days of annual leave do I have remaining?', language: 'en' },
      { intent: 'leave', text: 'Check my leave balance', language: 'en' },
      { intent: 'leave', text: 'My leave balance', language: 'en' },
      { intent: 'leave', text: 'Request leave', language: 'en' },
      { intent: 'leave', text: 'Apply for leave', language: 'en' },
      { intent: 'leave', text: 'Annual leave', language: 'en' },
      { intent: 'leave', text: 'Sick leave', language: 'en' },
      { intent: 'leave', text: 'Maternity leave', language: 'en' },


      // ======================================================
      // PAYSLIP - Salary, payslip, payroll, income
      // ======================================================
      { intent:'payslip', text:'Saya ingin lihat gaji', language:'id'},
      { intent:'payslip', text:'Tentang slip gaji saya', language:'id'},
      { intent:'payslip', text:'Informasi penggajian', language:'id'},
      { intent:'payslip', text:'Data gaji saya', language:'id'},
      { intent:'payslip', text:'Masalah gaji', language:'id'},
      { intent:'payslip', text:'Saya mau cek payroll', language:'id'},
      { intent:'payslip', text:'Tentang penghasilan saya', language:'id'},
      { intent:'payslip', text:'Slip gaji bulan ini', language:'id'},
      { intent:'payslip', text:'Slip gaji bulan lalu', language:'id'},
      { intent:'payslip', text:'Gaji saya berapa?', language:'id'},
      { intent:'payslip', text:'Cek gaji', language:'id'},
      { intent:'payslip', text:'Riwayat gaji', language:'id'},
      { intent:'payslip', text:'Detail gaji', language:'id'},
      { intent:'payslip', text:'Komponen gaji', language:'id'},
      { intent:'payslip', text:'Potongan gaji', language:'id'},
      { intent:'payslip', text:'Tunjangan', language:'id'},
      { intent:'payslip', text:'Bonus', language:'id'},
      { intent:'payslip', text:'THR', language:'id'},
      { intent:'payslip', text:'Lembur di gaji', language:'id'},

      { intent: 'payslip', text: 'Check payslip', language: 'en' },
      { intent: 'payslip', text: 'My payslip', language: 'en' },
      { intent: 'payslip', text: 'Payslip this month', language: 'en' },
      { intent: 'payslip', text: 'Payslip last month', language: 'en' },
      { intent: 'payslip', text: 'Check my salary', language: 'en' },
      { intent: 'payslip', text: 'My salary information', language: 'en' },
      { intent: 'payslip', text: 'Payroll information', language: 'en' },
      { intent: 'payslip', text: 'Salary details', language: 'en' },
      { intent: 'payslip', text: 'Download payslip', language: 'en' },
      { intent: 'payslip', text: 'Salary history', language: 'en' },


      // ======================================================
      // CLAIM - Expense claim, reimbursement, dana talangan
      // ======================================================
      { intent:'claim', text:'Saya ingin cek klaim', language:'id'},
      { intent:'claim', text:'Tentang reimburse saya', language:'id'},
      { intent:'claim', text:'Informasi klaim biaya', language:'id'},
      { intent:'claim', text:'Masalah reimburse', language:'id'},
      { intent:'claim', text:'Pengajuan klaim', language:'id'},
      { intent:'claim', text:'Tentang expense saya', language:'id'},
      { intent:'claim', text:'Urusan reimbursement', language:'id'},
      { intent: 'claim', text: 'Cek status dana talangan', language: 'id' },
      { intent: 'claim', text: 'Status dana talangan saya', language: 'id' },
      { intent: 'claim', text: 'Status dana talangan bulan ini', language: 'id' },
      { intent: 'claim', text: 'Status dana talangan bulan lalu', language: 'id' },
      { intent: 'claim', text: 'Berapa total dana talangan?', language: 'id' },
      { intent: 'claim', text: 'Total dana talangan saya', language: 'id' },
      { intent: 'claim', text: 'Total dana talangan bulan ini', language: 'id' },
      { intent: 'claim', text: 'Total dana talangan bulan lalu', language: 'id' },
      { intent:'claim', text:'Klaim transportasi', language:'id'},
      { intent:'claim', text:'Klaim makan', language:'id'},
      { intent:'claim', text:'Klaim akomodasi', language:'id'},
      { intent:'claim', text:'Reimburse biaya', language:'id'},
      { intent:'claim', text:'Claim expense', language:'id'},
      { intent:'claim', text:'Status klaim', language:'id'},
      { intent:'claim', text:'Proses klaim', language:'id'},
      { intent:'claim', text:'Dana talangan belum cair', language:'id'},
      { intent:'claim', text:'Klaim ditolak', language:'id'},

      { intent: 'claim', text: 'Check claim expense status', language: 'en' },
      { intent: 'claim', text: 'My claim expense status', language: 'en' },
      { intent: 'claim', text: 'Claim expense status this month', language: 'en' },
      { intent: 'claim', text: 'Claim expense status last month', language: 'en' },
      { intent: 'claim', text: 'Check advance claim status', language: 'en' },
      { intent: 'claim', text: 'My advance claim status', language: 'en' },
      { intent: 'claim', text: 'Advance claim total', language: 'en' },
      { intent: 'claim', text: 'Reimbursement status', language: 'en' },
      { intent: 'claim', text: 'Expense claim', language: 'en' },
      { intent: 'claim', text: 'Travel claim', language: 'en' },


      // ======================================================
      // TRAVEL REQUEST - Business trip, perjalanan dinas
      // ======================================================
      { intent:'travel_request', text:'Perjalanan dinas saya', language:'id'},
      { intent:'travel_request', text:'Tentang dinas kerja', language:'id'},
      { intent:'travel_request', text:'Saya ingin cek perjalanan dinas', language:'id'},
      { intent:'travel_request', text:'Informasi business trip', language:'id'},
      { intent:'travel_request', text:'Pengajuan perjalanan dinas', language:'id'},
      { intent:'travel_request', text:'Masalah perjalanan dinas', language:'id'},
      { intent:'travel_request', text:'Berapa total perjalanan dinas?', language: 'id' },
      { intent:'travel_request', text:'Total perjalanan dinas saya', language: 'id' },
      { intent:'travel_request', text:'Total perjalanan dinas bulan ini', language: 'id' },
      { intent:'travel_request', text:'Total perjalanan dinas bulan lalu', language: 'id' },
      { intent:'travel_request', text:'Status travel request', language:'id'},
      { intent:'travel_request', text:'Dinas luar kota', language:'id'},
      { intent:'travel_request', text:'Dinas luar negeri', language:'id'},
      { intent:'travel_request', text:'Tiket pesawat dinas', language:'id'},
      { intent:'travel_request', text:'Hotel dinas', language:'id'},
      { intent:'travel_request', text:'Anggaran perjalanan dinas', language:'id'},
      { intent:'travel_request', text:'Surat tugas', language:'id'},

      { intent: 'travel_request', text: 'Check travel request status', language: 'en' },
      { intent: 'travel_request', text: 'My travel request status', language: 'en' },
      { intent: 'travel_request', text: 'Travel request status this month', language: 'en' },
      { intent: 'travel_request', text: 'Travel request status last month', language: 'en' },
      { intent: 'travel_request', text: 'Check travel request total', language: 'en' },
      { intent: 'travel_request', text: 'My travel request total', language: 'en' },
      { intent: 'travel_request', text: 'Business trip', language: 'en' },
      { intent: 'travel_request', text: 'Work trip', language: 'en' },
      { intent: 'travel_request', text: 'Corporate travel', language: 'en' },


      // ======================================================
      // EMPLOYEE - Employee profile, personal data
      // ======================================================
      { intent: 'employee', text: 'Tampilkan detail karyawan saya', language: 'id' },
      { intent: 'employee', text: 'Tampilkan data karyawan', language: 'id' },
      { intent: 'employee', text: 'Profil saya', language: 'id' },
      { intent: 'employee', text: 'Data pribadi saya', language: 'id' },
      { intent: 'employee', text: 'Informasi karyawan', language: 'id' },
      { intent: 'employee', text: 'Detail karyawan', language: 'id' },
      { intent: 'employee', text: 'NIK saya berapa', language: 'id' },
      { intent: 'employee', text: 'Nomor karyawan', language: 'id' },
      { intent: 'employee', text: 'Jabatan saya', language: 'id' },
      { intent: 'employee', text: 'Departemen saya', language: 'id' },
      { intent: 'employee', text: 'Manager saya', language: 'id' },
      { intent: 'employee', text: 'Lokasi kerja saya', language: 'id' },
      { intent: 'employee', text: 'Tanggal bergabung', language: 'id' },
      { intent: 'employee', text: 'Status karyawan', language: 'id' },
      { intent: 'employee', text: 'Employee ID saya', language: 'id' },

      { intent: 'employee', text: 'Show my employee detail', language: 'en' },
      { intent: 'employee', text: 'Show employee detail', language: 'en' },
      { intent: 'employee', text: 'Employee detail', language: 'en' },
      { intent: 'employee', text: 'My profile', language: 'en' },
      { intent: 'employee', text: 'My employee information', language: 'en' },
      { intent: 'employee', text: 'Employee ID', language: 'en' },
      { intent: 'employee', text: 'My job title', language: 'en' },
      { intent: 'employee', text: 'My department', language: 'en' },
      { intent: 'employee', text: 'My manager', language: 'en' },


      // ======================================================
      // OVERTIME - Overtime request, lembur
      // ======================================================
      { intent:'overtime', text: 'Cek status izin lembur', language: 'id' },
      { intent:'overtime', text: 'Status izin lembur saya', language: 'id' },
      { intent:'overtime', text: 'Status izin lembur bulan ini', language: 'id' },
      { intent:'overtime', text: 'Status izin lembur bulan lalu', language: 'id' },
      { intent:'overtime', text:'Saya ingin cek lembur', language:'id'},
      { intent:'overtime', text:'Tentang overtime saya', language:'id'},
      { intent:'overtime', text:'Informasi lembur', language:'id'},
      { intent:'overtime', text:'Pengajuan lembur', language:'id'},
      { intent:'overtime', text:'Masalah lembur', language:'id'},
      { intent:'overtime', text:'Cara request lembur', language:'id'},
      { intent:'overtime', text:'Ajukan lembur', language:'id'},
      { intent:'overtime', text:'Lembur hari ini', language:'id'},
      { intent:'overtime', text:'Lembur minggu ini', language:'id'},
      { intent:'overtime', text:'Jam lembur', language:'id'},
      { intent:'overtime', text:'Bayaran lembur', language:'id'},
      { intent:'overtime', text:'Rate lembur', language:'id'},
      { intent:'overtime', text:'Approval lembur', language:'id'},

      { intent: 'overtime', text: 'Check overtime status', language: 'en' },
      { intent: 'overtime', text: 'My overtime status', language: 'en' },
      { intent: 'overtime', text: 'Overtime status this month', language: 'en' },
      { intent: 'overtime', text: 'Overtime status last month', language: 'en' },
      { intent: 'overtime', text: 'Request overtime', language: 'en' },
      { intent: 'overtime', text: 'Apply for overtime', language: 'en' },
      { intent: 'overtime', text: 'Overtime request', language: 'en' },
      { intent: 'overtime', text: 'Overtime pay', language: 'en' },
      { intent: 'overtime', text: 'Overtime rate', language: 'en' },


      // ======================================================
      // XLS GENERATOR - Generate Excel/CSV reports, export data
      // ======================================================
      { intent: 'xls_generator', text: 'Buat laporan Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Generate laporan Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Export data ke Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Download laporan Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Buat file Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Export ke format Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Buat spreadsheet', language: 'id' },
      { intent: 'xls_generator', text: 'Generate spreadsheet', language: 'id' },
      { intent: 'xls_generator', text: 'Export data ke spreadsheet', language: 'id' },
      { intent: 'xls_generator', text: 'Buat laporan CSV', language: 'id' },
      { intent: 'xls_generator', text: 'Generate file CSV', language: 'id' },
      { intent: 'xls_generator', text: 'Export ke CSV', language: 'id' },
      { intent: 'xls_generator', text: 'Download CSV', language: 'id' },
      { intent: 'xls_generator', text: 'Convert ke CSV', language: 'id' },
      { intent: 'xls_generator', text: 'Buat file CSV', language: 'id' },
      { intent: 'xls_generator', text: 'Export data karyawan ke Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Buat laporan absensi Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Generate report Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Export attendance to Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Download employee data Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Buat laporan gaji Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Export payslip to Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Generate leave report Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Buat laporan cuti CSV', language: 'id' },
      { intent: 'xls_generator', text: 'Export claim data Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Download laporan CSV', language: 'id' },
      { intent: 'xls_generator', text: 'Buat tabel Excel', language: 'id' },
      { intent: 'xls_generator', text: 'Export data ke format CSV', language: 'id' },
      { intent: 'xls_generator', text: 'Generate Excel dari data', language: 'id' },
      { intent: 'xls_generator', text: 'Convert data ke Excel', language: 'id' },

      { intent: 'xls_generator', text: 'Create Excel report', language: 'en' },
      { intent: 'xls_generator', text: 'Generate Excel file', language: 'en' },
      { intent: 'xls_generator', text: 'Export to Excel', language: 'en' },
      { intent: 'xls_generator', text: 'Download Excel report', language: 'en' },
      { intent: 'xls_generator', text: 'Create spreadsheet', language: 'en' },
      { intent: 'xls_generator', text: 'Export data to spreadsheet', language: 'en' },
      { intent: 'xls_generator', text: 'Generate CSV file', language: 'en' },
      { intent: 'xls_generator', text: 'Export to CSV', language: 'en' },
      { intent: 'xls_generator', text: 'Download CSV', language: 'en' },
      { intent: 'xls_generator', text: 'Create CSV report', language: 'en' },

      { intent: 'data_analyzer', text: 'Coba analisa', language: 'id' },
      { intent: 'data_analyzer', text: 'Analisis data', language: 'id' },
      { intent: 'data_analyzer', text: 'Cari pola dalam data', language: 'id' },
      { intent: 'data_analyzer', text: 'Jelaskan data', language: 'id' },
      { intent: 'data_analyzer', text: 'Buat analisis data', language: 'id' },
      { intent: 'data_analyzer', text: 'Lakukan analisa data', language: 'id' },

      { intent: 'data_analyzer', text: 'Try data analysis', language: 'en' },


      { intent: 'vehicles', text: 'Assignment kendaraan hari ini', language: 'id' },
      { intent: 'vehicles', text: 'Assignment kendaraan exit kemarin', language: 'id' },
      { intent: 'vehicles', text: 'kendaraan yang exit besok', language: 'id' },
      { intent: 'vehicles', text: 'Daftar assignment kendaraan', language: 'id' },
      { intent: 'vehicles', text: 'Kendaraan yang sudah diassign', language: 'id' },
      { intent: 'vehicles', text: 'Vehicle assignment aktif', language: 'id' },
      { intent: 'vehicles', text: 'Assignment kendaraan yang berjalan', language: 'id' },
      { intent: 'vehicles', text: 'Kendaraan yang belum memiliki assignment', language: 'id' },
      { intent: 'vehicles', text: 'Assignment kendaraan untuk driver', language: 'id' },
      { intent: 'vehicles', text: 'Driver dan kendaraan yang diassign', language: 'id' },
      { intent: 'vehicles', text: 'Kendaraan yang sedang digunakan', language: 'id' },
      { intent: 'vehicles', text: 'Assignment kendaraan berdasarkan driver', language: 'id' },
      { intent: 'vehicles', text: 'Data vehicle assignment aktif', language: 'id' },
      { intent: 'vehicles', text: 'Assignment kendaraan yang selesai', language: 'id' },
      { intent: 'vehicles', text: 'Riwayat assignment kendaraan', language: 'id' },
      { intent: 'vehicles', text: 'Kendaraan yang dipakai hari ini', language: 'id' },
      { intent: 'vehicles', text: 'Assignment mobil operasional', language: 'id' },
      { intent: 'vehicles', text: 'Kendaraan yang sedang bertugas', language: 'id' },
      { intent: 'vehicles', text: 'Vehicle assignment terbaru', language: 'id' },

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
       WHERE slug IN ('greeting','utilities','attendance', 'overtime', 'knowledge_workin','shift','leave', 'claim', 'employee', 'payslip', 'travel_request', 'xls_generator', 'data_analyzer', 'vehicles')`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    )

    const ids = intents.map((i) => i.id)
    if (ids.length > 0) {
      await queryInterface.bulkDelete('intent_examples', { intentId: ids })
    }
  },
}
