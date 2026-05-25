# VIPER V3.2 - Modular AI Intent Pipeline Engine

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-3.2.0-orange)](package.json)

## 📋 Daftar Isi

- [Deskripsi Singkat](#deskripsi-singkat)
- [Fitur Utama](#fitur-utama)
- [Arsitektur Sistem](#arsitektur-sistem)
- [Modular Pipeline Architecture](#modular-pipeline-architecture)
- [Alur Pipeline](#alur-pipeline)
- [Teknologi Stack](#teknologi-stack)
- [Struktur Folder Project](#struktur-folder-project)
- [Prerequisites](#prerequisites)
- [Instalasi & Setup](#instalasi--setup)
- [Konfigurasi Environment](#konfigurasi-environment)
- [Menjalankan Aplikasi](#menjalankan-aplikasi)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Contoh Penggunaan](#contoh-penggunaan)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## 🎯 Deskripsi Singkat

**VIPER V3.2** adalah AI Intent Pipeline Engine yang canggih dan scalable dengan **modular architecture** untuk memproses user input menjadi actionable intents dengan kemampuan:

- **Multi-Tenant Architecture**: Mendukung multiple agents/aplikasi dengan isolasi penuh
- **Intelligent Intent Recognition**: Menggunakan embedding vector dan similarity matching
- **Dynamic Parameter Extraction**: Ekstraksi parameter otomatis dengan confidence scoring
- **Knowledge-Augmented Response**: RAG (Retrieval Augmented Generation) untuk konteks
- **Conversation State Management**: Tracking conversation state multi-turn dengan episodic memory
- **Flexible Execution**: Mendukung tool execution, handler execution, knowledge retrieval, dan LLM direct call
- **Modular Pipeline Stages**: 9 modular stages untuk maintainability dan extensibility
- **Config-Based Thresholds**: Dynamic threshold adjustment via environment variables

VIPER (Vector Intent Pipeline Execution Resolution) dirancang untuk memberikan pengalaman conversational AI yang natural, contextual, dan efisien di scale production dengan **78% code reduction** melalui modular architecture.

---

## ✨ Fitur Utama

### 1. **Intent Recognition Engine**
   - Vector embedding menggunakan Ollama/Nomic embed model
   - Semantic similarity search terhadap intent database
   - Confidence-based decision tree dengan threshold adjustment
   - Clarification request saat ambiguity tinggi
   - Domain capability matching untuk agent-specific intents

### 2. **Smart Parameter Extraction**
   - LLM-based parameter extraction dari user input
   - Confidence scoring untuk setiap parameter
   - Automatic clarification questions untuk parameter yang missing
   - Parameter caching untuk optimization
   - Temporal entity injection (dates, locations, etc.)

### 3. **Multi-Execution Strategy**
   - **Tool Execution**: Call external APIs dengan parameter injection
   - **Handler Execution**: Internal function call dengan full context
   - **Knowledge-Based**: RAG dengan retrieval dari knowledge base
   - **Direct LLM**: Pure LLM generation untuk creative tasks
   - **Continuation Execution**: Reuse previous results for follow-up queries

### 4. **Conversation Intelligence**
   - Episodic memory untuk long-term context
   - Working memory untuk short-term state
   - Continuation intent resolution untuk multi-turn conversations
   - Slot filling untuk progressive parameter gathering
   - Context maintenance untuk location/tool follow-ups (e.g., "kalau bandung?")

### 5. **Natural Language Output**
   - LLM-based naturalization dari raw results
   - Context-aware response formatting
   - Multi-language support (Indonesian, English, etc)
   - Personalization berdasarkan user attributes
   - Separated system/user roles untuk better LLM understanding

### 6. **Knowledge Management**
   - Multi-source knowledge ingestion (PDF, TXT, DOCX, XLS, Web)
   - Automatic chunking dan vectorization
   - Semantic search dengan BM25 hybrid search
   - Episodic memory integration

### 7. **Monitoring & Observability**
   - Pipeline metrics collection
   - Detailed logging per execution stage
   - Error tracking dan reporting
   - Performance benchmarking
   - Resource breakdown tracking (tools/handlers/knowledge)

### 8. **Modular Architecture**
   - **9 Pipeline Stages**: PreProcessing, Embedding, IntentMatching, Planner, ConfidenceDecision, ParamExtraction, Execution, Naturalization, Chat
   - **4 Core Modules**: Injectors, Validators, Resolvers, Stages
   - **Config-Based Thresholds**: INTENT_SIMILARITY_THRESHOLD, INTENT_TOP_K
   - **78% Code Reduction**: From 2,377 lines to ~520 lines

---

## 🏗️ Arsitektur Sistem

### Modular Pipeline Architecture (V3.2)

```
┌──────────────────────────────────────────────────────────────┐
│              VIPER V3.2 Modular Architecture                 │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              PipelineCore (Main Orchestrator)          │  │
│  │  - Stage Coordinator                                   │  │
│  │  - Error Handling & Recovery                           │  │
│  │  - Metrics Collection                                  │  │
│  └────────────────────────────────────────────────────────┘  │
│           │                     │                    │        │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────┐  │
│  │    Injectors    │  │   Validators    │  │  Resolvers  │  │
│  │  - Temporal     │  │  - Plan         │  │  - Continue │  │
│  │  - Entity       │  │  - Signal       │  │  - SlotFill │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
│           │                                                  │
│  ┌────────▼─────────────────────────────────────────┐       │
│  │              Pipeline Stages (9)                  │       │
│  │  1. PreProcessing    → Query decomposition        │       │
│  │  2. Embedding        → Vector generation          │       │
│  │  3. IntentMatching   → Similarity search          │       │
│  │  4. Planner          → Task graph building        │       │
│  │  5. ConfidenceDecision → Action determination    │       │
│  │  6. ParamExtraction  → Parameter extraction       │       │
│  │  7. Execution        → Tool/Handler execution     │       │
│  │  8. Naturalization   → Response formatting        │       │
│  │  9. Chat             → Fallback handling          │       │
│  └───────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────┘
```

### Core Modules Structure

```
src/services/cores/
├── pipeline-core.ts          # Main orchestrator (~520 lines)
├── injectors/                # Context injectors
│   ├── temporal.injector.ts  # Date/time/entity injection
│   └── entity.injector.ts    # Location/name injection
├── validators/               # Validation logic
│   ├── plan.validator.ts     # Plan validation
│   └── signal.validator.ts   # Signal validation
├── resolvers/                # Multi-turn resolvers
│   ├── continuation.resolver.ts  # Continuation detection
│   └── slot-filling.resolver.ts  # Slot filling logic
└── stages/                   # Pipeline stages
    ├── pre-processing.stage.ts
    ├── embedding.stage.ts
    ├── intent-matching.stage.ts
    ├── planner.stage.ts
    ├── execution.stage.ts
    ├── naturalization.stage.ts
    └── chat.stage.ts
```

### Pipeline Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                             │
│  (Web, Mobile, Voice Interfaces, Third-party Integrations)  │
└────────────┬─────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────┐
│                    API GATEWAY / ROUTER                       │
│  Intent Route │ Knowledge Route │ Admin Knowledge Route       │
└────────────┬─────────────────────────────────────────────────┘
             │
┌────────────▼──────────────────────────────────────────────────┐
│               PIPELINE ORCHESTRATION LAYER                     │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │  Pipeline Service (Legacy Wrapper - Backward Compatible) │  │
│ │  - Pre-pipeline checks (continuation, pending state)     │  │
│ │  - Post-pipeline updates (working memory, metrics)       │  │
│ └──────────────────────────────────────────────────────────┘  │
│                          │                                     │
│ ┌────────────────────────▼──────────────────────────────────┐  │
│ │  PipelineCore (Main Orchestrator - 520 lines)             │  │
│ │  - Delegates to 9 modular stages                          │  │
│ │  - Config-based thresholds                                │  │
│ │  - Resource breakdown tracking                            │  │
│ └───────────────────────────────────────────────────────────┘  │
└────┬─────────────────────────────────────────────────────────┘
     │
┌────▼────────────────────────────────────────────────────────┐
│            EXECUTION PIPELINE STAGES (9)                     │
├────────────────────────────────────────────────────────────┤
│ Stage 1: PreProcessing                                      │
│  ├─ Query decomposition                                     │
│  ├─ Signal extraction (actions, formats, temporal)         │
│  └─ Multi-intent detection                                 │
├────────────────────────────────────────────────────────────┤
│ Stage 2: Embedding                                          │
│  ├─ Text normalization                                      │
│  ├─ Vector generation (Ollama/Nomic)                       │
│  └─ Embedding caching                                      │
├────────────────────────────────────────────────────────────┤
│ Stage 3: IntentMatching                                     │
│  ├─ Vector similarity search                               │
│  ├─ Signal boost application                               │
│  └─ Score threshold filtering (config.intent.similarity)   │
├────────────────────────────────────────────────────────────┤
│ Stage 4: Planner                                            │
│  ├─ Task graph building                                    │
│  ├─ Resource type recommendation                           │
│  └─ Fast path detection (single tool/handler)              │
├────────────────────────────────────────────────────────────┤
│ Stage 5: ConfidenceDecision                                 │
│  ├─ Confidence scoring                                     │
│  ├─ Resource breakdown (tools/handlers/knowledge)          │
│  └─ Action determination (execute/clarify/chat)            │
├────────────────────────────────────────────────────────────┤
│ Stage 6: ParamExtraction                                    │
│  ├─ LLM parameter extraction                               │
│  ├─ Temporal/entity injection                              │
│  └─ Missing parameter detection                            │
├────────────────────────────────────────────────────────────┤
│ Stage 7: Execution                                          │
│  ├─ Tool execution (external APIs)                         │
│  ├─ Handler execution (internal functions)                 │
│  ├─ Knowledge retrieval (RAG)                              │
│  └─ Error handling & retry                                 │
├────────────────────────────────────────────────────────────┤
│ Stage 8: Naturalization                                     │
│  ├─ LLM-based output generation                            │
│  ├─ System/user role separation                            │
│  └─ Context personalization                                │
├────────────────────────────────────────────────────────────┤
│ Stage 9: Chat                                               │
│  ├─ Fallback handling                                      │
│  └─ General chat response                                  │
└────────────────────────────────────────────────────────────┘
     │
┌────▼────────────────────────────────────────────────────────┐
│            SERVICE & INFRASTRUCTURE LAYER                    │
├────────────────────────────────────────────────────────────┤
│                                                              │
│ AI Models              External Services                     │
│ ├─ Ollama LLM         ├─ Tool APIs                          │
│ ├─ Ollama Embed       ├─ Knowledge Sources                  │
│ └─ OpenAI (fallback)  └─ External Integrations             │
│                                                              │
│ Vector Database        Memory Systems                        │
│ ├─ ChromaDB           ├─ Episodic Memory (DB)              │
│ └─ Vector Indexing    ├─ Working Memory (Cache)            │
│                       └─ Conversation State (Redis)         │
│                                                              │
│ Message Queue          Knowledge Management                  │
│ ├─ RabbitMQ           ├─ Knowledge Ingestion               │
│ └─ Event Publishing   ├─ Document Parsing                  │
│                       └─ Semantic Search                    │
│                                                              │
└────────────────────────────────────────────────────────────┘
     │
┌────▼────────────────────────────────────────────────────────┐
│              DATA PERSISTENCE LAYER                          │
├────────────────────────────────────────────────────────────┤
│                                                              │
│ PostgreSQL (Primary)   Redis (Cache)                         │
│ ├─ Agents              ├─ Embedding Cache                   │
│ ├─ Intents             ├─ Param Cache                       │
│ ├─ Knowledge           ├─ Session State                     │
│ ├─ Tools               └─ Rate Limiting                     │
│ ├─ Execution History   │                                    │
│ └─ Episodic Memory     │ MinIO (Object Storage)             │
│                        ├─ Knowledge Files                   │
│                        ├─ Generated Files                   │
│                        └─ Upload Storage                    │
│                                                              │
└────────────────────────────────────────────────────────────┘
```

---

## 🔄 Alur Pipeline

### Alur Eksekusi Utama

```
                 ┌──────────────┐
User Input ───►  │   INTENT     │  (Router)
                 └──────┬───────┘
                        │
        ┌───────────────┼──────────────────┐
        │               │                  │
    Tool Mapping   Knowledge Mapping   Handler Key
        │               │                  │
    Tool API        RAG/FAQ DB        Internal Function
```

### Stage 0: Pre-processing & State Check

```
┌─────────────────────────────────────────────┐
│ INPUT: (user_id, app_name, text)            │
├─────────────────────────────────────────────┤
│ 1. Validasi agent exists & active           │
│ 2. Check pending conversation state         │
│    ├─ Jika ada → resume intent              │
│    ├─ Jika cancel → clear state             │
│    └─ Jika switch intent → clear & process  │
│ 3. Prepare execution context                │
└─────────────────────────────────────────────┘
           │
           ▼
    ┌─────────────┐
    │ Stage 1 ▶   │
    └─────────────┘
```

### Stage 1: Intent Recognition

```
┌─────────────────────────────────────────────┐
│ 1. Generate embedding dari user input       │
│    - Menggunakan Ollama embedding model     │
│    - Cache untuk optimization               │
│                                             │
│ 2. Vector similarity search                 │
│    - Query terhadap intent vector DB        │
│    - Sort by relevance score (descending)   │
│                                             │
│ 3. Confidence-based decision tree:          │
│    - Score >= confidentThreshold            │
│      → Proceed to extraction                │
│    - Score >= clarifyThreshold              │
│      → Ask clarification                    │
│    - Score < clarifyThreshold               │
│      → General chat / fallback              │
└─────────────────────────────────────────────┘
```

### Stage 2: Parameter Extraction & Validation

```
┌─────────────────────────────────────────────┐
│ 1. Extract parameters menggunakan LLM       │
│    - Provide schema (Zod)                   │
│    - Provide examples                       │
│    - LLM generate extracted params          │
│                                             │
│ 2. Validate extracted parameters            │
│    - Check against schema                   │
│    - Type coercion                          │
│                                             │
│ 3. Check missing required parameters        │
│    - Jika lengkap → proceed to execution    │
│    - Jika missing:                          │
│      ├─ Save state                          │
│      ├─ Generate clarification questions    │
│      └─ Return request for more info        │
│                                             │
│ 4. On clarification received:               │
│    - Update params dengan jawaban user      │
│    - Re-validate                            │
│    - Proceed to execution                   │
└─────────────────────────────────────────────┘
```

### Stage 3: Intent Execution

```
┌──────────────────────────────────────────────┐
│ switch(executionType) {                      │
├──────────────────────────────────────────────┤
│                                              │
│ case 'tool':                                 │
│  ├─ Get primary tool (by priority)          │
│  ├─ Inject parameters ke URL                │
│  ├─ Execute via toolExecutorService         │
│  └─ Return API result                       │
│                                              │
│ case 'handler':                              │
│  ├─ Get registered handler function         │
│  ├─ Execute with params + context           │
│  ├─ Capture result/error                    │
│  └─ Return execution result                 │
│                                              │
│ case 'knowledge':                            │
│  ├─ Retrieve relevant knowledge documents   │
│  ├─ Augment prompt dengan knowledge         │
│  ├─ Generate response via LLM               │
│  └─ Return natural language response        │
│                                              │
│ case 'llm':                                  │
│  ├─ Direct LLM call dengan params           │
│  ├─ Handle streaming if needed              │
│  └─ Return natural language response        │
│                                              │
│ }                                            │
└──────────────────────────────────────────────┘
```

### Stage 4: Naturalization & Response

```
┌─────────────────────────────────────────────┐
│ 1. Ambil raw result dari execution          │
│    - API response, handler result, etc      │
│                                             │
│ 2. Convert ke natural language              │
│    - Format dengan LLM                      │
│    - Template-based formatting              │
│    - Context injection                      │
│                                             │
│ 3. Personalization                          │
│    - Based on user language/preferences     │
│    - Add user context (name, attributes)    │
│    - Format adjustment                      │
│                                             │
│ 4. Final response packaging                 │
│    - Metadata attachment                    │
│    - State persistence                      │
│    - Return to user                         │
└─────────────────────────────────────────────┘
```

### Multi-Tenant Isolation

```
Each agent has complete isolation:

┌─────────────────────────────────────────┐
│ Intent Database (filter by agentId)     │
├─────────────────────────────────────────┤
│ Knowledge Base (filter by agentId)      │
├─────────────────────────────────────────┤
│ Tools Mapping (filter by agentId)       │
├─────────────────────────────────────────┤
│ Conversation State (key: user_id:app)   │
└─────────────────────────────────────────┘

Conversation State Key Format:
  {user_id}:{app_name}

Example:
  user_123:hris
  user_123:crm
  user_456:helpdesk
```

---

## 🛠️ Teknologi Stack

| Layer | Teknologi | Versi | Fungsi |
|-------|-----------|-------|--------|
| **Runtime** | Node.js | 18+ | JavaScript runtime |
| **Language** | TypeScript | 5.0+ | Type-safe development |
| **Framework** | Fastify | 4.28+ | Web framework (high performance) |
| **AI/ML** | Ollama | Latest | Local LLM inference |
| **Vector DB** | ChromaDB | 1.9.0 | Vector similarity search |
| **Database** | PostgreSQL | 12+ | Primary data store |
| **Cache** | Redis | 6+ | Session & embedding cache |
| **Storage** | MinIO | 8.0+ | S3-compatible object storage |
| **Message Queue** | RabbitMQ | 3.x | Event publishing & async tasks |
| **ORM** | Sequelize | 6.37+ | Database ORM |
| **Validation** | Zod | 3.23+ | Schema validation |
| **API Docs** | Swagger/OpenAPI | 3.0 | Interactive API documentation |
| **Security** | Helmet | 11.0+ | HTTP security headers |
| **Logging** | Pino | Latest | Fast JSON logging |

---

## 📁 Struktur Folder Project

```
ai-intent-api-v2/
├── src/
│   ├── app.ts                          # Fastify application factory
│   ├── server.ts                       # Application bootstrap & startup
│   ├── worker.ts                       # Background worker processes
│   │
│   ├── controllers/                    # HTTP request handlers
│   │   ├── intent.controller.ts        # Intent chat endpoint
│   │   ├── knowledge.controller.ts     # Knowledge API
│   │   └── knowledgeSource.controller.ts
│   │
│   ├── routes/                         # API route definitions
│   │   ├── index.ts                    # Route registration
│   │   ├── intent.route.ts             # POST /api/v1/intent/chat
│   │   ├── adminKnowledge.routes.ts    # Admin knowledge management
│   │   └── health.route.ts             # Health check endpoint
│   │
│   ├── services/                       # Business logic & core services
│   │   ├── pipeline.service.ts         # Main orchestration engine
│   │   ├── intent-registry.service.ts  # Intent registration & lookup
│   │   ├── conversationState.service.ts # Conversation state management
│   │   ├── episodic-memory.service.ts  # Long-term memory
│   │   ├── workingMemory.service.ts    # Short-term memory
│   │   ├── ollama.service.ts           # Ollama LLM integration
│   │   ├── vector.service.ts           # Vector DB operations
│   │   ├── knowledgeVector.service.ts  # Knowledge vectorization
│   │   ├── toolExecutor.service.ts     # External tool execution
│   │   ├── paramExtractor.service.ts   # LLM parameter extraction
│   │   ├── knowledge.service.ts        # Knowledge retrieval
│   │   ├── naturalization.service.ts   # Response formatting
│   │   ├── clarification.service.ts    # Clarification logic
│   │   ├── generalChat.service.ts      # Fallback general chat
│   │   ├── knowledgeIngestion.service.ts # Document ingestion
│   │   ├── embedding-cache.service.ts  # Embedding caching
│   │   ├── param-cache.service.ts      # Parameter caching
│   │   ├── rabbitmq.service.ts         # Message queue integration
│   │   └── cores/                      # Modular pipeline stages
│   │       ├── pipeline-core.ts        # Core pipeline logic
│   │       └── stages/                 # Execution stages
│   │           ├── execution.stage.ts
│   │           ├── naturalization.stage.ts
│   │           ├── continuation.stage.ts
│   │           ├── slot-filling.stage.ts
│   │           └── chat.stage.ts
│   │
│   ├── intents/                        # Intent handler implementations
│   │   ├── index.ts                    # Intent registration
│   │   ├── greeting.intent.ts          # Greeting handler
│   │   ├── xls.intent.ts               # Excel generation handler
│   │   └── [other intent handlers]
│   │
│   ├── repositories/                   # Data access layer
│   │   ├── agent.repository.ts
│   │   ├── intent.repository.ts
│   │   ├── knowledge.repository.ts
│   │   ├── knowledgeSource.repository.ts
│   │   └── tool.repository.ts
│   │
│   ├── database/                       # Database configuration
│   │   ├── connection.ts               # DB connection setup
│   │   ├── config.js                   # Sequelize config
│   │   ├── migrations/                 # Database migrations
│   │   ├── models/                     # Sequelize models
│   │   └── seeders/                    # Database seeders
│   │
│   ├── config/                         # Application configuration
│   │   └── [environment configs]
│   │
│   ├── types/                          # TypeScript type definitions
│   │   ├── index.ts
│   │   ├── agent.types.ts
│   │   ├── episodic-memory.types.ts
│   │   ├── planner.types.ts
│   │   └── [other types]
│   │
│   ├── utils/                          # Utility functions
│   │   ├── logger.util.ts
│   │   ├── pipeline-formatter.util.ts
│   │   ├── async-helpers.util.ts
│   │   └── [other utilities]
│   │
│   ├── plugins/                        # Fastify plugins
│   │   └── swagger.plugin.ts           # Swagger documentation
│   │
│   └── middleware/                     # Express-like middleware
│       └── [middleware implementations]
│
├── migrations/                         # Database migration files
├── config/                             # Config templates
├── seeders/                            # Database seeders
│
├── .env                                # Environment variables (local)
├── .env.example                        # Environment template
├── .sequelizerc                        # Sequelize CLI config
├── tsconfig.json                       # TypeScript configuration
├── package.json                        # Dependencies & scripts
├── package-lock.json
│
├── AGENT.md                            # Detailed agent implementation docs
├── README.md                           # This file
└── dist/                               # Compiled JavaScript output
```

---

## 📋 Prerequisites

Sebelum instalasi, pastikan sistem Anda memiliki:

- **Node.js**: v18.0.0 atau lebih tinggi
- **npm** atau **yarn**: Package manager
- **PostgreSQL**: v12 atau lebih tinggi
- **Redis**: v6 atau lebih tinggi (untuk caching & session)
- **Ollama**: Untuk local LLM inference
- **ChromaDB**: Vector database (atau jalankan via Docker)
- **RabbitMQ** (opsional): Untuk async task processing
- **MinIO** (opsional): Untuk file storage
- **Docker** (recommended): Untuk containerized setup

---

## 🚀 Instalasi & Setup

### 1. Clone Repository

```bash
cd d:\Development\App
git clone <repository-url>
cd ai-intent-api-v2
```

### 2. Install Dependencies

```bash
npm install
# atau menggunakan yarn
yarn install
```

### 3. Setup Environment Variables

Buat file `.env` dari template `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` dengan konfigurasi lokal Anda.

### 4. Database Setup

```bash
# Run migrations
npm run db:migrate

# Run seeders (optional)
npm run db:seed
```

### 5. Verify Installation

```bash
npm run build
```

---

## ⚙️ Konfigurasi Environment

Buat file `.env` dengan template berikut:

```env
# ============================================================
# SERVER CONFIGURATION
# ============================================================
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=debug

# ============================================================
# DATABASE CONFIGURATION
# ============================================================
DB_HOST=localhost
DB_PORT=5432
DB_NAME=viper_db
DB_USER=postgres
DB_PASSWORD=your_password
DB_DIALECT=postgres

# ============================================================
# REDIS CONFIGURATION
# ============================================================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# ============================================================
# OLLAMA CONFIGURATION
# ============================================================
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_LLM_MODEL=qwen2.5:1.5b
OLLAMA_EMBED_MODEL=nomic-embed-text:latest
OLLAMA_TOOL_CALLING_MODEL=functiongemma:latest
OLLAMA_NATURAL_MODEL=qwen2.5:1.5b

# ============================================================
# INTENT CONFIGURATION (NEW in V3.2)
# ============================================================
# Minimum similarity score for intent matching (default: 0.75)
INTENT_SIMILARITY_THRESHOLD=0.75

# Maximum number of top intent matches to return (default: 3)
INTENT_TOP_K=3

# Confidence threshold for confident decisions (default: 0.70)
INTENT_CONFIDENT_THRESHOLD=0.70

# Threshold for clarification requests (default: 0.55)
INTENT_CLARIFY_THRESHOLD=0.55

# ============================================================
# CHROMADB CONFIGURATION
# ============================================================
CHROMADB_HOST=localhost
CHROMADB_PORT=8000

# ============================================================
# OPENAI CONFIGURATION (Optional Fallback)
# ============================================================
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-3.5-turbo

# ============================================================
# RABBITMQ CONFIGURATION (Optional)
# ============================================================
RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_USER=guest
RABBITMQ_PASSWORD=guest

# ============================================================
# MINIO CONFIGURATION (Optional)
# ============================================================
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

# ============================================================
# APPLICATION CONFIGURATION
# ============================================================
CONFIDENT_THRESHOLD=0.7
CLARIFY_THRESHOLD=0.5
MAX_CONVERSATION_HISTORY=10
SESSION_TIMEOUT=3600000
```

---

## ▶️ Menjalankan Aplikasi

### Development Mode

```bash
npm run dev
```

Aplikasi akan berjalan di `http://localhost:3000` dengan hot reload enabled.

### Production Mode

```bash
# Build
npm run build

# Start
npm start
```

### API Documentation

Akses Swagger UI di: `http://localhost:3000/docs`

---

## 📡 API Documentation

### Main Endpoint: Chat Intent

```http
POST /api/v1/intent/chat
Content-Type: application/json

{
  "user_id": "user_1",
  "app_name": "hris",
  "text": "Jam berapa sekarang di papua?",
  "chat_history": [
    {
      "role": "user",
      "content": "halo namaku ardi"
    },
    {
      "role": "assistant",
      "content": "halo ardi, ada yang bisa dibantu?"
    }
  ],
  "attributes": {
    "name": "Ardi Mahendra",
    "language": "id",
    "params": {
      "employee_id": "c0c82cb7-97d6-45c2-a1b4-41b45ab6c169",
      "department": "Engineering"
    }
  }
}
```

### Response Success

```json
{
  "success": true,
  "data": {
    "response": "Sekarang jam 14:30 WIT di Papua, cuacanya cerah dengan suhu 28°C",
    "intent": {
      "name": "get_weather",
      "confidence": 0.92,
      "executionType": "tool",
      "parameters": {
        "location": "papua",
        "include_forecast": true
      }
    },
    "conversationState": {
      "status": "completed",
      "sessionId": "sess_xyz"
    },
    "metadata": {
      "executionTime": 245,
      "model": "llama2",
      "version": "3.1.0"
    }
  },
  "timestamp": "2024-05-25T10:30:00Z"
}
```

### Response - Missing Parameters

```json
{
  "success": true,
  "data": {
    "status": "missing_parameters",
    "message": "Beberapa parameter diperlukan untuk melanjutkan",
    "clarificationQuestions": [
      "Tanggal berapa Anda ingin cuti?",
      "Berapa hari durasi cuti?"
    ],
    "conversationState": {
      "status": "pending",
      "sessionId": "sess_xyz",
      "stateKey": "user_1:hris"
    }
  }
}
```

### Health Check Endpoint

```http
GET /api/v1/health
```

---

## 🗄️ Database Schema

### Main Tables

**agents**
```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL,
  description TEXT,
  status ENUM('active', 'inactive'),
  config JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**intents**
```sql
CREATE TABLE intents (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  name VARCHAR NOT NULL,
  slug VARCHAR NOT NULL,
  description TEXT,
  examples JSONB[],
  parameters JSONB,
  executionType ENUM('tool', 'handler', 'knowledge', 'llm'),
  tools JSONB[],
  confidence_threshold FLOAT DEFAULT 0.7,
  status ENUM('active', 'inactive'),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agent_id, slug)
);
```

**knowledge**
```sql
CREATE TABLE knowledge (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  title VARCHAR NOT NULL,
  content TEXT NOT NULL,
  source_id UUID REFERENCES knowledge_sources(id),
  embedding VECTOR(1536),
  metadata JSONB,
  status ENUM('active', 'inactive'),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**conversation_states**
```sql
CREATE TABLE conversation_states (
  id UUID PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  app_name VARCHAR NOT NULL,
  agent_id UUID REFERENCES agents(id),
  state JSONB,
  pending_intent_id UUID,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, app_name)
);
```

**episodic_memory**
```sql
CREATE TABLE episodic_memory (
  id UUID PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  agent_id UUID REFERENCES agents(id),
  event_type VARCHAR,
  data JSONB,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 💡 Contoh Penggunaan

### 1. Simple Intent dengan Tool Execution

User: "Berapa gaji saya bulan ini?"

**Flow:**
```
Input → Intent Recognition (match: salary_inquiry, conf: 0.95)
      → Parameter Extraction (params: {month: 'current'})
      → Execute Tool (API: service_payroll/salary)
      → Naturalization → Response: "Gaji Anda bulan Mei adalah Rp X.XXX.XXX"
```

### 2. Multi-Turn Conversation dengan Slot Filling

**Turn 1:**
- User: "Saya mau cuti"
- Bot: "Tanggal berapa Anda ingin cuti?" (missing parameters)

**Turn 2:**
- User: "Minggu depan"
- Bot: "Berapa hari durasi cuti?" (still missing)

**Turn 3:**
- User: "3 hari"
- Bot: Execute → "Permohonan cuti Anda telah diajukan untuk 3 hari mulai [date]"

### 3. Knowledge-Based Response

User: "Apa kebijakan overtime kami?"

**Flow:**
```
Intent Recognition → retrieve_knowledge_intent
Parameter: {query: "overtime policy"}
Execute: Knowledge Retrieval (RAG) dari knowledge base
Augment prompt dengan retrieved documents
Generate response via LLM
Response: "Kebijakan overtime kami adalah..."
```

### 4. Clarification Flow

User: "Siapa yang bisa membantu?"

**Ambiguity Resolution:**
```
Multiple intents match:
- contact_hr_dept (0.65)
- contact_it_support (0.62)
- general_inquiry (0.58)

Confidence < clarifyThreshold (0.7)
Ask: "Apakah Anda butuh bantuan HR, IT Support, atau yang lain?"
```

---

## 🔧 Troubleshooting

### Issue: Embedding service tidak tersambung

**Solusi:**
```bash
# Pastikan Ollama running
ollama serve

# Atau gunakan Docker
docker run -d -p 11434:11434 ollama/ollama
```

### Issue: PostgreSQL connection failed

**Solusi:**
```bash
# Check PostgreSQL status
pg_isready -h localhost -p 5432

# Verify credentials di .env
# Check PostgreSQL is running
```

### Issue: ChromaDB connection timeout

**Solusi:**
```bash
# Jalankan ChromaDB via Docker
docker run -d -p 8000:8000 ghcr.io/chroma-core/chroma:latest
```

### Issue: LLM parameter extraction gagal

**Check:**
- Ollama model tersedia: `ollama list`
- Model memory sufficient
- Prompt format correct

### Issue: Vector similarity search lambat

**Optimization:**
- Enable embedding cache: `EMBEDDING_CACHE_ENABLED=true`
- Adjust batch size di config
- Monitor ChromaDB index size

---

## 📝 Contributing

Kontribusi sangat diterima! Silakan:

1. Fork repository
2. Buat feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push ke branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

### Development Guidelines

- Follow TypeScript strict mode
- Write unit tests untuk setiap service
- Document complex logic dengan comments
- Use conventional commits
- Run linter sebelum commit: `npm run lint`

---

## 📄 License

Distributed under the MIT License. See LICENSE file for more information.

---

## 📞 Contact & Support

Untuk pertanyaan dan support:
- **Email**: support@duluin.com
- **Issues**: GitHub Issues
- **Documentation**: Lihat AGENT.md untuk detailed technical documentation

---

## 🎯 Roadmap

- [ ] **v3.2**: Multi-modal input (voice, image, document)
- [ ] **v3.3**: Enhanced episodic memory dengan temporal reasoning
- [ ] **v3.4**: GraphRAG integration untuk complex knowledge graph
- [ ] **v3.5**: Federated learning support untuk privacy-preserving training
- [ ] **v3.6**: Advanced analytics dashboard

---

## 🏆 Acknowledgments

Built with ❤️ by the VIPER Team

- Ollama untuk LLM inference
- ChromaDB untuk vector database
- Fastify untuk blazing fast web framework
- Sequelize untuk database ORM

---

## 📋 Requirements

### Minimum Requirements

- **PostgreSQL**: v8.0+ (MySQL requires adjustment)
- **ChromaDB**: Vector storage
- **Node.js**: v18+
- **Redis**: v6+ (for caching)

### Installation & Instructions

```bash
# Install dependencies
npm install

# Run database migrations
npm run db:migrate

# Run seeders (manage data in seeder to add/remove)
npm run db:seed

# Undo seeders (to undo seed, tweak seed and seed again)
npm run db:seed undo

# Run application
npm run dev
```

### ChromaDB Installation

```bash
# Install chromadb via pip
pip install chromadb

# Run chromadb
chroma run --path ./data_db
```

---

**Last Updated**: May 25, 2026
**Version**: 3.2.0 (Modular Architecture)
**Status**: Production Ready ✅

### Key Changes in V3.2

- **Modular Pipeline Stages**: 9 modular stages for better maintainability
- **Config-Based Thresholds**: `INTENT_SIMILARITY_THRESHOLD`, `INTENT_TOP_K`
- **Resource Breakdown**: Track tools/handlers/knowledge distribution
- **Continuation Support**: Multi-turn conversation with context maintenance (e.g., "kalau bandung?")
- **Score Threshold Filtering**: Only high-confidence matches (>0.75) proceed
- **78% Code Reduction**: From 2,377 lines to ~520 lines through modular architecture

---

## 🛠️ Tech Stack Summary

| Technology | Purpose |
|------------|---------|
| **Fastify** | Web framework (high performance) |
| **TypeScript** | Type-safe development |
| **PostgreSQL** | Primary database |
| **ChromaDB** | Vector storage |
| **Redis** | Caching & session management |
| **Ollama** | Local LLM inference |
| **Node.js** | Runtime environment |