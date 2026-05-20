-- ============================================================
-- SEED HRIS COMPANY — AI Dashboard Admin Workin by Duluin
-- Khusus agent: hris_company
-- Semua nama fitur, menu, dan tombol sesuai dashboard asli
-- Jalankan: psql -U postgres -d ai_intent -f seed_hris_company.sql
-- ============================================================

-- ============================================================
-- 1. AGENT
-- ============================================================
INSERT INTO agents (id, name, slug, description, "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'HRIS Company Dashboard', 'hris_company', 'Agent khusus AI dashboard admin perusahaan', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE slug = 'hris_company');

-- ============================================================
-- 2. KNOWLEDGE (DELETE + INSERT)
-- ============================================================
DELETE FROM knowledge WHERE slug IN ('attendance_faq','attendance_guide','employee_faq','employee_guide','payroll_faq','leave_faq','claim_faq');

INSERT INTO knowledge (id, slug, title, description, content, type, "isActive", "ingestionStatus", "createdAt", "updatedAt")
VALUES
(
  gen_random_uuid(),
  'attendance_faq',
  'FAQ Shift & Attendance',
  'Pertanyaan umum seputar fitur Shift & Attendance',
  E'Apa itu fitur Shift & Attendance di Workin?\nFitur Shift & Attendance digunakan untuk mengelola jadwal shift dan mencatat kehadiran karyawan. Karyawan melakukan check-in dan check-out melalui aplikasi mobile menggunakan GPS dan selfie. Admin bisa memantau kehadiran secara real-time dari halaman Attendance Data di dashboard.\n\nSubmenu yang tersedia:\n- Attendance Data: melihat rekap kehadiran seluruh karyawan dalam tabel\n- Attendance Request: pengajuan koreksi absensi oleh karyawan\n- Employee Activities: melihat aktivitas harian karyawan\n- Attendance Report: export rekap kehadiran\n- Monitoring Maps: melihat posisi karyawan secara real-time di peta\n\nBagaimana cara melihat data kehadiran karyawan?\n1. Klik menu Shift & Attendance di sidebar\n2. Pilih Attendance Data\n3. Filter tanggal hari ini, lihat kolom Attendance Status\n4. Karyawan dengan status Absent berarti belum melakukan absensi\n5. Gunakan tombol Filter untuk filter berdasarkan Company, Shift Type, Attendance Status, atau Approval Status\n{{BASE_URL}}/dashboard/attendances/attendances\n\nBagaimana cara koreksi absensi karyawan?\n1. Buka menu Shift & Attendance, pilih Attendance Request\n2. Klik Add New untuk membuat pengajuan baru, atau cari pengajuan yang sudah ada\n3. Ubah jam masuk / jam keluar sesuai kebutuhan\n4. Setelah approve, status berubah menjadi Approved\n{{BASE_URL}}/dashboard/attendances/request\n\nBagaimana cara export rekap kehadiran?\n1. Buka halaman Attendance Data\n2. Klik tombol Export\n3. Pilih format: Export Excel, Export PDF, Export CSV, atau Copy Data\n4. File akan otomatis terunduh\n{{BASE_URL}}/dashboard/attendances/attendances\n\nApa saja status kehadiran yang tersedia?\nSetiap baris data kehadiran menampilkan:\n- Attendance Status: Present, Absent, Half Day, Leave, Work From Home, Late Entry, Early Exit\n- Approval Status: Submit (menunggu), Approved, Rejected\n- Check-in Status: On Time atau X mins late / X mins early\n- Check-out Status: On Time atau X mins late / X mins early\nTombol Approval di atas tabel bisa digunakan untuk Approve atau Reject secara bulk.\n{{BASE_URL}}/dashboard/attendances/attendances\n\nApakah bisa melihat lokasi absensi karyawan?\nYa. Setiap absensi via GPS tercatat titik lokasinya. Buka Monitoring Maps untuk melihat posisi karyawan secara real-time di peta.\n{{BASE_URL}}/dashboard/attendances/monitoring',
  'faq',
  true,
  'idle',
  NOW(),
  NOW()
),
(
  gen_random_uuid(),
  'attendance_guide',
  'Panduan Shift & Attendance',
  'Langkah-langkah pengelolaan kehadiran dan shift',
  E'Cara Melihat Attendance Data:\n1. Login ke dashboard\n2. Klik menu Shift & Attendance di sidebar kiri\n3. Pilih Attendance Data\n4. Pilih tanggal atau rentang waktu\n5. Tabel menampilkan: Employee Name, Company Name, Attendance Date, Time In, Time Out, Check-in Status, Check-out Status, Attendance Status\n6. Gunakan kolom pencarian Search here... untuk mencari karyawan\n7. Klik tombol Filter untuk filter berdasar Company, Shift Type, Attendance Status, Approval Status, Date Range\n8. Klik tombol Export dan pilih Export Excel / Export PDF / Export CSV / Copy Data\n{{BASE_URL}}/dashboard/attendances/attendances\n\nCara Approve Absensi (Bulk):\n1. Centang karyawan yang ingin diapprove/direject\n2. Klik tombol Approval\n3. Pilih Approve atau Reject\n4. Klik Apply\n5. Notifikasi akan muncul: "{n} attendance successfully approved"\n{{BASE_URL}}/dashboard/attendances/attendances\n\nCara Koreksi via Attendance Request:\n1. Buka menu Shift & Attendance\n2. Pilih Attendance Request\n3. Klik Add New untuk request baru\n4. Atau klik Update pada baris yang sudah ada untuk edit\n5. Isi data koreksi, simpan\n6. Status akan berubah setelah diapprove\n{{BASE_URL}}/dashboard/attendances/request\n\nCara Monitoring via Maps:\n1. Buka menu Shift & Attendance\n2. Pilih Monitoring Maps\n3. Lihat posisi karyawan secara real-time di peta\n{{BASE_URL}}/dashboard/attendances/monitoring',
  'article',
  true,
  'idle',
  NOW(),
  NOW()
),
(
  gen_random_uuid(),
  'employee_faq',
  'FAQ Employees',
  'Pertanyaan umum seputar fitur Employees',
  E'Apa itu fitur Employees di Workin?\nFitur Employees digunakan untuk mengelola seluruh data karyawan: data personal, departemen, jabatan, grade, dan dokumen. Admin bisa menambah, mengedit, mengimport, atau menonaktifkan karyawan dari halaman Employees Data.\n\nSubmenu yang tersedia:\n- Employees Data: daftar dan detail seluruh karyawan\n- Branches: data cabang perusahaan\n- Departments: data departemen\n- Designations: data jabatan\n- Employee Grades: data grade / level\n- Import Employee: import data karyawan massal via Excel\n\nBagaimana cara menambah karyawan baru?\n1. Klik menu Employees di sidebar\n2. Pilih Employees Data\n3. Klik tombol Add New di pojok kanan atas\n4. Isi data: Employee Name, Employee ID, Company, Designation, Department, Branch, Contact Address, Mobile, dan lainnya\n5. Klik Simpan\n{{BASE_URL}}/dashboard/employees/employees/add\n\nBagaimana cara mencari karyawan tertentu?\n1. Buka halaman Employees Data\n2. Gunakan kolom pencarian Search here... dan ketik nama atau Employee ID\n3. Atau klik tombol Filter untuk filter berdasarkan Company, Department, Designation, Status, Contract Status\n{{BASE_URL}}/dashboard/employees/employees\n\nBagaimana cara menonaktifkan karyawan yang resign?\n1. Buka halaman Employees Data\n2. Cari karyawan, klik Update pada baris yang bersangkutan\n3. Ubah Status menjadi Inactive atau Employee Exit\n4. Isi informasi terakhir, simpan\n{{BASE_URL}}/dashboard/employees/employees\n\nBagaimana cara import karyawan massal?\n1. Buka menu Employees\n2. Pilih Import Employee\n3. Download template Excel\n4. Isi data sesuai template\n5. Upload file dan klik Import\n{{BASE_URL}}/dashboard/employees/import\n\nApa saja status karyawan?\n- Active: karyawan aktif\n- Inactive: karyawan nonaktif\n- New Employee: karyawan baru\n- Employee Exit: karyawan yang sudah keluar\n{{BASE_URL}}/dashboard/employees/employees\n\nFitur lainnya:\n- Batch Edit Organization: edit organisasi beberapa karyawan sekaligus\n- Send Verification Email: kirim verifikasi email ke karyawan terpilih\n- Forgot Password: reset password dari halaman Update karyawan\n{{BASE_URL}}/dashboard/employees/employees',
  'faq',
  true,
  'idle',
  NOW(),
  NOW()
),
(
  gen_random_uuid(),
  'employee_guide',
  'Panduan Employees',
  'Langkah-langkah pengelolaan data karyawan',
  E'Cara Menambah Karyawan Baru:\n1. Klik menu Employees di sidebar kiri\n2. Pilih Employees Data\n3. Klik tombol Add New\n4. Isi form: Employee Name, Employee ID, Company, Parent Company, Designation, Department, Branch, Contact Address, Mobile, dan Status\n5. Upload foto dan dokumen jika diperlukan\n6. Klik Simpan\n{{BASE_URL}}/dashboard/employees/employees/add\n\nCara Edit Data Karyawan:\n1. Buka halaman Employees Data\n2. Cari karyawan menggunakan kolom Search here...\n3. Klik tombol Update pada baris karyawan\n4. Ubah data yang diperlukan\n5. Klik Simpan\n{{BASE_URL}}/dashboard/employees/employees\n\nCara Nonaktifkan / Employee Exit:\n1. Buka halaman Employees Data\n2. Cari karyawan, klik Update\n3. Ganti Status menjadi Inactive atau Employee Exit\n4. Klik Simpan\n{{BASE_URL}}/dashboard/employees/employees\n\nCara Import Karyawan Massal:\n1. Buka menu Employees\n2. Pilih Import Employee\n3. Download template Excel\n4. Isi sesuai template\n5. Upload dan klik Import\n{{BASE_URL}}/dashboard/employees/import',
  'article',
  true,
  'idle',
  NOW(),
  NOW()
),
(
  gen_random_uuid(),
  'payroll_faq',
  'FAQ Salary Payout',
  'Pertanyaan umum seputar penggajian',
  E'Apa itu fitur Salary Payout di Workin?\nFitur Salary Payout digunakan untuk mengelola penggajian: komponen gaji, struktur gaji, periode payroll, entry payroll, dan pengiriman salary slip.\n\nSubmenu yang tersedia:\n- Salary Component: atur komponen gaji (earning/deduction)\n- Salary Structure: atur struktur gaji per jabatan/grade\n- Salary Structure Assignment: assign struktur gaji ke karyawan\n- Payroll Periode: atur periode penggajian\n- Payroll Entry: entry dan proses perhitungan payroll\n- Salary Slip: lihat dan kirim slip gaji\n- Cost Component: komponen biaya\n\nBagaimana cara menjalankan proses payroll?\n1. Buka menu Salary Payout, pilih Payroll Periode\n2. Tentukan periode (bulan/tahun)\n3. Buka Payroll Entry, isi Posting Date, Currency, Payroll Period, Start Date, End Date\n4. Filter berdasarkan Department, Company, atau Designation\n5. Klik Save Changes untuk memproses\n6. Hasil perhitungan muncul di tabel: Employee Name, Gross Pay, Total Deduction, Net Pay\n{{BASE_URL}}/dashboard/payouts/payroll-periode\n\nApakah payroll otomatis terhitung dari absensi?\nYa, dihitung berdasarkan data kehadiran. Pastikan data absensi sudah lengkap sebelum memproses.\n{{BASE_URL}}/dashboard/payouts/payroll-entry\n\nBagaimana cara kirim slip gaji ke karyawan?\n1. Buka menu Salary Payout, pilih Salary Slip\n2. Cari karyawan di tabel (kolom: Employee Name, Company, Gross Pay, Net Pay, Periode, Status)\n3. Gunakan Bulk Action Update Status untuk mengubah status\n4. Status: Draft, Submitted, Pending, Approved, Paid, Unpaid\n5. Karyawan bisa melihat slip gaji di aplikasi mobile\n{{BASE_URL}}/dashboard/payouts/salary-slip\n\nBagaimana jika ada kesalahan nominal gaji?\n1. Buka Payroll Entry\n2. Cari data karyawan\n3. Lakukan penyesuaian manual\n4. Klik Save Changes untuk memproses ulang\n{{BASE_URL}}/dashboard/payouts/payroll-entry',
  'faq',
  true,
  'idle',
  NOW(),
  NOW()
),
(
  gen_random_uuid(),
  'leave_faq',
  'FAQ Leaves & Holidays',
  'Pertanyaan umum seputar cuti dan hari libur',
  E'Apa itu fitur Leaves & Holidays di Workin?\nFitur Leaves & Holidays digunakan untuk mengelola pengajuan cuti, alokasi cuti, jenis cuti, dan hari libur.\n\nSubmenu yang tersedia:\n- Leave Application: daftar pengajuan cuti karyawan\n- Leave Allocation: atur sisa kuota cuti per karyawan\n- Leave Type: atur jenis cuti (tahunan, sakit, dll)\n- Holiday List: daftar hari libur nasional & perusahaan\n\nBagaimana cara approve pengajuan cuti karyawan?\n1. Klik menu Leaves & Holidays, pilih Leave Application\n2. Lihat daftar pengajuan dengan status Open\n3. Klik Update pada baris yang ingin direview\n4. Ubah Status: Approved atau Rejected\n5. Klik Simpan\nStatus yang tersedia: Open (menunggu), Approved, Rejected, Canceled, Draft\n{{BASE_URL}}/dashboard/leaves/application\n\nBagaimana cara melihat sisa cuti karyawan?\n1. Buka menu Leaves & Holidays, pilih Leave Allocation\n2. Cari karyawan menggunakan kolom Search here...\n3. Sisa kuota cuti tahunan ditampilkan beserta riwayat pemakaian\n{{BASE_URL}}/dashboard/leaves/allocation\n\nApakah admin bisa input cuti manual?\nYa. Buka Leave Application, klik Add New, pilih nama karyawan, Leave Type, tanggal, dan keterangan, lalu simpan.\n{{BASE_URL}}/dashboard/leaves/application\n\nBagaimana cara melihat siapa saja yang sedang cuti hari ini?\n1. Buka Leave Application\n2. Filter berdasarkan tanggal hari ini\n3. Filter Status: Approved\n4. Semua karyawan yang sedang cuti tampil dalam tabel\n{{BASE_URL}}/dashboard/leaves/application\n\nBagaimana cara melihat daftar hari libur?\nBuka Holiday List. Lihat semua tanggal libur yang sudah ditetapkan.\n{{BASE_URL}}/dashboard/leaves/holiday_list',
  'faq',
  true,
  'idle',
  NOW(),
  NOW()
),
(
  gen_random_uuid(),
  'claim_faq',
  'FAQ Reimbursment & Travel',
  'Pertanyaan umum seputar klaim dan perjalanan dinas',
  E'Apa itu fitur Reimbursment & Travel di Workin?\nFitur Reimbursment & Travel digunakan untuk mengelola klaim pengeluaran karyawan, uang muka, perjalanan dinas, dan budgeting.\n\nSubmenu yang tersedia:\n- Employee Expense: pengajuan klaim pengeluaran\n- Employee Advance: pengajuan uang muka\n- Expense Claim Type: atur jenis klaim dan limitnya\n- Travel Request: pengajuan perjalanan dinas\n- Travel Route: atur rute perjalanan\n- Budgeting: atur anggaran klaim per departemen\n\nBagaimana cara approve klaim karyawan?\n1. Klik menu Reimbursment & Travel\n2. Pilih Employee Expense\n3. Lihat daftar pengajuan dengan status Submitted\n4. Centang klaim yang ingin diproses, klik Update Status\n5. Pilih Approved atau Rejected\n6. Jika Rejected, isi Rejection Reason\n7. Klik Update Status\nStatus yang tersedia: Draft, Submitted, Approved, Rejected, Disbursed\n{{BASE_URL}}/dashboard/reimbursment/expense\n\nBagaimana cara mengatur limit klaim?\n1. Buka Expense Claim Type\n2. Pilih jenis klaim, atur nominal limit\n3. Simpan\n{{BASE_URL}}/dashboard/reimbursment/type\n\nApakah klaim otomatis masuk ke payroll?\nTidak saat ini. Klaim harus diproses secara terpisah dan belum otomatis terintegrasi ke payroll.\n{{BASE_URL}}/dashboard/reimbursment/expense\n\nBagaimana cara melihat riwayat klaim karyawan?\n1. Buka Employee Expense\n2. Lihat tabel: Code, Employee, Title, Company, Amount, Status, Pajak Natura, Created At\n3. Klik Detail untuk melihat informasi lengkap\n{{BASE_URL}}/dashboard/reimbursment/expense\n\nBagaimana cara mengajukan travel request?\n1. Buka Travel Request\n2. Klik Add New\n3. Isi detail perjalanan, tujuan, tanggal\n4. Ajukan\n{{BASE_URL}}/dashboard/reimbursment/travel\n\nBagaimana cara mengatur budgeting?\nBuka Budgeting untuk mengatur anggaran klaim per departemen.\n{{BASE_URL}}/dashboard/reimbursment/budgeting',
  'faq',
  true,
  'idle',
  NOW(),
  NOW()
);

-- ============================================================
-- 3. KNOWLEDGE SOURCES
-- ============================================================
DELETE FROM knowledge_sources
WHERE "knowledgeId" IN (SELECT id FROM knowledge WHERE slug IN ('attendance_faq','attendance_guide','employee_faq','employee_guide','payroll_faq','leave_faq','claim_faq'));

INSERT INTO knowledge_sources (id, "knowledgeId", type, "rawText", status, "lastCrawledAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), k.id, 'text', k.content, 'completed', NOW(), NOW(), NOW()
FROM knowledge k
WHERE k.slug IN ('attendance_faq','attendance_guide','employee_faq','employee_guide','payroll_faq','leave_faq','claim_faq');

-- ============================================================
-- 4. INTENTS (khusus hris_company)
-- ============================================================
DO $$
DECLARE
  company_id uuid;
BEGIN
  SELECT id INTO company_id FROM agents WHERE slug = 'hris_company';

  DELETE FROM intents WHERE "agentId" = company_id;

  INSERT INTO intents (id, "agentId", slug, name, description, "executionType", "handlerKey", "isActive", metadata, "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid(), company_id, 'company_check_attendance',    'Cek Kehadiran',   'Melihat data kehadiran dan rekap absensi',                 'llm', NULL, true, '{"icon":"clipboard","category":"attendance"}', NOW(), NOW()),
    (gen_random_uuid(), company_id, 'company_correct_attendance',  'Koreksi Absensi', 'Koreksi absensi melalui Attendance Request',              'llm', NULL, true, '{"icon":"pencil","category":"attendance"}', NOW(), NOW()),
    (gen_random_uuid(), company_id, 'company_add_employee',        'Tambah Karyawan', 'Menambahkan data karyawan baru',                          'llm', NULL, true, '{"icon":"user","category":"employee"}', NOW(), NOW()),
    (gen_random_uuid(), company_id, 'company_edit_employee',       'Edit Karyawan',   'Mengubah data yang sudah ada',                            'llm', NULL, true, '{"icon":"edit","category":"employee"}', NOW(), NOW()),
    (gen_random_uuid(), company_id, 'company_deactivate_employee', 'Nonaktifkan Karyawan', 'Proses resign / nonaktifkan karyawan',               'llm', NULL, true, '{"icon":"x-circle","category":"employee"}', NOW(), NOW()),
    (gen_random_uuid(), company_id, 'company_process_payroll',     'Proses Payroll',  'Menjalankan payroll di Payroll Entry',                    'llm', NULL, true, '{"icon":"dollar-sign","category":"payroll"}', NOW(), NOW()),
    (gen_random_uuid(), company_id, 'company_send_payslip',        'Kirim Slip Gaji', 'Kirim Salary Slip ke karyawan',                          'llm', NULL, true, '{"icon":"file-text","category":"payroll"}', NOW(), NOW()),
    (gen_random_uuid(), company_id, 'company_approve_leave',       'Approve Cuti',    'Setujui / tolak pengajuan cuti',                         'llm', NULL, true, '{"icon":"check-circle","category":"leave"}', NOW(), NOW()),
    (gen_random_uuid(), company_id, 'company_check_leave_balance', 'Cek Sisa Cuti',   'Lihat sisa kuota cuti di Leave Allocation',               'llm', NULL, true, '{"icon":"bar-chart","category":"leave"}', NOW(), NOW()),
    (gen_random_uuid(), company_id, 'company_approve_claim',       'Approve Klaim',   'Setujui / tolak Employee Expense',                       'llm', NULL, true, '{"icon":"check-circle","category":"claim"}', NOW(), NOW()),
    (gen_random_uuid(), company_id, 'company_check_claim_history', 'Riwayat Klaim',   'Lihat riwayat Employee Expense',                          'llm', NULL, true, '{"icon":"clipboard","category":"claim"}', NOW(), NOW());

  -- ==========================================================
  -- 5. INTENT EXAMPLES
  -- ==========================================================
  DELETE FROM intent_examples
  WHERE "intentId" IN (SELECT id FROM intents WHERE "agentId" = company_id);

  INSERT INTO intent_examples (id, "intentId", text, language, "createdAt", "updatedAt")
  SELECT gen_random_uuid(), i.id, e.txt, 'id', NOW(), NOW()
  FROM (VALUES
    ('company_check_attendance','Apa itu fitur Shift & Attendance di Workin?'),
    ('company_check_attendance','Bagaimana cara melihat data kehadiran karyawan?'),
    ('company_check_attendance','Cara melihat Attendance Data di dashboard'),
    ('company_check_attendance','Bagaimana cara export rekap kehadiran?'),
    ('company_check_attendance','Apakah bisa melihat lokasi absensi karyawan?'),
    ('company_check_attendance','Apa saja status kehadiran yang tersedia?'),
    ('company_check_attendance','Cek kehadiran hari ini'),
    ('company_check_attendance','Lihat rekap absensi karyawan'),
    ('company_correct_attendance','Bagaimana cara koreksi absensi karyawan?'),
    ('company_correct_attendance','Cara edit absensi via Attendance Request'),
    ('company_correct_attendance','Koreksi jam masuk karyawan'),
    ('company_add_employee','Bagaimana cara menambah karyawan baru?'),
    ('company_add_employee','Cara menambahkan karyawan baru di dashboard'),
    ('company_add_employee','Apakah bisa import data karyawan secara massal?'),
    ('company_add_employee','Bagaimana cara mencari karyawan tertentu?'),
    ('company_add_employee','Tambah karyawan baru'),
    ('company_edit_employee','Bagaimana cara edit data karyawan?'),
    ('company_edit_employee','Cara mengubah data karyawan'),
    ('company_edit_employee','Edit profil karyawan'),
    ('company_deactivate_employee','Bagaimana cara menonaktifkan karyawan yang resign?'),
    ('company_deactivate_employee','Cara nonaktifkan karyawan'),
    ('company_deactivate_employee','Proses resign karyawan'),
    ('company_process_payroll','Bagaimana cara menjalankan proses payroll?'),
    ('company_process_payroll','Apakah payroll otomatis terhitung dari absensi?'),
    ('company_process_payroll','Bagaimana jika ada kesalahan nominal gaji?'),
    ('company_process_payroll','Cara proses penggajian di Payroll Entry'),
    ('company_process_payroll','Jalankan payroll bulan ini'),
    ('company_send_payslip','Bagaimana cara kirim slip gaji ke karyawan?'),
    ('company_send_payslip','Cara mengirim Salary Slip'),
    ('company_send_payslip','Kirim slip gaji'),
    ('company_approve_leave','Bagaimana cara approve pengajuan cuti karyawan?'),
    ('company_approve_leave','Apakah admin bisa input cuti manual?'),
    ('company_approve_leave','Siapa saja yang sedang cuti hari ini?'),
    ('company_approve_leave','Cara menyetujui cuti di Leave Application'),
    ('company_approve_leave','Approve pengajuan cuti'),
    ('company_check_leave_balance','Bagaimana cara melihat sisa cuti karyawan?'),
    ('company_check_leave_balance','Cek sisa cuti di Leave Allocation'),
    ('company_check_leave_balance','Lihat kuota cuti'),
    ('company_approve_claim','Bagaimana cara approve klaim karyawan?'),
    ('company_approve_claim','Bagaimana cara mengatur limit klaim per karyawan?'),
    ('company_approve_claim','Apakah klaim otomatis masuk ke payroll?'),
    ('company_approve_claim','Setujui Employee Expense'),
    ('company_check_claim_history','Bagaimana cara melihat riwayat klaim karyawan?'),
    ('company_check_claim_history','Cek riwayat Employee Expense'),
    ('company_check_claim_history','Lihat history klaim karyawan')
  ) AS e(slug, txt)
  JOIN intents i ON i.slug = e.slug AND i."agentId" = company_id;

  -- ==========================================================
  -- 6. INTENT-KNOWLEDGE MAPPINGS
  -- ==========================================================
  DELETE FROM intent_knowledge_mappings
  WHERE "intentId" IN (SELECT id FROM intents WHERE "agentId" = company_id);

  INSERT INTO intent_knowledge_mappings (id, "intentId", "knowledgeId", priority, "createdAt", "updatedAt")
  SELECT gen_random_uuid(), i.id, k.id, m.prio, NOW(), NOW()
  FROM (VALUES
    ('company_check_attendance',    'attendance_faq',   1),
    ('company_check_attendance',    'attendance_guide', 2),
    ('company_correct_attendance',  'attendance_guide', 1),
    ('company_correct_attendance',  'attendance_faq',   2),
    ('company_add_employee',        'employee_guide',   1),
    ('company_add_employee',        'employee_faq',     2),
    ('company_edit_employee',       'employee_guide',   1),
    ('company_deactivate_employee', 'employee_faq',     1),
    ('company_process_payroll',     'payroll_faq',      1),
    ('company_send_payslip',        'payroll_faq',      1),
    ('company_approve_leave',       'leave_faq',        1),
    ('company_check_leave_balance', 'leave_faq',        1),
    ('company_approve_claim',       'claim_faq',        1),
    ('company_check_claim_history', 'claim_faq',        1)
  ) AS m(intent_slug, knowledge_slug, prio)
  JOIN intents i ON i.slug = m.intent_slug AND i."agentId" = company_id
  JOIN knowledge k ON k.slug = m.knowledge_slug;

END $$;
