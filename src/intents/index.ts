import { intentRegistry } from '../services/intent-registry.service'
// import { weatherIntent, handleGetWeather } from './weather.intent'
// Import intent baru di sini ↓

// ============================================================
// INTENTS INITIALIZATION
// ============================================================
// Sync intents from database (DB-based routing)
// ============================================================

export async function initializeIntents(): Promise<void> {
  // Sync DB intents
  await intentRegistry.syncFromDatabase();

  console.log(`✓ Synced ${intentRegistry.getAll().length} intents from DB`)
}
