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
- Gunakan fitur "Lokasi Tidak Terjangkau" di aplikasi

**Telat Absen**
- 3x telat dalam sebulan = teguran lisan
- 5x telat = surat peringatan

**Tidak Bisa Absen**
- Pastikan koneksi internet stabil
- Wajib periksa shift atau jadwal hari ini
- Restart aplikasi dan coba lagi
- Hubungi HR anda jika masalah berlanjut

**Sakit & Izin**
- Upload surat dokter/dokumen pendukung
- HR akan proses dalam 1x24 jam
- HR akan menghubungi atasan untuk persetujuan
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
        'attendance_faq'
      ],
    })
  },
}