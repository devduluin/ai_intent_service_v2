# VIPER V3.7.1 - Modular AI Intent Pipeline Engine

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-3.7.1-orange)](package.json)

## 📋 Daftar Isi

- [Deskripsi Singkat](#deskripsi-singkat)
- [What's New in V3.7](#whats-new-in-v37)
- [What's New in V3.7.1](#whats-new-in-v371)
- [Perception Stage](#-perception-stage--intent-frame-detection-new-v371)
- [Memory Task Replay](#-memory-task-replay--recall--select--execute-new-v371)
- [Standalone Comparison](#-standalone-comparison-stage-updated-v371)
- [Skill Signal Service](#-skill-signal-service-new-v371)
- [Active Offer Generation](#-active-offer-generation-system-new-v371)
- [All Skills Registry](#-all-skills--runtime-registry)
- [Continuation Sub-system](#-continuation-sub-system-architecture-updated)
- [Fitur Utama](#fitur-utama)
- [Arsitektur Sistem](#arsitektur-sistem)
- [Road to VIPER Cognition](#-road-to-viper-cognition--human-like-ai-reasoning)
- [Complete Pipeline Flow](#complete-pipeline-flow)
- [Teknologi Stack](#teknologi-stack)
- [Instalasi & Setup](#instalasi--setup)
- [API Documentation](#api-documentation)
- [Chat UI](#chat-ui)
- [Contoh Penggunaan](#contoh-penggunaan)

---

## 🎯 Deskripsi Singkat

**VIPER V3.7** adalah AI Intent Pipeline Engine dengan **modular architecture**, **internal skill runtime**, **contextual flow state**, **automation runtime**, **comprehensive memory management**, dan **cache-first optimization** untuk memproses user input menjadi actionable intents dengan kemampuan:

- **Multi-Tenant Architecture**: Multiple agents/aplikasi dengan isolasi penuh
- **Comprehensive Memory**: Episodic + Working memory dengan automatic updates
- **Cache-First Optimization**: N+1 query prevention dengan single I/O loading
- **Pipeline Re-entry**: Continuation fallback ke main pipeline flow
- **Internal Skills**: Skill auto-discovery dari folder `src/skills`, tidak lagi bergantung pada legacy handler DB
- **Skill Param Schema**: Skill dapat memakai `paramSchema` dan slot filling seperti tool
- **Active Offer**: Sistem dapat menawarkan next action yang executable dan grounded
- **Comparison V1**: Continuation comparison exact-tool dengan temporal mapping dinamis
- **ClarificationState**: Planner clarification disimpan dan jawaban user berikutnya dipakai untuk re-run pipeline
- **Temporal-Only Follow-up Guard**: Query seperti `tanggal 29` dan `saya ingin lihat kemarin` diarahkan ke active intent/tool, bukan vector matching bebas
- **Memory Recall Skill**: Skill khusus untuk menjawab riwayat/topik yang pernah dibahas
- **Episodic Topic Normalization**: Episodic memory menyimpan `topicKey`, `flowStage`, `taskPlan`, dan `flowTrace`
- **LLM Entity Detection**: Intelligent entity change detection dengan temporal collaboration
- **Dynamic XLS Styles**: 8 pre-defined Excel themes dengan random style support
- **WebSocket Support**: Real-time communication dengan auto-reconnect
- **Slot Filling**: Progressive parameter gathering dengan retry logic
- **Multi-Entity Detection**: Detect multiple entity changes in single query
- **Knowledge-Augmented Response**: RAG (Retrieval Augmented Generation)
- **Structured JSON Analysis**: LLM-powered data analysis dengan JSON schema
- **Param Resolution Service**: Unified parameter collection dari 5 sources
- **Automation Runtime**: Reminder, scheduled workflow, dan conditional alert dengan confirmation, pretest, scheduler, dan WebSocket notification
- **God Mode Manager**: Mode scoped seperti `/automation manager` dan `/user profile` agar command ambiguous tidak bentrok dengan pipeline utama
- **Reusable Text Intent Cleanup**: Shared utility untuk cancellation, exit mode, temporal residue, dan generic desire phrase ID/EN
- **Confirmation Runtime**: Draft create/delete automation wajib dikonfirmasi, mendukung edit, cancel, hard delete, dan TTL
- **Pipeline Collision Guards**: Pending, confirmation, god mode, offer, continuation, greeting, dan memory recall diprioritaskan secara eksplisit

VIPER (Vector Intent Pipeline Execution Resolution) memberikan pengalaman conversational AI yang natural, contextual, dan efisien. Fokus V3.7 adalah menjaga konteks percakapan tetap executable: follow-up, offer, clarification, memory recall, automation, god-mode command, dan comparison diproses sebagai flow eksplisit, bukan fallback chat bebas.

---

## ✨ What's New in V3.7

### Automation Runtime V1
```text
User: ingatkan saya besok jam 7 pagi meeting
-> automation_manager
-> confirmation_required
-> user confirms
-> automation_jobs saved
-> scheduler sends WebSocket notification at due time
```

Supported automation types:

```text
reminder
scheduled_workflow
conditional_alert
```

Behavior:

- Reminder uses one-time trigger by default.
- Scheduled workflow runs the full pipeline when the schedule is due, then sends a grounded notification from the pipeline result.
- Conditional alert runs the full pipeline, evaluates the condition, and only notifies when the condition is true.
- Scheduled workflow and conditional alert run pretest before confirmation so bad future jobs are easier to detect.
- Confirmation output is standardized across reminder, scheduled workflow, and conditional alert.

### God Mode Manager
```text
/automation manager
-> enter scoped automation mode
-> list automation jobs
-> hapus 1
-> confirmation delete
-> ya hapus
-> hard delete
```

God mode isolates command interpretation:

```text
/automation manager
/user profile
exit
kluar
```

When a god mode is active, mode commands are handled before normal planner execution. `exit` or `kluar` exits the active mode even if a slot-filling state exists.

### Confirmation Runtime
Automation create/delete uses a reusable confirmation state:

```text
confirmation_required
-> simpan / ya
-> ubah ...
-> batalkan
-> TTL expiry
```

Delete automation is hard delete from `automation_jobs`, not soft status update.

### Reusable Text Intent Cleanup
Shared utility:

```text
src/utils/text-intent-cleanup.util.ts
```

Responsibilities:

- Normalize intent text.
- Strip generic desire words such as `ingin`, `mau`, `pengen`, `want`, `need`.
- Detect temporal follow-up residue for ID/EN.
- Detect cancellation text.
- Detect delete confirmation text.
- Detect mode exit text.

This prevents duplicated regex logic across `PipelineService`, `ContinuationResolver`, `PipelineCore`, automation params, and mode services.

### Pipeline State Collision Guards
Priority is explicit:

```text
global mode exit / cancel
-> pending slot filling
-> pending confirmation
-> god mode
-> clarification
-> active offer
-> continuation
-> main pipeline
```

Important guard:

```text
halo
AI: Mau saya tampilkan kemampuan?
User: ya tampilkan memori kemarin
```

The active offer resolver will not swallow this as `show_capabilities`; it falls through to the main pipeline so memory recall can run.

### Automation Data Naturalization
Scheduler notifications now prefer grounded result data:

- Scheduled workflow runs the pipeline and naturalizes the pipeline result.
- Conditional alert includes condition evaluation, observed value, and raw JSON preview.
- Large JSON is compacted safely with circular, BigInt, Date, max-depth, and max-node guards.

---

## Previous V3.6 Highlights

### 🧭 ClarificationState
```typescript
// Planner can ask clarification and preserve the original query.
{
  originalText: "cek data hari ini",
  clarificationQuestion: "Data apa yang Anda maksud?",
  retryCount: 0,
  maxRetry: 2
}
```

Jika planner menghasilkan `needsClarification=true`, pipeline mengembalikan `intent: "clarification"` dan menyimpan state. Jawaban berikutnya digabung ke query awal:

```text
cek data hari ini. Klarifikasi user: kendaraan exit
```

Ini berbeda dari slot filling. Slot filling dipakai untuk missing param; ClarificationState dipakai untuk ambiguity intent/task.

### 📅 Temporal-Only Follow-up Routing
```text
User: tampilkan kendaraan exit hari ini
User: coba lihat kemarin
User: tanggal 29
```

Query temporal-only tidak lagi masuk vector matching bebas. Jika working memory memiliki `activeIntent`/`activeTool`, PipelineCore route ke active intent dengan `source: "memory_fallback"`.

Supported temporal follow-up:

```text
kemarin
saya ingin lihat kemarin
tanggal 29
tgl 29
2026-05-29
29/05/2026
```

`tanggal 29` di-resolve dinamis. Jika tanggal hari ini `2026-06-01`, maka `tanggal 29` berarti `2026-05-29`.

### 🧠 Memory Recall Skill
```text
User: Apa yang saya bahas kemarin?
→ planner selects skill: memory_recall
```

`memory_recall` mengambil episodic memory berdasarkan user/app/date/topic dan mengembalikan summary yang grounded. Jika memory item punya `taskPlan` dan `flowTrace` aman, sistem dapat membuat active offer:

```text
Mau saya tampilkan kembali data dari pembahasan itu?
```

Jawaban `ya` menjalankan ulang tool/skill dari task plan lama, bukan general chat.

### 🗂️ Episodic Memory Normalization
Episodic memory sekarang memisahkan:

```text
intent      = label kompatibilitas lama
topicKey    = topik yang dibahas user
flowStage   = cara Viper memproses request
taskPlan    = graph task yang dieksekusi
flowTrace   = jejak compact tool/skill/offer/comparison
memoryMeta  = metadata tambahan
```

Rule utama:

```text
intent/topic is what the user talked about.
flowStage is how Viper processed it.
taskPlan is what Viper executed.
```

### 🧩 Planner Context Improvements
Planner prompt sekarang menerima:

```text
recent_usage
recent_user_msgs
recent_assistant_msgs
recommended_resource
```

Ini membantu planner memahami offer/response AI terakhir ketika query user pendek atau ambigu.

### 🧩 Internal Skills Runtime
```typescript
// Skills auto-discovered from src/skills
skillsRegistry.registerSkill(metadata, handler);

// Planner task uses first-class skill resource
{
  "resource": "skill",
  "key": "data_analyzer",
  "depends_on": ["1"]
}
```

Legacy `handler` task/resource sudah digantikan oleh `skill`. Intent DB masih bisa dipertahankan untuk backward compatibility, tetapi planner dan execution path utama memakai `tool`, `skill`, dan `knowledge`.

### 🧾 Skill Param Schema + Slot Filling
```typescript
export const greetingSkill = {
  slug: 'greeting',
  paramSchema: [
    { name: 'show_skills', type: 'boolean', isRequired: false }
  ]
}
```

Skill sekarang dapat memakai `paramSchema` yang dinormalisasi ke schema param resource yang sama dengan tool. Slot filling, clarification, param validation, dan execution guard berlaku untuk skill yang punya required param.

### 💡 Active Offer Generation
```typescript
activeOffer: {
  status: 'active',
  type: 'show_capabilities',
  target: {
    resource: 'skill',
    key: 'greeting',
    paramsPatch: { show_skills: true }
  }
}
```

VIPER dapat menawarkan next action setelah execution, tetapi hanya dari kandidat deterministic yang executable. LLM hanya boleh menarasikan `allowedOffer`, bukan memilih tool/skill bebas.

### 🔍 Grounded Search Continuation
```text
User: cek kendaraan leave hari ini
AI: ...
User: cari apakah ada ardi mahendra
→ continuation refine active tool
→ execute get_vehicle_assignment({ search: "ardi mahendra", status: "leave", date })
```

Pertanyaan pencarian lanjutan tidak lagi jatuh ke general chat. Jika tetap fallback, general chat memiliki operational-data guard agar tidak mengarang record/nama dari summary atau memory.

### 🔁 Comparison V1
```text
User: cek kendaraan exit hari ini
User: bandingkan dengan kemarin
→ exact-tool comparison
→ baseline params: hari ini
→ target params: kemarin
→ analyzer receives baseline + target
```

V1 fokus pada exact-tool comparison. Temporal param mapping bersifat dinamis mengikuti schema tool (`date`, `month`, `year`, `start_date`, `end_date`, `month_year`).

### 🧠 Comprehensive Memory Management
```typescript
// Episodic Memory - Long-term conversation history
await episodicMemoryService.summarize(agent, intent, ...messages);

// Working Memory - Short-term context
workingMemory: {
  activeIntent: 'get_time',
  activeEntities: { city: 'jakarta' },
  activeTool: 'get_time',
  activePlan: { mode: 'single_step', tasks: [...] }  // ✅ NEW: Store planner tasks
}
```

### 🔄 Pipeline Re-entry for Continuation
```typescript
// Continuation fallback re-routes to main pipeline
if (result.intent === 'continuation_fallback') {
  return await executeMainPipeline(input, agent);  // ✅ Ensures memory updates
}
```

### ⚡ Cache-First Optimization
```typescript
// Load context ONCE, use multiple times
const execContext = await loadContinuationContext();  // 1 I/O
const cachedParams = execContext.cachedParams;        // ✅ No duplicate I/O
```

### 🎯 Multi-Entity Change Detection
```typescript
// Detect multiple entity changes in single query
User: "kalau bandung besok?"
→ changedParams: {
  city: { oldValue: 'jakarta', newValue: 'bandung' },
  date: { oldValue: '2026-05-27', newValue: '2026-05-28' }
}
```

### 🔁 Slot Filling with Retry Logic
```typescript
// Retry count tracking
retryCount: 1/2  // User gets 2 attempts
maxRetry: 2      // Default max retries
```

### 📊 Structured JSON Analysis
```typescript
// Data analyzer returns structured JSON (not markdown)
{
  "analysis": {
    "summary": "Data menunjukkan...",
    "insights": ["Insight 1", "Insight 2"],
    "patterns": ["Pattern 1"],
    "recommendations": ["Recommendation 1", "Recommendation 2"],
    "caveats": ["Caveat 1"]
  }
}
```

### 🔧 Param Resolution Service
```typescript
// Collect params from 5 sources
const resolutionResult = await paramResolutionService.resolve(input, plan, decompositionResult);
// Sources:
// 1. input.attributes.params (explicit injection)
// 2. signals.temporalDetails (normalized dates)
// 3. deterministic rules (status patterns)
// 4. LLM extraction (only missing params)
// 5. tool defaults (fallback)
```

---

## ✨ What's New in V3.7.1 — VIPER Engineering Review (2026-06-04)

CTO-led full codebase audit menemukan 8 bug dan 6 optimization opportunities. 6 bug fixed, 2 known issues documented. Cumulative ~400ms latency reduction across pipeline.

### 🐛 Bug Fixes

#### `isDefaultAllowed` — Required select defaults not applied (HIGH)
**File:** `param-resolution.service.ts`  
**Issue:** Param `type: 'select'` dengan `defaultValue` (e.g., `status: 'exit'`) tidak diaplikasikan kecuali ada `useDefaultWhenMissing: true` di config.  
**Fix:** Hapus guard. Semua meaningful `defaultValue` langsung dipakai tanpa syarat tambahan.  
**Impact:** `get_vehicle_assignment` dll. tidak lagi gagal karena missing `status`.

#### `checkMissingParams` — Empty string defaults bypass slot filling (MEDIUM)
**File:** `pipeline-core.ts:1329, 1353`  
**Issue:** Filter `!== undefined && !== null` tidak mendeteksi `defaultValue: ''` sebagai "tidak ada default". Param dengan empty default lolos dari slot filling → execution error 500.  
**Fix:** Tambah `&& !== ''` di resource-level dan tool-level filter.  
**Impact:** Param `company_id` dll. dengan empty default sekarang memicu slot filling.

#### Double validation in `executeToolTask` (LOW)
**File:** `execution.stage.ts:272`  
**Issue:** `validateParamsForTask` sudah validasi + throw. `getMissingParamsFromTool` memvalidasi ulang dengan logic berbeda — redundant.  
**Fix:** Hapus validasi kedua.

#### `getIntentBySlug` loads ALL intents across agents (MEDIUM)
**File:** `intentKeyword.resolver.ts:203`  
**Issue:** `intentRegistry.getAll()` tanpa agent filter untuk cari 1 intent by slug.  
**Fix:** Ganti ke `intentRegistry.getBySlugs([slug])` — O(n) → O(1).

#### `failedTasks` always 0 in execution metrics (LOW)
**File:** `execution.stage.ts:116`  
**Issue:** Hardcoded `failedTasks: 0` meskipun task gagal dan hasilnya `{ error: ... }`.  
**Fix:** Hitung task dengan `'error' in result`.

#### ConversationState memory leak (MEDIUM)
**File:** `conversationState.service.ts:11`  
**Issue:** In-memory `Map` tanpa periodic eviction. Expiry hanya dicek saat `get()`.  
**Fix:** `setInterval` eviction setiap TTL (5 menit).

### ⚡ Optimizations

#### Cache tool parameter definitions — 1 min TTL
**File:** `resource-param-schema.service.ts`  
**Impact:** ~10-50ms saved per pipeline run. Tool params jarang berubah, cache by sorted slug key.

#### Cache intent registry `getAll()` per agent — 30s TTL
**File:** `intent-registry.service.ts`  
**Impact:** ~5-20ms saved per pipeline run. Filtered results cached per `agentId`. Invalidated on `syncFromDatabase()`.

#### Batch conversation state writes — 2 locks → 1 lock
**Files:** `conversationState.service.ts`, `slot-filling.stage.ts`  
**Impact:** ~50ms saved during slot filling. `updateMissingParams` + `updateCollectedParams` digabung ke `updateSlotState()`.

### ⚠️ Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| Slot filling retry incremented on low LLM confidence (not user error) | Medium | Open |
| Fallback question without LLM for tool-only missing params | Low | Open |
| Conversation state in-memory — not multi-instance ready | Architecture | Planned |

### 📊 Updated Performance Benchmarks

| Metric | V3.7 | V3.7.1 | Improvement |
|--------|------|--------|-------------|
| **Default param resolution** | Failed for required select | Fixed | ✅ No more 500 errors |
| **Slot filling detection** | Empty defaults missed | Fixed | ✅ Proper clarification |
| **Intent keyword lookup** | O(n) across all agents | O(1) by slug | ✅ ~5ms saved |
| **Tool param collection** | DB call per pipeline | Cached 1min | ✅ ~10-50ms saved |
| **Intent registry filter** | Re-filter per pipeline | Cached 30s | ✅ ~5-20ms saved |
| **Slot filling state writes** | 2 lock acquisitions | 1 lock | ✅ ~50ms saved |
| **Conversation memory** | Unbounded growth | Periodic eviction | ✅ Memory stable |
| **Execution metrics** | failedTasks: 0 | Accurate count | ✅ Observability |
| **Cumulative latency** | Baseline | -370-820ms | ✅ Faster pipeline |

---

## 🧠 Perception Stage — Intent Frame Detection (NEW V3.7.1)

**File:** `services/cores/stages/perception.stage.ts`

Sebelum planner berjalan, PerceptionStage mengklasifikasikan user intent ke dalam **8 frame types** menggunakan deterministic rule-based detection dengan confidence scoring.

### Frame Types & Detection Priority

```
1. small_talk          → greeting/thanks (greetingDetector)
2. offer_response      → active offer + confirmation yes/no
3. continuation_refine → working memory aktif + refine/export signals
4. comparison          → decomposition signal isComparison=true
5. memory_task_replay  → memory triggers + "jalankan ulang" / "rerun"
6. memory_question     → memory triggers without replay signal
7. automation_request  → automation triggers (ingatkan/jadwalkan/pantau)
8. direct_task         → default
```

### PerceptionFrame Structure

```typescript
interface PerceptionFrame {
  type: PerceptionIntentType;       // classified frame
  operations: PerceptionOperation[]; // implied sequence (recall→select→execute, etc.)
  confidence: number;                // 0.65 (LOW), 0.80 (MEDIUM), 0.92 (HIGH)
  reasoning: string[];               // human-readable trace
  temporalScope?: { raw, normalized, relativeOffsetDays };
  target?: { resource, key, kind };  // tool/skill/knowledge/memory/automation
  replay?: { requested, source, autoExecuteIfSingle, clarifyIfMultiple };
  automation?: { requested, kind, futureTask };
  safety?: { requiresConfirmation, sideEffectLevel };
}
```

### Skip Embedding Optimization

Frame dengan confidence ≥ 0.85 akan **skip embedding + intent matching stage** (STAGE 3), langsung menuju planner dengan context frame. Ini menghemat ~100-200ms untuk query yang sudah jelas intent-nya.

### Override `shouldFallbackToChat`

High-confidence perception frame dapat meng-override fallback ke chat. Contoh: `memory_question` dengan confidence 0.92 tetap diproses meskipun confidence decision menyatakan fallback.

---

## 🔁 Memory Task Replay — Recall → Select → Execute (NEW V3.7.1)

**Files:** `services/memory-task-replay.service.ts`, `pipeline-core.ts` (STAGE 2.6)

Saat PerceptionStage mendeteksi `memory_task_replay`, pipeline bercabang ke MemoryTaskReplayService:

```
PerceptionFrame (type=memory_task_replay)
  ↓
MemoryTaskReplayService.recallAndSelect()
  ├─ recall from episodic memory (memory_recall skill)
  ├─ filter rerunnable tasks (has taskPlan, not already memory_replay)
  ↓
Decision:
  ├─ auto_execute    → 1 safe match → execute stored plan langsung
  ├─ clarify_multiple → >1 match → tanya user pilih nomor
  └─ no_rerunnable   → tidak ada task yang bisa di-replay
```

### Replay Rules

- Task dianggap **rerunnable** jika memiliki `taskPlan` lengkap (bukan hanya `memory_replay`)
- Tool/skill yang direferensi harus **masih exist** di registry
- Single match dengan `sideEffectLevel: 'none'` → auto-execute tanpa konfirmasi
- Multiple matches → user diminta memilih nomor

### Example

```text
User: "jalankan ulang cek kendaraan yang tadi"
  ↓ Perception: memory_task_replay (confidence 0.92)
  ↓ MemoryTaskReplay: recall "cek kendaraan"
  ↓ Found 1 rerunnable task: get_vehicle_assignment
  ↓ Auto-execute dengan params dari taskPlan tersimpan
  ↓ Naturalization: hasil kendaraan
```

---

## 🔀 Standalone Comparison Stage (UPDATED V3.7.1)

**File:** `services/cores/stages/comparison.stage.ts`

Comparison stage sekarang mendukung **standalone mode** — ketika decomposition mendeteksi comparison signal dengan baseline dari current query.

```
PipelineCore STAGE 6 → plan validation
  ↓
Check: comparison signal + baseline source = current_query?
  ├─ YES → ComparisonStage.tryExecuteStandalone()
  │         ├─ baseline execution (temporal 1)
  │         ├─ target execution (temporal 2)
  │         ├─ trend_analyzer skill
  │         └─ return naturalized comparison result
  └─ NO  → continue normal pipeline
```

Standalone comparison melewati planner dan langsung mengeksekusi dua temporal run + analyzer. Timeout 2x planner timeout karena butuh 2x execution.

---

## 🏷️ Skill Signal Service (NEW V3.7.1)

**File:** `services/skill-signal.service.ts`

Runtime trigger detection dari skill registry — mencegah drift antara skill definition dan detection logic:

```typescript
// PerceptionStage membaca triggers langsung dari skill metadata:
const triggers = skillsRegistry.getSkillBySlug('memory_recall').capabilities.triggers;
// → ['ingat', 'riwayat', 'sejarah', 'apa yang saya tanyakan', ...]

// Tidak ada hardcoded trigger list di perception stage
```

Setiap skill mendefinisikan `capabilities.triggers` di metadata-nya. PerceptionStage membaca ini secara runtime, jadi saat skill definition berubah, detection otomatis mengikuti.

---

## 🎁 Active Offer Generation System (NEW V3.7.1)

**Files:** `services/offer-generation.service.ts`, `services/cores/stages/offer-generation.stage.ts`, `services/cores/resolvers/offer.resolver.ts`

Setelah eksekusi selesai, sistem secara otomatis menghasilkan **proactive offers** untuk next action. Offer bersifat **executable and grounded** — tidak boleh LLM memilih tool/skill bebas.

### 5 Offer Types

```
1. SameToolParamOffer     → "Mau lihat status exit?" (param refinement for same tool)
2. GreetingCapabilityOffer → "Mau saya tampilkan kemampuan saya?" (after greeting)
3. MemoryRecallRerunOffer  → "Mau tampilkan kembali data pembahasan itu?" (replay)
4. AnalyzeOffer            → "Mau saya analisis data ini?" (data_analyzer)
5. ExportOffer             → "Mau diexport ke Excel?" (xls_generator)
```

### Offer Lifecycle

```
generate → rank → select best → store in workingMemory.activeOffer
  ↓
User response
  ↓
OfferResolver.resolve()
  ├─ ya/yes/jalankan → accepted → build plan → execute
  ├─ tidak/batal     → rejected → clear
  ├─ expired (TTL 2min)→ cleared
  └─ new topic        → fall through to main pipeline
```

### Collision Guards

- Pending slot filling **diprioritaskan** di atas active offer (jawaban pendek seperti `ya` tetap isi param dulu)
- Offer dengan strong new topic (e.g. `ya tampilkan memori kemarin`) **tidak ditelan** oleh OfferResolver — jatuh ke main pipeline
- Offer sebelumnya otomatis di-replace saat offer baru dibuat

### LLM Option Resolution

**File:** `services/llm-option-resolution.service.ts`

Offer dan confirmation menggunakan LLM untuk mendeteksi boolean/enum/action dari teks pendek user dengan mode:

```typescript
type LlmOptionResolutionMode = 'boolean' | 'enum' | 'action' | 'param_patch';
```

Digunakan oleh `OfferResolver` (detect yes/no/new-topic) dan `ConfirmationResolver` (detect simpan/ubah/batal).

---

## 📦 All Skills — Runtime Registry

| Skill | Slug | Category | Purpose |
|-------|------|----------|---------|
| **Greeting** | `greeting` | chat | Sapaan + tampilkan kemampuan |
| **Data Analyzer** | `data_analyzer` | analysis | Structured JSON analysis via LLM |
| **Trend Analyzer** | `trend_analyzer` | comparison | Perbandingan baseline vs target |
| **Memory Recall** | `memory_recall` | memory | Riwayat percakapan + replay task |
| **Automation Manager** | `automation_manager` | automation | Reminder, scheduled workflow, conditional alert |
| **Notification Manager** | `notification_manager` | automation | Kirim notifikasi langsung (saat ini) |
| **XLS Generator** | `xls_generator` | export | Generate Excel/CSV dengan LLM formatting |

Setiap skill mendefinisikan `capabilities.triggers` untuk runtime detection dan `paramSchema` untuk slot filling.

### Notification Manager

```text
User: "kirim notifikasi sekarang bahwa server sudah restart"
→ notification_manager skill
→ mengirim notifikasi real-time via WebSocket
→ return delivery status
```

Untuk reminder masa depan, gunakan `automation_manager` bukan ini. `notification_manager` hanya untuk notifikasi **saat ini**.

### XLS Generator

```text
User: "export data kendaraan ke excel"
→ xls_generator skill
→ LLM memilih 8 tema warna (random/dynamic)
→ generate file .xlsx dengan formatting profesional
→ return download link
```

8 pre-defined Excel themes: blue, green, orange, purple, red, teal, gray, yellow.

---

## 🔄 Continuation Sub-system Architecture (UPDATED)

**Directory:** `services/cores/continuation/` (16 files)

```
ContinuationAnalyzer
  ├─ EntityAnalyzer       → entity change detection (city, date, employee)
  ├─ ContextAnalyzer      → conversation context signals
  ├─ WorkflowAnalyzer     → multi-step workflow detection
  ├─ SemanticAnalyzer     → intent similarity scoring
  ├─ LLMEntityDetector    → LLM-powered entity extraction
  ├─ LLMFallbackService   → fallback when cache/tools miss
  ├─ TopicRelevanceService→ topical coherence check
  ├─ EmbeddingCacheService→ embedding result caching
  ├─ QuerySnapshotManager → query history for comparison
  ├─ IntentKeywordResolver→ runtime keyword lookup (no hardcoded maps)
  └─ ConfidenceAggregator → weighted confidence scoring
```

Deteksi continuation types:
- **refine** — search/filter tambahan pada tool yang sama
- **detail** — minta penjelasan lebih detail
- **export** — export/download data
- **comparison** — bandingkan dengan periode lain
- **workflow** — multi-step lanjutan

---

## ✨ Fitur Utama

### 1. **Intent Recognition Engine**
   - Vector embedding menggunakan Ollama/Nomic embed model
   - Semantic similarity search terhadap intent database
   - Confidence-based decision tree dengan threshold adjustment
   - Domain capability matching untuk agent-specific intents
   - Multi-intent detection dengan cross-agent support

### 2. **Comprehensive Memory Management**
   - **Episodic Memory**: Long-term conversation history
     - Automatic summarization setelah setiap interaction
     - Retrieval untuk context-aware responses
     - TTL-based expiration (persistent in DB)
     - Topic fields: `topicKey`, `topicLabel`, `flowStage`
     - Replay fields: `taskPlan`, `flowTrace`, `memoryMeta`
   - **Working Memory**: Short-term context
     - Active intent tracking
     - Active entities (params) preservation
     - Active tool/skill tracking
     - **Active plan storage** (for continuation reuse) ✅
     - **Active offer lifecycle** (`active`, `accepted`, `rejected`, `expired`, `cleared`) ✅
     - Continuation hints (canExport, canSummarize, etc.)
   - **Tool Result Cache**: Execution results caching
     - Entity-specific cache keys
     - Hash-based param caching
     - Redis support for production

### 3. **LLM Entity Detection**
   - Intelligent entity change detection menggunakan LLM
   - Temporal collaboration dengan query-decomposition.service
   - Multi-entity change detection (city, date, timezone, employee)
   - Confidence scoring (0-1 scale)
   - Fallback to rule-based detection
   - Cache-first approach dengan workingMemory fallback

### 4. **Cache-First Optimization** 🆕
   - Single I/O context loading
   - N+1 query prevention
   - WorkingMemory fallback on cache miss
   - Context caching in class properties
   - 67% faster response time

### 5. **Pipeline Re-entry** 🆕
   - Continuation fallback ke main pipeline
   - Ensures episodic memory updates
   - Ensures working memory updates
   - Consistent error handling
   - Metrics recording

### 6. **Slot Filling with Retry Logic** 🆕
   - Progressive parameter gathering
   - Retry count tracking (default: maxRetry=2)
   - Low confidence handling (increment retry, not clear)
   - State updates dengan latest missing params
   - User-friendly clarification messages

### 6.1 **ClarificationState for Planner Ambiguity**
   - Menangani `plannerOutput.needsClarification=true`
   - Mengembalikan `clarificationQuestion` dari planner ke user
   - Menyimpan query awal, question, retry, dan TTL
   - Jawaban user berikutnya digabung sebagai `Klarifikasi user: ...`
   - Digunakan untuk ambiguity intent/task, bukan missing param

### 7. **Smart Parameter Extraction**
   - LLM-based parameter extraction dari user input
   - Batch extraction (single LLM call for all params)
   - Confidence scoring untuk setiap parameter
   - Automatic clarification questions untuk missing parameters
   - Parameter caching untuk optimization
   - Temporal entity injection (dates, locations, etc.)
   - **Param Resolution Service**: Unified collection dari 5 sources ✅

### 8. **Internal Skills Runtime** 🆕
   - Skills auto-discovered dari `src/skills`
   - Planner memakai `resource: "skill"` sebagai first-class task
   - ExecutionStage mengeksekusi skill via `SkillExecutionStrategy`
   - Skill metadata punya `capabilities`, `paramSchema`, `handlerKey`, tags, category
   - Legacy `handler` resource tidak dipakai di planner/execution utama

### 9. **Skill Param Schema & Slot Filling** 🆕
   - Skill bisa punya required/optional params
   - Param schema skill dinormalisasi ke resource param schema yang sama dengan tool
   - Slot filling, clarification, validation, dan retry logic berlaku untuk skill
   - Contoh: `greeting.show_skills=true` dapat diisi dari offer response seperti `ya tampilkan`

### 10. **Active Offer Generation** 🆕
   - Post-execution deterministic offer generation
   - Offer tersimpan di working memory dengan status lifecycle
   - `OfferResolver` menangkap jawaban seperti `ya`, `ya tampilkan`, `lihat`, `tampilkan saja`
   - Offer dapat execute tool/skill dengan `paramsPatch` dan `clearParams`
   - LLM hanya menarasikan `allowedOffer`; tidak boleh membuat offer operasional sendiri
   - Data-only skills seperti `data_analyzer` dan `xls_generator` hanya ditawarkan jika source result benar-benar data
   - `memory_recall` dapat membuat `rerun_memory_task` offer dari task plan lama yang aman

### 10.1 **Temporal-Only Follow-up Guard**
   - Query temporal-only tidak masuk vector matching bebas jika ada active intent/tool
   - `tanggal 29`, `tgl 29`, `kemarin`, `besok` menjadi refine ke active tool
   - Menghindari false match ke intent lain seperti overtime, attendance, atau greeting
   - Query dengan topik eksplisit baru tetap masuk pipeline normal

### 11. **Structured JSON Data Analysis**
   - LLM-powered analysis dengan JSON schema
   - **No markdown artifacts** (pure JSON output) ✅
   - **No duplicate system prompts** (single instruction) ✅
   - **12s timeout protection** ✅
   - Skip analysis for minimal data (<10 fields) ✅
   - Fields: summary, insights, patterns, recommendations, caveats

### 12. **Dynamic XLS Styles**
   - 8 pre-defined Excel themes (blue, teal, green, purple, orange, red, dark, minimal)
   - Random style selection untuk variety
   - Professional formatting dengan alternating rows
   - Auto-width columns
   - Configurable via `defaultStyle` parameter

### 13. **WebSocket Support**
   - Real-time communication dengan WebSocket
   - Automatic reconnection dengan exponential backoff
   - HTTP fallback jika WebSocket unavailable
   - Connection status indicator
   - Typing indicator support
   - Attributes.params support

### 14. **Multi-Execution Strategy**
   - **Tool Execution**: Call external APIs dengan parameter injection
   - **Skill Execution**: Internal skill call dengan metadata, paramSchema, dan context
   - **Knowledge-Based**: RAG dengan retrieval dari knowledge base
   - **Direct LLM**: Pure LLM generation untuk creative tasks
   - **Continuation Execution**: Reuse previous results for follow-up queries
   - **Multi-Step Graph**: Tool → Skill execution flow
   - **Skip Analysis for Minimal Data**: Time data (<10 fields) returns formatted message ✅

### 15. **Natural Language Output**
   - LLM-based naturalization dari raw results
   - **Skip naturalization for structured data_analyzer** ✅
   - Context-aware response formatting
   - Multi-language support (Indonesian, English, etc)
   - Personalization berdasarkan user attributes
   - Episodic memory integration

### 16. **Monitoring & Observability**
   - Pipeline metrics collection
   - Detailed logging per execution stage
   - Error tracking dan reporting
   - Performance benchmarking
   - Continuation success rate tracking
   - Cache hit/miss monitoring
   - **JSON parsing vs markdown parsing logs** ✅

### 17. **Automation Runtime & Scheduling** 🆕
   - **Automation Manager Skill**: Membuat reminder, scheduled workflow, dan conditional alert.
   - **Skill Param Schema Slot Filling**: Automation memakai `automation_type`, `goal`, `schedule`, `condition`.
   - **Confirmation Runtime**: Draft automation harus `simpan/ya`, bisa `ubah ...`, `batalkan`, atau expired.
   - **Pretest**: Scheduled workflow dan conditional alert menjalankan query uji sebelum disimpan.
   - **Scheduler Runner**: Cron-based job execution.
   - **Scheduled Workflow Execution**: Scheduler menjalankan full pipeline saat jatuh tempo, bukan hanya notifikasi.
   - **Conditional Alert Evaluation**: Scheduler menjalankan pipeline, mengevaluasi condition, lalu notify hanya jika true.
   - **Reminder Notification**: Reminder one-time mengirim notifikasi sesuai `runAt`.
   - **Real-time WebSocket Broadcast**: Push notification saat scheduled time.
   - **Smart Pending Queue**: Hanya untuk user yang disconnected.
   - **Grounded Naturalization**: Notification memakai result data, condition, observed value, dan raw JSON preview.
   - **Safe Data Compaction**: JSON besar dipangkas dengan guard circular, BigInt, Date, max-depth, max-node.
   - **God Mode Automation Manager**: `/automation manager`, `list`, `hapus <nomor>`, `exit/kluar`.
   - **Hard Delete**: Delete automation benar-benar menghapus row dari DB.

### 18. **Trend Analyzer Skill** 🆕
   - Specialized comparison/trend analysis ✅
   - Compares data across time periods or conditions ✅
   - Calculates trends (increase/decrease, percentage change) ✅
   - Output structure: baseline, comparison, delta, trends, recommendations ✅
   - Auto-routed for comparison queries ('bandingkan', 'vs', 'versus') ✅

### 19. **Slot-Based Resource Limitation** 🆕
   - **MAX_JOBS_PER_USER = 6** (automation jobs) ✅
   - **MAX_SLOTS_PER_USER = 6** (episodic memories) ✅
   - Auto-cleanup on create (repository layer) ✅
   - Deletes oldest completed/failed items first ✅
   - Consistent pattern across resources ✅

---

## 🏗️ Arsitektur Sistem

### Modular Pipeline Architecture (V3.7.1)

```
┌────────────────────────────────────────────────────────┐
│           VIPER V3.7.1 Enhanced Architecture            │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │        PipelineCore (Main Orchestrator)          │  │
│  │  - Stage Coordinator (11 stages)                 │  │
│  │  - Error Handling & Recovery                     │  │
│  │  - Metrics Collection                            │  │
│  │  - Memory Cleanup                                │  │
│  └──────────────────────────────────────────────────┘  │
│           │                 │                    │      │
│  ┌────────▼────────┐ ┌─────▼────────┐  ┌────────▼──┐   │
│  │   Injectors     │ │  Validators  │  │ Resolvers │   │
│  │  - Temporal     │ │  - Plan      │  │  - Continue│   │
│  │  - Entity       │ │  - Signal    │  │  - SlotFill│   │
│  │                 │ │              │  │  - Offer   │   │
│  │                 │ │              │  │  - Confirm │   │
│  └─────────────────┘ └──────────────┘  └───────────┘   │
│           │                                              │
│  ┌────────▼─────────────────────────────────────────┐   │
│  │         Pipeline Stages (11) + Enhancements      │   │
│  │  0.  Intent Loading      → Registry fetch        │   │
│  │  1.  Query Rewrite       → Memory-aware rewrite  │   │
│  │  2.  PreProcessing       → Query decomposition   │   │
│  │  2.5 Perception          → Intent frame detection │   │
│  │  2.6 MemoryTaskReplay    → Recall→Select→Execute │   │
│  │  3.  Embedding+Matching  → Vector similarity     │   │
│  │  4.  Planner             → Tool/Skill graph      │   │
│  │  5.  ConfidenceDecision  → Action determination  │   │
│  │  6.  Plan Validation     → Standalone comparison │   │
│  │  7.  ParamResolution     → 5-source collection   │   │
│  │  8.  Slot Filling Check  → Missing param trigger │   │
│  │  9.  Execution           → Tool/Skill/Knowledge  │   │
│  │  10. OfferGeneration     → Grounded next action  │   │
│  │  11. Naturalization      → Response formatting   │   │
│  │                                                  │   │
│  │  🆕 Enhancements:                                │   │
│  │  - PerceptionStage (intent frame classification) │   │
│  │  - MemoryTaskReplay (auto-execute stored plans)  │   │
│  │  - Standalone Comparison (baseline+target)       │   │
│  │  - Skill Signal Service (runtime trigger detect) │   │
│  │  - Comprehensive Memory (episodic+working)       │   │
│  │  - Cache-First Optimization (3 caches)           │   │
│  │  - Pipeline Re-entry (continuation fallback)     │   │
│  │  - Multi-Entity Detection                        │   │
│  │  - Slot Filling with Retry Logic                 │   │
│  │  - Internal Skill Runtime (7 skills)             │   │
│  │  - Skill Param Schema Slot Filling               │   │
│  │  - Active Offer Lifecycle (5 types)              │   │
│  │  - Automation Runtime + Scheduler                │   │
│  │  - Confirmation Runtime                          │   │
│  │  - God Mode Manager                              │   │
│  │  - Shared Text Intent Cleanup                    │   │
│  │  - Exact-Tool Comparison V1                      │   │
│  │  - Structured JSON Analysis                      │   │
│  │  - Skip Analysis for Minimal Data                │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

---

## 🧠 Road to VIPER Cognition — Human-Like AI Reasoning

> **Status:** Strategic Vision | **Target:** V4.0+

Saat ini VIPER adalah **reactive executor** yang sangat baik — menerima input, memproses pipeline, mengembalikan hasil. Tapi untuk menjadi sistem yang benar-benar cerdas seperti cara manusia berfikir dan bertindak, VIPER perlu berevolusi dari executor menjadi **cognitive agent**.

### Current State vs Human-Like Target

| Dimension | Current VIPER (V3.7.1) | Human-Like Target (V4+) |
|-----------|----------------------|------------------------|
| **Input Processing** | Single query → single response | Multi-turn context with implicit intent |
| **Memory** | Episodic + Working (short-term) | Semantic + Procedural + Experiential |
| **Reasoning** | Planner: single/multi-step task graph | Hierarchical goal decomposition with backtracking |
| **Uncertainty** | Fallback to chat or clarify | Calibrated confidence + probabilistic reasoning |
| **Learning** | None (stateless between sessions) | Continuous learning from outcomes + user feedback |
| **Proactivity** | Reactive only (offer setelah eksekusi) | Anticipatory — mendeteksi kebutuhan sebelum ditanya |
| **Self-Awareness** | None | Meta-cognition: tahu batas kemampuan, bisa eskalasi |
| **Error Recovery** | Retry + circuit breaker | Self-diagnosis + alternative strategy generation |
| **World Model** | Tool/skill definitions (static) | Dynamic entity models dengan relationship graph |

---

### Phase 1: Reflection & Learning (V3.8)

**Goal:** VIPER belajar dari setiap interaksi.

```
Setiap eksekusi selesai
  ↓
Reflection Prompt (internal, invisible to user)
  ├─ "Apakah response saya akurat?"
  ├─ "Apakah user puas? (follow-up positif/negatif)"
  ├─ "Apa yang bisa saya pelajari?"
  ↓
Reflection Output → stored in episodic memory dengan tag: reflection
  ↓
Digunakan oleh:
  ├─ Planner: "Dulu untuk query serupa, approach X lebih berhasil"
  ├─ Confidence: "Saya pernah salah di domain ini, kurangi confidence"
  └─ Naturalization: "User suka format singkat, bukan panjang"
```

**Implementation:**
- `ReflectionStage` — post-execution internal LLM call (async, non-blocking)
- `reflection` field di episodic memory schema
- Planner prompt enrichment dengan reflection history

---

### Phase 2: Mental Models & World Knowledge (V3.9)

**Goal:** VIPER membangun model persisten tentang entitas dan relasinya.

```
Query: "cek kendaraan ardi mahendra"
  ↓
EntityResolver
  ├─ Extract entity: "ardi mahendra" → type: employee
  ├─ Lookup entity graph:
  │   ardi mahendra
  │   ├─ department: operasional
  │   ├─ vehicle: B 1234 XYZ
  │   ├─ shift: pagi
  │   └─ status: active
  ↓
Enrich params dengan entity context
  ↓
Planner punya konteks lebih kaya → plan lebih akurat
```

**Implementation:**
- `EntityGraphService` — graph-based entity storage (employee, vehicle, location, schedule)
- Relationship inference dari query history ("ardi mahendra selalu disebut bareng kendaraan B 1234 XYZ")
- Entity disambiguation: "ardi" vs "ardi mahendra" vs "ardiansyah"

---

### Phase 3: Hierarchical Goal Reasoning (V4.0)

**Goal:** Planner bisa dekomposisi goal kompleks seperti manusia.

```
User: "saya mau laporan performa driver bulan ini"
  ↓ (bukan single tool call)
Goal Decomposition (Tree-of-Thought):
  ├─ Sub-goal 1: Dapatkan semua driver aktif
  ├─ Sub-goal 2: Untuk setiap driver, dapatkan data kendaraan
  ├─ Sub-goal 3: Hitung metrik (total trip, avg per day)
  ├─ Sub-goal 4: Ranking + highlight top/bottom 3
  └─ Sub-goal 5: Format sebagai laporan + offer export
```

**Implementation:**
- `GoalDecomposer` — LLM-based hierarchical planning dengan tree search
- Branch evaluation: setiap branch dievaluasi sebelum eksekusi
- Intermediate result validation: "apakah hasil sub-goal 1 valid sebelum lanjut ke 2?"
- Parallel sub-goal execution untuk independent branches

---

### Phase 4: Anticipatory Intelligence (V4.1)

**Goal:** VIPER tidak menunggu ditanya — dia mendeteksi kebutuhan.

```
Jam 07:00 pagi, user belum kirim pesan
  ↓
AnticipatoryScheduler
  ├─ Check: user biasanya cek kendaraan jam 07:15
  ├─ Check: hari ini Senin (meeting mingguan)
  ├─ Check: kemarin user tanya tentang kendaraan exit
  ↓
Proactive message (WebSocket):
  "Selamat pagi! Mau saya tampilkan ringkasan kendaraan hari ini
   seperti biasa? Ada 3 kendaraan exit kemarin yang mungkin
   perlu perhatian."
```

**Implementation:**
- `AnticipatoryScheduler` — cron-based proactive check
- User behavior pattern learning dari episodic memory
- Confidence threshold: hanya kirim proactive message jika confidence ≥ 0.80
- Opt-out mechanism: user bisa bilang "jangan kirim notifikasi pagi"

---

### Phase 5: Meta-Cognition & Self-Awareness (V4.2)

**Goal:** VIPER tahu kapan dia tidak tahu, dan tahu cara mencari bantuan.

```
Query: "kenapa employee X selalu telat?"
  ↓
Meta-Cognition Check:
  ├─ Apakah saya punya tools untuk analisis keterlambatan? ❌
  ├─ Apakah saya punya data attendance? ✅ (get_attendance)
  ├─ Tapi "analisis penyebab" di luar kapabilitas saya
  ↓
Response:
  "Saya sudah menampilkan data attendance employee X.
   Untuk analisis penyebab keterlambatan, saya perlu
   di-integrasikan dengan sistem HR. Mau saya bantu
   siapkan requirement integrasinya?"
```

**Implementation:**
- `CapabilityBoundary` — explicit definition of what VIPER can/cannot do
- `EscalationPath` — suggestion untuk kapabilitas di luar batas
- Confidence calibration: "Saya 85% yakin tentang ini, tapi untuk X saya kurang yakin"
- Self-diagnosis: "Response saya tadi mungkin kurang akurat karena data attendance belum update"

---

### Implementation Roadmap

| Phase | Version | Key Features | Complexity |
|-------|---------|-------------|------------|
| **Phase 1** | V3.8 | Reflection loop, learning from outcomes | Medium |
| **Phase 2** | V3.9 | Entity graph, mental models, relationship inference | High |
| **Phase 3** | V4.0 | Hierarchical goal planning, tree-of-thought | High |
| **Phase 4** | V4.1 | Anticipatory intelligence, proactive messaging | Medium |
| **Phase 5** | V4.2 | Meta-cognition, capability boundary, escalation | Medium |

### Quick Wins (Bisa Dimulai Sekarang)

1. **Reflection prompt di akhir eksekusi** — LLM call async untuk evaluasi response sendiri
2. **User satisfaction signal** — deteksi "terima kasih" / "bagus" / "bukan itu" sebagai feedback
3. **Planner context enrichment** — tambahkan `reflection` + `recent_feedback` ke planner prompt
4. **Uncertainty expression** — kalibrasi confidence score ke response: "Saya cukup yakin..." vs "Mungkin yang Anda maksud..."
5. **Entity memory** — simpan pasangan (entity_name, entity_type) dari setiap query untuk lookup masa depan

---

### Memory Architecture

```
┌────────────────────────────────────────────────────┐
│              Memory Hierarchy                       │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │         Episodic Memory (Long-term)          │   │
│  │  - Conversation summaries                    │   │
│  │  - User preferences                          │   │
│  │  - Context recall                            │   │
│  │  - TTL: Persistent (DB)                      │   │
│  └─────────────────────────────────────────────┘   │
│                      ↓                              │
│  ┌─────────────────────────────────────────────┐   │
│  │         Working Memory (Short-term)          │   │
│  │  - Active intent                             │   │
│  │  - Active entities (params)                  │   │
│  │  - Active tool/skill                         │   │
│  │  - Active plan (for continuation reuse) ✅   │   │
│  │  - Active offer (next action state) ✅       │   │
│  │  - Continuation hints                        │   │
│  │  - TTL: 5 minutes (Redis/Cache)              │   │
│  └─────────────────────────────────────────────┘   │
│                      ↓                              │
│  ┌─────────────────────────────────────────────┐   │
│  │         Tool Result Cache (Execution)        │   │
│  │  - Tool execution results                    │   │
│  │  - Entity-specific cache keys                │   │
│  │  - Hash-based param caching                  │   │
│  │  - TTL: 30 minutes (Redis/Cache)             │   │
│  └─────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
```

### Continuation Flow Architecture

```
User Query: "kalau bandung?"
  ↓
ContinuationStage.execute()
  ↓
Check continuation intent
  ↓ YES (isContinuation = true)
Load ContinuationContext (1 I/O)
  ├─ toolResultCache.get()  ← Cache miss?
  └─ workingMemory.activeEntities  ← Fallback ✅
  └─ workingMemory.activePlan  ← Reuse plan ✅
  ↓
detectEntityChange()
  ├─ Query decomposition (pattern-based)
  ├─ Merge signals with cachedParams
  └─ Detect changedParams: { city: { old, new } }
  ↓
Execute Tool with newParams
  ↓
Update Working Memory ✅
Update Episodic Memory ✅
Record Metrics ✅
  ↓
Return PipelineResult
```

### Cache-First Optimization Flow

```
BEFORE (N+1 Problem):
  1. fetchCachedData() → toolResultCache.get()  [I/O #1]
  2. detectEntityChange() → toolResultCache.get()  [I/O #2]
  3. newParams merge → toolResultCache.get()  [I/O #3]
  Total: 3 I/O calls ❌

AFTER (Cache-First):
  1. loadContinuationContext() → toolResultCache.get()  [I/O #1]
     └─ workingMemory.activeEntities  ← Fallback if cache miss ✅
  2. detectEntityChange() → use execContext.cachedParams  [NO I/O]
  3. newParams merge → use execContext.cachedParams  [NO I/O]
  Total: 1 I/O call ✅

Improvement: -67% latency ✅
```

### Param Resolution Flow (NEW)

```
User Input → ParamResolutionService.resolve()
  ↓
Collect from Resource Schemas:
  - tool.parameters
  - skill.paramSchema
  ↓
Collect Params:
  1. valid tool/skill defaults
  2. input.attributes.params
  3. signals.temporalDetails
  4. deterministic rules
  5. LLM extraction for unresolved required params
  6. optional semantic extraction with strict validation
  ↓
Merge with Precedence:
  defaults → attributes → temporal → rules → LLM
  ↓
Validate Against Resource Params
  ↓
Return:
  - availableParams
  - missingResourceParams
  - sources (tracking)
  - confidences
```

### Active Offer Flow (NEW)

```
ExecutionResult
  ↓
OfferGenerationStage
  ├─ same-tool param refinement
  ├─ greeting capability offer
  ├─ data analysis offer (only if source is data)
  └─ export offer (only if record data exists)
  ↓
NaturalizationStage receives allowedOffer
  ↓
WorkingMemory stores activeOffer
  ↓
Next user answer:
  "ya" / "ya tampilkan" / "lihat"
  ↓
OfferResolver builds executable plan
  ↓
ExecutionStage runs target tool/skill
```

Rules:

- Active offer never auto-executes without user acceptance.
- Pending slot filling has priority over active offer.
- Only one active offer is stored in V1.
- Replacing or clearing an offer moves previous offer to history.
- `clearParams` prevents stale optional params, e.g. clearing `search` when offering status refinement.
- OfferResolver rejects acceptance phrases that contain a strong new topic, e.g. `ya tampilkan memori kemarin`.

### Automation Runtime Flow (NEW)

```
User automation request
  ↓
Planner selects automation_manager skill
  ↓
Skill paramSchema slot filling
  ├─ automation_type
  ├─ goal
  ├─ schedule
  └─ condition (conditional_alert only)
  ↓
Automation draft
  ↓
Pretest for scheduled_workflow / conditional_alert
  ↓
ConfirmationState
  ├─ simpan / ya → persist automation_jobs
  ├─ ubah ...    → patch draft and ask again
  └─ batalkan    → clear draft
  ↓
SchedulerRunner
  ├─ reminder             → notification_manager
  ├─ scheduled_workflow   → pipeline.run → notification_manager
  └─ conditional_alert    → pipeline.run → condition_evaluator → notification_manager if true
```

Rules:

- Reminder is one-time unless user gives a recurring schedule.
- One-time reminder created message shows `Jadwal`, not duplicate `Eksekusi berikutnya`.
- Scheduled workflow and conditional alert must be pretested before save confirmation.
- Conditional alert does not need planner to choose the future tool at creation time. The scheduler later reruns the saved command through the full pipeline.
- Delete automation uses confirmation and hard delete.

### God Mode Flow (NEW)

```
/automation manager
  ↓
GodModeManagerService
  ↓
AutomationModeService
  ├─ list
  ├─ hapus <nomor/judul/goal>
  ├─ confirmation delete
  └─ exit / kluar
```

God mode keeps ambiguous commands inside a scoped service. Example: `hapus 1` in automation mode deletes an automation candidate, not arbitrary operational data.

### Text Intent Cleanup Flow (NEW)

```
src/utils/text-intent-cleanup.util.ts
```

Reusable helpers:

```typescript
normalizeIntentText()
stripGenericDesireWords()
isGenericDesireText()
buildTemporalFollowUpResidue()
isCancellationText()
isConfirmDeleteText()
isExitModeText()
```

Used by:

- PipelineService cancellation and delete-confirm routing.
- PipelineCore temporal-only follow-up guard.
- ContinuationResolver temporal refine guard.
- Automation param cleanup.
- Automation mode and user profile mode exit detection.

### Internal Skill Flow (NEW)

```
src/skills/*.skill.ts
  ↓
SkillsRegistry auto-registers metadata + handler
  ↓
PlannerStage injects skill candidates
  ↓
ToolPlanner returns tasks with resource: "skill"
  ↓
ResourceParamSchemaService loads skill.paramSchema
  ↓
SlotFillingStage resolves required params if needed
  ↓
ExecutionStage runs SkillExecutionStrategy
```

Skill metadata:

```typescript
{
  slug: 'greeting',
  capabilities: {
    actionTypes: ['greeting', 'capability'],
    requiresData: false
  },
  paramSchema: [
    { name: 'show_skills', type: 'boolean', isRequired: false }
  ]
}
```

### Data Analyzer Flow

```
data_analyzer skill
  ↓
generateJson (NOT chatMessage)
  ├─ System prompt: JSON format instructions
  ├─ User prompt: Data + context
  └─ Options: { temperature: 0.7, num_predict: 5000 }
  ↓
LLM returns JSON (not markdown)
  ↓
Parse JSON (TRY 1)
  ├─ JSON.parse() → Structured result ✅
  └─ Fallback to markdown parsing (TRY 2)
  ↓
Return structured analysis:
  {
    "analysis": {
      "summary": "...",
      "insights": [...],
      "recommendations": [...]
    }
  }
```

### Skip Analysis for Minimal Data (NEW)

```
Continuation receives get_time result
  ↓
Check field count: Object.keys(timeData).length
  ↓
If < 10 fields:
  ├─ Skip data_analyzer ✅
  ├─ Return formatted message: "Waktu di {timezone}: {date_time}"
  └─ No LLM call, no timeout ✅
Else:
  └─ Proceed with analysis
```

---

## 🔄 Alur Pipeline

### Complete Pipeline Flow (Updated)

```
User Input
  ↓
AgentLoader
  ↓
Global mode exit / cancellation?
  - YES: clear relevant active state and return deterministic response
  - NO: continue
  ↓
Pending Slot Filling?
  ├─ YES → SlotFillingStage.resume()
  │        ├─ complete → execute stored plan
  │        └─ incomplete → ask clarification
  └─ NO
  ↓
Pending Confirmation?
  - YES: resolve simpan/ubah/batalkan/ya hapus
  - NO: continue
  ↓
God Mode?
  - /automation manager → AutomationModeService
  - /user profile → UserProfileModeService
  - active mode commands stay scoped until exit/kluar
  ↓
Pending Clarification?
  - YES: merge original query + clarification answer, then re-enter main pipeline
  - NO: continue

WorkingMemory + ActiveOffer?
  ├─ Accepted offer ("ya", "ya tampilkan", "lihat")
  │   → OfferResolver builds plan
  │   → ExecutionStage runs target tool/skill
  └─ No offer response
  ↓
Continuation?
  ├─ refine/detail/export/comparison/workflow
  │   → reuse activePlan
  │   → strict cache where applicable
  │   → re-resolve params
  └─ new query
  ↓
PipelineCore
  1. Query rewrite/decomposition
  2. Temporal-only follow-up guard
  2.5 Perception: intent frame detection (NEW V3.7.1)
  2.6 Memory task replay branch (NEW V3.7.1)
  3. Embedding + intent matching (skip if perception ≥ 0.85)
  4. Planner: tool/skill/knowledge graph
  5. Clarification decision if planner is ambiguous
  6. Plan validation + standalone comparison check
  7. Param resolution: tool.parameters + skill.paramSchema
  8. Missing param check / slot filling
  9. Execution: tool + skill + knowledge
 10. Offer generation
 11. Naturalization with allowedOffer
  ↓
Post-stage updates
  ├─ Working memory: activePlan, activeTool, activeSkill, activeOffer
  ├─ Tool result cache
  └─ Episodic memory
```

### Pre-Stage Checks

#### Pre-Stage 1: Agent Loading
```typescript
const agent = await agentLoader.loadBySlug(input.app_name);
// Multi-tenant: Each agent has isolated intents/tools/knowledge
```

#### Pre-Stage 2: Slot Filling Check
```typescript
const pending = conversationStateService.get(userId, appName);
if (pending) {
  // User is in middle of parameter gathering
  return slotFillingStage.resume(input, pending, agent);
}
```

#### Pre-Stage 3: ClarificationState Check
```typescript
const clarificationState = clarificationStateService.get(userId, appName);
if (clarificationState) {
  const clarifiedInput = {
    ...input,
    text: `${clarificationState.originalText}. Klarifikasi user: ${input.text}`
  };

  return pipeline.run(clarifiedInput);
}
```

ClarificationState dipakai ketika planner ambiguity (`needsClarification=true`). Missing param tetap ditangani oleh slot filling.

#### Pre-Stage 4: Continuation Check
```typescript
const continuationResult = await continuationStage.execute(input, workingMemory);
if (continuationResult.shouldSkipPipeline && continuationResult.intent.isContinuation) {
  // User is following up on previous query (e.g., "kalau bandung?")
  
  // ✅ Check for stored plan
  if (workingMemory.activePlan) {
    return executeStoredPlan(workingMemory.activePlan);  // Skip re-planning
  }
  
  return executeActivePlanContinuation(...);
}
```

#### Pre-Stage 5: Active Offer Check
```typescript
const offerResolution = offerResolver.resolve(input, workingMemory);
if (offerResolution.accepted) {
  return executeAcceptedOffer(offerResolution.plan, offerResolution.params);
}
```

Active offer runs after pending slot filling so short answers like `ya` still fill pending parameters first.

#### Pre-Stage 5: Episodic Memory Retrieval
```typescript
const episodicMemory = await episodicMemoryService.getLastContext(userId, appName);
// Provides long-term context for personalization
```

### Stage Execution Flow (Updated)

#### Stage 0: Get Intents
```typescript
const intents = intentRegistry.getAll({ agentId: agent.id });
```

#### Stage 1: Query Rewrite
```typescript
const enrichedUserQuery = await queryRewriteService.rewriteWithMemory(
  agent,
  episodicMemory?.summary || null,
  input
);
```

#### Stage 2: PreProcessing
```typescript
const decompositionResult = await preProcessingStage.execute(enrichedUserQuery);
// Extract: actionHints, formatHints, temporalHints, entityHints
```

#### Stage 3: Embedding & IntentMatching
```typescript
const embedding = await embeddingStage.execute(enrichedUserQuery);
const matches = await intentMatchingStage.execute(embedding, agent);
// Signal boost: Apply temporal/entity boosts
```

#### Stage 3.1: Temporal-Only Follow-up Guard
```typescript
if (isTemporalOnlyFollowUp(input.text, signals) && workingMemory.activeIntent) {
  return vectorService.getIntentBySlug(intents, workingMemory.activeIntent);
}
```

Query pendek seperti `tanggal 29`, `tgl 29`, atau `saya ingin lihat kemarin` tidak boleh masuk vector matching bebas jika masih ada active intent/tool. Guard ini mencegah false match ke domain lain.

#### Stage 4: Planner
```typescript
const plan = await plannerStage.execute(matches, input, agent, memoryContext);
// Store plan in workingMemory for continuation reuse ✅
```

Planner output uses first-class resources:

```json
{
  "mode": "multi_step",
  "chat": false,
  "tasks": [
    { "id": "1", "resource": "tool", "key": "get_vehicle_assignment", "depends_on": [] },
    { "id": "2", "resource": "skill", "key": "data_analyzer", "depends_on": ["1"] }
  ]
}
```

#### Stage 5: ConfidenceDecision
```typescript
const decision = confidenceDecisionService.evaluate({
  plan,
  userText: enrichedUserQuery,
  signals: decompositionResult.signals
});
// Actions: execute, clarify, chat
```

#### Stage 6: Param Resolution 🆕
```typescript
const resolutionResult = await paramResolutionService.resolve(
  input,
  plan,
  decompositionResult
);
// Collect from tool.parameters + skill.paramSchema
const safeParams = resolutionResult.availableParams;
```

#### Stage 7: Missing Params Check
```typescript
const missingParamsResult = await checkMissingParams(input, agent, plan, safeParams);
if (missingParamsResult.hasMissing) {
  return {
    intent: 'slot_filling',
    naturalResponse: missingParamsResult.question,
    metadata: { originalPlan: plan }  // Store plan for later execution ✅
  };
}
```

#### Stage 8: Execution
```typescript
const executionResult = await executionStage.execute(
  plan,
  input,
  safeParams,
  { cacheResults: true, userId, appName }
);

// ✅ Check for minimal data (e.g., time data with <10 fields)
if (executionResult.results['get_time'] && 
    Object.keys(executionResult.results['get_time']).length < 10) {
  // Skip analysis, return formatted message
  return {
    intent: intentLabel,
    naturalResponse: `Waktu di ${timezone}: ${date_time}`
  };
}
```

#### Stage 8.5: Offer Generation 🆕
```typescript
const offerResult = await offerGenerationStage.execute({
  input,
  plan,
  params: safeParams,
  results: executionResult.results,
  executedTasks: executionResult.metrics.executedTasksDetails
});

// selectedOffer is passed to naturalization as allowedOffer
```

Offer examples:

- Greeting result → `show_capabilities` skill offer
- Vehicle summary result → same-tool status refinement
- Data result → analysis/export offer if target skill requires data
- Empty/error result → no unsafe operational offer

#### Stage 9: Naturalization
```typescript
// ✅ Skip naturalization for structured data_analyzer results
if (executionResult.results['data_analyzer']?.analysis) {
  const naturalResponse = formatStructuredAnalysis(
    executionResult.results['data_analyzer'].analysis
  );  // No LLM call
} else {
  const naturalResponse = await naturalizationStage.execute(...);
}
```

### Post-Stage Updates

#### Update Working Memory
```typescript
await workingMemoryUpdater.update(userId, appName, {
  type: 'plan',
  apiResults: executionResult.results,
  activeIntent: intentLabel,
  activeTool: toolSlug,
  activePlan: plan  // ✅ Store plan for continuation reuse
});
```

#### Update Episodic Memory
```typescript
const messages = ConversationUtil.buildMessages(input, {
  memoryContext: naturalResponse
});
await episodicMemoryService.summarize(agent, intentLabel, userId, appName, messages);
```

#### Record Metrics
```typescript
metricsService.recordSuccess(intentLabel, duration);
```

#### Memory Cleanup
```typescript
// In finally block
decompositionResult = null;
branchResult = null;
finalVectorHints = [];
plannerOutput = null;
safePlan = null;
safeParams = {};
executionResult = null;

if (global.gc) {
  global.gc();  // Force garbage collection
}
```

---

## 🛠️ Teknologi Stack

| Layer | Teknologi | Versi | Fungsi |
|-------|-----------|-------|--------|
| **Runtime** | Node.js | 18+ | JavaScript runtime |
| **Language** | TypeScript | 5.0+ | Type-safe development |
| **Framework** | Fastify | 4.28+ | Web framework |
| **AI/ML** | Ollama | Latest | Local LLM inference |
| **AI/ML** | Qwen (Alibaba) | Latest | Structured JSON generation ✅ |
| **Vector DB** | ChromaDB | 1.9.0 | Vector similarity search |
| **Database** | PostgreSQL | 12+ | Primary data store |
| **Cache** | Redis | 6+ | Session & embedding cache |
| **Storage** | MinIO | 8.0+ | S3-compatible object storage |
| **WebSocket** | ws | Latest | Real-time communication |
| **Validation** | Zod | 3.23+ | Schema validation |
| **Logging** | Pino | Latest | Fast JSON logging |

---

## 📁 Instalasi & Setup

### 1. Install Dependencies

chroma run --path ./data_db

```bash
npm install
```

### 2. Configure Environment

```bash
# Copy .env.example
cp .env.example .env

# Edit .env dengan konfigurasi Anda
```

### 3. Run Database Migrations

```bash
npm run migrate
```

### 4. Start Application

```bash
# Development
npm run dev

# Production
npm run start
```

---

## 🌐 API Documentation

### Base URL
```
http://localhost:3000/api/v1
```

### Endpoints

#### POST /chat
Send chat message with continuation support

**Request**:
```json
{
  "user_id": "user_1",
  "app_name": "hris",
  "text": "jam berapa sekarang di jakarta",
  "chat_history": [],
  "language": "id",
  "attributes": {
    "params": {
      "company_id": "79483b71-25c2-11f0-8c42-d28e58827589"
    }
  }
}
```

**Response**:
```json
{
  "success": true,
  "response": "Sekarang jam 14:30 WIB di Jakarta",
  "intent": "get_time",
  "confidence": 0.95,
  "metadata": {
    "totalTime": 1234
  }
}
```

#### WebSocket /chat-ws
Real-time chat communication

**Connect**:
```javascript
const ws = new WebSocket('ws://localhost:3000/api/v1/chat-ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'chat',
    payload: {
      user_id: 'user_1',
      app_name: 'hris',
      text: 'jam berapa sekarang',
      attributes: {
        params: { company_id: '...' }
      }
    }
  }));
};
```

---

## 💬 Chat UI

### Modern Chat Interface

Access the chat UI at:
```
http://localhost:3000/test/html/modern-index.html
```

### Features

- **Responsive Design**: Mobile-friendly interface
- **Real-time Updates**: WebSocket support dengan typing indicator
- **Connection Status**: Visual indicator untuk connection status
- **Message History**: LocalStorage persistence
- **Export Options**: Excel export dengan dynamic styles
- **Attributes Support**: Params passing untuk multi-tenant
- **Structured Analysis Display**: JSON analysis rendering ✅

### Configuration

```javascript
// config.js
export const CONFIG = {
  API_BASE_URL: 'http://localhost:3000',
  ENABLE_WEBSOCKET: true,
  WS_ENDPOINT: '/api/v1/chat-ws',
  MAX_CHAT_HISTORY: 6
};
```

---

## 📝 Contoh Penggunaan

### Example 1: Simple Query
```
User: "jam berapa sekarang di jakarta"
AI: "Sekarang jam 14:30 WIB di Jakarta"
```

### Example 2: Entity Substitution (Multi-Entity)
```
User: "jam berapa sekarang di jakarta"
AI: "Sekarang jam 14:30 WIB di Jakarta"

User: "kalau bandung?"
AI: "Sekarang jam 14:30 WITA di Bandung"
  → LLM detects: city change jakarta → bandung ✅
  → Cache hit: Fetch cached time data ✅
  → Re-execute: get_time with city="bandung" ✅
```

### Example 3: Temporal Change
```
User: "cuaca di bandung hari ini"
AI: "Cuaca Bandung cerah, 28°C"

User: "besok?"
AI: "Cuaca Bandung besok diperkirakan hujan, 25°C"
  → LLM detects: date change hari ini → besok ✅
  → Temporal normalization: besok → 2026-05-28 ✅
  → Re-execute: get_weather with date="2026-05-28" ✅
```

### Example 4: Export dengan Dynamic Style
```
User: "data penjualan jakarta"
AI: "Data penjualan Jakarta: Rp 1.5M"

User: "export ke excel"
AI: "✅ File Excel berhasil dibuat"
  → Skill: xls_generator ✅
  → Style: random (blue theme) ✅
  → Download URL: /download/xls/export_123456.xlsx ✅
```

### Example 5: Multi-Entity Change
```
User: "jam berapa di jakarta hari ini"
AI: "Sekarang jam 14:30 WIB di Jakarta, 27 Mei 2026"

User: "kalau bandung besok?"
AI: "Besok di Bandung, jam 14:30 WITA, 28 Mei 2026"
  → LLM detects multiple changes ✅
  → city: jakarta → bandung ✅
  → date: hari ini → besok ✅
  → Execute with both new params ✅
```

### Example 6: Slot Filling with Retry
```
User: "kendaraan exit"
AI: "Untuk status kendaraan, silakan masukkan company_id"
  → State: { missingParams: ["company_id"], retryCount: 0 }

User: "tidak jelas" ❌ (low confidence)
AI: "Maaf, saya tidak mengerti. Untuk company_id, silakan masukkan ID perusahaan (Percobaan 1/2)"
  → retryCount: 1/2 ✅

User: "79483b71-..." ✅ (high confidence)
AI: "✅ Kendaraan exit berhasil ditampilkan"
  → retryCount: 0 (reset) ✅
```

### Example 7: Continuation with Memory
```
User: "Saya mau cek kendaraan dengan status exit"
AI: "Baik, tidak ada kendaraan dengan status exit"
  → Episodic memory saved ✅

--- 1 hour later ---

User: "kendaraannya mana?"
AI: "Saya sedang cek kendaraan dengan status exit yang Anda tanyakan sebelumnya.
     Berdasarkan data terakhir, tidak ada kendaraan dengan status exit." ✅
```

### Example 8: Continuation Fallback to Pipeline
```
User: "export ke excel" (continuation without cached data)
AI: ContinuationStage returns 'continuation_fallback'
  → PipelineService re-routes to executeMainPipeline() ✅
  → Main pipeline executes ✅
  → Episodic memory updated ✅
  → Working memory updated ✅
```

### Example 9: Structured JSON Analysis 🆕
```
User: "cek jam berapa sekarang di bandung dan lakukan analisa"
AI: "Data waktu menunjukkan timezone Asia/Jakarta dengan offset +7 jam dari UTC.
     
     Insight utama:
     - Waktu saat ini adalah 23:51:50 WIB
     - Hari: Friday
     - DST tidak aktif
     
     Rekomendasi:
     - Gunakan format 24 jam untuk konsistensi
     - Perhatikan timezone untuk meeting lintas region"
  → generateJson returns structured JSON ✅
  → No markdown artifacts ✅
  → No duplicate summary ✅
```

### Example 10: Skip Analysis for Minimal Data 🆕
```

### Example 11: Greeting Capability Offer 🆕
```
User: "halo"
AI: "Selamat sore! Saya adalah HRIS System...
     Mau saya tampilkan hal-hal yang bisa saya bantu?"
  → OfferGenerationStage creates show_capabilities offer ✅
  → activeOffer stored in working memory ✅

User: "ya tampilkan"
AI: "Berikut kemampuan yang tersedia..."
  → OfferResolver accepts phrase ✅
  → Executes greeting skill with show_skills=true ✅
```

### Example 12: Active Offer Status Refinement 🆕
```
User: "cek kendaraan yang exit hari ini"
AI: "Tidak ada kendaraan exit. Ada 28 kendaraan leave.
     Mau saya tampilkan data dengan status leave?"
  → Offer target: get_vehicle_assignment
  → paramsPatch: { status: "leave" }
  → clearParams: ["search"] ✅

User: "ya"
AI: "Berikut data kendaraan leave..."
  → Executes tool with status=leave ✅
  → Does not inherit stale search param ✅
```

### Example 13: Search Follow-up is Grounded 🆕
```
User: "cari apakah ada ardi mahendra"
  → ContinuationResolver detects refine active tool ✅
  → ParamResolution extracts search="ardi mahendra" ✅
  → Executes active tool, not general chat ✅
  → If no record exists, AI answers not found from tool result ✅
```
### Example 14: Temporal Follow-up Without Vector Noise
```
User: "tampilkan data kendaraan yang berstatus exit hari ini"
AI: "Berikut data kendaraan exit hari ini..."

User: "coba lihat kemarin"
AI: "Berikut data kendaraan exit kemarin..."

User: "tanggal 29"
AI: "Berikut data kendaraan exit pada 29 Mei 2026..."
  -> query_decomposition detects temporal date
  -> PipelineCore routes to active intent/tool
  -> does not vector-match to overtime/attendance/greeting
```

### Example 15: Planner ClarificationState
```
User: "cek data hari ini"
AI: "Data apa yang Anda maksud?"
  -> intent: clarification
  -> ClarificationState stores originalText="cek data hari ini"

User: "kendaraan exit"
AI: "Berikut data kendaraan exit hari ini..."
  -> pipeline reruns: "cek data hari ini. Klarifikasi user: kendaraan exit"
```

### Example 16: Memory Recall + Rerun Offer
```
User: "Apa yang saya bahas kemarin?"
AI: "Kemarin Anda membahas kendaraan exit..."
AI: "Mau saya tampilkan kembali data dari pembahasan itu?"

User: "ya"
AI: "Berikut data kendaraan exit dari task yang pernah dijalankan..."
  -> memory_recall returns taskPlan/flowTrace
  -> activeOffer type=rerun_memory_task
  -> OfferResolver executes stored tool/skill target
```

### Example 17: Reminder Confirmation
```
User: "saya ingin buat pengingat"
AI: "Apa tujuan automation ini?"

User: "ingatkan meeting dengan client"
AI: "Kapan automation ini dijalankan?"

User: "hari ini jam 00:48"
AI:
Saya tangkap reminder: meeting dengan client dengan jadwal 3 Jun 2026, 00.48.

Konfirmasi:
- Ketik "simpan" atau "ya" untuk menyimpan.
- Ketik "ubah ..." kalau ada yang perlu diganti.
- Ketik "batalkan" untuk membatalkan.

User: "simpan"
AI:
Siap, pengingat sudah aktif.
Detail: meeting dengan client.
Jadwal: 3 Jun 2026, 00.48
```

One-time reminder tidak menampilkan `Eksekusi berikutnya` karena jadwal dan next run adalah waktu yang sama.

### Example 18: Conditional Alert With Pretest
```
User: "buat conditional alert kalau kendaraan exit lebih dari 1 unit setiap hari jam 5 sore"
AI:
Saya tangkap conditional alert: kendaraan exit lebih dari 1 unit dengan jadwal setiap hari pukul 17.00 WIB.

Pretest:
- Query: "cek kendaraan exit"
- Status: berhasil
- Hasil saat ini: exit: 0.

Konfirmasi:
- Ketik "simpan" atau "ya" untuk menyimpan.
- Ketik "ubah ..." kalau ada yang perlu diganti.
- Ketik "batalkan" untuk membatalkan.
```

Saat scheduler berjalan:

```text
pipeline.run("cek kendaraan exit")
-> condition_evaluator(exit > 1)
-> notification_manager only if condition true
```

### Example 19: God Mode Automation Manager
```
User: "/automation manager"
AI: Daftar automation manager...

User: "hapus 1"
AI: Konfirmasi penghapusan automation...

User: "ya hapus"
AI: Automation sudah saya hapus dari daftar aktif.

User: "exit"
AI: Mode automation manager sudah ditutup.
```

### Example 20: Offer Collision Guard
```
User: "halo"
AI: "Mau saya tampilkan hal-hal yang bisa saya bantu?"

User: "ya tampilkan memori kemarin"
```

`OfferResolver` tidak mengeksekusi `show_capabilities` karena ada topik baru `memori kemarin`. Query dilanjutkan ke main pipeline dan dapat dipilih sebagai `memory_recall`.

---

## 📊 Performance Benchmarks

| Metric | V3.6 | V3.7 | V3.7.1 | Improvement |
|--------|------|------|--------|-------------|
| **Execution Resource Model** | Tool + handler | Tool + skill | Tool + skill | Legacy handler removed ✅ |
| **Skill Slot Filling** | N/A | Supported | Supported | Skill paramSchema uses shared param flow ✅ |
| **Active Offer** | N/A | Supported | Supported | Grounded proactive next action ✅ |
| **Comparison** | Partial | Exact-tool V1 | Exact-tool V1 | Dynamic temporal param mapping ✅ |
| **ClarificationState** | Basic question only | Stateful follow-up | Stateful follow-up | Ambiguous planner output continues ✅ |
| **Temporal Follow-up Guard** | Vector matching risk | Active intent fallback | Active intent fallback | `tanggal 29` avoids false matches ✅ |
| **Memory Recall** | General memory context | Dedicated skill | Dedicated skill | Recall history and rerun safe task plan ✅ |
| **Episodic Memory** | Summary + intent | Normalized topic/flow/task | Normalized topic/flow/task | Easier scaling ✅ |
| **Automation Runtime** | Draft planning | Scheduler execution | Scheduler execution | Reminder, workflow, conditional alert ✅ |
| **Automation Pretest** | N/A | Supported | Supported | Future jobs tested before confirm ✅ |
| **God Mode Manager** | N/A | Scoped commands | Scoped commands | `/automation manager`, `/user profile` ✅ |
| **Confirmation Runtime** | Partial | Reusable state | Reusable state | create/delete/edit/cancel/TTL ✅ |
| **Text Intent Cleanup** | Duplicated regex | Shared util | Shared util | ID/EN cancellation, exit, temporal ✅ |
| **Pipeline Collision Guards** | Partial | Explicit priority | Explicit priority | pending, confirmation, god mode, offer ✅ |
| **Continuation Cache** | Strict params partial | Strict params enforced | Strict params enforced | Safer cache reuse ✅ |
| **General Chat Guard** | Partial | Operational-data guarded | Operational-data guarded | Reduced hallucinations ✅ |
| **N+1 Query Prevention** | 1 I/O target | 1 I/O target | 1 I/O target | Maintained ✅ |
| **JSON Parsing Success** | 99% target | 99% target | 99% target | Maintained ✅ |
| **Default Param Resolution** | — | Failed for required select | Fixed | ✅ No more 500 errors |
| **Slot Filling Detection** | — | Empty defaults missed | Fixed | ✅ Proper clarification |
| **Tool Param Cache** | — | DB call per pipeline | Cached 1min TTL | ✅ ~10-50ms saved |
| **Intent Registry Cache** | — | Re-filter per pipeline | Cached 30s TTL | ✅ ~5-20ms saved |
| **State Write Batching** | — | 2 lock acquisitions | 1 lock | ✅ ~50ms saved |
| **Conversation Memory** | — | Unbounded growth | Periodic eviction | ✅ Memory stable |
| **Execution Metrics** | — | failedTasks: 0 | Accurate count | ✅ Observability fixed |

---

## 📈 Monitoring & Observability

### Key Metrics

```typescript
// Pipeline metrics
metricsService.recordSuccess(intent, duration);
metricsService.recordFailure(error, duration);
metricsService.recordSlotFilling();
metricsService.recordContinuationSuccess();  // NEW
metricsService.recordContinuationFailure();  // NEW

// Cache metrics
appLogger.debug('[ContinuationStage] Cache hit', { toolSlug });
appLogger.debug('[ContinuationStage] Cache miss, using workingMemory fallback');

// Memory metrics
appLogger.debug('[ContinuationStage] Episodic memory updated', { intent });
appLogger.debug('[Pipeline] Working memory updated', { activeIntent, activeTool, activePlan });

// Analysis metrics (NEW) ✅
appLogger.debug('[AnalyzerChat] Parsed JSON response successfully');
appLogger.debug('[AnalyzerChat] JSON parse failed, trying markdown parsing');
appLogger.info('[ContinuationStage] Skipping analysis for minimal time data', { fieldCount });
```
