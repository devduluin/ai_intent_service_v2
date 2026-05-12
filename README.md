                ┌──────────────┐
User Input ───► │   INTENT     │  (Router)
                └──────┬───────┘
                       │
     ┌─────────────────┼──────────────────┐
     │                 │                  │
 tool mapping     knowledge mapping   handlerKey
     │                 │                  │
Tool API          RAG / FAQ DB        internal function

Stage 0: Pre-processing & State Check
1. Validasi agent (exists & active)
2. Check pending conversation state
   - Jika ada → resume intent
   - Jika cancel → clear state
3. Jika pending & user switch intent → clear state, process new intent

Stage 1: Intent Recognition
1. Generate embedding dari user input (Ollama)
2. Vector similarity search terhadap semua intent agent
3. Sort matches by score (descending)
4. Decision tree agoritma based on score:
   - >= confidentThreshold → proceed to extraction
   - >= clarifyThreshold → ask clarification
   - < clarifyThreshold → general chat

Stage 2: Parameter Extraction & Validation
1. Extract parameters menggunakan LLM
2. Validate required parameters
3. If missing:
   - Save state ke conversationStateService
   - Generate pertanyaan untuk parameter yang kurang
   - Return "missing_parameters" response
4. If complete → proceed to execution

Stage 3: Intent Execution
switch(executionType) {
  case 'tool':
    - Get primary tool (by priority)
    - Execute via toolExecutorService
    - Return API result
  
  case 'handler':
    - Get registered handler function
    - Execute with params + context
    - Store handler at src/intent and register in index.ts
  
  case 'knowledge':
    - Retrieve relevant knowledge documents
    - Augment prompt with knowledge
    - Generate response via LLM
  
  case 'llm':
    - Direct LLM call with params
    - Return natural language response
}

Stage 4: Naturalization
1. Ambil raw result dari execution
2. Convert ke natural language via Ollama
3. Personalize based on user language
4. Return final response

Error Types
- embed: Gagal generate embedding
- api: Gagal extract parameter atau eksekusi
- naturalize: LLM naturalisasi gagal
- unknown: Unknown pipeline error

Multi-tenant Architecture
// Setiap agent memiliki isolasi:
- Intent database (filter by agentId)
- Knowledge base (filter by agentId)
- Tools mapping (filter by agentId)
- Conversation state (key: user_id:app_name)


// example request:

POST http://0.0.0.0:3000/api/v1/intent/chat

payload raw :
{
  "user_id": "user_1",
  "app_name": "hris",
  "text": "Jam berapa sekarang di papua, bagaimana cuaca disana dan Bagaimana jika lupa absen, atau saya mau izin?",
//   "chat_history": [
//     { "role": "user", "content": "halo namaku ardi" },
//     { "role": "assistant", "content": "halo, ada yang bisa dibantu?" }
//   ],
  "attributes": {
    "name": "Ardi Mahendra",
    // param injection ke tools contoh url tool ;
    //  http:service_attendance/attendace?employee_id={employee_id} -> replacing value
    "params": {
        "employee_id" :"c0c82cb7-97d6-45c2-a1b4-41b45ab6c169"
    }
  }
}

response :
{
    "success": true,
    "response": "\"Untuk info cuaca, silakan jelaskan kota mana yang ingin Anda ketahui.\"",
    "intent": "missing_parameters",
    "confidence": 0.82,
    "metadata": {
        "totalTime": 14893
    }
}

----Requirment----
  - postgree min 8.0 // mysql need adjustment
  - chroma db // vector storage

---Installation & Instruction---
  - npm install
  - npm run db:migrate
  - npm run db:seed //manage data di seeder to add/remove
  - npm run db:seed undo // untuk undo seed tweek seed dan seed lagi

npm run dev // untuk running app

1 install chroma db
  - pip install chromadb
  - chroma run --path ./data_db

---Stack---
  - Fastify
  - Typescript