import { buildApp } from './app';
import { config } from './config';
import { connectDatabase } from './database/connection';
import { vectorService } from './services/vector.service';
import { knowledgeVectorService } from './services/knowledgeVector.service';
import { intentRegistry } from './services/intent-registry.service';
import { intentRepository } from './repositories/intent.repository';
import { initializeIntents } from './intents';
import { initializeInternalSkills } from './skills';
import { schedulerRunnerService } from './services/automation/scheduler-runner.service';
import { knowledgeRepository } from './repositories/knowledge.repository';
import { knowledgeSourceRepository } from './repositories/knowledgeSource.repository';
import { knowledgeIngestionService } from './services/knowledgeIngestion.service';
const fastifyWebSocket = require('@fastify/websocket');
const fastifyStatic = require('@fastify/static')
import 'dotenv/config';

// ============================================================
// Startup Sequence
// ============================================================

async function start() {
  const app = await buildApp();

  // console.log('ENV OLLAMA:', process.env.OLLAMA_BASE_URL);

  try {
    // 0.5. Register WebSocket if enabled
    if (process.env.ENABLE_WEBSOCKET === 'true') {
      app.log.info('Registering WebSocket...');
      await app.register(fastifyWebSocket as any, {
        options: {
          maxPayload: 1048576, // 1MB
          verifyClient: (info: any, next: any) => {
            app.log.debug('WebSocket client connecting from ' + info.origin);
            next(true);
          }
        } as any
      });
      app.log.info('WebSocket registered successfully');
    } else {
      app.log.info('WebSocket disabled (set ENABLE_WEBSOCKET=true to enable)');
    }

    // 0.6. Start automation scheduler
    app.log.info('Starting automation scheduler...');
    schedulerRunnerService.start();
    app.log.info('Automation scheduler started successfully - checking jobs every minute');

    // 1. Koneksi ke PostgreSQL
    app.log.info('Connecting to PostgreSQL...');
    await connectDatabase();

    // 2. Initialize internal skills (auto-discovery from skills/ folder)
    app.log.info('Initializing internal skills...');
    await initializeInternalSkills();

    // 3. Load intent definitions dari PostgreSQL (DB-based routing)
    app.log.info('Loading intents from database...');
    await initializeIntents();
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
    // await vectorService.indexAllIntents(dbIntents);

    // 6. Ingest all knowledge sources
    app.log.info('Ingesting all knowledge sources...');
    // await ingestAllKnowledge(app);

    // 7. Override registry dengan data dari DB
    // (supaya examples dari DB yang dipakai, bukan dari file)
    for (const intent of dbIntents) {
      if (!intentRegistry.hasIntent(intent.slug)) {
        app.log.warn(`No handler found for intent: ${intent.name}, skipping...`);
      }
    }

    // 7.5. Serve static files for chat UI (if exists)
    app.log.info('Registering static file serving...');
    await app.register(fastifyStatic, {
      root: require('path').join(__dirname, '../src/test/html'),
      prefix: '/test/html/',
      decorateReply: false
    });
    app.log.info('Static files served at /test/html/');

    // 7.6. Register WebSocket chat route (if enabled)
    if (process.env.ENABLE_WEBSOCKET === 'true') {
      app.log.info('Registering WebSocket chat route...');
      const { chatWsRoute } = await import('./routes/chat-ws.route');
      await app.register(chatWsRoute, { prefix: '/api/v1' });
      app.log.info('WebSocket chat route registered at /api/v1/chat-ws');
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

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  schedulerRunnerService.stop();
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('Shutting down...');
  schedulerRunnerService.stop();
  process.exit(0);
});

start();
