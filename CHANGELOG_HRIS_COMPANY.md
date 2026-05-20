# Changelog — AI Intent Service v2

Dokumentasi perubahan dan penambahan fitur.

---

## 1. Agent Baru: `hris_company`

**Tujuan:** Agent khusus untuk AI dashboard admin Workin, terpisah dari `hris` (general HRIS).

Migration dari **seeder Sequelize** → **file SQL** `seed_hris_company.sql` agar lebih portable, mudah dibaca, dan bisa dijalankan langsung ke database tanpa dependensi framework.

### Intent yang tersedia (khusus `hris_company`):

| Intent Slug | Fungsi |
|---|---|
| `company_check_attendance` | Cek kehadiran dan rekap absensi |
| `company_correct_attendance` | Koreksi absensi via Attendance Request |
| `company_add_employee` | Tambah karyawan |
| `company_edit_employee` | Edit data karyawan |
| `company_deactivate_employee` | Nonaktifkan/resign karyawan |
| `company_process_payroll` | Proses penggajian |
| `company_send_payslip` | Kirim slip gaji |
| `company_approve_leave` | Approve cuti |
| `company_check_leave_balance` | Cek sisa cuti |
| `company_approve_claim` | Approve klaim |
| `company_check_claim_history` | Riwayat klaim |

---

## 2. Knowledge Base

7 knowledge entries: FAQ/Guidance untuk admin dashboard, **disimpan dalam SQL**.

| Slug | Type | Konten |
|---|---|---|
| `attendance_faq` | faq | FAQ Shift & Attendance |
| `attendance_guide` | article | Panduan Shift & Attendance |
| `employee_faq` | faq | FAQ Employees |
| `employee_guide` | article | Panduan Employees |
| `payroll_faq` | faq | FAQ Salary Payout |
| `leave_faq` | faq | FAQ Leaves & Holidays |
| `claim_faq` | faq | FAQ Reimbursment & Travel |

Semua knowledge menggunakan **nama fitur sesuai dashboard** (`hrms_companiesV2`), bukan istilah umum.

---

## 3. Intent Examples (Vector Search)

46 intent_examples untuk 11 intent `hris_company`.

**Penting:** Tanpa intent_examples, vector search tidak bisa match, dan jawaban akan fallback ke `general_chat`.

### Daftar Pertanyaan per Intent:

| Intent | Pertanyaan |
|---|---|
| **company_check_attendance** (8) | Apa itu fitur Shift & Attendance di Workin? |
| | Bagaimana cara melihat data kehadiran karyawan? |
| | Cara melihat Attendance Data di dashboard |
| | Bagaimana cara export rekap kehadiran? |
| | Apakah bisa melihat lokasi absensi karyawan? |
| | Apa saja status kehadiran yang tersedia? |
| | Cek kehadiran hari ini |
| | Lihat rekap absensi karyawan |
| **company_correct_attendance** (3) | Bagaimana cara koreksi absensi karyawan? |
| | Cara edit absensi via Attendance Request |
| | Koreksi jam masuk karyawan |
| **company_add_employee** (5) | Bagaimana cara menambah karyawan baru? |
| | Cara menambahkan karyawan baru di dashboard |
| | Apakah bisa import data karyawan secara massal? |
| | Bagaimana cara mencari karyawan tertentu? |
| | Tambah karyawan baru |
| **company_edit_employee** (3) | Bagaimana cara edit data karyawan? |
| | Cara mengubah data karyawan |
| | Edit profil karyawan |
| **company_deactivate_employee** (3) | Bagaimana cara menonaktifkan karyawan yang resign? |
| | Cara nonaktifkan karyawan |
| | Proses resign karyawan |
| **company_process_payroll** (5) | Bagaimana cara menjalankan proses payroll? |
| | Apakah payroll otomatis terhitung dari absensi? |
| | Bagaimana jika ada kesalahan nominal gaji? |
| | Cara proses penggajian di Payroll Entry |
| | Jalankan payroll bulan ini |
| **company_send_payslip** (3) | Bagaimana cara kirim slip gaji ke karyawan? |
| | Cara mengirim Salary Slip |
| | Kirim slip gaji |
| **company_approve_leave** (5) | Bagaimana cara approve pengajuan cuti karyawan? |
| | Apakah admin bisa input cuti manual? |
| | Siapa saja yang sedang cuti hari ini? |
| | Cara menyetujui cuti di Leave Application |
| | Approve pengajuan cuti |
| **company_check_leave_balance** (3) | Bagaimana cara melihat sisa cuti karyawan? |
| | Cek sisa cuti di Leave Allocation |
| | Lihat kuota cuti |
| **company_approve_claim** (4) | Bagaimana cara approve klaim karyawan? |
| | Bagaimana cara mengatur limit klaim per karyawan? |
| | Apakah klaim otomatis masuk ke payroll? |
| | Setujui Employee Expense |
| **company_check_claim_history** (3) | Bagaimana cara melihat riwayat klaim karyawan? |
| | Cek riwayat Employee Expense |
| | Lihat history klaim karyawan |

---

## 4. Mapping Intent → Knowledge

14 mapping entries: setiap intent `hris_company` terhubung ke 1-2 knowledge entries.

---

## 5. System Prompt & Strict Knowledge Mode

### File dimodifikasi:
- **`src/services/generalChat.service.ts`**
  - System prompt untuk `hris_company`: HANYA jawab dari knowledge, DILARANG pakai pengetahuan umum
  - Untuk agent lain: tetap menggunakan system prompt CITRA + knowledge Duluin (tidak berubah)

