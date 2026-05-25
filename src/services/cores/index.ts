/**
 * Core Services - Barrel Export
 * 
 * Main entry point for all core pipeline modules:
 * - PipelineCore: Main orchestrator
 * - Stages: Pipeline processing stages
 * - Resolvers: Multi-turn conversation resolvers
 * - Injectors: Context injectors
 * - Validators: Validation logic
 */

// Main orchestrator
export { PipelineCore, type PipelineCoreConfig, type PipelineExecutionContext } from './pipeline-core';

// Stages
export {
  PreProcessingStage,
  EmbeddingStage,
  IntentMatchingStage,
  PlannerStage,
  ExecutionStage,
  NaturalizationStage
} from './stages';

// Resolvers
export {
  ContinuationResolver,
  SlotFillingResolver
} from './resolvers';

// Injectors
export {
  TemporalInjector,
  EntityInjector
} from './injectors';

// Validators
export {
  PlanValidator,
  SignalValidator
} from './validators';
