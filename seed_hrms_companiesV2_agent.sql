BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $seed$
DECLARE
  v_now timestamptz := NOW();
  v_model_id uuid;
  v_agent_id uuid;

  k_ui_naming uuid;
  k_nav_overview uuid;
  k_company_mgmt uuid;
  k_employee_mgmt uuid;
  k_kpi_mgmt uuid;
  k_hiring_mgmt uuid;
  k_workspace_forms uuid;
  k_attendance_mgmt uuid;
  k_leave_mgmt uuid;
  k_payroll_mgmt uuid;
  k_reimbursment_mgmt uuid;
  k_checklist_mgmt uuid;
  k_documents_mgmt uuid;
  k_assets_mgmt uuid;
  k_users_settings_mgmt uuid;

  v_intent_id uuid;

  PROCEDURE upsert_knowledge(
    IN p_slug text,
    IN p_title text,
    IN p_description text,
    IN p_content text,
    IN p_type text,
    IN p_tags text[],
    OUT p_id uuid
  )
  LANGUAGE plpgsql
  AS $proc$
  BEGIN
    SELECT id INTO p_id
    FROM knowledge
    WHERE slug = p_slug
    ORDER BY "createdAt" ASC
    LIMIT 1;

    IF p_id IS NULL THEN
      INSERT INTO knowledge
        (id, slug, title, description, content, type, tags, "isActive", "ingestionStatus", "lastIngestedAt", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), p_slug, p_title, p_description, p_content, p_type::"enum_knowledge_type", p_tags, TRUE, 'idle', NULL, v_now, v_now)
      RETURNING id INTO p_id;
    ELSE
      UPDATE knowledge
      SET
        title = p_title,
        description = p_description,
        content = p_content,
        type = p_type::"enum_knowledge_type",
        tags = p_tags,
        "isActive" = TRUE,
        "ingestionStatus" = 'idle',
        "lastIngestedAt" = NULL,
        "updatedAt" = v_now
      WHERE id = p_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM knowledge_sources
      WHERE "knowledgeId" = p_id AND type = 'text'
    ) THEN
      UPDATE knowledge_sources
      SET
        "rawText" = p_content,
        status = 'pending',
        "lastCrawledAt" = NULL,
        "updatedAt" = v_now
      WHERE "knowledgeId" = p_id AND type = 'text';
    ELSE
      INSERT INTO knowledge_sources
        (id, "knowledgeId", type, url, "rawText", status, "lastCrawledAt", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), p_id, 'text', NULL, p_content, 'pending', NULL, v_now, v_now);
    END IF;
  END;
  $proc$;

  PROCEDURE upsert_intent_llm(
    IN p_slug text,
    IN p_name text,
    IN p_description text,
    IN p_metadata jsonb,
    OUT p_id uuid
  )
  LANGUAGE plpgsql
  AS $proc$
  BEGIN
    INSERT INTO intents
      (id, "agentId", slug, name, description, "executionType", "handlerKey", "isActive", metadata, "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid(), v_agent_id, p_slug, p_name, p_description, 'llm', NULL, TRUE, p_metadata, v_now, v_now)
    ON CONFLICT ON CONSTRAINT intents_agent_slug_unique DO UPDATE
    SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      "executionType" = EXCLUDED."executionType",
      "handlerKey" = EXCLUDED."handlerKey",
      "isActive" = TRUE,
      metadata = EXCLUDED.metadata,
      "updatedAt" = v_now
    RETURNING id INTO p_id;
  END;
  $proc$;

  PROCEDURE add_intent_example(
    IN p_intent_id uuid,
    IN p_text text,
    IN p_language text DEFAULT 'id'
  )
  LANGUAGE plpgsql
  AS $proc$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM intent_examples
      WHERE "intentId" = p_intent_id AND text = p_text AND language = p_language
    ) THEN
      INSERT INTO intent_examples
        (id, "intentId", text, language, "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), p_intent_id, p_text, p_language, v_now, v_now);
    END IF;
  END;
  $proc$;

  PROCEDURE map_intent_knowledge(
    IN p_intent_id uuid,
    IN p_knowledge_id uuid,
    IN p_priority int
  )
  LANGUAGE plpgsql
  AS $proc$
  BEGIN
    INSERT INTO intent_knowledge_mappings
      (id, "intentId", "knowledgeId", priority, "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid(), p_intent_id, p_knowledge_id, p_priority, v_now, v_now)
    ON CONFLICT ON CONSTRAINT intent_knowledge_unique DO UPDATE
    SET
      priority = EXCLUDED.priority,
      "updatedAt" = v_now;
  END;
  $proc$;

BEGIN
  INSERT INTO llm_models
    (id, name, provider, "modelCode", "contextWindow", "maxOutputTokens", "costPer1kInput", "costPer1kOutput", "isActive", metadata, "createdAt", "updatedAt")
  VALUES
    (
      gen_random_uuid(),
      'Qwen Flash 2025-07-28',
      'qwen',
      'qwen-flash-2025-07-28',
      128000,
      8192,
      0.00008,
      0.00018,
      TRUE,
      '{"tier":"ultra-fast","latency":"very-low","reasoning":"medium-low"}'::jsonb,
      v_now,
      v_now
    )
  ON CONFLICT ("modelCode") DO UPDATE
  SET
    name = EXCLUDED.name,
    provider = EXCLUDED.provider,
    "contextWindow" = EXCLUDED."contextWindow",
    "maxOutputTokens" = EXCLUDED."maxOutputTokens",
    "costPer1kInput" = EXCLUDED."costPer1kInput",
    "costPer1kOutput" = EXCLUDED."costPer1kOutput",
    "isActive" = TRUE,
    metadata = EXCLUDED.metadata,
    "updatedAt" = v_now
  RETURNING id INTO v_model_id;

  IF v_model_id IS NULL THEN
    SELECT id INTO v_model_id
    FROM llm_models
    WHERE "modelCode" = 'qwen-flash-2025-07-28'
    LIMIT 1;
  END IF;

  INSERT INTO agents
    (id, name, slug, description, "isActive", "customPrompt", "systemPrompt", temperature, "maxTokens", "memoryEnabled", "modelId", metadata, "createdAt", "updatedAt")
  VALUES
    (
      gen_random_uuid(),
      'HRMS Companies V2 Assistant',
      'hrms_companies_v2',
      'Agent khusus untuk panduan penggunaan HRMS Companies V2 (admin dashboard) berdasarkan knowledge internal dan penamaan UI yang konsisten.',
      TRUE,
      'Fokus pada navigasi menu, alur kerja admin dashboard, penamaan tombol/tab, filter/export, dan aksi tabel sesuai HRMS Companies V2. Gunakan knowledge sebagai sumber kebenaran utama.',
      $p$
KAMU ADALAH AI ASSISTANT UNTUK HRMS COMPANIES V2 (ADMIN DASHBOARD).

WAJIB DIIKUTI:
1. Gunakan KNOWLEDGE INTERNAL sebagai sumber kebenaran utama (nama menu, tab, tombol, label, dan alur).
2. Jika pertanyaan di luar cakupan knowledge HRMS Companies V2, katakan dengan jujur bahwa informasinya belum tersedia di knowledge.
3. Jangan mengarang nama menu, tab, status, tombol, atau path. Jika ragu, minta user menyebutkan modul/menu yang dimaksud.
4. Untuk instruksi, tulis langkah-langkah ringkas dan berurutan.
5. Gunakan istilah UI yang konsisten dengan aplikasi, misalnya: "Add New", "Save Changes", "Filter", "Export", "Choose Action", "Available Actions".
6. Jika user bertanya hal umum yang tidak terkait dashboard (mis. cuaca), arahkan bahwa agent ini khusus HRMS Companies V2.
$p$,
      0.4,
      2048,
      TRUE,
      v_model_id,
      '{"domain":"hrms_companiesV2","uiLanguage":"en","answerLanguage":"id"}'::jsonb,
      v_now,
      v_now
    )
  ON CONFLICT (slug) DO UPDATE
  SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    "isActive" = TRUE,
    "customPrompt" = EXCLUDED."customPrompt",
    "systemPrompt" = EXCLUDED."systemPrompt",
    temperature = EXCLUDED.temperature,
    "maxTokens" = EXCLUDED."maxTokens",
    "memoryEnabled" = EXCLUDED."memoryEnabled",
    "modelId" = EXCLUDED."modelId",
    metadata = EXCLUDED.metadata,
    "updatedAt" = v_now
  RETURNING id INTO v_agent_id;

  CALL upsert_knowledge(
    'hrmsv2_ui_naming_conventions',
    'HRMS Companies V2 - UI Naming Conventions',
    'Standar penamaan elemen UI (menu, button, tab, action) agar konsisten dan mudah dipahami saat menggunakan HRMS Companies V2.',
    $k$
Tujuan: memastikan seluruh penamaan elemen antarmuka pada HRMS Companies V2 konsisten, jelas, dan tidak membingungkan.

1) Bahasa & Format
- UI utama memakai Bahasa Inggris dengan Title Case pada menu dan action label.
- Gunakan kata kerja yang spesifik dan konsisten.
- Hindari variasi istilah yang maknanya sama (mis. jangan campur "Create" vs "Add New" untuk tombol utama).

2) Standar Label Tombol (Button)
- Primary create button pada banyak halaman: "Add New"
- Submit pada form: "Save Changes"
- Tombol pembatalan pada modal/form: "Cancel"
- Tombol konfirmasi pada modal approval: "Confirm Action"
- Label saat proses: "Saving..." (varian dari Save Changes saat loading)

3) Filter & Export (Action Bar)
- Tombol filter: "Filter" (menampilkan badge jumlah filter aktif)
- Dropdown export: "Export"
  - Item: "Export Excel", "Export PDF", "Export CSV", "Copy Data"