- **`src/services/pipeline.service.ts`**
  - Pass `app_name` ke `naturalizationService.naturalize()`

- **`src/services/naturalization.service.ts`**
  - Terima parameter `appName`
  - Jika `appName === 'hris_company'` → strict rule ditambahkan

- **`src/services/ollama.service.ts`**
  - `naturalize()` terima `appName`
  - Strict rule: "HANYA gunakan data JSON" untuk `hris_company`

- **`src/services/openAi.service.ts`**
  - Sama seperti ollama.service.ts

**Semua perubahan hanya aktif saat `appName === 'hris_company'` (exact match). Agent existing tidak terpengaruh.**

---

## 6. URL Dashboard di Knowledge

Setiap knowledge entry dilengkapi URL menuju halaman terkait di dashboard.

**Format:** `🔗 {{BASE_URL}}/dashboard/...` — ganti `{{BASE_URL}}` dengan domain masing-masing perusahaan.

### Daftar URL per Menu:

| Fitur Dashboard | Submenu | URL |
|---|---|---|
| **Shift & Attendance** | Attendance Data | `/dashboard/attendances/attendances` |
| | Attendance Request | `/dashboard/attendances/request` |
| | Attendance Report | `/dashboard/attendances/report` |
| | Monitoring Maps | `/dashboard/attendances/monitoring` |
| **Employees** | Employees (list) | `/dashboard/employees/employees` |
| | Add Employee | `/dashboard/employees/employees/add` |
| | Import Employee | `/dashboard/employees/import` |
| **Salary Payout** | Payroll Periode | `/dashboard/payouts/payroll-periode` |
| | Payroll Entry | `/dashboard/payouts/payroll-entry` |
| | Salary Slip | `/dashboard/payouts/salary-slip` |
| **Leaves & Holidays** | Leave Application | `/dashboard/leaves/application` |
| | Leave Allocation | `/dashboard/leaves/allocation` |
| | Holiday List | `/dashboard/leaves/holiday_list` |
| **Reimbursment & Travel** | Employee Expense | `/dashboard/reimbursment/expense` |
| | Expense Claim Type | `/dashboard/reimbursment/type` |
| | Travel Request | `/dashboard/reimbursment/travel` |
| | Budgeting | `/dashboard/reimbursment/budgeting` |

---

## 7. Perubahan Terbaru: Penyesuaian Nama Fitur

### Latar Belakang
Knowledge awal menggunakan istilah umum/terjemahan bebas (misal: "Absensi", "Payroll", "Klaim"). Setelah eksplorasi kode `hrms_companiesV2`, nama fitur diselaraskan dengan label yang muncul di dashboard.

### Perubahan Nama:

| Sebelum | Sesudah (sesuai dashboard) |
|---|---|---|
| Absensi | **Shift & Attendance** |
| Attendance Records / Rekap Absensi | **Attendance Data** |
| Koreksi Absensi | **Attendance Request** |
| Status: Hadir/Tidak Hadir | **Present / Absent / Half Day / Leave / WFH / Late Entry / Early Exit** |
| Approval Status | **Submit / Approved / Rejected** |
| Karyawan | **Employees** |
| Halaman daftar karyawan | **Employees Data** |
| Tombol Tambah | **Add New** |
| Tombol Edit | **Update** |
| Tombol Export Excel/CSV | **Export** (Export Excel / Export PDF / Export CSV / Copy Data) |
| Pencarian | **Search here...** |
| Payroll / Penggajian | **Salary Payout** |
| Halaman payroll | **Payroll Entry** |
| Slip Gaji | **Salary Slip** |
| Status slip gaji | **Draft / Submitted / Pending / Approved / Paid / Unpaid** |
| Cuti | **Leaves & Holidays** |
| Halaman cuti | **Leave Application** |
| Status cuti | **Draft / Open / Approved / Rejected / Canceled** |
| Sisa cuti | **Leave Allocation** |
| Klaim / Reimbursement | **Reimbursment & Travel** |
| Halaman klaim | **Employee Expense** |
| Status klaim | **Draft / Submitted / Approved / Rejected / Disbursed** |
| Tombol Update Status Bulk | **Update Status** (dengan Rejection Reason) |

### Dampak:
- Konten knowledge di SQL diubah pakai nama fitur dashboard
- Intent examples disesuaikan dengan istilah dashboard
- URL tetap sama (struktur routing tidak berubah)
- **Zero impact ke agent lain** — hanya `hris_company` yang berubah

---

## 8. Cara Penggunaan

### Test prompt (contoh):
```bash
curl -X POST http://localhost:3000/api/v1/intent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "admin_1",
    "app_name": "hris_company",
    "text": "Bagaimana cara menambah karyawan baru?",
    "attributes": { "name": "Admin" }
  }'
```

### File aktif:
```
seed_hris_company.sql  ← satu-satunya file seed (SQL, bukan Sequelize)
```

### Cara menjalankan:
```bash
psql -U postgres -d ai_intent -f seed_hris_company.sql
```

### Catatan:
- Semua data `hris_company` duduk di atas data seed original (`0000-0007`) — **tidak mengganggu**
- Operasi **DELETE + INSERT** untuk knowledge/intents milik `hris_company` saja — aman dijalankan berulang kali
- Agent `hris` original dan agent lain tetap utuh tidak berubah
- Semua nama fitur, tombol, menu, dan status **sesuai eksak dengan dashboard** `hrms_companiesV2`
