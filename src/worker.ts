import { knowledgeVectorService } from './services/knowledgeVector.service'
import { knowledgeIngestionWorker } from './workers/knowledgeIngestion.worker'

async function bootstrap() {
  console.log('Starting Knowledge Worker...')

  // init Chroma connection
  await knowledgeVectorService.init()

  // start consuming queue
  await knowledgeIngestionWorker.start()
}

bootstrap()

//node dist/worker.js