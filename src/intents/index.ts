import { intentRegistry } from '../services/intent-registry.service'
// import { weatherIntent, handleGetWeather } from './weather.intent'
// Import intent baru di sini ↓
import { handleGreeting } from './greeting.intent'
// import { productIntent, handleProduct } from './product.intent'

// ============================================================
// Daftarkan semua intent ke registry
// ============================================================
export async function registerAllIntents(): Promise<void> {

  // 1. register handler CODE FIRST
  intentRegistry.registerHandler('handleGreeting', handleGreeting)

  // 2. sync DB INTENTS
  await intentRegistry.syncFromDatabase();

  console.log(`✓ Registered ${intentRegistry.getAll().length} intents`)
}