- Hindari variasi seperti "Download" atau "Export Data" jika UI sudah memakai "Export".

4) Bulk Actions & Row Actions
- Dropdown bulk action: default title "Choose Action"
- Row actions (ikon titik tiga) memiliki header: "Available Actions"
- Gunakan label action yang langsung menjelaskan aksi: "Edit", "Delete", "Update Status", "Assign", "Approve", "Reject" (sesuai konteks modul).

4.1) Table Settings Tabs (Column Visibility Menu)
- Tab: "Columns", "Controls", "Sorting"
- Footer buttons: "Reset" dan "Show All"

5) Menu & Navigasi (Nama yang harus dipakai sesuai aplikasi)
Home Menu:
- "Quick Overview"
- "Employees"
- "Reimbursment & Travel"
- "Shift & Attendance"
- "Leaves & Holidays"
- "Documents"
- "Salary Payout"
- "Form Builder"
- "Checklist"
- "Publisher"
- "Assets & Resources"
- "Companies"
- "Settings"
- "My Account"
- "Billings"
- "Users Management"

Menu modul (contoh):
- Attendance: "Shift Types", "Shift Assignments", "Attendance Records", "Attendance Request", "Employee Activities", "Monitoring Maps"
- Payroll: "Salary Component", "Salary Structure", "Salary Structure Assignment", "Payroll Periode", "Payroll Entry", "Salary Slip", "Cost Component"
- Leave: "Holiday List", "Leave Type", "Leave Application", "Leave Allocation"
- Reimbursment: "Employee Expense", "Employee Advance", "Expense Claim Type", "Travel Request", "Travel Route", "Budgeting"

