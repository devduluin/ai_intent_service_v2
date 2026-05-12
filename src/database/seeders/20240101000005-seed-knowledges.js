'use strict'

module.exports = {
  async up(queryInterface) {
    const now = new Date()

    await queryInterface.bulkInsert('knowledge', [

      {
        slug: 'attendance_faq',
        title: 'FAQ Absensi',
        description: 'Pertanyaan umum tentang absensi',
        content: `
**Lupa Absen**
- Hubungi HR maksimal H+1 untuk koreksi manual
- Lampirkan bukti kehadiran (foto selfie/timeline)

**Absen dari luar kantor**
- Wajib dapat persetujuan atasan via email/chat
- Gunakan fitur presensi dengan status tugas dilur di aplikasi workin

**Tidak Bisa Absen**
- Pastikan koneksi internet stabil
- Wajib periksa shift atau jadwal hari ini
- Restart aplikasi Workin dan coba lagi
- Hubungi HR anda jika masalah berlanjut
- Jika masih ada kendala, anda juga bisa pakai offline mode

        `,
        type: 'faq',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        slug: 'leave_faq',
        title: 'FAQ Izin & Cuti',
        description: 'Pertanyaan umum tentang pengajuan izin dan cuti',
        content: `
**Cara Mengajukan Izin**
- Buka menu Cuti & Izin pada aplikasi Workin
- Pilih jenis izin yang tersedia
- Isi tanggal dan alasan
- Kirim pengajuan untuk persetujuan atasan

**Batas Waktu Pengajuan**
- Izin mendadak: maksimal H+1 setelah kejadian
- Cuti terencana: minimal 3 hari sebelum tanggal cuti

**Status Pengajuan**
- Pending → menunggu persetujuan atasan
- Approved → izin disetujui
- Rejected → izin ditolak (cek catatan atasan)

**Izin Mendadak**
- Wajib informasikan atasan via chat/telepon
- Ajukan izin di aplikasi Workin setelah kondisi memungkinkan

**Pembatalan Izin**
- Bisa dibatalkan selama status masih Pending
- Jika sudah Approved, hubungi HR untuk perubahan

**Sisa Cuti**
- Sisa cuti dapat dilihat pada dashboard aplikasi Workin
- Reset cuti mengikuti kebijakan perusahaan
        `,
        type: 'faq',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

    ])
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('knowledge', {
      slug: [
        'attendance_faq',
        'leave_faq'
      ],
    })
  },
}