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
        tags: ['attendance', 'absensi', 'hr', 'faq'],
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
        tags: ['leave', 'cuti', 'izin', 'hr', 'faq'],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: 'salary_faq',
        title: 'FAQ Gaji',
        description: 'Pertanyaan umum tentang gaji',
        content: `
**Kapan Gajian?**
- Gajian cair setiap tanggal 1 setiap bulannya
- Jika tanggal 1 jatuh di hari libur/weekend, gajian akan cair pada hari kerja sebelumnya

**Transfer Gagal/Salah**
- Segera laporkan ke HR atau Finance maksimal H+2 setelah tanggal gajian
- Sertakan bukti transfer gagal atau nomor rekening yang salah

**Keterlambatan Pembayaran**
- Jika gajian terlambat, HR akan memberikan informasi resmi
- Pembayaran akan diproses pada hari kerja berikutnya

**Cek Slip Gaji**
- Slip gaji tersedia di aplikasi Workin mulai tanggal 1 setiap bulan
- Pilih menu Karyawan → Slip Gaji untuk mengunduh atau melihat slip

**Perubahan Data Rekening**
- Ajukan perubahan rekening melalui formulir yang tersedia di HR atau melalui aplikasi Workin
- Perubahan akan efektif pada periode gajian berikutnya
        `,
        type: 'faq',
        tags: ['salary', 'gaji', 'payroll', 'finance', 'faq'],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: 'advance_claim_faq',
        title: 'FAQ Dana Talangan',
        description: 'Pertanyaan umum tentang dana talangan',
        content: `
**Apa itu Dana Talangan?**
Dana Talangan adalah fasilitas pinjaman sementara bagi karyawan untuk keperluan mendesak sebelum gajian

**Siapa yang berhak mengajukan?**
- Karyawan tetap dengan masa kerja minimal 1 tahun
- Telah melewati masa percobaan (probay)
- Karyawan tidak sedang dalam proses disipliner

**Berapa maksimum nilai dana talangan yang bisa diajukan?**
- Maksimum 50% dari gaji bersih per bulan
- Tidak melebihi batas maksimal yang ditetapkan perusahaan (misalnya Rp2.000.000)

**Bagaimana prosedur mengajukan dana talangan?**
1. Buka aplikasi Workin
2. Pilih menu Dana Talangan
3. Isi jumlah yang dibutuhkan dan alasan mendesak
4. Ajukan ke atasan langsung untuk persetujuan
5. Setelah disetujui, dana akan ditransfer dalam 2 hari kerja

**Bagaimana cara pelunasan dana talangan?**
- Pelunasan otomatis melalui potongan gaji pada bulan berikutnya
- Jumlah pelunasan dapat dilihat pada slip gaji

**Apa yang terjadi jika karyawan resign saat masih memiliki dana talangan aktif?**
- Sisa dana talangan akan dipotong dari gaji terakhir (pesangon/exit clearance)
- Jika jumlah dana talangan melebihi hak yang akan diterima, karyawan wajib melunasi selisihnya

**Berapa lama proses pencairan dana talangan?**
- Maksimal 2 hari kerja setelah pengajuan disetujui
- Untuk keadaan darurat ekstrem, proses dapat dipercepat

**Apakah ada bunga atau biaya administrasi?**
- Bebas bunga
- Hanya dikenakan biaya administrasi Rp25.000
        `,
        type: 'faq',
        tags: ['advance-claim', 'dana-talangan', 'pinjaman', 'finance', 'faq'],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },

      {
        slug: 'claim_expense_faq',
        title: 'FAQ Klaim Reimburse',
        description: 'Pertanyaan umum tentang klaim reimburse',
        content: `
**Apa itu Klaim Reimburse?**
Klaim Reimburse adalah penggantian biaya yang telah dikeluarkan karyawan sesuai kebijakan perusahaan

**Jenis-jenis klaim yang bisa diajukan:**
1. Biaya perjalanan dinas (tiket, hotel, transportasi)
2. Biaya representasi
3. Biaya operasional
4. Biaya medis (jika tidak ditanggung BPJS)
5. Biaya lain yang telah disetujui sebelumnya

**Apa saja syarat dokumen yang diperlukan?**
- Invoice/nota asli dari vendor
- Bukti pembayaran (struk ATM, e-receipt, transfer)
- Foto kwitansi (jika kwitansi fisik)
- Surat tugas (untuk perjalanan dinas)
- Justifikasi bisnis yang jelas

**Bagaimana prosedur mengajukan klaim?**
1. Buka aplikasi Workin
2. Pilih menu Klaim Reimburse
3. Isi detail klaim dan unggah bukti pendukung
4. Ajukan ke atasan langsung
5. Setelah disetujui, klaim akan diteruskan ke Finance untuk verifikasi
6. Pembayaran dalam 5 hari kerja

**Batas waktu pelaporan klaim?**
Maksimal 5 hari kerja setelah pengeluaran biaya dilakukan

**Bagaimana jika dokumen hilang?**
- Ajukan surat pernyataan kehilangan
- Dapatkan surat keterangan dari vendor terkait
- Memerlukan persetujuan khusus dari atasan dan Finance

**Apa yang terjadi jika klaim ditolak?**
- Anda akan mendapatkan notifikasi dengan alasan penolakan
- Perbaiki dokumen atau informasi yang kurang, lalu ajukan kembali
- Jika masih ada perbedaan, ajukan banding melalui HR
        `,
        type: 'faq',
        tags: ['claim-expense', 'reimburse', 'klaim', 'finance', 'faq'],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: 'travel_request_faq',
        title: 'FAQ Perjalanan Dinas',
        description: 'Pertanyaan umum tentang perjalanan dinas',
        content: `
**Apa itu Surat Tugas Perjalanan Dinas?**
Dokumen resmi yang memberikan otorisasi karyawan untuk melakukan perjalanan atas nama perusahaan

**Jenis perjalanan dinas:**
1. Internal meeting
2. Client meeting
3. Training/seminar
4. Konferensi
5. Kunjungan cabang

**Berapa lama proses pengajuan perjalanan dinas?**
Maksimal 3 hari kerja sebelum tanggal keberangkatan

**Dokumen apa saja yang diperlukan?**
- Tujuan perjalanan
- Jadwal perjalanan (tanggal, jam, lokasi)
- Estimasi biaya
- Nama rekan perjalanan (jika ada)
- Justifikasi bisnis

**Siapa yang perlu memberikan persetujuan?**
1. Atasan langsung
2. Head of Department (HOD)
3. Finance (untuk verifikasi anggaran)

**Berapa lama batas waktu klaim reimbursement setelah perjalanan selesai?**
Maksimal 5 hari kerja setelah kembali dari perjalanan

**Apa yang terjadi jika jadwal perjalanan berubah?**
- Ajukan revisi jadwal minimal 1 hari sebelum tanggal semula
- Jika perubahan mendadak saat perjalanan, informasikan segera via chat

**Apakah bisa mendapatkan advance untuk perjalanan dinas?**
Ya, bisa mengajukan dana talangan khusus perjalanan dinas dengan batas maksimal 80% dari estimasi biaya
        `,
        type: 'faq',
        tags: ['travel-request', 'perjalanan-dinas', 'surat-tugas', 'finance', 'faq'],
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
        'leave_faq',
        'salary_faq',
        'advance_claim_faq',
        'claim_expense_faq',
        'travel_request_faq'
      ],
    })
  },
}