6) Prinsip konsistensi output jawaban
- Saat memberi langkah, selalu sebut menu sesuai label UI.
- Jika ada label yang tampak typo di aplikasi (contoh: "Reimbursment"), tetap sebut apa adanya agar user mudah menemukannya.
$k$,
    'policy',
    ARRAY['ui','naming','buttons','tabs','menu','hrms_companiesV2']
  , k_ui_naming);

  CALL upsert_knowledge(
    'hrmsv2_navigation_overview',
    'HRMS Companies V2 - Navigasi & Struktur Modul',
    'Ringkasan struktur modul dan rute utama berdasarkan menu HRMS Companies V2.',
    $k$
Ringkasan navigasi HRMS Companies V2:

1) Home Menu (Dashboard)
- "Quick Overview" -> /dashboard
- "Employees" -> /dashboard/employees
- "Reimbursment & Travel" -> /dashboard/reimbursment
- "Shift & Attendance" -> /dashboard/attendances
- "Leaves & Holidays" -> /dashboard/leaves
- "Documents" -> /dashboard/documents
- "Salary Payout" -> /dashboard/payouts
- "Form Builder" -> /dashboard/workspace/forms
- "Checklist" -> /dashboard/checklist
- "Publisher" -> /dashboard/publishers
- "Assets & Resources" -> /dashboard/assets
- "Companies" -> /dashboard/companies
- "Settings" -> /dashboard/settings
- "My Account" -> /dashboard/account
- "Billings" -> /dashboard/billings
- "Users Management" -> /dashboard/users

2) Pola umum halaman data (table-based)
- Gunakan "Filter" untuk menyaring data.
- Gunakan "Export" untuk ekspor hasil table.
- Gunakan checkbox pada table untuk bulk action -> "Choose Action".
- Gunakan menu titik tiga pada setiap row -> "Available Actions".

3) Pola umum create/update
- Create biasanya melalui tombol "Add New" atau halaman /add pada modul tertentu.
- Submit form biasanya "Save Changes".
$k$,
    'article',
    ARRAY['navigation','menu','routes','overview','hrms_companiesV2']
  , k_nav_overview);

  CALL upsert_knowledge(
    'hrmsv2_company_management',
    'HRMS Companies V2 - Company Management',
    'Panduan modul Companies, Approval Policy, Approval Request, dan Settings.',
    $k$
Company Management (menu: "Company Management"):

1) Companies
- Menu: "Companies"
- Rute: /dashboard/companies/companies (atau entry via /dashboard/companies)
- Kegunaan: mengelola data perusahaan/tenant.
- Pola umum:
  1. Buka "Companies"
  2. Gunakan "Filter" bila perlu
  3. Klik "Add New" untuk membuat data baru
  4. Klik "Available Actions" pada row untuk tindakan (contoh: Edit/Delete jika tersedia)
  5. Klik "Save Changes" untuk menyimpan perubahan

2) Approval Policy
- Menu: "Approval Policy"
- Rute: /dashboard/companies/approval-policy
- Kegunaan: mengatur aturan persetujuan (approval flow/policy) untuk pengajuan tertentu.
- Pola umum:
  - Pilih tipe approval yang ingin diatur
  - Simpan dengan "Save Changes" bila tersedia

3) Approval Request
- Menu: "Approval Request"
- Rute: /dashboard/companies/approval-request
- Kegunaan: memproses permintaan yang butuh persetujuan.
- UI modal:
  - Title default: "Approval Action"
  - Dropdown: pilih aksi via "Select an action..."
  - Tombol: "Cancel" dan "Confirm Action"
  - Jika aksi membutuhkan alasan, field label: "Reason"

4) Settings
- Menu: "Settings"
- Rute: /dashboard/settings
- Kegunaan: pengaturan global tenant (sesuai akses user).
$k$,
    'article',
    ARRAY['companies','approval','settings','workflow','hrms_companiesV2']
  , k_company_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_employee_management',
    'HRMS Companies V2 - Employees & Master Data',
    'Panduan modul Employees (onboarding), master data (Branches, Departments, Designations, Grades, Types), permission, organization chart, serta import employee.',
    $k$
Employees (menu group: "Onboarding"):

1) Employees
- Menu: "Employees"
- Rute: /dashboard/employees/employees
- Pola kerja:
  - Gunakan "Filter" untuk menyaring data karyawan.
  - Gunakan "Export" untuk export table.
  - Bulk action (pilih beberapa row): "Choose Action".
  - Row action (titik tiga): "Available Actions" untuk aksi per karyawan.
  - Create: tombol "Add New".

2) Master Data
- Branches: /dashboard/employees/branches
- Departments: /dashboard/employees/department
- Designations: /dashboard/employees/designation
- Employee Grades: /dashboard/employees/grade
- Employee Types: /dashboard/employees/employment-type
- Pola:
  - Create: "Add New"
  - Submit form: "Save Changes"
  - Gunakan row action jika ada.

3) Employees Permission
- Menu: "Employees Permission"
- Rute: /dashboard/employees/employee-permission
- Kegunaan: mengatur akses/perizinan karyawan.

4) Organization Chart
- Menu: "Organization Chart"
- Rute: /dashboard/employees/organization-chart
- Kegunaan: struktur organisasi.

