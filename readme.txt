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
4. Decision tree based on score:
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
    - Return handler result
  
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

// Contoh request:
{
  user_id: "user123",
  app_name: "travel-agent",  // agent slug
  text: "Book flight to Jakarta"
}