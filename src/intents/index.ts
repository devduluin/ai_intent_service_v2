import { intentRegistry } from '../services/intent-registry.service'
// import { weatherIntent, handleGetWeather } from './weather.intent'
// Import intent baru di sini ↓
import { handleGreeting, greetingHandlerKey } from './greeting.intent'
import { handleGenerateXls, xlsHandlerKey } from './xls.intent'
// import { productIntent, handleProduct } from './product.intent'

// ============================================================
// Daftarkan semua intent ke registry
// ============================================================
export async function registerAllIntents(): Promise<void> {

  // 1. register handler CODE FIRST
  intentRegistry.registerHandler(greetingHandlerKey, handleGreeting)
  intentRegistry.registerHandler(xlsHandlerKey, handleGenerateXls)

  // 2. sync DB INTENTS
  await intentRegistry.syncFromDatabase();

  console.log(`✓ Registered ${intentRegistry.getAll().length} intents`)
}