Tools:
5) Import Employee
- Menu: "Import Employee"
- Rute: /dashboard/employees/import
- Kegunaan: upload/import data karyawan (biasanya file Excel/CSV sesuai template).
$k$,
    'article',
    ARRAY['employees','branches','departments','designation','grade','import','permissions','orgchart']
  , k_employee_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_kpi_management',
    'HRMS Companies V2 - KPI Management',
    'Panduan modul Key Performance Indicator (KPI) sesuai menu HRMS Companies V2.',
    $k$
Key Performance Indicator (menu group: "Key Performance Indicator"):

1) Balance Score Card -> /dashboard/kpi/balance-score-card
2) Target Types -> /dashboard/kpi/target-types
3) KPI Directories -> /dashboard/kpi/directory
4) Rating Performance Appraisal -> /dashboard/kpi/rating-pa
5) KPI Type Quantitative -> /dashboard/kpi/kpi-types-quantitative
6) KPI Type Qualitative -> /dashboard/kpi/kpi-types-qualitative
7) KPI Structure -> /dashboard/kpi/kpi-structure
8) KPI Assignment -> /dashboard/kpi/kpi-assignment
9) KPI Score -> /dashboard/kpi/kpi-score

Pola UI:
- Halaman KPI umumnya table-based: gunakan "Filter", "Export", bulk "Choose Action", row "Available Actions".
- Buat/update data: gunakan "Add New" dan simpan dengan "Save Changes" bila tersedia.
$k$,
    'article',
    ARRAY['kpi','performance','score','assignment','balance score card']
  , k_kpi_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_hiring_management',
    'HRMS Companies V2 - Hiring Management',
    'Panduan modul Hiring Management sesuai menu HRMS Companies V2.',
    $k$
Hiring Management (menu group: "Hiring Management"):

1) Job Posting -> /dashboard/hiring/job-posting
2) Candidates -> /dashboard/hiring/candidates
3) Interview -> /dashboard/hiring/interviews
4) Offering -> /dashboard/hiring/offering
5) Onboarding -> /dashboard/hiring/onboarding

Pola UI:
- Table-based: "Filter", "Export", bulk "Choose Action", row "Available Actions".
- Form: gunakan "Save Changes" saat menyimpan.
- Status update sering muncul sebagai action label "Update Status" pada detail kandidat/interview.
$k$,
    'article',
    ARRAY['hiring','job posting','candidates','interview','offering','onboarding']
  , k_hiring_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_workspace_form_builder',
    'HRMS Companies V2 - Workspace Form Builder',
    'Panduan modul Form Builder pada Workspace.',
    $k$
Workspace - Form Builder:

- Menu: "Form Builder"
- Rute: /dashboard/workspace/forms

Pola UI umum:
- Untuk menambah item pada builder, beberapa area menggunakan label seperti "Add New Question" (pada editor/builder).
- Gunakan tombol aksi utama yang konsisten: "Add New" untuk create, "Save Changes" untuk menyimpan.

Catatan:
- Jika user menyebutkan nama form atau halaman spesifik di builder, jawab dengan langkah navigasi dan minta user menyebutkan modul/section jika belum jelas.
$k$,
    'article',
    ARRAY['workspace','form builder','forms']
  , k_workspace_forms);

  CALL upsert_knowledge(
    'hrmsv2_attendance_shift_checkpoint',
    'HRMS Companies V2 - Shift, Attendance, Checkpoint, Reports',
    'Panduan modul Shift Management, Attendance, Checkpoint, serta Report & Tools pada HRMS Companies V2.',
    $k$
Shift & Attendance (menu: "Shift & Attendance" -> /dashboard/attendances)

Shift Management:
1) Shift Types
- Menu: "Shift Types"
- Rute: /dashboard/attendances/shift-type
- Kegunaan: definisi tipe shift.
- Pola: "Add New" untuk menambah, "Save Changes" untuk menyimpan.

2) Shift Assignments
- Menu: "Shift Assignments"
- Rute: /dashboard/attendances/shift-assignment

3) Shift Assignments Bulk
- Menu: "Shift Assignments Bulk"
- Rute: /dashboard/attendances/create-shift-assignment-bulk

4) Shift Assignments Schedule
- Menu: "Shift Assignments Schedule"
- Rute: /dashboard/attendances/create-shift-assignment-schedule

5) Assignments Schedule Bulk
- Menu: "Assignments Schedule Bulk"
- Rute: /dashboard/attendances/create-shift-assignment-schedule-bulk

6) Import Shift
- Menu: "Import Shift"
- Rute: /dashboard/attendances/import_shift

Attendance:
7) Attendance Records
- Menu: "Attendance Records"
- Rute: /dashboard/attendances/attendances
- Pola table: "Filter", "Export", bulk "Choose Action", row "Available Actions".

8) Attendance Request
- Menu: "Attendance Request"
- Rute: /dashboard/attendances/request
- Kegunaan: memproses request terkait absensi (koreksi/penyesuaian sesuai kebijakan).
- Jika ada approval modal, gunakan "Approval Action" -> "Confirm Action".

9) Employee Activities
- Menu: "Employee Activities"
- Rute: /dashboard/attendances/activity

Checkpoint:
10) Checkpoint Location
- Menu: "Checkpoint Location"
- Rute: /dashboard/attendances/master_checkpoint

11) Checkpoint Assignment
- Menu: "Checkpoint Assignment"
- Rute: /dashboard/attendances/checkpoint_assignment

12) Checkpoint Record
- Menu: "Checkpoint Record"
- Rute: /dashboard/attendances/scan_record

