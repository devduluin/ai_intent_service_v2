BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_now timestamptz := NOW();
  v_agent_id uuid;
  v_tool_id uuid;
  v_intent_id uuid;
  v_attendance_host text := 'https://apidev-hrms.duluin.com';
  v_tool_url text := v_attendance_host || '/api/proxy/v1/attendance/ai/attendance/daily-summary';
BEGIN
  SELECT id
  INTO v_agent_id
  FROM agents
  WHERE slug = 'hris_company'
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Agent with slug "hris_company" not found';
  END IF;

  INSERT INTO tools (
    id,
    name,
    slug,
    description,
    method,
    url,
    "authType",
    "authConfig",
    headers,
    "bodyTemplate",
    tags,
    "responseMapping",
    "allowedAgentDelegates",
    "isActive",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    gen_random_uuid(),
    'Attendance Daily Summary API',
    'attendance_daily_summary',
    'Gunakan Tools ini untuk melihat ringkasan absensi harian (hadir/telat/izin/absen) dan daftar karyawan sesuai status',
    'GET',
    v_tool_url,
    'none',
    NULL,
    NULL,
    NULL,
    ARRAY['attendance','absensi','harian','hadir','telat','izin','absent']::text[],
    NULL,
    ARRAY[]::text[],
    TRUE,
    v_now,
    v_now
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    method = EXCLUDED.method,
    url = EXCLUDED.url,
    tags = EXCLUDED.tags,
    "authType" = EXCLUDED."authType",
    "authConfig" = EXCLUDED."authConfig",
    headers = EXCLUDED.headers,
    "bodyTemplate" = EXCLUDED."bodyTemplate",
    "responseMapping" = EXCLUDED."responseMapping",
    "allowedAgentDelegates" = EXCLUDED."allowedAgentDelegates",
    "isActive" = TRUE,
    "updatedAt" = v_now
  RETURNING id INTO v_tool_id;

  INSERT INTO intents (
    id,
    "agentId",
    slug,
    name,
    description,
    "executionType",
    "handlerKey",
    "isActive",
    metadata,
    "createdAt",
    "updatedAt"
  )
  VALUES (
    gen_random_uuid(),
    v_agent_id,
    'attendance_daily_summary',
    'Capability Attendance Daily Summary',
    'Mendapatkan ringkasan absensi harian perusahaan dan daftar karyawan berdasarkan status (hadir/telat/izin/absen)',
    'llm',
    NULL,
    TRUE,
    '{"icon":"🗓️","category":"attendance"}'::jsonb,
    v_now,
    v_now
  )
  ON CONFLICT ("agentId", slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    "executionType" = EXCLUDED."executionType",
    "handlerKey" = EXCLUDED."handlerKey",
    "isActive" = TRUE,
    metadata = EXCLUDED.metadata,
    "updatedAt" = v_now
  RETURNING id INTO v_intent_id;

  INSERT INTO intent_tool_mappings (
    id,
    "intentId",
    "toolId",
    "isPrimary",
    priority,
    "createdAt",
    "updatedAt"
  )
  VALUES (
    gen_random_uuid(),
    v_intent_id,
    v_tool_id,
    TRUE,
    1,
    v_now,
    v_now
  )
  ON CONFLICT ("intentId", "toolId") DO UPDATE SET
    "isPrimary" = TRUE,
    priority = 1,
    "updatedAt" = v_now;

  DELETE FROM tools_parameters
  WHERE "toolId" = v_tool_id;

  INSERT INTO tools_parameters (
    id,
    "toolId",
    name,
    type,
    description,
    "isRequired",
    "extractPrompt",
    "defaultValue",
    "createdAt",
    "updatedAt"
  )
  VALUES
    (
      gen_random_uuid(),
      v_tool_id,
      'company_id',
      'string',
      'Company ID (UUID) perusahaan',
      TRUE,
      'Company ID (UUID). Jika tidak disebutkan, gunakan dari passing data (attributes/params). Jika tetap tidak ada, minta user memberikan company_id.',
      '',
      v_now,
      v_now
    ),
    (
      gen_random_uuid(),
      v_tool_id,
      'all_company',
      'boolean',
      'Ambil data untuk semua company (true/false). Jika tidak disebutkan, gunakan true',
      FALSE,
      'boolean true/false. Jika user menanyakan "semua" atau tidak menyebutkan scope, jawab true. Jika user menanyakan "company tertentu" atau ingin spesifik, jawab false.',
      'true',
      v_now,
      v_now
    ),
    (
      gen_random_uuid(),
      v_tool_id,
      'date',
      'string',
      'Tanggal ringkasan absensi (YYYY-MM-DD). Jika tidak disebutkan, gunakan hari ini',
      TRUE,
      'Tanggal dalam format YYYY-MM-DD. Jika user bilang "hari ini" gunakan tanggal hari ini (Asia/Jakarta). Jika user tidak menyebutkan tanggal, gunakan hari ini.',
      '',
      v_now,
      v_now
    ),
    (
      gen_random_uuid(),
      v_tool_id,
      'status',
      'string',
      'Filter status: all | present | late | leave | absent',
      FALSE,
      'Status filter: all, present, late, leave, absent. Jika user bertanya "siapa yang izin" → leave. "siapa yang telat" → late. "siapa yang hadir" → present. "siapa yang tidak hadir/alpha" → absent. Jika tidak spesifik, jawab all.',
      'all',
      v_now,
      v_now
    );

  DELETE FROM intent_examples
  WHERE "intentId" = v_intent_id;

  INSERT INTO intent_examples (
    id,
    "intentId",
    text,
    language,
    "createdAt",
    "updatedAt"
  )
  VALUES
    (gen_random_uuid(), v_intent_id, 'Absensi hari ini gimana?', 'id', v_now, v_now),
    (gen_random_uuid(), v_intent_id, 'Rekap absensi hari ini', 'id', v_now, v_now),
    (gen_random_uuid(), v_intent_id, 'Ringkasan absensi hari ini', 'id', v_now, v_now),
    (gen_random_uuid(), v_intent_id, 'Siapa saja yang izin hari ini?', 'id', v_now, v_now),
    (gen_random_uuid(), v_intent_id, 'Siapa yang telat hari ini?', 'id', v_now, v_now),
    (gen_random_uuid(), v_intent_id, 'Siapa yang hadir hari ini?', 'id', v_now, v_now),
    (gen_random_uuid(), v_intent_id, 'Siapa yang tidak hadir hari ini?', 'id', v_now, v_now),
    (gen_random_uuid(), v_intent_id, 'Daftar karyawan yang alpha hari ini', 'id', v_now, v_now),
    (gen_random_uuid(), v_intent_id, 'Summary absensi tanggal 2026-05-27', 'id', v_now, v_now);
END;
$$;

COMMIT;
