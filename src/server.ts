import { buildApp } from './app'
import { config } from './config'
import { connectDatabase } from './database/connection'
import { vectorService } from './services/vector.service'
import { knowledgeVectorService } from './services/knowledgeVector.service'
import { intentRegistry } from './services/intent-registry.service'
import { intentRepository } from './repositories/intent.repository'
import { registerAllIntents } from './intents'
import 'dotenv/config'

// ============================================================
// Startup Sequence
// ============================================================

async function start() {
  const app = await buildApp()

  // console.log('ENV OLLAMA:', process.env.OLLAMA_BASE_URL)

  try {
    // 1. Koneksi ke PostgreSQL
    app.log.info('Connecting to PostgreSQL...')
    await connectDatabase()

    // 2. Register handler functions ke registry
    // (handler tetap di-register dari file TS, bukan dari DB)
    app.log.info('Registering API handlers...')
    registerAllIntents()

    // 3. Load intent definitions dari PostgreSQL
    app.log.info('Loading intents from database...')
    const dbIntents = await intentRepository.findAllActive({})
    app.log.info(`Loaded ${dbIntents.length} intents from DB`)

    // 4. Init vector DB (ChromaDB)
    app.log.info('Connecting to ChromaDB...')
    await vectorService.init()
    await knowledgeVectorService.init()
    await vectorService.resetCollection()

    // 5. Index intent dari DB ke vector DB
    app.log.info('Indexing intents into vector DB...')
    await vectorService.indexAllIntents(dbIntents)

    // 6. Override registry dengan data dari DB
    // (supaya examples dari DB yang dipakai, bukan dari file)
    for (const intent of dbIntents) {
      if (!intentRegistry.hasIntent(intent.slug)) {
        app.log.warn(`No handler found for intent: ${intent.name}, skipping...`)
      }
    }

    // 7. Start server
    await app.listen({
      port: config.server.port,
      host: config.server.host,
    })

    app.log.info(`

         AI Intent API Ready 🚀           

  URL   : http://${config.server.host}:${config.server.port}
  Docs  : http://localhost:${config.server.port}/docs
  Model : ${config.ollama.llmModel.padEnd(30)}
  Embed : ${config.ollama.embedModel.padEnd(30)}
  DB    : ${config.db.name.padEnd(30)}

    `.trim())
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

process.on('SIGTERM', () => { console.log('Shutting down...'); process.exit(0) })
process.on('SIGINT',  () => { console.log('Shutting down...'); process.exit(0) })

start()