Report & Tools:
13) Attendance Report -> /dashboard/attendances/report
14) Activity Report -> /dashboard/attendances/activity/report
15) Shift Report -> /dashboard/attendances/shift-report
16) Checkpoint Report -> /dashboard/attendances/scan_record/report
17) Attendance Summary -> /dashboard/attendances/summary
18) Monitoring Maps -> /dashboard/attendances/monitoring
$k$,
    'article',
    ARRAY['attendance','shift','checkpoint','reports','monitoring']
  , k_attendance_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_leave_management',
    'HRMS Companies V2 - Leaves & Holidays',
    'Panduan Holiday List, Leave Type, Leave Application, dan Leave Allocation.',
    $k$
Leaves & Holidays (menu: "Leaves & Holidays" -> /dashboard/leaves)

1) Holiday List
- Menu: "Holiday List"
- Rute: /dashboard/leaves/holiday_list
- Kegunaan: daftar hari libur.

2) Leave Type
- Menu: "Leave Type"
- Rute: /dashboard/leaves/leave-type
- Kegunaan: definisi jenis cuti/izin.

3) Leave Application
- Menu: "Leave Application"
- Rute: /dashboard/leaves/application
- Kegunaan: melihat/memproses pengajuan cuti (tergantung role).
- Jika ada approval modal: gunakan "Approval Action" -> "Confirm Action" / "Cancel".

4) Leave Allocation
- Menu: "Leave Allocation"
- Rute: /dashboard/leaves/allocation
- Kegunaan: mengatur kuota cuti per karyawan.
$k$,
    'article',
    ARRAY['leave','holiday','allocation','application']
  , k_leave_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_payroll_salary_payout',
    'HRMS Companies V2 - Salary Payout (Payroll)',
    'Panduan Salary Component, Salary Structure, Assignment, Payroll Periode, Payroll Entry, Salary Slip, Cost Component, serta tools bulk/import.',
    $k$
Salary Payout (menu: "Salary Payout" -> /dashboard/payouts)

Salary Component & Structure:
1) Salary Component -> /dashboard/payouts/salary-component
2) Salary Structure -> /dashboard/payouts/salary-structure

Structure Assignment:
3) Salary Structure Assignment -> /dashboard/payouts/salary-structure-assignment

Payroll Entry:
4) Payroll Periode -> /dashboard/payouts/payroll-periode
5) Payroll Entry -> /dashboard/payouts/payroll-entry
6) Salary Slip -> /dashboard/payouts/salary-slip
7) Cost Component -> /dashboard/payouts/cost-component

Tools:
8) Bulk Salary Structure Assignment -> /dashboard/payouts/bulk-salary-structure-assignment
9) Import Payroll Entry -> /dashboard/payouts/import-payroll

Pola UI umum:
- Table actions: "Filter", "Export", bulk "Choose Action", row "Available Actions"
- Create: "Add New"
- Submit form: "Save Changes"
$k$,
    'article',
    ARRAY['payroll','salary payout','salary slip','payroll entry','structure','component']
  , k_payroll_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_reimbursment_travel',
    'HRMS Companies V2 - Reimbursment & Travel',
    'Panduan modul claim expenses dan travel management.',
    $k$
Reimbursment & Travel (menu: "Reimbursment & Travel" -> /dashboard/reimbursment)

Claim Expenses:
1) Employee Expense -> /dashboard/reimbursment/expense
2) Employee Advance -> /dashboard/reimbursment/advance
3) Expense Claim Type -> /dashboard/reimbursment/type

Travel Management:
4) Travel Request -> /dashboard/reimbursment/travel
5) Travel Route -> /dashboard/reimbursment/travel_route
6) Budgeting -> /dashboard/reimbursment/budgeting

Pola UI umum:
- Create biasanya menggunakan "Add New" (contoh pada Travel: "Add New Route", "Add New Costing Detail")
- Submit form: "Save Changes"
$k$,
    'article',
    ARRAY['reimbursment','travel','expense','advance','budgeting']
  , k_reimbursment_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_checklist',
    'HRMS Companies V2 - Checklist',
    'Panduan Checklist Master, Checklist Assignment, dan Checklist Record.',
    $k$
Checklist (menu: "Checklist" -> /dashboard/checklist)

1) Checklist Master -> /dashboard/checklist/master
- Kegunaan: membuat definisi checklist.

2) Checklist Assignment -> /dashboard/checklist/assignment
- Kegunaan: assign checklist ke user/karyawan.
- Ada form bulk (contoh: "Bulk Assignment Setup", "Add Bulk Assignment").

3) Checklist Record -> /dashboard/checklist/record
- Kegunaan: melihat record hasil checklist.
- Pola table: "Filter", "Export", bulk "Choose Action", row "Available Actions"
- Create: "Add New" (jika fitur create tersedia di halaman terkait).
$k$,
    'article',
    ARRAY['checklist','assignment','record']
  , k_checklist_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_documents',
    'HRMS Companies V2 - Documents',
    'Panduan modul Documents untuk upload dan manajemen dokumen.',
    $k$
Documents (menu: "Documents" -> /dashboard/documents)

Pola umum:
- Pilih modul di sidebar "Documents"
- Gunakan aksi upload sesuai form yang disediakan
- Submit form umumnya "Save Changes"
- Jika ada upload massal, ikuti instruksi pada halaman upload.
$k$,
    'article',
    ARRAY['documents','upload','management']
  , k_documents_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_assets_resources',
    'HRMS Companies V2 - Assets & Resources',
    'Panduan modul Assets Management: Categories, Assets, Assignment, Maintenances.',
    $k$
