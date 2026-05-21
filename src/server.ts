import { buildApp } from './app';
import { config } from './config';
import { connectDatabase } from './database/connection';
import { vectorService } from './services/vector.service';
import { knowledgeVectorService } from './services/knowledgeVector.service';
import { intentRegistry } from './services/intent-registry.service';
import { intentRepository } from './repositories/intent.repository';
import { registerAllIntents } from './intents';
import { knowledgeRepository } from './repositories/knowledge.repository';
import { knowledgeSourceRepository } from './repositories/knowledgeSource.repository';
import { knowledgeIngestionService } from './services/knowledgeIngestion.service';
import 'dotenv/config';

// ============================================================
// Startup Sequence
// ============================================================

async function start() {
  const app = await buildApp();

  // console.log('ENV OLLAMA:', process.env.OLLAMA_BASE_URL);

  try {
    // 1. Koneksi ke PostgreSQL
    app.log.info('Connecting to PostgreSQL...');
    await connectDatabase();

    // 2. Register handler functions ke registry
    // (handler tetap di-register dari file TS, bukan dari DB)
    app.log.info('Registering API handlers...');
    registerAllIntents();

    // 3. Load intent definitions dari PostgreSQL
    app.log.info('Loading intents from database...');
    const dbIntents = await intentRepository.findAllActive({});
    app.log.info(`Loaded ${dbIntents.length} intents from DB`);

    // 4. Init vector DB (ChromaDB)
    app.log.info('Connecting to ChromaDB...');
    await vectorService.init();
    await knowledgeVectorService.init();
    // await vectorService.resetCollection();
    // await knowledgeVectorService.resetCollection();

    // 5. Index intent dari DB ke vector DB
    app.log.info('Indexing intents into vector DB...');
    await vectorService.indexAllIntents(dbIntents);

    // 6. Ingest all knowledge sources
    app.log.info('Ingesting all knowledge sources...');
    await ingestAllKnowledge(app);

    // 7. Override registry dengan data dari DB
    // (supaya examples dari DB yang dipakai, bukan dari file)
    for (const intent of dbIntents) {
      if (!intentRegistry.hasIntent(intent.slug)) {
        app.log.warn(`No handler found for intent: ${intent.name}, skipping...`);
      }
    }

    // 8. Start server
    await app.listen({
      port: config.server.port,
      host: config.server.host,
    });

    app.log.info(`

         AI Intent API Ready 🚀

  URL   : http://${config.server.host}:${config.server.port}
  Docs  : http://localhost:${config.server.port}/docs
  Model : ${config.ollama.llmModel.padEnd(30)}
  Embed : ${config.ollama.embedModel.padEnd(30)}
  DB    : ${config.db.name.padEnd(30)}

    `.trim());
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// ============================================================
// KNOWLEDGE INGESTION ALL
// ============================================================

async function ingestAllKnowledge(app: any): Promise<void> {
  const startTime = Date.now();

  try {
    // Get all active knowledge with sources
    const allKnowledge = await knowledgeRepository.findAllActive();
    app.log.info(`Found ${allKnowledge.length} active knowledge entries`);

    let ingestedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const knowledge of allKnowledge) {
      try {
        // Get sources for this knowledge
        const sources = await knowledgeSourceRepository.findByKnowledgeId(knowledge.id);

        if (!sources || sources.length === 0) {
          app.log.warn(`No sources found for knowledge: ${knowledge.slug}, skipping...`);
          skippedCount++;
          continue;
        }

        app.log.info(`Ingesting knowledge: ${knowledge.slug} (${sources.length} sources)`);

        // Ingest each source
        for (const source of sources) {
          try {
            await knowledgeIngestionService.ingestSource(source.id);
            app.log.info(`✓ Ingested source: ${source.type} - ${source.url?.substring(0, 50) || 'text'}`);
            ingestedCount++;
          } catch (sourceError) {
            app.log.error(`Failed to ingest source ${source.id}:`, sourceError);
            failedCount++;
          }
        }

        app.log.info(`✓ Completed knowledge: ${knowledge.slug}`);
      } catch (knowledgeError) {
        app.log.error(`Failed to process knowledge ${knowledge.slug}:`, knowledgeError);
        failedCount++;
      }
    }

    const duration = Date.now() - startTime;

    app.log.info('Knowledge ingestion completed', {
      totalKnowledge: allKnowledge.length,
      ingested: ingestedCount,
      failed: failedCount,
      skipped: skippedCount,
      durationMs: duration,
      durationSec: (duration / 1000).toFixed(2)
    });
  } catch (error) {
    app.log.error('Knowledge ingestion failed:', error);
    throw error;
  }
}

process.on('SIGTERM', () => { console.log('Shutting down...'); process.exit(0); });
process.on('SIGINT', () => { console.log('Shutting down...'); process.exit(0); });

start();