Assets & Resources (menu: "Assets & Resources" -> /dashboard/assets)

Assets Management:
1) Categories -> /dashboard/assets/categories
2) Assets -> /dashboard/assets/assets
3) Assignment -> /dashboard/assets/assignment
4) Maintenances -> /dashboard/assets/maintenances

Pola table:
- "Filter", "Export", bulk "Choose Action", row "Available Actions"
- Create: "Add New" jika tersedia
$k$,
    'article',
    ARRAY['assets','categories','assignment','maintenances']
  , k_assets_mgmt);

  CALL upsert_knowledge(
    'hrmsv2_users_settings_billing',
    'HRMS Companies V2 - Users, Account, Billing, Settings',
    'Panduan modul Settings, My Account, Billings, Users Management, Publisher.',
    $k$
Company & Account:

1) Publisher -> /dashboard/publishers
2) Settings -> /dashboard/settings
3) My Account -> /dashboard/account
4) Billings -> /dashboard/billings
5) Users Management -> /dashboard/users

Pola umum:
- Gunakan menu sesuai label di sidebar.
- Jika ada perubahan konfigurasi, simpan dengan "Save Changes".
$k$,
    'article',
    ARRAY['settings','account','billing','users','publisher']
  , k_users_settings_mgmt);

  CALL upsert_intent_llm(
    'hrmsv2_navigate_menu',
    'Navigasi Menu HRMS Companies V2',
    'Menjawab cara menemukan modul/halaman berdasarkan menu dan rute yang tersedia di HRMS Companies V2.',
    '{"category":"navigation"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Di mana menu Salary Payout?');
  CALL add_intent_example(v_intent_id, 'Saya mau buka halaman Attendance Records');
  CALL add_intent_example(v_intent_id, 'Menu untuk Checklist ada di mana?');
  CALL add_intent_example(v_intent_id, 'Bagaimana cara masuk ke halaman Users Management?');
  CALL map_intent_knowledge(v_intent_id, k_nav_overview, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_ui_actions_filter_export_bulk',
    'Menggunakan Filter, Export, Bulk Action, Row Action',
    'Menjawab cara menggunakan action bar (Filter/Export), bulk action (Choose Action), dan row action (Available Actions).',
    '{"category":"ui-actions"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Bagaimana cara pakai Filter di tabel?');
  CALL add_intent_example(v_intent_id, 'Cara export data ke Excel di tabel?');
  CALL add_intent_example(v_intent_id, 'Bulk action itu lewat mana?');
  CALL add_intent_example(v_intent_id, 'Menu titik tiga di tabel itu apa?');
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 1);
  CALL map_intent_knowledge(v_intent_id, k_nav_overview, 2);

  CALL upsert_intent_llm(
    'hrmsv2_companies_manage',
    'Mengelola Companies',
    'Panduan membuat, mengubah, dan menemukan halaman Companies.',
    '{"module":"companies"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Bagaimana cara tambah company baru?');
  CALL add_intent_example(v_intent_id, 'Di mana halaman Companies?');
  CALL add_intent_example(v_intent_id, 'Cara edit data company?');
  CALL map_intent_knowledge(v_intent_id, k_company_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_approval_policy_setup',
    'Mengatur Approval Policy',
    'Panduan mengatur kebijakan approval pada modul Company Management.',
    '{"module":"approval-policy"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Bagaimana cara setting Approval Policy?');
  CALL add_intent_example(v_intent_id, 'Approval policy ada di menu mana?');
  CALL add_intent_example(v_intent_id, 'Saya mau atur alur approval pengajuan');
  CALL map_intent_knowledge(v_intent_id, k_company_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_approval_request_process',
    'Memproses Approval Request',
    'Panduan memproses permintaan approval termasuk penggunaan Approval Action modal.',
    '{"module":"approval-request"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara approve request di Approval Request?');
  CALL add_intent_example(v_intent_id, 'Cara reject approval request?');
  CALL add_intent_example(v_intent_id, 'Di mana Approval Request?');
  CALL map_intent_knowledge(v_intent_id, k_company_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_employees_manage',
    'Mengelola Employees',
    'Panduan menggunakan halaman Employees termasuk create, filter, export, dan row actions.',
    '{"module":"employees"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Bagaimana cara tambah karyawan baru?');
  CALL add_intent_example(v_intent_id, 'Cara mencari karyawan pakai filter?');
  CALL add_intent_example(v_intent_id, 'Cara export daftar karyawan?');
  CALL add_intent_example(v_intent_id, 'Cara edit data employee?');
  CALL map_intent_knowledge(v_intent_id, k_employee_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_employee_masterdata_manage',
    'Mengelola Master Data Employee (Branches/Departments/Designations/Grades/Types)',
    'Panduan pengelolaan master data employee untuk kebutuhan onboarding dan payroll.',
    '{"module":"employee-master-data"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Bagaimana cara tambah Branch?');
  CALL add_intent_example(v_intent_id, 'Cara buat Department baru?');
  CALL add_intent_example(v_intent_id, 'Di mana halaman Designations?');
  CALL add_intent_example(v_intent_id, 'Cara update Employee Grades?');
  CALL map_intent_knowledge(v_intent_id, k_employee_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_kpi_manage',
    'Mengelola KPI (Key Performance Indicator)',
    'Panduan navigasi dan penggunaan modul KPI sesuai menu HRMS Companies V2.',
    '{"module":"kpi"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Di mana menu KPI Score?');
  CALL add_intent_example(v_intent_id, 'Cara buka Balance Score Card?');
  CALL add_intent_example(v_intent_id, 'KPI Assignment ada di mana?');
  CALL add_intent_example(v_intent_id, 'Bagaimana cara mengelola KPI Structure?');
  CALL map_intent_knowledge(v_intent_id, k_kpi_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_hiring_manage',
    'Mengelola Hiring (Job Posting/Candidates/Interview/Offering/Onboarding)',
    'Panduan navigasi dan alur dasar modul Hiring Management.',
    '{"module":"hiring"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Di mana halaman Job Posting?');
  CALL add_intent_example(v_intent_id, 'Cara update status kandidat?');
  CALL add_intent_example(v_intent_id, 'Interview ada di menu mana?');
  CALL add_intent_example(v_intent_id, 'Onboarding page itu di mana?');
  CALL map_intent_knowledge(v_intent_id, k_hiring_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_form_builder_manage',
    'Menggunakan Form Builder (Workspace)',
    'Panduan navigasi dan penggunaan dasar Form Builder pada Workspace.',
    '{"module":"workspace-forms"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Di mana menu Form Builder?');
  CALL add_intent_example(v_intent_id, 'Cara menambah pertanyaan baru di form builder?');
  CALL add_intent_example(v_intent_id, 'Saya mau edit form di workspace');
  CALL map_intent_knowledge(v_intent_id, k_workspace_forms, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_employee_import',
    'Import Employee',
    'Panduan melakukan import data karyawan melalui menu Import Employee.',
    '{"module":"employee-import"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara import employee dari Excel?');
  CALL add_intent_example(v_intent_id, 'Import Employee ada di menu mana?');
  CALL add_intent_example(v_intent_id, 'Saya mau upload data karyawan');
  CALL map_intent_knowledge(v_intent_id, k_employee_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_shift_types_manage',
    'Mengelola Shift Types',
    'Panduan membuat dan mengatur Shift Types pada modul Shift Management.',
    '{"module":"shift-types"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara membuat shift type baru?');
  CALL add_intent_example(v_intent_id, 'Shift Types ada di menu mana?');
  CALL add_intent_example(v_intent_id, 'Saya mau edit shift type');
  CALL map_intent_knowledge(v_intent_id, k_attendance_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_shift_assignments_manage',
    'Mengelola Shift Assignments (Bulk/Schedule)',
    'Panduan assign shift ke karyawan termasuk bulk dan schedule.',
    '{"module":"shift-assignments"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara assign shift ke karyawan?');
  CALL add_intent_example(v_intent_id, 'Shift Assignments Bulk itu untuk apa?');
  CALL add_intent_example(v_intent_id, 'Saya mau buat jadwal shift (schedule) lewat mana?');
  CALL map_intent_knowledge(v_intent_id, k_attendance_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_attendance_records_view',
    'Melihat Attendance Records',
    'Panduan melihat dan mengekspor Attendance Records.',
    '{"module":"attendance-records"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Di mana lihat Attendance Records?');
  CALL add_intent_example(v_intent_id, 'Cara export attendance ke Excel?');
  CALL add_intent_example(v_intent_id, 'Cara filter attendance berdasarkan tanggal?');
  CALL map_intent_knowledge(v_intent_id, k_attendance_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_attendance_request_process',
    'Memproses Attendance Request',
    'Panduan memproses permintaan absensi pada Attendance Request.',
    '{"module":"attendance-request"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara approve attendance request?');
  CALL add_intent_example(v_intent_id, 'Cara reject attendance request?');
  CALL add_intent_example(v_intent_id, 'Attendance Request ada di menu mana?');
  CALL map_intent_knowledge(v_intent_id, k_attendance_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_company_mgmt, 2);

  CALL upsert_intent_llm(
    'hrmsv2_checkpoint_manage',
    'Mengelola Checkpoint',
    'Panduan mengelola Checkpoint Location, Assignment, dan Record.',
    '{"module":"checkpoint"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara buat checkpoint location?');
  CALL add_intent_example(v_intent_id, 'Di mana checkpoint assignment?');
  CALL add_intent_example(v_intent_id, 'Cara lihat checkpoint record?');
  CALL map_intent_knowledge(v_intent_id, k_attendance_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_reports_attendance',
    'Membuka Report & Tools (Attendance/Shift/Checkpoint)',
    'Panduan membuka halaman report attendance, activity, shift, checkpoint, summary, dan monitoring maps.',
    '{"module":"reports"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Di mana Attendance Report?');
  CALL add_intent_example(v_intent_id, 'Cara buka Monitoring Maps?');
  CALL add_intent_example(v_intent_id, 'Shift Report ada di menu mana?');
  CALL map_intent_knowledge(v_intent_id, k_attendance_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_leave_types_manage',
    'Mengelola Leave Type & Holiday List',
    'Panduan mengelola Holiday List dan Leave Type pada Leaves & Holidays.',
    '{"module":"leave-type"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara tambah hari libur di Holiday List?');
  CALL add_intent_example(v_intent_id, 'Leave Type ada di menu mana?');
  CALL add_intent_example(v_intent_id, 'Bagaimana cara buat jenis cuti baru?');
  CALL map_intent_knowledge(v_intent_id, k_leave_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_leave_application_process',
    'Memproses Leave Application',
    'Panduan memproses pengajuan cuti pada Leave Application.',
    '{"module":"leave-application"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara approve leave application?');
  CALL add_intent_example(v_intent_id, 'Cara reject leave request?');
  CALL add_intent_example(v_intent_id, 'Di mana halaman Leave Application?');
  CALL map_intent_knowledge(v_intent_id, k_leave_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_leave_allocation_manage',
    'Mengelola Leave Allocation',
    'Panduan mengatur kuota cuti pada Leave Allocation.',
    '{"module":"leave-allocation"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara set kuota cuti karyawan?');
  CALL add_intent_example(v_intent_id, 'Leave Allocation ada di mana?');
  CALL map_intent_knowledge(v_intent_id, k_leave_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_payroll_component_structure',
    'Mengelola Salary Component & Salary Structure',
    'Panduan membuat komponen gaji dan struktur gaji.',
    '{"module":"salary-component-structure"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara buat Salary Component?');
  CALL add_intent_example(v_intent_id, 'Salary Structure ada di menu mana?');
  CALL add_intent_example(v_intent_id, 'Bagaimana cara atur struktur gaji?');
  CALL map_intent_knowledge(v_intent_id, k_payroll_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_salary_structure_assignment',
    'Salary Structure Assignment',
    'Panduan assign Salary Structure ke employee (assignment).',
    '{"module":"salary-structure-assignment"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara assign salary structure ke employee?');
  CALL add_intent_example(v_intent_id, 'Di mana menu Salary Structure Assignment?');
  CALL map_intent_knowledge(v_intent_id, k_payroll_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_payroll_periode_entry_run',
    'Menjalankan Payroll (Periode & Entry)',
    'Panduan mengatur Payroll Periode dan menjalankan Payroll Entry.',
    '{"module":"payroll-entry"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara membuat payroll periode?');
  CALL add_intent_example(v_intent_id, 'Cara menjalankan Payroll Entry?');
  CALL add_intent_example(v_intent_id, 'Menu Payroll Entry ada di mana?');
  CALL map_intent_knowledge(v_intent_id, k_payroll_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_salary_slip_manage',
    'Mengelola Salary Slip',
    'Panduan melihat Salary Slip dan melakukan aksi terkait status/ekspor.',
    '{"module":"salary-slip"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Di mana lihat Salary Slip?');
  CALL add_intent_example(v_intent_id, 'Cara export salary slip?');
  CALL add_intent_example(v_intent_id, 'Bagaimana cara update status salary slip?');
  CALL map_intent_knowledge(v_intent_id, k_payroll_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_payroll_import_entry',
    'Import Payroll Entry',
    'Panduan import data Payroll Entry melalui menu Import Payroll Entry.',
    '{"module":"import-payroll"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara import payroll entry?');
  CALL add_intent_example(v_intent_id, 'Import Payroll Entry ada di menu mana?');
  CALL map_intent_knowledge(v_intent_id, k_payroll_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_reimbursment_expense_manage',
    'Mengelola Employee Expense & Advance',
    'Panduan menggunakan modul reimbursment untuk expense dan advance.',
    '{"module":"reimbursment-expense"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Di mana halaman Employee Expense?');
  CALL add_intent_example(v_intent_id, 'Cara input expense claim?');
  CALL add_intent_example(v_intent_id, 'Employee Advance itu ada di menu mana?');
  CALL map_intent_knowledge(v_intent_id, k_reimbursment_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_reimbursment_travel_manage',
    'Mengelola Travel Request & Travel Route',
    'Panduan membuat dan mengelola travel request serta travel route.',
    '{"module":"reimbursment-travel"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara buat Travel Request?');
  CALL add_intent_example(v_intent_id, 'Cara tambah Travel Route?');
  CALL add_intent_example(v_intent_id, 'Budgeting ada di menu mana?');
  CALL map_intent_knowledge(v_intent_id, k_reimbursment_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_ui_naming, 2);

  CALL upsert_intent_llm(
    'hrmsv2_checklist_manage',
    'Mengelola Checklist (Master/Assignment/Record)',
    'Panduan membuat checklist, melakukan assignment, dan melihat record.',
    '{"module":"checklist"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Checklist Master ada di mana?');
  CALL add_intent_example(v_intent_id, 'Cara assign checklist ke karyawan?');
  CALL add_intent_example(v_intent_id, 'Cara lihat Checklist Record?');
  CALL map_intent_knowledge(v_intent_id, k_checklist_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_documents_manage',
    'Mengelola Documents',
    'Panduan membuka dan menggunakan modul Documents.',
    '{"module":"documents"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Di mana menu Documents?');
  CALL add_intent_example(v_intent_id, 'Cara upload dokumen?');
  CALL map_intent_knowledge(v_intent_id, k_documents_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_assets_manage',
    'Mengelola Assets',
    'Panduan modul Assets Management (Categories/Assets/Assignment/Maintenances).',
    '{"module":"assets"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Cara tambah asset category?');
  CALL add_intent_example(v_intent_id, 'Assets ada di menu mana?');
  CALL add_intent_example(v_intent_id, 'Cara assign asset ke user?');
  CALL map_intent_knowledge(v_intent_id, k_assets_mgmt, 1);

  CALL upsert_intent_llm(
    'hrmsv2_users_settings_billing',
    'Users Management, Account, Billing, Settings',
    'Panduan navigasi dan penggunaan modul users/account/billing/settings.',
    '{"module":"settings-account-billing"}'::jsonb,
    v_intent_id
  );
  CALL add_intent_example(v_intent_id, 'Di mana menu Users Management?');
  CALL add_intent_example(v_intent_id, 'Cara buka halaman Billings?');
  CALL add_intent_example(v_intent_id, 'Settings ada di mana?');
  CALL map_intent_knowledge(v_intent_id, k_users_settings_mgmt, 1);
  CALL map_intent_knowledge(v_intent_id, k_nav_overview, 2);

END;
$seed$;

COMMIT;
